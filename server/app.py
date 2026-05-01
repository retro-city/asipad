#!/usr/bin/env python3
"""Asipad kiosk local server.

Serves the kiosk frontend, an admin UI, and a small power API on port 8080.
- Bound on 0.0.0.0 so the admin UI is reachable from another computer on the LAN.
- /api/shutdown and /api/reboot are accepted only from 127.0.0.1.
- /admin and /admin/* require HTTP basic auth (see ADMIN_PW_FILE).
"""
import io
import json
import logging
import re
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
JOBS_DIR = DATA / "jobs"
STORIES_DIR = DATA / "stories"
STORY_IMG_DIR = STORIES_DIR / "img"
CURRENT_BG_FILE = DATA / "current-bg.txt"
ACTIVE_STORIES_FILE = STORIES_DIR / "active.txt"
CONFIG_FILE = DATA / "config.json"

DEFAULT_CONFIG = {"heading": "ASIPad", "nivaa": "lett"}
NIVAA_VALUES = ("lett", "medium", "vanskelig")
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
    return jsonify(
        version=idx_v,
        background=bg_v,
        started=STARTED,
        config=load_config(),
    )


# --- Runtime config (heading, nivaa) ---


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        return dict(DEFAULT_CONFIG)
    try:
        cfg = json.loads(CONFIG_FILE.read_text())
    except Exception:
        return dict(DEFAULT_CONFIG)
    return {**DEFAULT_CONFIG, **(cfg if isinstance(cfg, dict) else {})}


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
    if "nivaa" in body:
        v = str(body.get("nivaa") or "")
        if v in NIVAA_VALUES:
            cfg["nivaa"] = v
    save_config(cfg)
    return jsonify(cfg)


@app.post("/api/nivaa")
def api_set_nivaa_local():
    """Localhost-only — lets the kiosk's NIVÅ tile change difficulty
    without going through the admin auth dance."""
    require_local()
    body = request.get_json(silent=True) or {}
    v = str(body.get("value") or "")
    if v not in NIVAA_VALUES:
        return jsonify(error="bad value"), 400
    cfg = load_config()
    cfg["nivaa"] = v
    save_config(cfg)
    return jsonify(cfg)


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
