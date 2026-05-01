#!/usr/bin/env bash
# Asipad kiosk installer. Run on the Pi as asi. Idempotent.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

if [[ "$EUID" -eq 0 ]]; then
  echo "run this as asi, not root — sudo will prompt as needed" >&2
  exit 1
fi

echo "==> apt packages"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
  python3-flask python3-pil python3-icalendar python3-dateutil \
  curl zram-tools cage cog wvkbd

echo "==> zram swap (compressed RAM-backed swap, faster than SD)"
# zram-tools enables a default zram swap device on boot. Sized at 50% of RAM
# by default, which is right for our case.
if [[ -f /etc/default/zramswap ]] && ! grep -q '^PERCENT=' /etc/default/zramswap; then
  echo "PERCENT=50" | sudo tee -a /etc/default/zramswap >/dev/null
fi
sudo systemctl enable --now zramswap.service 2>/dev/null || true

echo "==> disable services we don't need (bluetooth kept for speakers)"
for svc in ModemManager triggerhappy packagekit cups cups-browsed; do
  sudo systemctl disable --now "$svc" 2>/dev/null || true
done

echo "==> /boot/firmware/config.txt — cap GPU mem at 64 MB if not already pinned"
if [[ -f /boot/firmware/config.txt ]] && ! grep -qE '^[[:space:]]*gpu_mem=' /boot/firmware/config.txt; then
  echo "" | sudo tee -a /boot/firmware/config.txt >/dev/null
  echo "# asipad: cap GPU memory split — frees RAM for the kiosk" | sudo tee -a /boot/firmware/config.txt >/dev/null
  echo "gpu_mem=64" | sudo tee -a /boot/firmware/config.txt >/dev/null
  echo "    (gpu_mem=64 added; takes effect on next reboot)"
fi

echo "==> sudoers fragment"
sudo install -m 0440 -o root -g root \
  deploy/sudoers-kiosk /etc/sudoers.d/asipad-kiosk
sudo visudo -cf /etc/sudoers.d/asipad-kiosk >/dev/null

echo "==> labwc kiosk config (compositor for cog + wvkbd)"
sudo install -d -m 0755 /etc/asipad/labwc
sudo install -m 0755 deploy/labwc-autostart /etc/asipad/labwc/autostart
sudo install -m 0644 deploy/labwc-rc.xml /etc/asipad/labwc/rc.xml
# Clean up any stale per-user labwc autostart left over from earlier setups.
rm -f "$HOME/.config/labwc/autostart"
# Old cage runner script (no longer used).
sudo rm -f /usr/local/bin/asipad-kiosk-runner

echo "==> systemd units"
sudo install -m 0644 \
  deploy/kiosk-server.service /etc/systemd/system/kiosk-server.service
sudo install -m 0644 \
  deploy/asipad-kiosk.service /etc/systemd/system/asipad-kiosk.service
sudo systemctl daemon-reload
sudo systemctl enable --now kiosk-server.service
sudo systemctl enable asipad-kiosk.service

echo "==> disable display manager (cage runs directly on tty1)"
sudo systemctl disable --now lightdm.service 2>/dev/null || true

echo "==> done. Reboot to enter the cage+cog kiosk."
