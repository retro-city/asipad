#!/usr/bin/env bash
# Deploy from laptop to the Pi.
#   ./deploy.sh          rsync + restart server + respawn chromium
#   ./deploy.sh setup    rsync + run installer (first-time setup, needs sudo on Pi)
#   ./deploy.sh reboot   reboot the Pi
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# Local overrides — kept out of git so personal usernames / hostnames
# never enter the public repo. Example .deploy.env:
#   KIOSK_USER=mykid
#   KIOSK_HOST=10.0.0.5
[ -f "$HERE/.deploy.env" ] && . "$HERE/.deploy.env"

# Either set KIOSK_USER + KIOSK_HOST (env or .deploy.env), or pre-set HOST.
KIOSK_USER="${KIOSK_USER:-asi}"
KIOSK_HOST="${KIOSK_HOST:-asipad.local}"
HOST="${HOST:-${KIOSK_USER}@${KIOSK_HOST}}"
DEST="${DEST:-/home/${KIOSK_USER}/asipad}"

cmd="${1:-sync}"

sync_files() {
  rsync -avz --delete \
    --exclude='.git/' \
    --exclude='__pycache__/' \
    --exclude='.venv/' \
    --exclude='.DS_Store' \
    --exclude='data/' \
    "$HERE"/ "$HOST:$DEST/"
}

case "$cmd" in
  sync)
    sync_files
    # Restart the server. The kiosk browser auto-reloads via /api/version polling.
    ssh "$HOST" '
      sudo /usr/bin/systemctl restart kiosk-server.service || true
    '
    ;;
  restart-display)
    ssh "$HOST" 'sudo /usr/bin/systemctl restart asipad-kiosk.service || true'
    ;;
  setup)
    sync_files
    ssh -t "$HOST" "cd $DEST && bash deploy/install.sh"
    ;;
  reboot)
    ssh "$HOST" 'sudo /sbin/reboot'
    ;;
  *)
    echo "usage: $0 [sync|setup|reboot]" >&2
    exit 2
    ;;
esac
