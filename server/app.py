#!/usr/bin/env python3
"""Asipad kiosk local server.

Serves the kiosk frontend, an admin UI, and a small power API on port 8080.
- Bound on 0.0.0.0 so the admin UI is reachable from another computer on the LAN.
- /api/shutdown and /api/reboot are accepted only from 127.0.0.1.
- /admin and /admin/* require HTTP basic auth (see ADMIN_PW_FILE).
"""
import io
import ipaddress
import json
import logging
import os
import re
import secrets
import subprocess
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_from_directory
from PIL import Image, ImageOps

try:
    from icalendar import Calendar, Event as IcalEvent
    from dateutil.rrule import rrulestr
    ICAL_AVAILABLE = True
except ImportError:
    ICAL_AVAILABLE = False

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DATA = ROOT / "data"
BG_DIR = DATA / "bg"
JOBS_DIR = DATA / "jobs"
STORIES_DIR = DATA / "stories"
STORY_IMG_DIR = STORIES_DIR / "img"
CURRENT_BG_FILE = DATA / "current-bg.txt"
ACTIVE_STORIES_FILE = STORIES_DIR / "active.txt"
CONFIG_FILE = DATA / "config.json"
EVENTS_FILE = DATA / "events.json"
COINS_FILE = DATA / "coins.json"
GIF_COSTS_FILE = DATA / "gif_costs.json"
DEFAULT_GIF_COST = 9
GIF_UNLOCK_SECONDS = 3 * 60

DEFAULT_CONFIG = {
    "heading": "ASIPad",
    "level": "easy",
    "gender": "female",
    "admin_lang": "no",
    "kiosk_lang": "no",
    "show_logo": True,
    "show_heading": True,
    "lock_pattern": [],
    "time_budget_minutes": 15,
    "time_extension_pattern": ["red", "green", "blue", "blue", "green", "red"],
    "time_extension_options": [10, 15, 20],
}
LEVEL_VALUES = ("easy", "medium", "hard")
GENDER_VALUES = ("male", "female")
LANG_VALUES = ("no", "en", "ua")
LOCK_COLORS = ("red", "orange", "yellow", "green", "blue", "violet")
LEGACY_LEVEL_MAP = {"lett": "easy", "medium": "medium", "vanskelig": "hard"}
DATA.mkdir(exist_ok=True)
BG_DIR.mkdir(exist_ok=True)
JOBS_DIR.mkdir(exist_ok=True)
STORIES_DIR.mkdir(exist_ok=True)
STORY_IMG_DIR.mkdir(exist_ok=True)
INDEX = FRONTEND / "index.html"

JOB_ID_RE = re.compile(r"^\d+$")
STORY_ID_RE = re.compile(r"^\d+$")
MAX_JOB_BYTES = 64 * 1024  # 64 KiB per text file is plenty for kid notes
MAX_STORY_BYTES = 256 * 1024  # 256 KiB per story (text only — images live separately)
MAX_ACTIVE_STORIES = 3

ADMIN_PW_FILE = Path.home() / ".asipad-admin-password"
DEFAULT_ADMIN_PASSWORD = "asipad"

ALLOWED_BG = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_UPLOAD_BYTES = 16 * 1024 * 1024  # 16 MiB before resize (images)
MAX_VIDEO_BYTES = 200 * 1024 * 1024  # 200 MiB per video — kid clips, not movies
MAX_BG_DIM = (1280, 720)             # display resolution; larger doesn't help cog
WEBP_QUALITY = 78
ALLOWED_VIDEO = {".mp4", ".webm", ".mov", ".m4v"}
ALLOWED_TRAINING_MEDIA = ALLOWED_BG | ALLOWED_VIDEO  # gif/png/webp/jpg + video


def _migrate_legacy_bg() -> None:
    """Move pre-library background.<ext> into data/bg/ on first run."""
    legacy = sorted(DATA.glob("background.*"))
    if not legacy:
        return
    src = legacy[0]
    ts = int(src.stat().st_mtime)
    dst = BG_DIR / f"{ts}{src.suffix.lower()}"
    if not dst.exists():
        src.rename(dst)
        CURRENT_BG_FILE.write_text(dst.name)
    # Clean up any duplicates
    for extra in legacy[1:]:
        extra.unlink(missing_ok=True)


_migrate_legacy_bg()

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = max(MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES) + 8192
log = logging.getLogger("asipad")


def admin_password() -> str:
    if ADMIN_PW_FILE.exists():
        pw = ADMIN_PW_FILE.read_text().strip()
        if pw:
            return pw
    return DEFAULT_ADMIN_PASSWORD


def require_admin():
    auth = request.authorization
    expected = admin_password()
    if (
        auth is None
        or auth.username != "admin"
        or not secrets.compare_digest(auth.password or "", expected)
    ):
        return Response(
            "Authentication required\n",
            401,
            {"WWW-Authenticate": 'Basic realm="asipad-admin"'},
        )
    return None


def require_local():
    if request.remote_addr not in ("127.0.0.1", "::1"):
        abort(403)


# --- LAN-only access ----------------------------------------------------
# The server binds 0.0.0.0:8080 because the kiosk itself talks to it via
# 127.0.0.1 *and* the admin laptop talks to it via the Pi's LAN IP. To stop
# anything beyond the local network from poking at the API (e.g. if the Pi
# ever ends up behind a misconfigured port-forward or on a hostile Wi-Fi),
# every request goes through a CIDR allowlist before any route runs.
#
# Defaults to RFC1918 + loopback + IPv6 link-local/ULA. Override with the
# ASIPAD_ALLOWED_CIDRS env var (comma-separated). Disable for development
# only with ASIPAD_ALLOW_ALL=1.

DEFAULT_LAN_CIDRS = (
    "127.0.0.0/8",
    "::1/128",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "fe80::/10",
    "fc00::/7",
)


def _parse_cidrs(raw: str | None) -> tuple:
    cidrs = (raw or ",".join(DEFAULT_LAN_CIDRS)).split(",")
    nets = []
    for token in cidrs:
        token = token.strip()
        if not token:
            continue
        try:
            nets.append(ipaddress.ip_network(token, strict=False))
        except ValueError:
            logging.getLogger("asipad").warning("ignoring invalid CIDR %r", token)
    return tuple(nets)


LAN_CIDRS = _parse_cidrs(os.environ.get("ASIPAD_ALLOWED_CIDRS"))
ALLOW_ALL = os.environ.get("ASIPAD_ALLOW_ALL") == "1"


def _is_lan(addr: str | None) -> bool:
    if not addr:
        return False
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    for net in LAN_CIDRS:
        if ip.version == net.version and ip in net:
            return True
    return False


