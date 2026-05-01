<h1><img src="assets/asipad.svg" width="350px" alt="ASIPad" /></h1>

Kiosk firmware for a child's tablet built around a Raspberry Pi + HDMI touchscreen.
Boots straight into a fullscreen browser pointing at a tiny local Flask server.
Browser is **cog** (WPE-WebKit) under **cage** (Wayland compositor) — no display
manager, no Firefox, no Chromium.

## Hardware

Tested on:

- Raspberry Pi Zero 2 W (works after the cog+cage migration; Firefox/Chromium will not).
- Raspberry Pi 4 (works with anything; recommended for an easier life).

The Pi Zero 2 W's single OTG USB port can't reliably power a USB-fed touchscreen
once the kiosk is running. Either feed the screen its own power, use a powered
USB hub, or use a Pi 4.

## First-time install on a fresh Pi

1. Flash Raspberry Pi OS (Trixie / Bookworm successor) using **Raspberry Pi
   Imager**. In the imager's advanced options, set:
   - Hostname: `asipad`
   - User: `asi`, password: `asi` (the deploy artifacts encode whichever user
     you pick — see "Using a different username" below)
   - Wi-Fi: your network
   - Enable SSH (with public-key auth pointing at your laptop's `~/.ssh/id_ed25519.pub`)
2. Boot the Pi. Confirm `ssh asi@asipad` works without a password.
3. From your laptop:

   ```sh
   bash deploy.sh setup
   ```

   This will:
   - Install `python3-flask`, `cog`, `cage`, `zram-tools`, `curl` via apt.
   - Configure zram swap, disable a few unused services (keeps `bluetooth`).
   - Append `gpu_mem=64` to `/boot/firmware/config.txt`.
   - Install `kiosk-server.service` (the local Flask backend).
   - Install `asipad-kiosk.service` (cage + cog on `/dev/tty1`).
   - Disable `lightdm` and `getty@tty1` so cage owns the TTY.
   - Drop a sudoers fragment so the kiosk can power off without a password.

4. Reboot:

   ```sh
   ssh asi@asipad sudo /sbin/reboot
   ```

5. The tablet should come up directly into the kiosk within ~10 s on a Pi 4,
   30–60 s on a Pi Zero 2 W (cold-boot only).

### Using a different username or hostname

The deploy artifacts use `__USER__` placeholders that `deploy/install.sh`
fills in with whoever runs the installer (defaults to `id -un`). The
laptop-side `deploy.sh` reads `KIOSK_USER` / `KIOSK_HOST` from a gitignored
`.deploy.env` if present, otherwise defaults to `asi@asipad.local`.

To target a different account / host without editing tracked files:

```sh
cat > .deploy.env <<'EOF'
KIOSK_USER=mykid
KIOSK_HOST=10.0.0.5
EOF
```

## Daily use

```sh
bash deploy.sh sync             # rsync code + restart the local server
bash deploy.sh restart-display  # bounce cage+cog (rarely needed; auto-reload via /api/version)
bash deploy.sh reboot           # reboot the Pi
bash deploy.sh setup            # idempotent re-run of the installer
```

The kiosk polls `/api/version` every 30 s and reloads on frontend mtime changes,
so a `sync` typically refreshes the tablet within seconds with no manual step.

## Admin UI

Open `http://asipad:8080/admin` (or `http://asipad.local:8080/admin` if your
laptop resolves only via mDNS) from any computer on the LAN. Login: `admin` /
`asipad` (HTTP basic). Change the password by writing the new value into
`~/.asipad-admin-password` on the Pi:

```sh
ssh asi@asipad 'echo "new-password" > ~/.asipad-admin-password'
```

The admin UI lets you upload / clear the kiosk background image. Shutdown and
reboot endpoints are accepted only from `127.0.0.1` (i.e. the kiosk itself,
via the long-press power dot in the top-right corner).

## Customising tiles, calendar, etc.

- `frontend/index.html` — markup for the home grid + sub-pages.
- `frontend/style.css` — tile sizing and layout. Sizes are in `vw` so they
  scale with screen width.
- `frontend/app.js` — hash-routed sub-pages, calendar logic, power menu, version
  polling.

The server inlines these three files into a single HTTP response on `/`, so
each cold-load hits the network once. Edit any of them and `deploy.sh sync`
ships it; the kiosk auto-reloads.

## Architecture

```
                  +----------------------------+
                  |  Pi (asi@asipad)           |
                  |                            |
   browser  --->  |  cog (kiosk)  --HTTP-->  python3 Flask  --> data/
   localhost      |    ^                       127.0.0.1:8080      (uploaded bg)
                  |    |                       0.0.0.0:8080 (LAN, admin)
                  |  cage (Wayland)            |
                  |    |                       systemd:
                  |  /dev/tty1                   kiosk-server.service
                  |                              asipad-kiosk.service
                  +----------------------------+
                           |  HDMI
                           v
                    Touchscreen panel
```

- `kiosk-server.service` — Flask app, `server/app.py`. Bound on `0.0.0.0:8080`
  so the admin UI is reachable from your laptop. Power endpoints restrict to
  `127.0.0.1`.
- `asipad-kiosk.service` — systemd unit on tty1 running `cage -s -- cog URL`.
  See `deploy/asipad-kiosk.service`.

## Things that bit us, kept here so they don't bite again

- WPE's `bwrap` sandbox aborts on this Pi OS image with `Unexpected
  capabilities but not setuid`. Worked around by setting
  `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` in the unit. The kiosk only
  ever loads our own localhost content, so the sandbox is dead weight.
- `getty@tty1` will fight cage for the TTY and SIGHUP it; we disable getty
  and add `Conflicts=getty@tty1.service` to the unit.
- `grim` without `-o HDMI-A-1` captures a writeback virtual output that's
  always blank. Always pass `-o HDMI-A-1` for diagnostics.
- Chromium's network service crashes on Pi Zero 2 W; Firefox runs but never
  composites. cog is the only stack that paints reliably on this hardware.

## Layout

```
asipad/
├── deploy.sh                 # one-stop laptop CLI: setup / sync / reboot
├── deploy/
│   ├── install.sh            # idempotent installer, run on the Pi
│   ├── kiosk-server.service  # Flask backend
│   ├── asipad-kiosk.service  # cage + cog on tty1
│   └── sudoers-kiosk         # passwordless poweroff/reboot for the kiosk user
├── server/
│   └── app.py                # Flask: serves frontend, /admin, /api/*
├── frontend/
│   ├── index.html            # kiosk shell (server inlines style+script)
│   ├── style.css
│   ├── app.js
│   ├── admin.html            # admin UI (basic-auth)
│   ├── admin.css
│   └── admin.js
└── data/                     # runtime — uploaded backgrounds (gitignored)
```

## License

GPLv3 — see [`LICENSE`](LICENSE).
