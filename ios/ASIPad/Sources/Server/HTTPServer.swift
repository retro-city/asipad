import Foundation
import Network

/// Minimal HTTP/1.1 server on Network.framework. Serves the kiosk webview via
/// 127.0.0.1 today; the same instance can later bind a second LAN listener for
/// the admin laptop (stage 2) — the Router doesn't care about the transport.
///
/// Supported deliberately-small surface: request-line + headers, Content-Length
/// bodies, keep-alive, single-range GETs. No chunked uploads, no pipelining
/// beyond buffering — WKWebView doesn't need them.
final class HTTPServer {
    private let router: Router
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "asipad.http", qos: .userInitiated)
    private(set) var port: UInt16 = 0

    init(router: Router) {
        self.router = router
    }

    /// Binds loopback-only. Tries the canonical kiosk port first so URLs match
    /// the Pi deployment; falls back to an ephemeral port if it's taken.
    func start(preferredPort: UInt16 = 8080, ready: @escaping (UInt16) -> Void) {
        func makeListener(_ portValue: UInt16) -> NWListener? {
            let params = NWParameters.tcp
            // Loopback only — nothing on the Wi-Fi network can reach stage 1.
            params.requiredLocalEndpoint = NWEndpoint.hostPort(
                host: .ipv4(.loopback),
                port: portValue == 0 ? .any : NWEndpoint.Port(rawValue: portValue)!
            )
            params.allowLocalEndpointReuse = true
            return try? NWListener(using: params)
        }

        let listener = makeListener(preferredPort) ?? makeListener(0)
        guard let listener = listener else {
            NSLog("ASIPad server: could not create listener")
            return
        }
        self.listener = listener

        listener.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                self.port = listener.port?.rawValue ?? 0
                NSLog("ASIPad server: listening on 127.0.0.1:\(self.port)")
                ready(self.port)
            case .failed(let err):
                NSLog("ASIPad server: listener failed: \(err)")
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] conn in
            guard let self = self else { conn.cancel(); return }
            HTTPConnection(connection: conn, router: self.router, queue: self.queue).start()
        }
        listener.start(queue: queue)
    }
}

/// One TCP connection: buffer → parse → route → stream response → repeat
/// (keep-alive) until the peer closes.
private final class HTTPConnection {
    private static let maxHeaderBytes = 64 * 1024
    private static let maxBodyBytes = 210 * 1024 * 1024  // > MAX_GIF_BYTES + slack
    private static let fileChunk = 1 << 20               // 1 MiB streaming chunks

    private let connection: NWConnection
    private let router: Router
    private let queue: DispatchQueue
    private var buffer = Data()
    // Retain-until-closed: connection lifetime is managed by the socket itself.
    private var selfRetain: HTTPConnection?

    init(connection: NWConnection, router: Router, queue: DispatchQueue) {
        self.connection = connection
        self.router = router
        self.queue = queue
    }

