#!/usr/bin/env python3
"""Asipad kiosk local server.

Serves the kiosk frontend, an admin UI, and a small power API on port 8080.
- Bound on 0.0.0.0 so the admin UI is reachable from another computer on the LAN.
- /api/shutdown and /api/reboot are accepted only from 127.0.0.1.
- /admin and /admin/* require HTTP basic auth (see ADMIN_PW_FILE).
"""
import logging
import secrets
import subprocess
import time
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
INDEX = FRONTEND / "index.html"

ADMIN_PW_FILE = Path.home() / ".asipad-admin-password"
DEFAULT_ADMIN_PASSWORD = "asipad"

ALLOWED_BG = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MiB

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
    files = sorted(DATA.glob("background.*"))
    return files[0] if files else None


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
    for old in DATA.glob("background.*"):
        old.unlink(missing_ok=True)
    target = DATA / f"background{ext}"
    file.save(target)
    return jsonify(ok=True, version=int(target.stat().st_mtime))


@app.post("/admin/background/clear")
def admin_clear_bg():
    if (resp := require_admin()) is not None:
        return resp
    for old in DATA.glob("background.*"):
        old.unlink(missing_ok=True)
    return jsonify(ok=True)


@app.get("/background")
def background():
    bg = current_background()
    if bg is None:
        return ("", 204)
    return send_from_directory(DATA, bg.name, max_age=0)


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