@app.before_request
def _enforce_lan_only():
    if ALLOW_ALL:
        return
    if not _is_lan(request.remote_addr):
        abort(403)


def current_background():
    if not CURRENT_BG_FILE.exists():
        return None
    name = CURRENT_BG_FILE.read_text().strip()
    if not name:
        return None
    p = BG_DIR / name
    return p if p.exists() and p.is_file() else None


def list_backgrounds():
    if not BG_DIR.exists():
        return []
    return sorted(
        (f for f in BG_DIR.iterdir() if f.is_file() and f.suffix.lower() in ALLOWED_BG),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )


def _normalize_bg(file_storage) -> bytes:
    """Read an uploaded image, fix orientation, downscale to MAX_BG_DIM,
    re-encode to WebP. Keeps the kiosk's decoded RAM footprint bounded."""
    img = Image.open(file_storage.stream)
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    img.thumbnail(MAX_BG_DIM, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=WEBP_QUALITY, method=4)
    return buf.getvalue()


def _generate_gif_poster(gif_path: Path, poster_path: Path) -> bool:
    """First-frame JPG so the gallery tile can be a still image instead
    of an animated GIF (avoids 6 simultaneously-animating tiles eating
    CPU on the Pi). Pillow handles GIF and animated WebP."""
    try:
        with Image.open(gif_path) as im:
            im.seek(0)
            frame = im.convert("RGB")
            frame.thumbnail((640, 640), Image.LANCZOS)
            frame.save(poster_path, "JPEG", quality=82)
        return poster_path.is_file()
    except Exception as e:
        log.warning("gif poster generation skipped: %s", e)
        return False


def _generate_video_poster(video_path: Path, poster_path: Path) -> bool:
    """Run ffmpeg to extract a single frame near the start of `video_path`
    as a 480-px-wide JPG at `poster_path`. Returns True on success.
    Failures (missing ffmpeg, corrupt input) are logged and ignored — the
    gallery falls back to the bare video element."""
    try:
        r = subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", "0.5",
                "-i", str(video_path),
                "-frames:v", "1",
                "-vf", "scale=480:-2",
                "-q:v", "4",
                str(poster_path),
            ],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        return r.returncode == 0 and poster_path.is_file()
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        log.warning("video poster generation skipped: %s", e)
        return False


LOCALES_DIR = FRONTEND / "locales"


def load_locale_dict(code: str) -> dict:
    """Read a locale JSON file. Falls back to Norwegian on miss/parse error."""
    if code not in LANG_VALUES:
        code = "no"
    p = LOCALES_DIR / f"{code}.json"
    if not p.exists():
        p = LOCALES_DIR / "no.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _i18n_inline(locale: str) -> str:
    data = load_locale_dict(locale)
    return (
        "<script>window.__I18N__ = "
        + json.dumps({"locale": locale, "dict": data}, ensure_ascii=False)
        + ";</script>"
    )


@app.route("/")
def index():
    # Inline CSS + i18n + JS into the HTML so a cold load is one HTTP request
    # instead of four. The frontend keeps separate files for editing —
    # the server splices them at request time.
    cfg = load_config()
    html = (FRONTEND / "index.html").read_text()
    css = (FRONTEND / "style.css").read_text()
    i18n_js = (FRONTEND / "i18n.js").read_text()
    js = (FRONTEND / "app.js").read_text()
    html = html.replace(
        '<link rel="stylesheet" href="style.css">',
        f"<style>\n{css}\n</style>",
    )
    html = html.replace(
        '<script src="i18n.js"></script>',
        _i18n_inline(cfg.get("kiosk_lang", "no")) + f"\n<script>\n{i18n_js}\n</script>",
    )
    html = html.replace(
        '<script src="app.js"></script>',
        f"<script>\n{js}\n</script>",
    )
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.get("/admin")
def admin_index():
    if (resp := require_admin()) is not None:
        return resp
    cfg = load_config()
    html = (FRONTEND / "admin.html").read_text()
    i18n_js = (FRONTEND / "i18n.js").read_text()
    html = html.replace(
        '<script src="i18n.js"></script>',
        _i18n_inline(cfg.get("admin_lang", "no")) + f"\n<script>\n{i18n_js}\n</script>",
    )
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.get("/locales/<code>.json")
def serve_locale(code):
    if code not in LANG_VALUES:
        return jsonify({}), 404
    p = LOCALES_DIR / f"{code}.json"
    if not p.exists():
        return jsonify({}), 404
    return send_from_directory(LOCALES_DIR, f"{code}.json", mimetype="application/json; charset=utf-8")


# Static assets — logos, icons. Restricted to a handful of safe extensions so
# this can't be used to read arbitrary repo files.
ASSETS_DIR = ROOT / "assets"
_ALLOWED_ASSET_EXT = {".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico"}


@app.get("/assets/<path:name>")
def serve_asset(name):
    if "/" in name or "\\" in name or name.startswith("."):
        return ("", 404)
    p = ASSETS_DIR / name
    if not p.is_file() or p.suffix.lower() not in _ALLOWED_ASSET_EXT:
        return ("", 404)
    return send_from_directory(ASSETS_DIR, name)


@app.post("/admin/background")
def admin_upload_bg():
    if (resp := require_admin()) is not None:
        return resp
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify(error="missing file"), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_BG:
        return jsonify(error=f"extension {ext} not allowed"), 400
    try:
        data = _normalize_bg(file)
    except Exception as e:
        return jsonify(error=f"could not process image: {e}"), 400
    BG_DIR.mkdir(exist_ok=True)
    name = f"{int(time.time())}.webp"
    target = BG_DIR / name
    target.write_bytes(data)
    CURRENT_BG_FILE.write_text(name)
    return jsonify(
        ok=True,
        version=int(target.stat().st_mtime),
        id=name,
        bytes=len(data),
    )


@app.post("/admin/background/clear")
def admin_clear_bg():
    if (resp := require_admin()) is not None:
        return resp
    if CURRENT_BG_FILE.exists():
        CURRENT_BG_FILE.unlink()
    return jsonify(ok=True)


@app.post("/admin/background/delete")
def admin_delete_bg():
    if (resp := require_admin()) is not None:
        return resp
    body = request.get_json(silent=True) or {}
    name = body.get("id", "")
    if not name or "/" in name or ".." in name:
        return jsonify(error="bad id"), 400
    p = BG_DIR / name
    if not p.is_file():
        return jsonify(error="not found"), 404
    p.unlink()
    cur = current_background()
    if cur is None or cur.name == name:
        if CURRENT_BG_FILE.exists():
            CURRENT_BG_FILE.unlink()
    return jsonify(ok=True)


