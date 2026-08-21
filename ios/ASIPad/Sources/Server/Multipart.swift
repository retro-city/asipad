import Foundation

/// Minimal multipart/form-data parser — just enough for the admin upload
/// forms, which all send exactly one file part named "file" (plus nothing
/// else). Tolerates preamble, epilogue, and extra parts.
enum Multipart {
    struct File {
        let filename: String
        let data: Data
    }

    /// Extract the first file-bearing part with the given field name.
    static func firstFile(named field: String = "file",
                          contentType: String?,
                          body: Data) -> File? {
        guard let contentType = contentType,
              let boundary = boundary(from: contentType) else { return nil }
        let delimiter = Data("--\(boundary)".utf8)
        let crlf = Data("\r\n".utf8)

        // First delimiter may or may not be preceded by a CRLF preamble.
        guard var cursor = body.range(of: delimiter)?.upperBound else { return nil }

        while cursor < body.endIndex {
            // "--" right after a delimiter = closing marker.
            if body[cursor...].starts(with: Data("--".utf8)) { break }
            // Skip the CRLF that ends the delimiter line.
            if body[cursor...].starts(with: crlf) { cursor = body.index(cursor, offsetBy: 2) }

            // Part headers end at the first blank line.
            guard let headerEnd = body.range(of: Data("\r\n\r\n".utf8), in: cursor..<body.endIndex)
            else { return nil }
            let headerData = body[cursor..<headerEnd.lowerBound]
            let headers = String(data: headerData, encoding: .utf8) ?? ""

            // Content runs to the CRLF preceding the next delimiter.
            let contentStart = headerEnd.upperBound
            guard let nextDelimiter = body.range(of: delimiter, in: contentStart..<body.endIndex)
            else { return nil }
            var contentEnd = nextDelimiter.lowerBound
            if contentEnd >= body.index(contentStart, offsetBy: 2, limitedBy: body.endIndex) ?? contentStart {
                contentEnd = body.index(contentEnd, offsetBy: -2)  // strip trailing CRLF
            }

            if let disposition = headers.split(separator: "\r\n")
                .first(where: { $0.lowercased().hasPrefix("content-disposition:") }),
               dispositionValue(String(disposition), key: "name") == field,
               let filename = dispositionValue(String(disposition), key: "filename"),
               !filename.isEmpty {
                return File(filename: filename, data: Data(body[contentStart..<contentEnd]))
            }
            cursor = nextDelimiter.upperBound
        }
        return nil
    }

    private static func boundary(from contentType: String) -> String? {
        guard contentType.lowercased().hasPrefix("multipart/form-data") else { return nil }
        for param in contentType.split(separator: ";").dropFirst() {
            let trimmed = param.trimmingCharacters(in: .whitespaces)
            if trimmed.lowercased().hasPrefix("boundary=") {
                var value = String(trimmed.dropFirst("boundary=".count))
                if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 {
                    value = String(value.dropFirst().dropLast())
                }
                return value.isEmpty ? nil : value
            }
        }
        return nil
    }

    /// Pull `key="value"` (or bare `key=value`) out of a Content-Disposition line.
    private static func dispositionValue(_ line: String, key: String) -> String? {
        for param in line.split(separator: ";").dropFirst() {
            let trimmed = param.trimmingCharacters(in: .whitespaces)
            guard trimmed.lowercased().hasPrefix("\(key)=") else { continue }
            var value = String(trimmed.dropFirst(key.count + 1))
            if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 {
                value = String(value.dropFirst().dropLast())
            }
            return value
        }
        return nil
    }
}
