# ASIPad for iPad

Standalone iPad build: the same web frontend as the Pi kiosk, rendered in a
fullscreen `WKWebView` and served by an embedded Swift HTTP server on
`127.0.0.1`. The Flask API (`server/app.py`) is ported 1:1 in
`ASIPad/Sources/Server/Router.swift` — the frontend is bundled unmodified.

## Layout

- `project.yml` — [xcodegen](https://github.com/yonaskolb/XcodeGen) spec; the
  `.xcodeproj` is generated, not committed.
- `ASIPad/Sources/` — app shell (`AppDelegate`, `KioskViewController`) and the
  server (`Server/`): NWListener HTTP server, transport-agnostic router,
  `DataStore` (paths + persistence), `RRule` (calendar recurrence subset).
- `devserver/` — macOS CLI harness that runs the identical server sources
  against the repo checkout, used to curl-diff against the Flask server.

## Build

```sh
brew install xcodegen   # once
cd ios
xcodegen                # writes ASIPad.xcodeproj
open ASIPad.xcodeproj   # or xcodebuild -scheme ASIPad -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M4)'
```

Requires full Xcode (not just Command Line Tools) with the iOS platform
installed.

### Installing on a real iPad

1. Add your Apple ID in Xcode → Settings → Accounts, and put your team ID in
   a gitignored `ios/signing.yml` (see the optional include in `project.yml`).
2. Cable the iPad, trust the Mac, enable Developer Mode
   (Settings → Privacy & Security, toggle → restart → confirm).
3. Build and install:

   ```sh
   xcodebuild -project ASIPad.xcodeproj -scheme ASIPad -configuration Release \
     -destination 'platform=iOS,name=<device name>' \
     -derivedDataPath ~/Library/Developer/Xcode/DerivedData/ASIPad-manual \
     -allowProvisioningUpdates build
   xcrun devicectl device install app --device <udid> \
     ~/Library/Developer/Xcode/DerivedData/ASIPad-manual/Build/Products/Release-iphoneos/ASIPad.app
   ```

   Keep DerivedData **outside** the repo if the repo lives under `~/Documents`:
   iCloud stamps xattrs onto build products there and codesign then fails with
   "resource fork, Finder information, or similar detritus not allowed".
   (The strip-xattrs build phase handles the resource copies themselves.)

On the iPad, pin the app with Guided Access (Settings → Accessibility) for a
proper no-escape kiosk.

## Data

- The repo's `frontend/` and `assets/` are bundled as folder references.
- If `../data` exists at build time (it's gitignored — personal content), it is
  bundled too and used to **seed** the app's writable tree on first launch.
  After that the device owns its data; the bundle never overwrites it.
- The writable tree lives in the app's `Documents/data`, exposed via Finder
  file sharing (connect the iPad with a cable → Files tab) with the exact same
  layout as the Pi's `~/asipad/data`, so content can be copied both ways.
- Admin password: default `asipad`; override by placing
  `Documents/admin-password.txt` (analog of `~/.asipad-admin-password`).

## Stage 1 scope

Everything the kiosk itself touches works: config, coins, lock pattern, time
budget, jobs, stories, trainings, pictures, backgrounds, rentals (incl. video
with Range support), calendar day view. The admin UI at `/admin` works for
JSON-based actions (config, costs, active sets, deletes, story/training
editing). Not yet ported (returns 501): multipart file uploads and iCal
import/export — move media via Finder file sharing instead for now.

Stage 2 (planned): multipart uploads + optional LAN binding so the admin
laptop can reach the iPad like it reaches the Pi. Stage 3: app icon, Guided
Access notes, in-app import/export.

## Parity harness

```sh
cd ios
swiftc -O -o /tmp/asipad-devserver ASIPad/Sources/Server/*.swift devserver/main.swift
/tmp/asipad-devserver ../frontend ../assets /tmp/devdata 8090
```

Run the Flask server on 8080 with the same data tree and diff endpoints. Last
verified: 20/20 kiosk GET endpoints byte-identical (JSON-normalized), Range
requests identical, validation errors identical, spliced HTML semantically
identical (JSON key order in the inlined i18n dict differs).