@app.get("/background")
def background():
    bg = current_background()
    if bg is None:
        return ("", 204)
    return send_from_directory(BG_DIR, bg.name, max_age=0)


@app.get("/api/backgrounds")
def api_backgrounds():
    cur = current_background()
    cur_name = cur.name if cur else None
    items = []
    for f in list_backgrounds():
        mtime = int(f.stat().st_mtime)
        items.append({
            "id": f.name,
            "url": f"/api/backgrounds/{f.name}?v={mtime}",
            "current": f.name == cur_name,
            "mtime": mtime,
        })
    return jsonify(items)


@app.get("/api/backgrounds/<name>")
def api_background_file(name):
    if "/" in name or ".." in name:
        abort(400)
    return send_from_directory(BG_DIR, name, max_age=0)


@app.post("/api/backgrounds/use")
def api_set_background():
    body = request.get_json(silent=True) or {}
    name = body.get("id", "")
    if not name or "/" in name or ".." in name:
        return jsonify(error="bad id"), 400
    p = BG_DIR / name
    if not p.is_file():
        return jsonify(error="not found"), 404
    CURRENT_BG_FILE.write_text(name)
    return jsonify(ok=True, version=int(p.stat().st_mtime))


# --- BILDER: picture gallery (FRITID/BILDER) ---

PICTURES_DIR = DATA / "pictures"
PICTURES_DIR.mkdir(exist_ok=True)


def list_pictures():
    if not PICTURES_DIR.exists():
        return []
    return sorted(
        (f for f in PICTURES_DIR.iterdir() if f.is_file() and f.suffix.lower() in ALLOWED_BG),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )


@app.get("/api/pictures")
def api_pictures():
    items = []
    for f in list_pictures():
        mtime = int(f.stat().st_mtime)
        items.append({
            "id": f.name,
            "url": f"/api/pictures/{f.name}?v={mtime}",
            "mtime": mtime,
        })
    return jsonify(items)


@app.get("/api/pictures/<name>")
def api_picture_file(name):
    if "/" in name or ".." in name:
        abort(400)
    return send_from_directory(PICTURES_DIR, name, max_age=0)


@app.post("/admin/pictures")
def admin_upload_picture():
    if (resp := require_admin()) is not None:
        return resp
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify(error="missing file"), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_BG:
        return jsonify(error=f"extension {ext} not allowed"), 400
    try:
        data = _normalize_bg(file)
    except Exception as e:
        return jsonify(error=f"could not process image: {e}"), 400
    name = f"{int(time.time() * 1000)}.webp"
    (PICTURES_DIR / name).write_bytes(data)
    return jsonify(ok=True, id=name, bytes=len(data))


@app.post("/admin/pictures/delete")
def admin_delete_picture():
    if (resp := require_admin()) is not None:
        return resp
    body = request.get_json(silent=True) or {}
    name = body.get("id", "")
    if not name or "/" in name or ".." in name:
        return jsonify(error="bad id"), 400
    p = PICTURES_DIR / name
    if not p.is_file():
        return jsonify(error="not found"), 404
    p.unlink()
    return jsonify(ok=True)


# --- LEI FILM: paid rental gallery (FRITID/GIF) ---
# Accepts animated images (gif/webp, played as <img> via WebKit's image
# pipeline) AND short video clips (mp4/webm/mov/m4v, played as <video>).
# The route stays "gif" for backward compat, but the section serves both.
# Pi Zero 2 W couldn't decode H.264 under WPE — videos work fine on the
# current hardware (Rock 2F / Mali-450 / lima), and gracefully fall back
# to image-only if you ever flash this onto weaker hardware.

GIFS_DIR = DATA / "gifs"
GIFS_DIR.mkdir(exist_ok=True)
ALLOWED_GIF_IMAGE = {".gif", ".webp"}
ALLOWED_GIF_VIDEO = {".mp4", ".webm", ".mov", ".m4v"}
ALLOWED_GIF = ALLOWED_GIF_IMAGE | ALLOWED_GIF_VIDEO
MAX_GIF_BYTES = 200 * 1024 * 1024  # 200 MiB — covers both GIFs and MP4 rentals


def list_gifs():
    if not GIFS_DIR.exists():
        return []
    return sorted(
        (f for f in GIFS_DIR.iterdir() if f.is_file() and f.suffix.lower() in ALLOWED_GIF),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )


def load_gif_costs() -> dict:
    if not GIF_COSTS_FILE.exists():
        return {}
    try:
        d = json.loads(GIF_COSTS_FILE.read_text())
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def save_gif_costs(d: dict) -> None:
    GIF_COSTS_FILE.write_text(json.dumps(d, ensure_ascii=False, indent=2))


def gif_cost_for(name: str, costs: dict | None = None) -> int:
    """A per-GIF override or the default. 0 means free."""
    if costs is None:
        costs = load_gif_costs()
    if name in costs:
        try:
            return max(0, int(costs[name]))
        except (TypeError, ValueError):
            return DEFAULT_GIF_COST
    return DEFAULT_GIF_COST


@app.get("/api/gifs")
def api_gifs():
    costs = load_gif_costs()
    items = []
    for f in list_gifs():
        mtime = int(f.stat().st_mtime)
        kind = "video" if f.suffix.lower() in ALLOWED_GIF_VIDEO else "image"
        item = {
            "id": f.name,
            "url": f"/api/gifs/{f.name}?v={mtime}",
            "mtime": mtime,
            "cost": gif_cost_for(f.name, costs),
            "kind": kind,
        }
        poster = f.with_suffix(".jpg")
        if poster.is_file():
            item["poster_url"] = f"/api/gifs/{poster.name}?v={int(poster.stat().st_mtime)}"
        items.append(item)
    return jsonify(items)


@app.post("/admin/gifs/cost")
def admin_set_gif_cost():
    if (resp := require_admin()) is not None:
        return resp
    body = request.get_json(silent=True) or {}
    name = str(body.get("id") or "")
    if not name or "/" in name or ".." in name:
        return jsonify(error="bad id"), 400
    if not (GIFS_DIR / name).is_file():
        return jsonify(error="not found"), 404
    try:
        cost = int(body.get("cost"))
    except (TypeError, ValueError):
        return jsonify(error="bad cost"), 400
    if cost < 0:
        return jsonify(error="bad cost"), 400
    costs = load_gif_costs()
    if cost == DEFAULT_GIF_COST:
        costs.pop(name, None)  # don't store entries that match the default
    else:
        costs[name] = cost
    save_gif_costs(costs)
    return jsonify(ok=True, id=name, cost=cost)


