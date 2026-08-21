import UIKit
import WebKit

/// The entire UI: one fullscreen WKWebView showing the kiosk frontend served
/// by the embedded loopback server. The web app handles everything else —
/// this controller only pins the viewport down like cage+cog do on the Pi,
/// and fronts the admin panel's HTTP basic auth with a native prompt
/// (VALG → VOKSEN navigates to /admin).
final class KioskViewController: UIViewController, WKNavigationDelegate {
    private var webView: WKWebView!
    private var pendingURL: URL?
    /// Points of the on-screen keyboard covering our window. The webview is
    /// shrunk by this amount so the page (a 100vh flex layout) re-lays-out
    /// into the visible area — JOBB's editor stays on screen while typing.
    private var keyboardOverlap: CGFloat = 0

    override func loadView() {
        let config = WKWebViewConfiguration()
        // Rentals and training videos play inline inside the gallery markup,
        // and autoplay after the coin spend — no tap-to-play chrome.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        // The kiosk page is a fixed full-viewport layout; any scroll or
        // bounce is a bug, not a feature. (Re-enabled while on /admin,
        // which is an ordinary scrolling document.)
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        // Container instead of `view = webView` so the webview's frame can
        // track the keyboard without fighting UIKit over the root view.
        let container = UIView()
        container.backgroundColor = .black
        container.addSubview(webView)
        view = container
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardWillChange(_:)),
                           name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardWillHide(_:)),
                           name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        var frame = view.bounds
        frame.size.height = max(0, frame.height - keyboardOverlap)
        if webView.frame != frame { webView.frame = frame }
    }

    @objc private func keyboardWillChange(_ note: Notification) {
        guard let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
        else { return }
        // Convert from screen coordinates; a dismissed/undocked keyboard ends
        // up below the view and yields zero overlap.
        let endInView = view.convert(end, from: nil)
        keyboardOverlap = max(0, view.bounds.maxY - endInView.minY)
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }

    @objc private func keyboardWillHide(_ note: Notification) {
        keyboardOverlap = 0
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    func load(url: URL) {
        pendingURL = url
        webView.load(URLRequest(url: url))
    }

    /// The server races the webview at cold start; retry until it's up.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard let url = pendingURL else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.webView.load(URLRequest(url: url))
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Admin is a long scrolling document; the kiosk is a fixed layout.
        let isAdmin = webView.url?.path.hasPrefix("/admin") ?? false
        webView.scrollView.isScrollEnabled = isAdmin
        webView.scrollView.bounces = isAdmin
    }

    /// /admin uses HTTP basic auth (same credentials as on the Pi). WKWebView
    /// has no built-in credential dialog, so present a native one. Cancelling
    /// falls back to the kiosk via didFailProvisionalNavigation's retry.
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodHTTPBasic,
              challenge.protectionSpace.host == "127.0.0.1" else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        // Retry loops (wrong password) re-present the prompt with a hint.
        let again = challenge.previousFailureCount > 0
        let alert = UIAlertController(
            title: "Voksen",
            message: again ? "Feil passord — prøv igjen" : "Skriv inn voksen-passordet",
            preferredStyle: .alert)
        alert.addTextField { field in
            field.isSecureTextEntry = true
            field.placeholder = "Passord"
        }
        alert.addAction(UIAlertAction(title: "Avbryt", style: .cancel) { _ in
            completionHandler(.cancelAuthenticationChallenge, nil)
        })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
            let password = alert?.textFields?.first?.text ?? ""
            // .forSession keeps the admin panel's own fetches authenticated
            // until the app restarts.
            completionHandler(.useCredential,
                              URLCredential(user: "admin", password: password, persistence: .forSession))
        })
        present(alert, animated: true)
    }
}
