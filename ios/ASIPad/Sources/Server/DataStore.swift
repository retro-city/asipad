import Foundation

/// Owns the on-device mirror of the Pi's `data/` tree plus access to the
/// bundled frontend/assets. Directory layout, file formats, and defaults are
/// byte-compatible with server/app.py so content can move freely between a
/// Pi kiosk and the iPad (Finder file sharing exposes Documents/data).
final class DataStore {
    static let levelValues = ["easy", "medium", "hard"]
    static let genderValues = ["male", "female"]
    static let langValues = ["no", "en", "ua"]
    static let lockColors = ["red", "orange", "yellow", "green", "blue", "violet"]
    static let legacyLevelMap = ["lett": "easy", "medium": "medium", "vanskelig": "hard"]
    static let defaultGifCost = 9

    static let allowedBG = ["jpg", "jpeg", "png", "webp", "gif"]
    static let allowedVideo = ["mp4", "webm", "mov", "m4v"]
    static let allowedGif = ["gif", "webp", "mp4", "webm", "mov", "m4v"]

    static let defaultConfig: [String: Any] = [
        "heading": "ASIPad",
        "level": "easy",
        "gender": "female",
        "admin_lang": "no",
        "kiosk_lang": "no",
        "show_logo": true,
        "show_heading": true,
        "lock_pattern": [String](),
        "time_budget_minutes": 15,
        "time_extension_pattern": ["red", "green", "blue", "blue", "green", "red"],
        "time_extension_options": [10, 15, 20],
    ]

    let fm = FileManager.default

    // Writable tree — in Documents so UIFileSharingEnabled exposes it.
    let dataDir: URL
    var bgDir: URL { dataDir.appendingPathComponent("bg") }
    var gifsDir: URL { dataDir.appendingPathComponent("gifs") }
    var jobsDir: URL { dataDir.appendingPathComponent("jobs") }
    var picturesDir: URL { dataDir.appendingPathComponent("pictures") }
    var storiesDir: URL { dataDir.appendingPathComponent("stories") }
    var storyImgDir: URL { storiesDir.appendingPathComponent("img") }
    var trainingsDir: URL { dataDir.appendingPathComponent("trainings") }
    var trainingMediaDir: URL { trainingsDir.appendingPathComponent("media") }
    var videosDir: URL { dataDir.appendingPathComponent("videos") }

    var configFile: URL { dataDir.appendingPathComponent("config.json") }
    var coinsFile: URL { dataDir.appendingPathComponent("coins.json") }
    var eventsFile: URL { dataDir.appendingPathComponent("events.json") }
    var gifCostsFile: URL { dataDir.appendingPathComponent("gif_costs.json") }
    var currentBGFile: URL { dataDir.appendingPathComponent("current-bg.txt") }
    var activeStoriesFile: URL { storiesDir.appendingPathComponent("active.txt") }
    var activeTrainingsFile: URL { trainingsDir.appendingPathComponent("active.txt") }
    var adminPasswordFile: URL  // analog of ~/.asipad-admin-password

    // Read-only bundle content.
    let frontendDir: URL
    let assetsDir: URL
    var localesDir: URL { frontendDir.appendingPathComponent("locales") }

    let startedAt = Int(Date().timeIntervalSince1970)