@app.get("/api/gifs/<name>")
def api_gif_file(name):
    if "/" in name or ".." in name:
        abort(400)
    return send_from_directory(GIFS_DIR, name, max_age=0)


@app.post("/admin/gifs")
def admin_upload_gif():
    if (resp := require_admin()) is not None:
        return resp
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify(error="missing file"), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_GIF:
        return jsonify(error=f"extension {ext} not allowed"), 400
    name = f"{int(time.time() * 1000)}{ext}"
    target = GIFS_DIR / name
    file.save(target)
    size = target.stat().st_size
    if size > MAX_GIF_BYTES:
        target.unlink()
        return jsonify(error="file too large"), 413
    poster = target.with_suffix(".jpg")
    if ext in ALLOWED_GIF_VIDEO:
        poster_ok = _generate_video_poster(target, poster)
    else:
        poster_ok = _generate_gif_poster(target, poster)
    return jsonify(
        ok=True, id=name, bytes=size,
        poster_url=f"/api/gifs/{poster.name}" if poster_ok else None,
    )


@app.post("/admin/gifs/delete")
def admin_delete_gif():
    if (resp := require_admin()) is not None:
        return resp
    body = request.get_json(silent=True) or {}
    name = body.get("id", "")
    if not name or "/" in name or ".." in name:
        return jsonify(error="bad id"), 400
    p = GIFS_DIR / name
    if not p.is_file():
        return jsonify(error="not found"), 404
    p.unlink()
    poster = p.with_suffix(".jpg")
    if poster.is_file():
        poster.unlink()
    costs = load_gif_costs()
    if name in costs:
        del costs[name]
        save_gif_costs(costs)
    return jsonify(ok=True)


# --- VIDEO: video gallery (FRITID/VIDEO) ---

VIDEOS_DIR = DATA / "videos"
VIDEOS_DIR.mkdir(exist_ok=True)


def list_videos():
    if not VIDEOS_DIR.exists():
        return []
    return sorted(
        (f for f in VIDEOS_DIR.iterdir() if f.is_file() and f.suffix.lower() in ALLOWED_VIDEO),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )


def _video_poster_path(video: Path) -> Path:
    return video.with_suffix(".jpg")


@app.get("/api/videos")
def api_videos():
    items = []
    for f in list_videos():
        mtime = int(f.stat().st_mtime)
        poster = _video_poster_path(f)
        item = {
            "id": f.name,
            "url": f"/api/videos/{f.name}?v={mtime}",
            "mtime": mtime,
        }
        if poster.is_file():
            item["poster_url"] = f"/api/videos/{poster.name}?v={int(poster.stat().st_mtime)}"
        items.append(item)
    return jsonify(items)


@app.get("/api/videos/<name>")
def api_video_file(name):
    if "/" in name or ".." in name:
        abort(400)
    # conditional=True so Werkzeug honours Range requests — required for
    # in-browser seek without re-downloading the whole clip.
    return send_from_directory(VIDEOS_DIR, name, max_age=0, conditional=True)


@app.post("/admin/videos")
def admin_upload_video():
    if (resp := require_admin()) is not None:
        return resp
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify(error="missing file"), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_VIDEO:
        return jsonify(error=f"extension {ext} not allowed"), 400
    name = f"{int(time.time() * 1000)}{ext}"
    target = VIDEOS_DIR / name
    file.save(target)
    size = target.stat().st_size
    if size > MAX_VIDEO_BYTES:
        target.unlink()
        return jsonify(error="file too large"), 413
    poster = _video_poster_path(target)
    poster_ok = _generate_video_poster(target, poster)
    return jsonify(
        ok=True, id=name, bytes=size,
        poster_url=f"/api/videos/{poster.name}" if poster_ok else None,
    )


@app.post("/admin/videos/delete")
def admin_delete_video():
    if (resp := require_admin()) is not None:
        return resp
    body = request.get_json(silent=True) or {}
    name = body.get("id", "")
    if not name or "/" in name or ".." in name:
        return jsonify(error="bad id"), 400
    p = VIDEOS_DIR / name
    if not p.is_file():
        return jsonify(error="not found"), 404
    p.unlink()
    poster = _video_poster_path(p)
    if poster.is_file():
        poster.unlink()
    return jsonify(ok=True)


# --- JOBB: simple file-backed text store for the kid's writing tile ---


def _job_path(job_id: str) -> Path | None:
    if not JOB_ID_RE.match(job_id):
        return None
    return JOBS_DIR / f"{job_id}.json"


def _read_job(p: Path) -> dict:
    try:
        data = json.loads(p.read_text())
    except Exception:
        data = {}
    return {
        "title": str(data.get("title") or "Uten tittel"),
        "content": str(data.get("content") or ""),
        "mtime": int(p.stat().st_mtime),
    }


def _validate_job_payload(body: dict) -> tuple[str, str]:
    title = str(body.get("title") or "").strip() or "Uten tittel"
    content = str(body.get("content") or "")
    if len(content.encode("utf-8")) > MAX_JOB_BYTES:
        abort(413)
    return title, content


