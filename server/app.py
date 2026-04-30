#!/usr/bin/env python3
"""Asipad kiosk local server.

Serves the kiosk frontend, an admin UI, and a small power API on port 8080.
- Bound on 0.0.0.0 so the admin UI is reachable from another computer on the LAN.
- /api/shutdown and /api/reboot are accepted only from 127.0.0.1.
- /admin and /admin/* require HTTP basic auth (see ADMIN_PW_FILE).
"""
import io
import logging
import secrets
import subprocess
import time
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_from_directory
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DATA = ROOT / "data"
BG_DIR = DATA / "bg"
CURRENT_BG_FILE = DATA / "current-bg.txt"
DATA.mkdir(exist_ok=True)
BG_DIR.mkdir(exist_ok=True)
INDEX = FRONTEND / "index.html"

ADMIN_PW_FILE = Path.home() / ".asipad-admin-password"
DEFAULT_ADMIN_PASSWORD = "asipad"

ALLOWED_BG = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_UPLOAD_BYTES = 16 * 1024 * 1024  # 16 MiB before resize
MAX_BG_DIM = (1280, 720)             # display resolution; larger doesn't help cog
WEBP_QUALITY = 78


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
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES + 4096
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


@app.route("/")
def index():
    # Inline CSS + JS into the HTML so a cold load is one HTTP request
    # instead of three. The frontend keeps separate files for editing —
    # the server splices them at request time.
    html = (FRONTEND / "index.html").read_text()
    css = (FRONTEND / "style.css").read_text()
    js = (FRONTEND / "app.js").read_text()
    html = html.replace(
        '<link rel="stylesheet" href="style.css">',
        f"<style>\n{css}\n</style>",
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
    return send_from_directory(FRONTEND, "admin.html")


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
    return jsonify(version=idx_v, background=bg_v, started=STARTED)


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