    /// Defaults resolve inside the app sandbox/bundle. The overrides exist for
    /// the macOS dev harness (ios/devserver), which points the identical server
    /// code at the repo's frontend/ and a scratch data dir.
    init(dataDir dataDirOverride: URL? = nil,
         frontendDir frontendDirOverride: URL? = nil,
         assetsDir assetsDirOverride: URL? = nil,
         adminPasswordFile adminPasswordOverride: URL? = nil) {
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        dataDir = dataDirOverride ?? docs.appendingPathComponent("data")
        adminPasswordFile = adminPasswordOverride ?? docs.appendingPathComponent("admin-password.txt")

        let bundle = Bundle.main.resourceURL!
        frontendDir = frontendDirOverride ?? bundle.appendingPathComponent("frontend")
        assetsDir = assetsDirOverride ?? bundle.appendingPathComponent("assets")

        seedIfNeeded(bundleData: bundle.appendingPathComponent("data"))
        for dir in [bgDir, gifsDir, jobsDir, picturesDir, storiesDir, storyImgDir,
                    trainingsDir, trainingMediaDir, videosDir] {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    /// First launch: copy the bundled data snapshot (if the build included one)
    /// into the writable tree. Never overwrites an existing tree — the device's
    /// own progress always wins over the bundle.
    private func seedIfNeeded(bundleData: URL) {
        guard !fm.fileExists(atPath: dataDir.path) else { return }
        if fm.fileExists(atPath: bundleData.path) {
            try? fm.copyItem(at: bundleData, to: dataDir)
        } else {
            try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)
        }
    }

    // MARK: - Small-file helpers

    func readJSONDict(_ url: URL) -> [String: Any] {
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    func writeJSON(_ obj: Any, to url: URL, pretty: Bool = false) {
        var options: JSONSerialization.WritingOptions = [.sortedKeys]
        if pretty { options.insert(.prettyPrinted) }
        if let data = try? JSONSerialization.data(withJSONObject: obj, options: options) {
            try? data.write(to: url, options: .atomic)
        }
    }

    func mtime(_ url: URL) -> Int {
        let attrs = try? fm.attributesOfItem(atPath: url.path)
        return Int((attrs?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0)
    }

    /// Files in `dir` with one of `extensions`, newest mtime first — the
    /// ordering every gallery endpoint uses.
    func listFiles(in dir: URL, extensions: [String]) -> [URL] {
        let items = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        return items
            .filter { extensions.contains($0.pathExtension.lowercased()) }
            .sorted { mtime($0) > mtime($1) }
    }

    /// Millisecond-timestamp id, matching `int(time.time() * 1000)`.
    func newID() -> String { String(Int64(Date().timeIntervalSince1970 * 1000)) }

    // MARK: - Config

    func loadConfig() -> [String: Any] {
        guard fm.fileExists(atPath: configFile.path) else { return Self.defaultConfig }
        var cfg = readJSONDict(configFile)
        // Legacy schema migration (nivaa → level, "uk" → "ua").
        if let nivaa = cfg.removeValue(forKey: "nivaa"), cfg["level"] == nil {
            cfg["level"] = Self.legacyLevelMap["\(nivaa)"] ?? "easy"
        }
        if let lvl = cfg["level"] as? String, let mapped = Self.legacyLevelMap[lvl] {
            cfg["level"] = mapped
        }
        for key in ["admin_lang", "kiosk_lang"] where (cfg[key] as? String) == "uk" {
            cfg[key] = "ua"
        }
        return Self.defaultConfig.merging(cfg) { _, new in new }
    }

    func saveConfig(_ cfg: [String: Any]) {
        writeJSON(cfg, to: configFile)
    }

    // MARK: - Coins

    func loadCoins() -> Int {
        guard let data = try? Data(contentsOf: coinsFile),
              let obj = try? JSONSerialization.jsonObject(with: data) else { return 0 }
        if let d = obj as? [String: Any] { return intValue(d["count"]) ?? 0 }
        return intValue(obj) ?? 0
    }

    func saveCoins(_ count: Int) {
        writeJSON(["count": count], to: coinsFile)
    }

    // MARK: - Gif costs

    func loadGifCosts() -> [String: Any] { readJSONDict(gifCostsFile) }

    func saveGifCosts(_ costs: [String: Any]) { writeJSON(costs, to: gifCostsFile, pretty: true) }

    func gifCost(for name: String, costs: [String: Any]) -> Int {
        guard costs[name] != nil else { return Self.defaultGifCost }
        guard let n = intValue(costs[name]) else { return Self.defaultGifCost }
        return max(0, n)
    }

    // MARK: - Background

    func currentBackground() -> URL? {
        guard let name = (try? String(contentsOf: currentBGFile, encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return nil }
        let url = bgDir.appendingPathComponent(name)
        var isDir: ObjCBool = false
        return fm.fileExists(atPath: url.path, isDirectory: &isDir) && !isDir.boolValue ? url : nil
    }

    // MARK: - Events

    func loadEvents() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: eventsFile),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return arr
    }

    // MARK: - Active id lists (stories / trainings share the format)

    func readActiveIDs(_ file: URL, limit: Int) -> [String] {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        return text.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.allSatisfy(\.isNumber) }
            .prefix(limit).map { $0 }
    }

    func writeActiveIDs(_ ids: [String], file: URL, dir: URL, limit: Int) {
        let valid = ids
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.allSatisfy(\.isNumber) }
            .filter { fm.fileExists(atPath: dir.appendingPathComponent("\($0).json").path) }
        try? valid.prefix(limit).joined(separator: "\n")
            .write(to: file, atomically: true, encoding: .utf8)
    }

    // MARK: - Admin password

    func adminPassword() -> String {
        if let pw = (try? String(contentsOf: adminPasswordFile, encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines), !pw.isEmpty {
            return pw
        }
        return "asipad"
    }
}

/// Python-ish lenient int coercion: Int, Double, or numeric String.
func intValue(_ any: Any?) -> Int? {
    switch any {
    case let n as Int: return n
    case let n as Double: return Int(n)
    case let n as NSNumber: return n.intValue
    case let s as String: return Int(s)
    default: return nil
    }
}