@app.get("/api/jobs")
def api_list_jobs():
    items = []
    for p in sorted(JOBS_DIR.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
        d = _read_job(p)
        items.append({"id": p.stem, "title": d["title"], "mtime": d["mtime"]})
    return jsonify(items)


@app.get("/api/jobs/<job_id>")
def api_get_job(job_id: str):
    p = _job_path(job_id)
    if p is None or not p.is_file():
        return jsonify(error="not found"), 404
    return jsonify({"id": job_id, **_read_job(p)})


@app.post("/api/jobs")
def api_create_job():
    body = request.get_json(silent=True) or {}
    title, content = _validate_job_payload(body)
    job_id = str(int(time.time() * 1000))
    p = JOBS_DIR / f"{job_id}.json"
    p.write_text(json.dumps({"title": title, "content": content}, ensure_ascii=False))
    return jsonify({"id": job_id, **_read_job(p)})


@app.put("/api/jobs/<job_id>")
def api_update_job(job_id: str):
    p = _job_path(job_id)
    if p is None or not p.is_file():
        return jsonify(error="not found"), 404
    body = request.get_json(silent=True) or {}
    title, content = _validate_job_payload(body)
    p.write_text(json.dumps({"title": title, "content": content}, ensure_ascii=False))
    return jsonify({"id": job_id, **_read_job(p)})


@app.delete("/api/jobs/<job_id>")
def api_delete_job(job_id: str):
    p = _job_path(job_id)
    if p is None:
        return jsonify(error="bad id"), 400
    if p.is_file():
        p.unlink()
    return jsonify(ok=True)


# --- LESE: multi-page illustrated stories ---


def _story_path(sid: str) -> Path | None:
    if not STORY_ID_RE.match(sid):
        return None
    return STORIES_DIR / f"{sid}.json"


def _story_summary(p: Path) -> dict:
    try:
        d = json.loads(p.read_text())
    except Exception:
        d = {}
    return {
        "id": p.stem,
        "title": str(d.get("title") or "Uten tittel"),
        "page_count": len(d.get("pages") or []),
        "mtime": int(p.stat().st_mtime),
    }


def _story_full(p: Path) -> dict:
    try:
        d = json.loads(p.read_text())
    except Exception:
        d = {}
    pages = []
    for page in d.get("pages") or []:
        img = page.get("image") or None
        pages.append({
            "text": str(page.get("text") or ""),
            "image": img,
            "image_url": f"/api/stories/img/{img}" if img else None,
        })
    return {
        "id": p.stem,
        "title": str(d.get("title") or "Uten tittel"),
        "pages": pages,
        "mtime": int(p.stat().st_mtime),
    }


def _read_active_stories() -> list[str]:
    if not ACTIVE_STORIES_FILE.exists():
        return []
    return [
        ln.strip()
        for ln in ACTIVE_STORIES_FILE.read_text().splitlines()
        if ln.strip() and STORY_ID_RE.match(ln.strip())
    ][:MAX_ACTIVE_STORIES]


def _write_active_stories(ids: list[str]) -> None:
    valid = []
    for i in ids:
        i = str(i).strip()
        if not STORY_ID_RE.match(i):
            continue
        if not (STORIES_DIR / f"{i}.json").is_file():
            continue
        valid.append(i)
    ACTIVE_STORIES_FILE.write_text("\n".join(valid[:MAX_ACTIVE_STORIES]))


def _validate_story_payload(body: dict) -> tuple[str, list[dict]]:
    title = str(body.get("title") or "").strip() or "Uten tittel"
    raw_pages = body.get("pages") or []
    pages = []
    for p in raw_pages:
        if not isinstance(p, dict):
            continue
        text = str(p.get("text") or "")
        img = p.get("image")
        if img is not None:
            img = str(img).strip()
            if "/" in img or ".." in img or not img:
                img = None
        pages.append({"text": text, "image": img})
    if len(json.dumps({"title": title, "pages": pages}).encode("utf-8")) > MAX_STORY_BYTES:
        abort(413)
    return title, pages


@app.get("/api/stories")
def api_list_stories():
    items = [_story_summary(p) for p in sorted(
        STORIES_DIR.glob("*.json"),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )]
    return jsonify(items)


@app.get("/api/stories/active")
def api_active_stories():
    out = []
    for sid in _read_active_stories():
        p = _story_path(sid)
        if p and p.is_file():
            out.append(_story_summary(p))
    return jsonify(out)


@app.post("/api/stories/active")
def api_set_active_stories():
    if (resp := require_admin()) is not None:
        return resp
    body = request.get_json(silent=True) or {}
    _write_active_stories([str(i) for i in (body.get("ids") or [])])
    return jsonify(active=_read_active_stories())


@app.post("/api/stories")
def api_create_story():
    if (resp := require_admin()) is not None:
        return resp
    body = request.get_json(silent=True) or {}
    title, pages = _validate_story_payload(body)
    sid = str(int(time.time() * 1000))
    p = STORIES_DIR / f"{sid}.json"
    p.write_text(json.dumps({"title": title, "pages": pages}, ensure_ascii=False))
    return jsonify(_story_full(p))


@app.get("/api/stories/<sid>")
def api_get_story(sid: str):
    p = _story_path(sid)
    if p is None or not p.is_file():
        return jsonify(error="not found"), 404
    return jsonify(_story_full(p))


@app.put("/api/stories/<sid>")
def api_update_story(sid: str):
    if (resp := require_admin()) is not None:
        return resp
    p = _story_path(sid)
    if p is None or not p.is_file():
        return jsonify(error="not found"), 404
    body = request.get_json(silent=True) or {}
    title, pages = _validate_story_payload(body)
    p.write_text(json.dumps({"title": title, "pages": pages}, ensure_ascii=False))
    return jsonify(_story_full(p))


@app.delete("/api/stories/<sid>")
def api_delete_story(sid: str):
    if (resp := require_admin()) is not None:
        return resp
    p = _story_path(sid)
    if p is None:
        return jsonify(error="bad id"), 400
    if p.is_file():
        p.unlink()
    active = _read_active_stories()
    if sid in active:
        active.remove(sid)
        _write_active_stories(active)
    return jsonify(ok=True)


@app.get("/api/stories/img/<name>")
def api_story_img(name: str):
    if "/" in name or ".." in name:
        abort(400)
    return send_from_directory(STORY_IMG_DIR, name, max_age=0)


@app.post("/api/stories/img")
def api_upload_story_img():
    if (resp := require_admin()) is not None:
        return resp
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify(error="missing file"), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_BG:
        return jsonify(error=f"extension {ext} not allowed"), 400
    try:
        data = _normalize_bg(file)
    except Exception as e:
        return jsonify(error=f"could not process image: {e}"), 400
    name = f"{int(time.time() * 1000)}.webp"
    target = STORY_IMG_DIR / name
    target.write_bytes(data)
    return jsonify(ok=True, name=name, url=f"/api/stories/img/{name}")


# --- TRENING: training sessions (FRITID/TRENING) — same shape as stories
# but each page can have an image, gif, or video as its media. ---

TRAININGS_DIR = DATA / "trainings"
TRAINING_MEDIA_DIR = TRAININGS_DIR / "media"
ACTIVE_TRAININGS_FILE = TRAININGS_DIR / "active.txt"
TRAININGS_DIR.mkdir(exist_ok=True)
TRAINING_MEDIA_DIR.mkdir(exist_ok=True)
TRAINING_ID_RE = re.compile(r"^\d+$")
MAX_TRAINING_BYTES = 256 * 1024
MAX_ACTIVE_TRAININGS = 3


def _training_path(tid: str):
    if not TRAINING_ID_RE.match(tid):
        return None
    return TRAININGS_DIR / f"{tid}.json"


def _media_kind(name: str | None):
    if not name:
        return None
    ext = Path(name).suffix.lower()
    if ext in ALLOWED_VIDEO:
        return "video"
    if ext in ALLOWED_BG:
        return "image"
    return None


def _training_summary(p: Path) -> dict:
    try:
        d = json.loads(p.read_text())
    except Exception:
        d = {}
    return {
        "id": p.stem,
        "title": str(d.get("title") or "Uten tittel"),
        "page_count": len(d.get("pages") or []),
        "mtime": int(p.stat().st_mtime),
    }


def _training_full(p: Path) -> dict:
    try:
        d = json.loads(p.read_text())
    except Exception:
        d = {}
    pages = []
    for page in d.get("pages") or []:
        m = page.get("media") or None
        kind = _media_kind(m)
        poster_url = None
        if m and kind == "video":
            poster = TRAINING_MEDIA_DIR / (Path(m).stem + ".jpg")
            if poster.is_file():
                poster_url = f"/api/trainings/media/{poster.name}"
        pages.append({
            "text": str(page.get("text") or ""),
            "media": m,
            "media_url": f"/api/trainings/media/{m}" if m else None,
            "media_kind": kind,
            "poster_url": poster_url,
        })
    return {
        "id": p.stem,
        "title": str(d.get("title") or "Uten tittel"),
        "pages": pages,
        "mtime": int(p.stat().st_mtime),
    }


def _read_active_trainings() -> list[str]:
    if not ACTIVE_TRAININGS_FILE.exists():
        return []
    return [
        ln.strip()
        for ln in ACTIVE_TRAININGS_FILE.read_text().splitlines()
        if ln.strip() and TRAINING_ID_RE.match(ln.strip())
    ][:MAX_ACTIVE_TRAININGS]


def _write_active_trainings(ids) -> None:
    valid = []
    for i in ids:
        i = str(i).strip()
        if not TRAINING_ID_RE.match(i):
            continue
        if not (TRAININGS_DIR / f"{i}.json").is_file():
            continue
        valid.append(i)
    ACTIVE_TRAININGS_FILE.write_text("\n".join(valid[:MAX_ACTIVE_TRAININGS]))


def _validate_training_payload(body: dict):
    title = str(body.get("title") or "").strip() or "Uten tittel"
    raw_pages = body.get("pages") or []
    pages = []
    for p in raw_pages:
        if not isinstance(p, dict):
            continue
        text = str(p.get("text") or "")
        m = p.get("media")
        if m is not None:
            m = str(m).strip()
            if "/" in m or ".." in m or not m:
                m = None
        pages.append({"text": text, "media": m})
    if len(json.dumps({"title": title, "pages": pages}).encode("utf-8")) > MAX_TRAINING_BYTES:
        abort(413)
    return title, pages


@app.get("/api/trainings")
def api_list_trainings():
    items = [_training_summary(p) for p in sorted(
        TRAININGS_DIR.glob("*.json"),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )]
    return jsonify(items)


@app.get("/api/trainings/active")
def api_active_trainings():
    out = []
    for tid in _read_active_trainings():
        p = _training_path(tid)
        if p and p.is_file():
            out.append(_training_summary(p))
    return jsonify(out)


@app.post("/api/trainings/active")
def api_set_active_trainings():
    if (resp := require_admin()) is not None:
        return resp
    body = request.get_json(silent=True) or {}
    _write_active_trainings([str(i) for i in (body.get("ids") or [])])
    return jsonify(active=_read_active_trainings())


@app.post("/api/trainings")
def api_create_training():
    if (resp := require_admin()) is not None:
        return resp
    body = request.get_json(silent=True) or {}
    title, pages = _validate_training_payload(body)
    tid = str(int(time.time() * 1000))
    p = TRAININGS_DIR / f"{tid}.json"
    p.write_text(json.dumps({"title": title, "pages": pages}, ensure_ascii=False))
    return jsonify(_training_full(p))


@app.get("/api/trainings/<tid>")
def api_get_training(tid: str):
    p = _training_path(tid)
    if p is None or not p.is_file():
        return jsonify(error="not found"), 404
    return jsonify(_training_full(p))


@app.put("/api/trainings/<tid>")
def api_update_training(tid: str):
    if (resp := require_admin()) is not None:
        return resp
    p = _training_path(tid)
    if p is None or not p.is_file():
        return jsonify(error="not found"), 404
    body = request.get_json(silent=True) or {}
    title, pages = _validate_training_payload(body)
    p.write_text(json.dumps({"title": title, "pages": pages}, ensure_ascii=False))
    return jsonify(_training_full(p))


@app.delete("/api/trainings/<tid>")
def api_delete_training(tid: str):
    if (resp := require_admin()) is not None:
        return resp
    p = _training_path(tid)
    if p is None:
        return jsonify(error="bad id"), 400
    if p.is_file():
        p.unlink()
    active = _read_active_trainings()
    if tid in active:
        active.remove(tid)
        _write_active_trainings(active)
    return jsonify(ok=True)


@app.get("/api/trainings/media/<name>")
def api_training_media(name: str):
    if "/" in name or ".." in name:
        abort(400)
    return send_from_directory(TRAINING_MEDIA_DIR, name, max_age=0, conditional=True)


@app.post("/api/trainings/media")
def api_upload_training_media():
    if (resp := require_admin()) is not None:
        return resp
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify(error="missing file"), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_TRAINING_MEDIA:
        return jsonify(error=f"extension {ext} not allowed"), 400
    if ext in ALLOWED_VIDEO:
        # Save video as-is — no transcoding step on the Pi — but extract
        # a JPG poster so the gallery doesn't have to decode metadata for
        # every tile on every page render.
        name = f"{int(time.time() * 1000)}{ext}"
        target = TRAINING_MEDIA_DIR / name
        file.save(target)
        if target.stat().st_size > MAX_VIDEO_BYTES:
            target.unlink()
            return jsonify(error="file too large"), 413
        _generate_video_poster(target, target.with_suffix(".jpg"))
    elif ext == ".gif":
        # Preserve animation; webp re-encode would flatten it.
        data = file.read()
        if len(data) > MAX_UPLOAD_BYTES:
            return jsonify(error="file too large"), 413
        name = f"{int(time.time() * 1000)}.gif"
        (TRAINING_MEDIA_DIR / name).write_bytes(data)
    else:
        # Static image — normalize to webp like backgrounds.
        try:
            data = _normalize_bg(file)
        except Exception as e:
            return jsonify(error=f"could not process image: {e}"), 400
        name = f"{int(time.time() * 1000)}.webp"
        (TRAINING_MEDIA_DIR / name).write_bytes(data)
    kind = _media_kind(name)
    poster_url = None
    if kind == "video":
        poster = TRAINING_MEDIA_DIR / (Path(name).stem + ".jpg")
        if poster.is_file():
            poster_url = f"/api/trainings/media/{poster.name}"
    return jsonify(
        ok=True, name=name,
        url=f"/api/trainings/media/{name}",
        kind=kind, poster_url=poster_url,
    )


@app.post("/api/shutdown")
def shutdown():
    require_local()
    log.warning("shutdown requested")
    subprocess.Popen(["sudo", "-n", "/sbin/poweroff"])
    return jsonify(ok=True)


@app.post("/api/reboot")
def reboot():
    require_local()
    log.warning("reboot requested")
    subprocess.Popen(["sudo", "-n", "/sbin/reboot"])
    return jsonify(ok=True)


@app.get("/api/health")
def health():
    return jsonify(ok=True)


# --- BANK: simple coin counter for SKOLE rewards ---


def load_coins() -> int:
    if not COINS_FILE.exists():
        return 0
    try:
        d = json.loads(COINS_FILE.read_text())
        return int(d.get("count") or 0) if isinstance(d, dict) else int(d)
    except Exception:
        return 0


def save_coins(count: int) -> None:
    COINS_FILE.write_text(json.dumps({"count": int(count)}))


@app.get("/api/coins")
def api_coins():
    return jsonify(count=load_coins())


@app.post("/api/lock_pattern")
def api_set_lock_pattern_local():
    """Localhost-only — lets the kiosk's VALG → Lås page set the password
    without going through admin auth. Same validation as the admin
    /api/config POST."""
    require_local()
    body = request.get_json(silent=True) or {}
    raw = body.get("pattern")
    if raw in (None, []):
        new = []
    elif (
        isinstance(raw, list)
        and len(raw) == 3
        and all(isinstance(c, str) and c in LOCK_COLORS for c in raw)
    ):
        new = list(raw)
    else:
        return jsonify(error="bad pattern"), 400
    cfg = load_config()
    cfg["lock_pattern"] = new
    save_config(cfg)
    return jsonify(lock_pattern=new)


@app.post("/api/coins/spend")
def api_coins_spend():
    body = request.get_json(silent=True) or {}
    try:
        n = int(body.get("n") or 0)
    except (TypeError, ValueError):
        return jsonify(error="bad n"), 400
    if n <= 0:
        return jsonify(error="bad n"), 400
    current = load_coins()
    if current < n:
        return jsonify(error="insufficient", balance=current), 402
    new = current - n
    save_coins(new)
    return jsonify(count=new, spent=n)


@app.post("/api/coins/earn")
def api_coins_earn():
    # No admin auth — earning happens from the kiosk on task completion.
    # The LAN allowlist (above) is the only gate. Acceptable for kid-only use.
    n = load_coins() + 1
    save_coins(n)
    return jsonify(count=n)


@app.post("/api/coins/reset")
def api_coins_reset():
    if (resp := require_admin()) is not None:
        return resp
    save_coins(0)
    return jsonify(count=0)


@app.get("/api/version")
def version():
    # Use the newest mtime across the inlined frontend bundle so editing any
    # one of {index.html, style.css, app.js} triggers a kiosk reload.
    mtimes = []
    for f in (INDEX, FRONTEND / "style.css", FRONTEND / "app.js"):
        try:
            mtimes.append(int(f.stat().st_mtime))
        except FileNotFoundError:
            pass
    idx_v = max(mtimes) if mtimes else 0
    bg = current_background()
    bg_v = int(bg.stat().st_mtime) if bg else 0
    try:
        events_v = int(EVENTS_FILE.stat().st_mtime) if EVENTS_FILE.exists() else 0
    except FileNotFoundError:
        events_v = 0
    return jsonify(
        version=idx_v,
        background=bg_v,
        events=events_v,
        coins=load_coins(),
        started=STARTED,
        config=load_config(),
    )


# --- Runtime config (heading, level, gender, admin_lang, kiosk_lang) ---


def _migrate_config(cfg: dict) -> dict:
    """Legacy schema → English keys / current locale codes."""
    if "nivaa" in cfg and "level" not in cfg:
        cfg["level"] = LEGACY_LEVEL_MAP.get(str(cfg.pop("nivaa")), "easy")
    if cfg.get("level") in LEGACY_LEVEL_MAP:
        cfg["level"] = LEGACY_LEVEL_MAP[cfg["level"]]
    # Earlier prototype used "uk" for Ukrainian; ISO/locale code is now "ua".
    for key in ("admin_lang", "kiosk_lang"):
        if cfg.get(key) == "uk":
            cfg[key] = "ua"
    return cfg


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        return dict(DEFAULT_CONFIG)
    try:
        cfg = json.loads(CONFIG_FILE.read_text())
    except Exception:
        return dict(DEFAULT_CONFIG)
    if not isinstance(cfg, dict):
        cfg = {}
    return {**DEFAULT_CONFIG, **_migrate_config(cfg)}


def save_config(cfg: dict) -> None:
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False))


