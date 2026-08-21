import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var server: HTTPServer?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Kiosk: the tablet must not fall asleep mid-play.
        application.isIdleTimerDisabled = true

        let store = DataStore()
        let server = HTTPServer(router: Router(store: store))
        self.server = server

        let kiosk = KioskViewController()
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = kiosk
        window.makeKeyAndVisible()
        self.window = window

        server.start { port in
            DispatchQueue.main.async {
                kiosk.load(url: URL(string: "http://127.0.0.1:\(port)/")!)
            }
        }
        return true
    }
}
