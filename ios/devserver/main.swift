import Foundation

// macOS dev harness — runs the identical iOS server sources against the repo
// checkout so API parity with server/app.py can be verified with curl, no
// simulator required. Not part of the app target.
//
//   swiftc -o asipad-devserver ASIPad/Sources/Server/*.swift devserver/main.swift
//   ./asipad-devserver ../frontend ../assets /path/to/scratch-data 8090

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write(Data("usage: \(args[0]) <frontendDir> <assetsDir> <dataDir> [port]\n".utf8))
    exit(2)
}
let store = DataStore(dataDir: URL(fileURLWithPath: args[3]),
                      frontendDir: URL(fileURLWithPath: args[1]),
                      assetsDir: URL(fileURLWithPath: args[2]))
let server = HTTPServer(router: Router(store: store))
let port: UInt16 = args.count > 4 ? (UInt16(args[4]) ?? 8090) : 8090
server.start(preferredPort: port) { boundPort in
    print("dev server on 127.0.0.1:\(boundPort)")
}
RunLoop.main.run()