@app.get("/api/config")
def api_get_config():
    return jsonify(load_config())


@app.post("/api/config")
def api_set_config():
    if (resp := require_admin()) is not None:
        return resp
    body = request.get_json(silent=True) or {}
    cfg = load_config()
    if "heading" in body:
        h = str(body.get("heading") or "").strip()
        if h:
            cfg["heading"] = h[:120]
    if "level" in body:
        v = str(body.get("level") or "")
        if v in LEVEL_VALUES:
            cfg["level"] = v
    if "gender" in body:
        g = str(body.get("gender") or "")
        if g in GENDER_VALUES:
            cfg["gender"] = g
    if "admin_lang" in body:
        v = str(body.get("admin_lang") or "")
        if v in LANG_VALUES:
            cfg["admin_lang"] = v
    if "kiosk_lang" in body:
        v = str(body.get("kiosk_lang") or "")
        if v in LANG_VALUES:
            cfg["kiosk_lang"] = v
    if "show_logo" in body:
        cfg["show_logo"] = bool(body.get("show_logo"))
    if "show_heading" in body:
        cfg["show_heading"] = bool(body.get("show_heading"))
    if "lock_pattern" in body:
        raw = body.get("lock_pattern")
        # null or empty list clears the lock; otherwise must be exactly 3
        # rainbow-palette colour names. Anything malformed is rejected.
        if raw is None or (isinstance(raw, list) and len(raw) == 0):
            cfg["lock_pattern"] = []
        elif (
            isinstance(raw, list)
            and len(raw) == 3
            and all(isinstance(c, str) and c in LOCK_COLORS for c in raw)
        ):
            cfg["lock_pattern"] = list(raw)
        else:
            return jsonify(error="bad lock_pattern"), 400
    if "time_budget_minutes" in body:
        try:
            m = int(body.get("time_budget_minutes"))
        except (TypeError, ValueError):
            return jsonify(error="bad time_budget_minutes"), 400
        if m < 0 or m > 720:
            return jsonify(error="bad time_budget_minutes"), 400
        cfg["time_budget_minutes"] = m
    if "time_extension_pattern" in body:
        raw = body.get("time_extension_pattern")
        if (isinstance(raw, list)
                and len(raw) == 6
                and all(isinstance(c, str) and c in LOCK_COLORS for c in raw)):
            cfg["time_extension_pattern"] = list(raw)
        else:
            return jsonify(error="bad time_extension_pattern"), 400
    if "time_extension_options" in body:
        raw = body.get("time_extension_options")
        try:
            opts = [int(x) for x in (raw or [])]
        except (TypeError, ValueError):
            return jsonify(error="bad time_extension_options"), 400
        if len(opts) != 3 or any(x < 1 or x > 120 for x in opts):
            return jsonify(error="bad time_extension_options"), 400
        cfg["time_extension_options"] = opts
    save_config(cfg)
    return jsonify(cfg)