    func start() {
        selfRetain = self
        connection.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.close() }
            if case .cancelled = state { self?.selfRetain = nil }
        }
        connection.start(queue: queue)
        receive()
    }

    private func close() {
        connection.cancel()
        selfRetain = nil
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 128 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let data = data, !data.isEmpty {
                self.buffer.append(data)
                self.processBuffer()
            }
            if isComplete || error != nil {
                self.close()
            } else if !(self.pendingResponse) {
                self.receive()
            }
        }
    }

    /// True while a request is being handled — reads pause so a slow media
    /// send isn't interleaved with parsing the next request.
    private var pendingResponse = false

    private func processBuffer() {
        guard !pendingResponse else { return }
        guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
            if buffer.count > Self.maxHeaderBytes { respondAndClose(.status(400)) }
            return
        }
        guard let head = String(data: buffer[..<headerEnd.lowerBound], encoding: .utf8) else {
            respondAndClose(.status(400))
            return
        }
        var lines = head.components(separatedBy: "\r\n")
        let requestLine = lines.removeFirst().split(separator: " ", maxSplits: 2)
        guard requestLine.count == 3 else {
            respondAndClose(.status(400))
            return
        }
        let method = requestLine[0].uppercased()
        let target = String(requestLine[1])

        var headers: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }

        let contentLength = Int(headers["content-length"] ?? "0") ?? 0
        if contentLength > Self.maxBodyBytes {
            respondAndClose(.status(413))
            return
        }
        let bodyStart = headerEnd.upperBound
        guard buffer.count - bodyStart >= contentLength else { return }  // need more bytes

        let body = buffer.subdata(in: bodyStart..<(bodyStart + contentLength))
        buffer.removeSubrange(..<(bodyStart + contentLength))

        // Split path from query, percent-decode both.
        var path = target
        var query: [String: String] = [:]
        if let qm = target.firstIndex(of: "?") {
            path = String(target[..<qm])
            for pair in target[target.index(after: qm)...].split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1)
                let k = String(kv[0]).removingPercentEncoding ?? String(kv[0])
                let v = kv.count > 1 ? (String(kv[1]).removingPercentEncoding ?? String(kv[1])) : ""
                query[k] = v
            }
        }
        path = path.removingPercentEncoding ?? path

        let request = HTTPRequest(method: method, path: path, query: query, headers: headers, body: body)
        let keepAlive = headers["connection"]?.lowercased() != "close"

        pendingResponse = true
        let response = router.handle(request)
        send(response, headOnly: method == "HEAD") { [weak self] in
            guard let self = self else { return }
            self.pendingResponse = false
            if keepAlive {
                // Another request may already be buffered (or arrive later).
                self.processBuffer()
                if !self.pendingResponse { self.receive() }
            } else {
                self.close()
            }
        }
    }

    private func respondAndClose(_ response: HTTPResponse) {
        pendingResponse = true
        send(response, headOnly: false) { [weak self] in self?.close() }
    }

    private func send(_ response: HTTPResponse, headOnly: Bool, completion: @escaping () -> Void) {
        var head = "HTTP/1.1 \(response.status) \(httpStatusText(response.status))\r\n"
        var headers = response.headers
        headers["Content-Length"] = String(response.body.length)
        headers["Connection"] = "keep-alive"
        for (k, v) in headers { head += "\(k): \(v)\r\n" }
        head += "\r\n"

        var payload = Data(head.utf8)
        if headOnly {
            connection.send(content: payload, completion: .contentProcessed { _ in completion() })
            return
        }
        switch response.body {
        case .empty:
            connection.send(content: payload, completion: .contentProcessed { _ in completion() })
        case .data(let d):
            payload.append(d)
            connection.send(content: payload, completion: .contentProcessed { _ in completion() })
        case .file(let url, let offset, let length):
            connection.send(content: payload, completion: .contentProcessed { [weak self] _ in
                self?.streamFile(url: url, offset: offset, remaining: length, completion: completion)
            })
        }
    }

    /// Sequentially stream a file slice in bounded chunks.
    private func streamFile(url: URL, offset: Int64, remaining: Int64, completion: @escaping () -> Void) {
        guard remaining > 0 else { completion(); return }
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            close()
            return
        }
        do { try handle.seek(toOffset: UInt64(offset)) } catch { try? handle.close(); close(); return }

        func sendNext(_ left: Int64) {
            guard left > 0 else { try? handle.close(); completion(); return }
            let chunkLen = Int(min(Int64(Self.fileChunk), left))
            guard let chunk = try? handle.read(upToCount: chunkLen), !chunk.isEmpty else {
                try? handle.close()
                self.close()  // short read — abort the connection rather than lie
                return
            }
            // `sendNext` already holds self strongly via the nested capture;
            // the connection outlives the stream or we abort with it.
            self.connection.send(content: chunk, completion: .contentProcessed { error in
                guard error == nil else { try? handle.close(); self.close(); return }
                sendNext(left - Int64(chunk.count))
            })
        }
        sendNext(remaining)
    }
}
