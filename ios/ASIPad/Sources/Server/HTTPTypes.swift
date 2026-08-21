import Foundation

/// A parsed HTTP request, transport-agnostic. The same struct is fed to the
/// Router whether it arrived over the loopback socket (kiosk webview) or —
/// later — a LAN listener for the admin laptop.
struct HTTPRequest {
    let method: String            // uppercased: GET / POST / PUT / DELETE
    let path: String              // percent-decoded, query stripped, e.g. "/api/jobs/17"
    let query: [String: String]   // decoded query items (unused by the API today)
    let headers: [String: String] // keys lowercased
    let body: Data

    /// JSON body parsed leniently — mirrors Flask's `get_json(silent=True) or {}`.
    var json: [String: Any] {
        (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
    }

    /// Parsed single-range `Range: bytes=a-b` header, as (start, endInclusive?).
    var byteRange: (start: Int64, end: Int64?)? {
        guard let raw = headers["range"], raw.hasPrefix("bytes=") else { return nil }
        let spec = raw.dropFirst("bytes=".count)
        guard !spec.contains(","), let dash = spec.firstIndex(of: "-") else { return nil }
        let startStr = spec[spec.startIndex..<dash]
        let endStr = spec[spec.index(after: dash)...]
        if startStr.isEmpty {
            // suffix range "bytes=-N": last N bytes
            guard let n = Int64(endStr), n > 0 else { return nil }
            return (-n, nil)
        }
        guard let start = Int64(startStr), start >= 0 else { return nil }
        return (start, endStr.isEmpty ? nil : Int64(endStr))
    }
}

/// Response body: small payloads as Data, media as a file slice that the
/// connection streams in chunks (a 200 MB rental video must never be
/// materialized in RAM on an iPad).
enum HTTPBody {
    case data(Data)
    case file(url: URL, offset: Int64, length: Int64)
    case empty

    var length: Int64 {
        switch self {
        case .data(let d): return Int64(d.count)
        case .file(_, _, let len): return len
        case .empty: return 0
        }
    }
}

struct HTTPResponse {
    var status: Int
    var headers: [String: String]
    var body: HTTPBody

    static func json(_ obj: Any, status: Int = 200) -> HTTPResponse {
        let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data("{}".utf8)
        return HTTPResponse(status: status,
                            headers: ["Content-Type": "application/json"],
                            body: .data(data))
    }

    static func error(_ message: String, status: Int) -> HTTPResponse {
        .json(["error": message], status: status)
    }

    static func text(_ s: String, status: Int = 200, contentType: String = "text/plain; charset=utf-8") -> HTTPResponse {
        HTTPResponse(status: status, headers: ["Content-Type": contentType], body: .data(Data(s.utf8)))
    }

    static func html(_ s: String) -> HTTPResponse {
        .text(s, contentType: "text/html; charset=utf-8")
    }

    static func status(_ code: Int) -> HTTPResponse {
        HTTPResponse(status: code, headers: [:], body: .empty)
    }

    /// 401 challenge matching Flask's require_admin().
    static var unauthorized: HTTPResponse {
        HTTPResponse(status: 401,
                     headers: ["WWW-Authenticate": "Basic realm=\"asipad-admin\"",
                               "Content-Type": "text/plain"],
                     body: .data(Data("Authentication required\n".utf8)))
    }

    /// Serve a file, honouring a single-range request (needed for <video> seek).
    static func file(_ url: URL, contentType: String, range: (start: Int64, end: Int64?)?) -> HTTPResponse {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = (attrs[.size] as? NSNumber)?.int64Value else {
            return .status(404)
        }
        var headers = ["Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": "no-cache"]
        guard let range = range, size > 0 else {
            return HTTPResponse(status: 200, headers: headers, body: .file(url: url, offset: 0, length: size))
        }
        var start = range.start
        if start < 0 { start = max(0, size + start) }           // suffix range
        var end = range.end ?? (size - 1)
        end = min(end, size - 1)
        guard start <= end, start < size else {
            headers["Content-Range"] = "bytes */\(size)"
            return HTTPResponse(status: 416, headers: headers, body: .empty)
        }
        headers["Content-Range"] = "bytes \(start)-\(end)/\(size)"
        return HTTPResponse(status: 206, headers: headers,
                            body: .file(url: url, offset: start, length: end - start + 1))
    }
}

enum MIME {
    static let byExtension: [String: String] = [
        "html": "text/html; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif",
        "ico": "image/x-icon",
        "woff2": "font/woff2",
        "mp4": "video/mp4",
        "m4v": "video/x-m4v",
        "webm": "video/webm",
        "mov": "video/quicktime",
        "ics": "text/calendar; charset=utf-8",
    ]

    static func forFile(_ url: URL) -> String {
        byExtension[url.pathExtension.lowercased()] ?? "application/octet-stream"
    }
}

func httpStatusText(_ code: Int) -> String {
    switch code {
    case 200: return "OK"
    case 204: return "No Content"
    case 206: return "Partial Content"
    case 400: return "Bad Request"
    case 401: return "Unauthorized"
    case 402: return "Payment Required"
    case 403: return "Forbidden"
    case 404: return "Not Found"
    case 405: return "Method Not Allowed"
    case 413: return "Payload Too Large"
    case 416: return "Range Not Satisfiable"
    case 500: return "Internal Server Error"
    case 501: return "Not Implemented"
    default: return "Status \(code)"
    }
}