# --- Calendar / events (iCal-backed) ---


def load_events() -> list[dict]:
    if not EVENTS_FILE.exists():
        return []
    try:
        data = json.loads(EVENTS_FILE.read_text())
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_events(events: list[dict]) -> None:
    EVENTS_FILE.write_text(json.dumps(events, ensure_ascii=False, indent=2))


def _guess_icon(summary: str) -> str:
    s = (summary or "").lower()
    if any(k in s for k in ("svøm", "swim", "basseng")):     return "swim"
    if any(k in s for k in ("musikk", "music", "song")):     return "music"
    if any(k in s for k in ("bursdag", "kake", "birthday")): return "cake"
    return "event"


def _parse_ical(content: bytes) -> list[dict]:
    """Parse an iCalendar payload into our flat event dicts."""
    if not ICAL_AVAILABLE:
        raise RuntimeError("icalendar library not available")
    cal = Calendar.from_ical(content)
    out = []
    for comp in cal.walk("VEVENT"):
        uid = str(comp.get("UID") or "").strip()
        summary = str(comp.get("SUMMARY") or "").strip()
        dtstart_field = comp.get("DTSTART")
        if not uid or not summary or dtstart_field is None:
            continue
        dt = dtstart_field.dt
        if isinstance(dt, datetime):
            dtstart_str = dt.date().isoformat()  # we only care about the day
        else:
            dtstart_str = dt.isoformat()
        rrule_str = None
        rrule_field = comp.get("RRULE")
        if rrule_field is not None:
            rrule_str = rrule_field.to_ical().decode().strip()
        out.append({
            "uid": uid,
            "summary": summary,
            "dtstart": dtstart_str,
            "rrule": rrule_str,
            "icon": _guess_icon(summary),
        })
    return out


