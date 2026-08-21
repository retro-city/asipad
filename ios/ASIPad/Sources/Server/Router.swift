import Foundation

/// Swift port of server/app.py's routes. Response shapes, status codes, and
/// validation rules mirror the Flask implementation so the unmodified web
/// frontend (and the admin UI) can't tell the difference.
///
/// Stage-1 gaps, all admin-side: multipart file uploads and iCal import/export
/// return 501 — content uploaded on the Pi arrives via the bundled seed or
/// Finder file sharing instead.
final class Router {
    let store: DataStore

    init(store: DataStore) {
        self.store = store
    }

    func handle(_ req: HTTPRequest) -> HTTPResponse {
        let parts = req.path.split(separator: "/").map(String.init)
        // Deepest route is 4 segments (/api/stories/img/<name>); pad so the
        // whole table can be one tuple switch. `n` disambiguates the padding.
        let n = parts.count
        let s0 = n > 0 ? parts[0] : ""
        let s1 = n > 1 ? parts[1] : ""
        let s2 = n > 2 ? parts[2] : ""
        let s3 = n > 3 ? parts[3] : ""

        switch (req.method, s0, s1, s2, s3) {

        // --- Kiosk + admin pages -------------------------------------------
        case ("GET", "", _, _, _) where n == 0:
            return kioskIndex()
        case ("GET", "admin", _, _, _) where n == 1:
            if let challenge = requireAdmin(req) { return challenge }
            return adminIndex()
        case ("GET", "locales", let file, _, _) where n == 2 && file.hasSuffix(".json"):
            let code = String(file.dropLast(5))
            guard DataStore.langValues.contains(code) else { return .json([:], status: 404) }
            return serveFile(store.localesDir.appendingPathComponent(file))
        case ("GET", "assets", let name, _, _) where n == 2:
            guard isSafeName(name), !name.hasPrefix("."),
                  ["svg", "png", "jpg", "jpeg", "webp", "ico"].contains((name as NSString).pathExtension.lowercased())
            else { return .status(404) }
            return serveFile(store.assetsDir.appendingPathComponent(name))

        // --- Background -----------------------------------------------------
        case ("GET", "background", _, _, _) where n == 1:
            guard let bg = store.currentBackground() else { return .status(204) }
            return serveFile(bg)
        case ("GET", "api", "backgrounds", _, _) where n == 2:
            let cur = store.currentBackground()?.lastPathComponent
            return .json(store.listFiles(in: store.bgDir, extensions: DataStore.allowedBG).map { f in
                let m = store.mtime(f)
                return ["id": f.lastPathComponent,
                        "url": "/api/backgrounds/\(f.lastPathComponent)?v=\(m)",
                        "current": f.lastPathComponent == cur,
                        "mtime": m] as [String: Any]
            })
        case ("POST", "api", "backgrounds", "use", _) where n == 3:
            guard let name = req.json["id"] as? String, isSafeName(name), !name.isEmpty
            else { return .error("bad id", status: 400) }
            let p = store.bgDir.appendingPathComponent(name)
            guard store.fm.fileExists(atPath: p.path) else { return .error("not found", status: 404) }
            try? name.write(to: store.currentBGFile, atomically: true, encoding: .utf8)
            return .json(["ok": true, "version": store.mtime(p)])
        case ("GET", "api", "backgrounds", let name, _) where n == 3:
            guard isSafeName(name) else { return .status(400) }
            return serveFile(store.bgDir.appendingPathComponent(name))
        case ("POST", "admin", "background", "clear", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            try? store.fm.removeItem(at: store.currentBGFile)
            return .json(["ok": true])
        case ("POST", "admin", "background", "delete", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            return deleteMediaFile(req, dir: store.bgDir) { name in
                let cur = self.store.currentBackground()
                if cur == nil || cur?.lastPathComponent == name {
                    try? self.store.fm.removeItem(at: self.store.currentBGFile)
                }
            }

        // --- Pictures (FRITID/BILDER) --------------------------------------
        case ("GET", "api", "pictures", _, _) where n == 2:
            return .json(store.listFiles(in: store.picturesDir, extensions: DataStore.allowedBG).map { f in
                let m = store.mtime(f)
                return ["id": f.lastPathComponent,
                        "url": "/api/pictures/\(f.lastPathComponent)?v=\(m)",
                        "mtime": m] as [String: Any]
            })
        case ("GET", "api", "pictures", let name, _) where n == 3:
            guard isSafeName(name) else { return .status(400) }
            return serveFile(store.picturesDir.appendingPathComponent(name))
        case ("POST", "admin", "pictures", "delete", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            return deleteMediaFile(req, dir: store.picturesDir)

        // --- LEI FILM rentals (gifs + short videos) ------------------------
        case ("GET", "api", "gifs", _, _) where n == 2:
            let costs = store.loadGifCosts()
            return .json(store.listFiles(in: store.gifsDir, extensions: DataStore.allowedGif).map { f in
                let m = store.mtime(f)
                let ext = f.pathExtension.lowercased()
                var item: [String: Any] = [
                    "id": f.lastPathComponent,
                    "url": "/api/gifs/\(f.lastPathComponent)?v=\(m)",
                    "mtime": m,
                    "cost": store.gifCost(for: f.lastPathComponent, costs: costs),
                    "kind": DataStore.allowedVideo.contains(ext) ? "video" : "image",
                ]
                let poster = f.deletingPathExtension().appendingPathExtension("jpg")
                if store.fm.fileExists(atPath: poster.path) {
                    item["poster_url"] = "/api/gifs/\(poster.lastPathComponent)?v=\(store.mtime(poster))"
                }
                return item
            })
        case ("POST", "admin", "gifs", "cost", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            let body = req.json
            guard let name = body["id"] as? String, !name.isEmpty, isSafeName(name)
            else { return .error("bad id", status: 400) }
            guard store.fm.fileExists(atPath: store.gifsDir.appendingPathComponent(name).path)
            else { return .error("not found", status: 404) }
            guard let cost = intValue(body["cost"]), cost >= 0 else { return .error("bad cost", status: 400) }
            var costs = store.loadGifCosts()
            if cost == DataStore.defaultGifCost { costs.removeValue(forKey: name) } else { costs[name] = cost }
            store.saveGifCosts(costs)
            return .json(["ok": true, "id": name, "cost": cost])
        case ("POST", "admin", "gifs", "delete", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            return deleteMediaFile(req, dir: store.gifsDir, alsoPoster: true) { name in
                var costs = self.store.loadGifCosts()
                if costs.removeValue(forKey: name) != nil { self.store.saveGifCosts(costs) }
            }
        case ("GET", "api", "gifs", let name, _) where n == 3:
            guard isSafeName(name) else { return .status(400) }
            return serveFile(store.gifsDir.appendingPathComponent(name), range: req.byteRange)

        // --- Videos ---------------------------------------------------------
        case ("GET", "api", "videos", _, _) where n == 2:
            return .json(store.listFiles(in: store.videosDir, extensions: DataStore.allowedVideo).map { f in
                let m = store.mtime(f)
                var item: [String: Any] = ["id": f.lastPathComponent,
                                           "url": "/api/videos/\(f.lastPathComponent)?v=\(m)",
                                           "mtime": m]
                let poster = f.deletingPathExtension().appendingPathExtension("jpg")
                if store.fm.fileExists(atPath: poster.path) {
                    item["poster_url"] = "/api/videos/\(poster.lastPathComponent)?v=\(store.mtime(poster))"
                }
                return item
            })
        case ("POST", "admin", "videos", "delete", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            return deleteMediaFile(req, dir: store.videosDir, alsoPoster: true)
        case ("GET", "api", "videos", let name, _) where n == 3:
            guard isSafeName(name) else { return .status(400) }
            return serveFile(store.videosDir.appendingPathComponent(name), range: req.byteRange)

        // --- JOBB free-typing docs -----------------------------------------
        case ("GET", "api", "jobs", _, _) where n == 2:
            return .json(store.listFiles(in: store.jobsDir, extensions: ["json"]).map { f in
                let d = readJob(f)
                return ["id": f.deletingPathExtension().lastPathComponent,
                        "title": d["title"]!, "mtime": d["mtime"]!] as [String: Any]
            })
        case ("POST", "api", "jobs", _, _) where n == 2:
            guard let (title, content) = validateJobPayload(req.json) else { return .status(413) }
            let id = store.newID()
            let p = store.jobsDir.appendingPathComponent("\(id).json")
            store.writeJSON(["title": title, "content": content], to: p)
            return .json(readJob(p).merging(["id": id]) { a, _ in a })
        case ("GET", "api", "jobs", let id, _) where n == 3:
            guard let p = jobPath(id), store.fm.fileExists(atPath: p.path)
            else { return .error("not found", status: 404) }
            return .json(readJob(p).merging(["id": id]) { a, _ in a })
        case ("PUT", "api", "jobs", let id, _) where n == 3:
            guard let p = jobPath(id), store.fm.fileExists(atPath: p.path)
            else { return .error("not found", status: 404) }
            guard let (title, content) = validateJobPayload(req.json) else { return .status(413) }
            store.writeJSON(["title": title, "content": content], to: p)
            return .json(readJob(p).merging(["id": id]) { a, _ in a })
        case ("DELETE", "api", "jobs", let id, _) where n == 3:
            guard let p = jobPath(id) else { return .error("bad id", status: 400) }
            try? store.fm.removeItem(at: p)
            return .json(["ok": true])

        // --- LESE stories ---------------------------------------------------
        case ("GET", "api", "stories", _, _) where n == 2:
            return .json(store.listFiles(in: store.storiesDir, extensions: ["json"]).map(storySummary))
        case ("GET", "api", "stories", "active", _) where n == 3:
            return .json(store.readActiveIDs(store.activeStoriesFile, limit: 3).compactMap { sid -> [String: Any]? in
                let p = store.storiesDir.appendingPathComponent("\(sid).json")
                return store.fm.fileExists(atPath: p.path) ? storySummary(p) : nil
            })
        case ("POST", "api", "stories", "active", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            let ids = (req.json["ids"] as? [Any] ?? []).map { "\($0)" }
            store.writeActiveIDs(ids, file: store.activeStoriesFile, dir: store.storiesDir, limit: 3)
            return .json(["active": store.readActiveIDs(store.activeStoriesFile, limit: 3)])
        case ("POST", "api", "stories", _, _) where n == 2:
            if let challenge = requireAdmin(req) { return challenge }
            guard let (title, pages) = validatePagesPayload(req.json, mediaKey: "image") else { return .status(413) }
            let p = store.storiesDir.appendingPathComponent("\(store.newID()).json")
            store.writeJSON(["title": title, "pages": pages], to: p)
            return .json(storyFull(p))
        case ("GET", "api", "stories", "img", let name) where n == 4:
            guard isSafeName(name) else { return .status(400) }
            return serveFile(store.storyImgDir.appendingPathComponent(name))
        case ("POST", "api", "stories", "img", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            guard let file = uploadedFile(req) else { return .error("missing file", status: 400) }
            let ext = fileExt(file.filename)
            guard DataStore.allowedBG.contains(ext) else {
                return .error("extension .\(ext) not allowed", status: 400)
            }
            guard let data = MediaPipeline.normalizeImage(file.data) else {
                return .error("could not process image", status: 400)
            }
            let name = "\(store.newID()).jpg"
            try? data.write(to: store.storyImgDir.appendingPathComponent(name))
            return .json(["ok": true, "name": name, "url": "/api/stories/img/\(name)"])
        case ("GET", "api", "stories", let sid, _) where n == 3:
            guard let p = numericJSONPath(sid, in: store.storiesDir), store.fm.fileExists(atPath: p.path)
            else { return .error("not found", status: 404) }
            return .json(storyFull(p))
        case ("PUT", "api", "stories", let sid, _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            guard let p = numericJSONPath(sid, in: store.storiesDir), store.fm.fileExists(atPath: p.path)
            else { return .error("not found", status: 404) }
            guard let (title, pages) = validatePagesPayload(req.json, mediaKey: "image") else { return .status(413) }
            store.writeJSON(["title": title, "pages": pages], to: p)
            return .json(storyFull(p))
        case ("DELETE", "api", "stories", let sid, _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            guard let p = numericJSONPath(sid, in: store.storiesDir) else { return .error("bad id", status: 400) }
            try? store.fm.removeItem(at: p)
            var active = store.readActiveIDs(store.activeStoriesFile, limit: 3)
            if let i = active.firstIndex(of: sid) {
                active.remove(at: i)
                store.writeActiveIDs(active, file: store.activeStoriesFile, dir: store.storiesDir, limit: 3)
            }
            return .json(["ok": true])

        // --- TRENING sessions ----------------------------------------------
        case ("GET", "api", "trainings", _, _) where n == 2:
            return .json(store.listFiles(in: store.trainingsDir, extensions: ["json"]).map(storySummary))
        case ("GET", "api", "trainings", "active", _) where n == 3:
            return .json(store.readActiveIDs(store.activeTrainingsFile, limit: 3).compactMap { tid -> [String: Any]? in
                let p = store.trainingsDir.appendingPathComponent("\(tid).json")
                return store.fm.fileExists(atPath: p.path) ? storySummary(p) : nil
            })
        case ("POST", "api", "trainings", "active", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            let ids = (req.json["ids"] as? [Any] ?? []).map { "\($0)" }
            store.writeActiveIDs(ids, file: store.activeTrainingsFile, dir: store.trainingsDir, limit: 3)
            return .json(["active": store.readActiveIDs(store.activeTrainingsFile, limit: 3)])
        case ("POST", "api", "trainings", _, _) where n == 2:
            if let challenge = requireAdmin(req) { return challenge }
            guard let (title, pages) = validatePagesPayload(req.json, mediaKey: "media") else { return .status(413) }
            let p = store.trainingsDir.appendingPathComponent("\(store.newID()).json")
            store.writeJSON(["title": title, "pages": pages], to: p)
            return .json(trainingFull(p))
        case ("GET", "api", "trainings", "media", let name) where n == 4:
            guard isSafeName(name) else { return .status(400) }
            return serveFile(store.trainingMediaDir.appendingPathComponent(name), range: req.byteRange)
        case ("POST", "api", "trainings", "media", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            guard let file = uploadedFile(req) else { return .error("missing file", status: 400) }
            let ext = fileExt(file.filename)
            guard DataStore.allowedBG.contains(ext) || DataStore.allowedVideo.contains(ext) else {
                return .error("extension .\(ext) not allowed", status: 400)
            }
            let name: String
            var posterURL: String?
            if DataStore.allowedVideo.contains(ext) {
                // Save video as-is — no transcoding — but extract a poster so
                // the gallery doesn't decode video metadata per tile.
                name = "\(store.newID()).\(ext)"
                let target = store.trainingMediaDir.appendingPathComponent(name)
                guard file.data.count <= 200 * 1024 * 1024 else { return .error("file too large", status: 413) }
                try? file.data.write(to: target)
                if let poster = MediaPipeline.videoPoster(target) {
                    let posterName = ((name as NSString).deletingPathExtension) + ".jpg"
                    try? poster.write(to: store.trainingMediaDir.appendingPathComponent(posterName))
                    posterURL = "/api/trainings/media/\(posterName)"
                }
            } else if ext == "gif" {
                // Preserve animation; re-encode would flatten it.
                guard file.data.count <= 16 * 1024 * 1024 else { return .error("file too large", status: 413) }
                name = "\(store.newID()).gif"
                try? file.data.write(to: store.trainingMediaDir.appendingPathComponent(name))
            } else {
                guard let data = MediaPipeline.normalizeImage(file.data) else {
                    return .error("could not process image", status: 400)
                }
                name = "\(store.newID()).jpg"
                try? data.write(to: store.trainingMediaDir.appendingPathComponent(name))
            }
            let kind = DataStore.allowedVideo.contains(ext) ? "video" : "image"
            return .json(["ok": true, "name": name,
                          "url": "/api/trainings/media/\(name)",
                          "kind": kind,
                          "poster_url": posterURL.map { $0 as Any } ?? NSNull()])
        case ("GET", "api", "trainings", let tid, _) where n == 3:
            guard let p = numericJSONPath(tid, in: store.trainingsDir), store.fm.fileExists(atPath: p.path)
            else { return .error("not found", status: 404) }
            return .json(trainingFull(p))
        case ("PUT", "api", "trainings", let tid, _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            guard let p = numericJSONPath(tid, in: store.trainingsDir), store.fm.fileExists(atPath: p.path)
            else { return .error("not found", status: 404) }
            guard let (title, pages) = validatePagesPayload(req.json, mediaKey: "media") else { return .status(413) }
            store.writeJSON(["title": title, "pages": pages], to: p)
            return .json(trainingFull(p))
        case ("DELETE", "api", "trainings", let tid, _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            guard let p = numericJSONPath(tid, in: store.trainingsDir) else { return .error("bad id", status: 400) }
            try? store.fm.removeItem(at: p)
            var active = store.readActiveIDs(store.activeTrainingsFile, limit: 3)
            if let i = active.firstIndex(of: tid) {
                active.remove(at: i)
                store.writeActiveIDs(active, file: store.activeTrainingsFile, dir: store.trainingsDir, limit: 3)
            }
            return .json(["ok": true])

        // --- Power dot — meaningless on an iPad, acknowledged as no-ops ----
        case ("POST", "api", "shutdown", _, _) where n == 2,
             ("POST", "api", "reboot", _, _) where n == 2:
            return .json(["ok": true])

        case ("GET", "api", "health", _, _) where n == 2:
            return .json(["ok": true])

        // --- BANK coins -----------------------------------------------------
        case ("GET", "api", "coins", _, _) where n == 2:
            return .json(["count": store.loadCoins()])
        case ("POST", "api", "coins", "spend", _) where n == 3:
            guard let v = intValue(req.json["n"]), v > 0 else { return .error("bad n", status: 400) }
            let current = store.loadCoins()
            guard current >= v else {
                return .json(["error": "insufficient", "balance": current], status: 402)
            }
            store.saveCoins(current - v)
            return .json(["count": current - v, "spent": v])
        case ("POST", "api", "coins", "earn", _) where n == 3:
            let c = store.loadCoins() + 1
            store.saveCoins(c)
            return .json(["count": c])
        case ("POST", "api", "coins", "reset", _) where n == 3:
            if let challenge = requireAdmin(req) { return challenge }
            store.saveCoins(0)
            return .json(["count": 0])

        // --- Lock pattern (kiosk VALG → Lås; loopback = always "local") ----
        case ("POST", "api", "lock_pattern", _, _) where n == 2:
            let raw = req.json["pattern"]
            let new: [String]
            if raw == nil || raw is NSNull || (raw as? [Any])?.isEmpty == true {
                new = []
            } else if let list = raw as? [String], list.count == 3,
                      list.allSatisfy({ DataStore.lockColors.contains($0) }) {
                new = list
            } else {
                return .error("bad pattern", status: 400)
            }
            var cfg = store.loadConfig()
            cfg["lock_pattern"] = new
            store.saveConfig(cfg)
            return .json(["lock_pattern": new])

        // --- Version / config ----------------------------------------------
        case ("GET", "api", "version", _, _) where n == 2:
            let frontendMtimes = ["index.html", "style.css", "app.js"]
                .map { store.mtime(store.frontendDir.appendingPathComponent($0)) }
            let bg = store.currentBackground()
            return .json([
                "version": frontendMtimes.max() ?? 0,
                "background": bg.map { store.mtime($0) } ?? 0,
                "events": store.fm.fileExists(atPath: store.eventsFile.path) ? store.mtime(store.eventsFile) : 0,
                "coins": store.loadCoins(),
                "started": store.startedAt,
                "config": store.loadConfig(),
            ])
        case ("GET", "api", "config", _, _) where n == 2:
            return .json(store.loadConfig())
        case ("POST", "api", "config", _, _) where n == 2:
            if let challenge = requireAdmin(req) { return challenge }
            return updateConfig(req.json)

        // --- Calendar -------------------------------------------------------
        case ("GET", "api", "calendar", _, _) where n == 2:
            return .json(["count": store.loadEvents().count, "ical_available": false])
        case ("GET", "api", "calendar", "export", _) where n == 3,
             ("POST", "api", "calendar", "import", _) where n == 3:
            return .error("iCal import/export not supported in the iPad app yet", status: 501)
        case ("DELETE", "api", "calendar", _, _) where n == 2:
            if let challenge = requireAdmin(req) { return challenge }
            store.writeJSON([[String: Any]](), to: store.eventsFile, pretty: true)
            return .json(["ok": true])
        case ("GET", "api", "events", let datestr, _) where n == 3:
            guard datestr.count == 10, let target = RRule.parseDate(datestr)
            else { return .error("bad date", status: 400) }
            return .json(store.loadEvents().compactMap { ev -> [String: Any]? in
                guard RRule.eventOccurs(event: ev, on: target) else { return nil }
                return ["uid": ev["uid"] ?? NSNull(),
                        "summary": ev["summary"] ?? NSNull(),
                        "icon": (ev["icon"] as? String) ?? "event"]
            })

        // --- Admin multipart uploads ---------------------------------------
        case ("POST", "admin", "background", _, _) where n == 2:
            if let challenge = requireAdmin(req) { return challenge }
            guard let file = uploadedFile(req) else { return .error("missing file", status: 400) }
            let ext = fileExt(file.filename)
            guard DataStore.allowedBG.contains(ext) else {
                return .error("extension .\(ext) not allowed", status: 400)
            }
            guard let data = MediaPipeline.normalizeImage(file.data) else {
                return .error("could not process image", status: 400)
            }
            // Seconds, not ms — matches app.py's background naming.
            let name = "\(Int(Date().timeIntervalSince1970)).jpg"
            let target = store.bgDir.appendingPathComponent(name)
            try? data.write(to: target)
            try? name.write(to: store.currentBGFile, atomically: true, encoding: .utf8)
            return .json(["ok": true, "version": store.mtime(target), "id": name, "bytes": data.count])

        case ("POST", "admin", "pictures", _, _) where n == 2:
            if let challenge = requireAdmin(req) { return challenge }
            guard let file = uploadedFile(req) else { return .error("missing file", status: 400) }
            let ext = fileExt(file.filename)
            guard DataStore.allowedBG.contains(ext) else {
                return .error("extension .\(ext) not allowed", status: 400)
            }
            guard let data = MediaPipeline.normalizeImage(file.data) else {
                return .error("could not process image", status: 400)
            }
            let name = "\(store.newID()).jpg"
            try? data.write(to: store.picturesDir.appendingPathComponent(name))
            return .json(["ok": true, "id": name, "bytes": data.count])

        case ("POST", "admin", "gifs", _, _) where n == 2:
            if let challenge = requireAdmin(req) { return challenge }
            guard let file = uploadedFile(req) else { return .error("missing file", status: 400) }
            let ext = fileExt(file.filename)
            guard DataStore.allowedGif.contains(ext) else {
                return .error("extension .\(ext) not allowed", status: 400)
            }
            guard file.data.count <= 200 * 1024 * 1024 else { return .error("file too large", status: 413) }
            let name = "\(store.newID()).\(ext)"
            let target = store.gifsDir.appendingPathComponent(name)
            try? file.data.write(to: target)
            let poster = DataStore.allowedVideo.contains(ext)
                ? MediaPipeline.videoPoster(target)
                : MediaPipeline.gifPoster(file.data)
            var posterURL: String?
            if let poster = poster {
                let posterName = ((name as NSString).deletingPathExtension) + ".jpg"
                try? poster.write(to: store.gifsDir.appendingPathComponent(posterName))
                posterURL = "/api/gifs/\(posterName)"
            }
            return .json(["ok": true, "id": name, "bytes": file.data.count,
                          "poster_url": posterURL.map { $0 as Any } ?? NSNull()])

        case ("POST", "admin", "videos", _, _) where n == 2:
            if let challenge = requireAdmin(req) { return challenge }
            guard let file = uploadedFile(req) else { return .error("missing file", status: 400) }
            let ext = fileExt(file.filename)
            guard DataStore.allowedVideo.contains(ext) else {
                return .error("extension .\(ext) not allowed", status: 400)
            }
            guard file.data.count <= 200 * 1024 * 1024 else { return .error("file too large", status: 413) }
            let name = "\(store.newID()).\(ext)"
            let target = store.videosDir.appendingPathComponent(name)
            try? file.data.write(to: target)
            var posterURL: String?
            if let poster = MediaPipeline.videoPoster(target) {
                let posterName = ((name as NSString).deletingPathExtension) + ".jpg"
                try? poster.write(to: store.videosDir.appendingPathComponent(posterName))
                posterURL = "/api/videos/\(posterName)"
            }
            return .json(["ok": true, "id": name, "bytes": file.data.count,
                          "poster_url": posterURL.map { $0 as Any } ?? NSNull()])

        // --- Static frontend fallback (admin.css, admin.js, vendor/…) ------
        default:
            guard req.method == "GET" else { return .status(405) }
            guard n > 0, !parts.contains(".."), !parts.contains(where: { $0.hasPrefix(".") })
            else { return .status(404) }
            return serveFile(store.frontendDir.appendingPathComponent(parts.joined(separator: "/")))
        }
    }

    // MARK: - Pages

    /// Port of the index route: splice CSS + i18n + JS into one document.
    private func kioskIndex() -> HTTPResponse {
        guard var html = readFrontend("index.html"),
              let css = readFrontend("style.css"),
              let i18nJS = readFrontend("i18n.js"),
              let appJS = readFrontend("app.js") else {
            return .error("frontend bundle incomplete", status: 500)
        }
        let cfg = store.loadConfig()
        html = html.replacingOccurrences(
            of: "<link rel=\"stylesheet\" href=\"style.css\">",
            with: "<style>\n\(css)\n</style>")
        html = html.replacingOccurrences(
            of: "<script src=\"i18n.js\"></script>",
            with: i18nInline(locale: cfg["kiosk_lang"] as? String ?? "no") + "\n<script>\n\(i18nJS)\n</script>")
        html = html.replacingOccurrences(
            of: "<script src=\"app.js\"></script>",
            with: "<script>\n\(appJS)\n</script>")
        return .html(html)
    }

    private func adminIndex() -> HTTPResponse {
        guard var html = readFrontend("admin.html"),
              let i18nJS = readFrontend("i18n.js") else {
            return .error("frontend bundle incomplete", status: 500)
        }
        let cfg = store.loadConfig()
        html = html.replacingOccurrences(
            of: "<script src=\"i18n.js\"></script>",
            with: i18nInline(locale: cfg["admin_lang"] as? String ?? "no") + "\n<script>\n\(i18nJS)\n</script>")
        return .html(html)
    }

    private func readFrontend(_ name: String) -> String? {
        try? String(contentsOf: store.frontendDir.appendingPathComponent(name), encoding: .utf8)
    }

    private func i18nInline(locale rawLocale: String) -> String {
        let locale = DataStore.langValues.contains(rawLocale) ? rawLocale : "no"
        var url = store.localesDir.appendingPathComponent("\(locale).json")
        if !store.fm.fileExists(atPath: url.path) {
            url = store.localesDir.appendingPathComponent("no.json")
        }
        let dict = store.readJSONDict(url)
        let payload = (try? JSONSerialization.data(withJSONObject: ["locale": locale, "dict": dict]))
            ?? Data("{}".utf8)
        return "<script>window.__I18N__ = \(String(data: payload, encoding: .utf8) ?? "{}");</script>"
    }

    // MARK: - Shared helpers

    private func requireAdmin(_ req: HTTPRequest) -> HTTPResponse? {
        guard let auth = req.headers["authorization"],
              auth.lowercased().hasPrefix("basic "),
              let decoded = Data(base64Encoded: String(auth.dropFirst(6)).trimmingCharacters(in: .whitespaces)),
              let creds = String(data: decoded, encoding: .utf8),
              let colon = creds.firstIndex(of: ":") else {
            return .unauthorized
        }
        let user = String(creds[..<colon])
        let pass = String(creds[creds.index(after: colon)...])
        guard user == "admin", constantTimeEquals(pass, store.adminPassword()) else {
            return .unauthorized
        }
        return nil
    }

    private func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let ab = Array(a.utf8), bb = Array(b.utf8)
        guard ab.count == bb.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<ab.count { diff |= ab[i] ^ bb[i] }
        return diff == 0
    }

    private func uploadedFile(_ req: HTTPRequest) -> Multipart.File? {
        guard let file = Multipart.firstFile(contentType: req.headers["content-type"], body: req.body),
              !file.filename.isEmpty else { return nil }
        return file
    }

    private func fileExt(_ filename: String) -> String {
        (filename as NSString).pathExtension.lowercased()
    }

    private func isSafeName(_ name: String) -> Bool {
        !name.contains("/") && !name.contains("\\") && !name.contains("..")
    }

    private func serveFile(_ url: URL, range: (start: Int64, end: Int64?)? = nil) -> HTTPResponse {
        var isDir: ObjCBool = false
        guard store.fm.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue else {
            return .status(404)
        }
        return .file(url, contentType: MIME.forFile(url), range: range)
    }

    /// Shared shape of the /admin/*/delete JSON endpoints.
    private func deleteMediaFile(_ req: HTTPRequest, dir: URL, alsoPoster: Bool = false,
                                 afterDelete: ((String) -> Void)? = nil) -> HTTPResponse {
        guard let name = req.json["id"] as? String, !name.isEmpty, isSafeName(name)
        else { return .error("bad id", status: 400) }
        let p = dir.appendingPathComponent(name)
        guard store.fm.fileExists(atPath: p.path) else { return .error("not found", status: 404) }
        try? store.fm.removeItem(at: p)
        if alsoPoster {
            try? store.fm.removeItem(at: p.deletingPathExtension().appendingPathExtension("jpg"))
        }
        afterDelete?(name)
        return .json(["ok": true])
    }

    // MARK: - Jobs

    private func jobPath(_ id: String) -> URL? { numericJSONPath(id, in: store.jobsDir) }

    private func numericJSONPath(_ id: String, in dir: URL) -> URL? {
        guard !id.isEmpty, id.allSatisfy(\.isNumber) else { return nil }
        return dir.appendingPathComponent("\(id).json")
    }

    private func readJob(_ url: URL) -> [String: Any] {
        let d = store.readJSONDict(url)
        return ["title": (d["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Uten tittel",
                "content": d["content"] as? String ?? "",
                "mtime": store.mtime(url)]
    }

    private func validateJobPayload(_ body: [String: Any]) -> (title: String, content: String)? {
        let title = (body["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let content = body["content"] as? String ?? ""
        guard content.utf8.count <= 64 * 1024 else { return nil }
        return (title.isEmpty ? "Uten tittel" : title, content)
    }

    // MARK: - Stories / trainings (shared shapes)

    private func storySummary(_ url: URL) -> [String: Any] {
        let d = store.readJSONDict(url)
        return ["id": url.deletingPathExtension().lastPathComponent,
                "title": (d["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Uten tittel",
                "page_count": (d["pages"] as? [Any])?.count ?? 0,
                "mtime": store.mtime(url)]
    }

    private func storyFull(_ url: URL) -> [String: Any] {
        let d = store.readJSONDict(url)
        let pages = (d["pages"] as? [[String: Any]] ?? []).map { page -> [String: Any] in
            let img = (page["image"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return ["text": page["text"] as? String ?? "",
                    "image": img ?? NSNull(),
                    "image_url": img.map { "/api/stories/img/\($0)" } ?? NSNull()]
        }
        return ["id": url.deletingPathExtension().lastPathComponent,
                "title": (d["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Uten tittel",
                "pages": pages,
                "mtime": store.mtime(url)]
    }

    private func trainingFull(_ url: URL) -> [String: Any] {
        let d = store.readJSONDict(url)
        let pages = (d["pages"] as? [[String: Any]] ?? []).map { page -> [String: Any] in
            let media = (page["media"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let ext = media.map { ($0 as NSString).pathExtension.lowercased() } ?? ""
            let kind: String? = DataStore.allowedVideo.contains(ext) ? "video"
                : (DataStore.allowedBG.contains(ext) ? "image" : nil)
            var posterURL: String?
            if let media = media, kind == "video" {
                let poster = ((media as NSString).deletingPathExtension) + ".jpg"
                if store.fm.fileExists(atPath: store.trainingMediaDir.appendingPathComponent(poster).path) {
                    posterURL = "/api/trainings/media/\(poster)"
                }
            }
            return ["text": page["text"] as? String ?? "",
                    "media": media ?? NSNull(),
                    "media_url": media.map { "/api/trainings/media/\($0)" } ?? NSNull(),
                    "media_kind": kind ?? NSNull(),
                    "poster_url": posterURL.map { $0 as Any } ?? NSNull()]
        }
        return ["id": url.deletingPathExtension().lastPathComponent,
                "title": (d["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Uten tittel",
                "pages": pages,
                "mtime": store.mtime(url)]
    }

    /// Pages payload validation shared by stories (image key) and trainings
    /// (media key). Returns nil on the 413 size cap, mirroring abort(413).
    private func validatePagesPayload(_ body: [String: Any], mediaKey: String)
        -> (title: String, pages: [[String: Any]])? {
        let rawTitle = (body["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let title = rawTitle.isEmpty ? "Uten tittel" : rawTitle
        var pages: [[String: Any]] = []
        for raw in body["pages"] as? [Any] ?? [] {
            guard let page = raw as? [String: Any] else { continue }
            var media = (page[mediaKey] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let m = media, m.isEmpty || m.contains("/") || m.contains("..") { media = nil }
            pages.append(["text": page["text"] as? String ?? "",
                          mediaKey: media ?? NSNull()])
        }
        let size = (try? JSONSerialization.data(withJSONObject: ["title": title, "pages": pages]))?.count ?? 0
        guard size <= 256 * 1024 else { return nil }
        return (title, pages)
    }

    // MARK: - Config update (validation mirrors /api/config POST)

    private func updateConfig(_ body: [String: Any]) -> HTTPResponse {
        var cfg = store.loadConfig()
        if body["heading"] != nil {
            let h = (body["heading"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !h.isEmpty { cfg["heading"] = String(h.prefix(120)) }
        }
        if let v = body["level"] as? String, DataStore.levelValues.contains(v) {
            cfg["level"] = v
        }
        if let g = body["gender"] as? String, DataStore.genderValues.contains(g) {
            cfg["gender"] = g
        }
        for key in ["admin_lang", "kiosk_lang"] {
            if let v = body[key] as? String, DataStore.langValues.contains(v) { cfg[key] = v }
        }
        if let v = body["show_logo"] { cfg["show_logo"] = truthy(v) }
        if let v = body["show_heading"] { cfg["show_heading"] = truthy(v) }
        if body.keys.contains("lock_pattern") {
            let raw = body["lock_pattern"]
            if raw is NSNull || (raw as? [Any])?.isEmpty == true {
                cfg["lock_pattern"] = [String]()
            } else if let list = raw as? [String], list.count == 3,
                      list.allSatisfy({ DataStore.lockColors.contains($0) }) {
                cfg["lock_pattern"] = list
            } else {
                return .error("bad lock_pattern", status: 400)
            }
        }
        if body["time_budget_minutes"] != nil {
            guard let m = intValue(body["time_budget_minutes"]), (0...720).contains(m) else {
                return .error("bad time_budget_minutes", status: 400)
            }
            cfg["time_budget_minutes"] = m
        }
        if body["time_restore_hours"] != nil {
            guard let h = intValue(body["time_restore_hours"]), (0...168).contains(h) else {
                return .error("bad time_restore_hours", status: 400)
            }
            cfg["time_restore_hours"] = h
        }
        if body["time_extension_pattern"] != nil {
            guard let list = body["time_extension_pattern"] as? [String], list.count == 6,
                  list.allSatisfy({ DataStore.lockColors.contains($0) }) else {
                return .error("bad time_extension_pattern", status: 400)
            }
            cfg["time_extension_pattern"] = list
        }
        if body["time_extension_options"] != nil {
            let opts = (body["time_extension_options"] as? [Any] ?? []).compactMap { intValue($0) }
            guard opts.count == 3, opts.allSatisfy({ (1...120).contains($0) }) else {
                return .error("bad time_extension_options", status: 400)
            }
            cfg["time_extension_options"] = opts
        }
        store.saveConfig(cfg)
        return .json(cfg)
    }

    private func truthy(_ v: Any) -> Bool {
        if let b = v as? Bool { return b }
        if let num = intValue(v) { return num != 0 }
        if let s = v as? String { return !s.isEmpty }
        return false
    }
}
