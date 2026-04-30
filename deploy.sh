#!/usr/bin/env bash
# Deploy from laptop to the Pi.
#   ./deploy.sh          rsync + restart server + respawn chromium
#   ./deploy.sh setup    rsync + run installer (first-time setup, needs sudo on Pi)
#   ./deploy.sh reboot   reboot the Pi
set -euo pipefail

HOST="${HOST:-asi@pitablet}"
DEST="/home/asi/asipad"
HERE="$(cd "$(dirname "$0")" && pwd)"

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