def _event_occurs_on(ev: dict, target: date) -> bool:
    try:
        start = date.fromisoformat(str(ev.get("dtstart") or ""))
    except ValueError:
        return False
    rrule_str = ev.get("rrule")
    if not rrule_str:
        return start == target
    try:
        rule = rrulestr(rrule_str, dtstart=datetime.combine(start, datetime.min.time()))
        target_dt = datetime.combine(target, datetime.min.time())
        # between(inc=True) is inclusive on both ends, so it pulls in the
        # next day's occurrence too. Filter on .date() equality.
        for occ in rule.between(target_dt, target_dt + timedelta(days=1), inc=True):
            if occ.date() == target:
                return True
        return False
    except Exception:
        return False


def _events_to_ical(events: list[dict]) -> str:
    """Serialize stored events back to RFC-5545 .ics text."""
    if not ICAL_AVAILABLE:
        raise RuntimeError("icalendar library not available")
    cal = Calendar()
    cal.add("prodid", "-//asipad//kiosk//NO")
    cal.add("version", "2.0")
    for ev in events:
        comp = IcalEvent()
        comp.add("uid", ev.get("uid") or f"asipad-{int(time.time()*1000)}@kiosk")
        comp.add("summary", ev.get("summary") or "")
        try:
            comp.add("dtstart", date.fromisoformat(str(ev.get("dtstart") or "")))
        except ValueError:
            continue
        if ev.get("rrule"):
            try:
                cleaned = ev["rrule"]
                if cleaned.upper().startswith("RRULE:"):
                    cleaned = cleaned.split(":", 1)[1]
                # icalendar wants a vRecur dict — round-trip through string parse
                from icalendar.prop import vRecur
                comp.add("rrule", vRecur.from_ical(cleaned))
            except Exception:
                pass
        cal.add_component(comp)
    return cal.to_ical().decode()


@app.get("/api/calendar")
def api_calendar_info():
    events = load_events()
    return jsonify(count=len(events), ical_available=ICAL_AVAILABLE)


@app.get("/api/calendar/export")
def api_export_calendar():
    if not ICAL_AVAILABLE:
        return jsonify(error="icalendar library not available"), 501
    body = _events_to_ical(load_events())
    return Response(
        body,
        mimetype="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="asipad.ics"'},
    )


@app.post("/api/calendar/import")
def api_import_calendar():
    if (resp := require_admin()) is not None:
        return resp
    if not ICAL_AVAILABLE:
        return jsonify(error="icalendar library not available on server"), 501
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify(error="missing file"), 400
    try:
        new = _parse_ical(file.read())
    except Exception as e:
        return jsonify(error=f"could not parse: {e}"), 400
    existing = load_events()
    seen = {(e.get("uid"), e.get("dtstart")) for e in existing}
    added = 0
    skipped = 0
    for ev in new:
        key = (ev["uid"], ev["dtstart"])
        if key in seen:
            skipped += 1
            continue
        seen.add(key)
        existing.append(ev)
        added += 1
    save_events(existing)
    return jsonify(ok=True, added=added, skipped=skipped, total=len(existing))


@app.delete("/api/calendar")
def api_clear_calendar():
    if (resp := require_admin()) is not None:
        return resp
    # Write an empty list rather than removing the file — otherwise the
    # next load_events() would re-seed the default events.
    save_events([])
    return jsonify(ok=True)


@app.get("/api/events/<datestr>")
def api_events_on(datestr: str):
    try:
        target = date.fromisoformat(datestr)
    except ValueError:
        return jsonify(error="bad date"), 400
    out = []
    for ev in load_events():
        if _event_occurs_on(ev, target):
            out.append({
                "uid":     ev.get("uid"),
                "summary": ev.get("summary"),
                "icon":    ev.get("icon") or "event",
            })
    return jsonify(out)


@app.route("/<path:name>")
def static_file(name):
    return send_from_directory(FRONTEND, name)


STARTED = int(time.time())


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    app.run(host="0.0.0.0", port=8080, debug=False, use_reloader=False)
