import UIKit
import WebKit

/// The entire UI: one fullscreen WKWebView showing the kiosk frontend served
/// by the embedded loopback server. The web app handles everything else —
/// this controller only pins the viewport down like cage+cog do on the Pi.
final class KioskViewController: UIViewController, WKNavigationDelegate {
    private var webView: WKWebView!
    private var pendingURL: URL?

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
        // bounce is a bug, not a feature.
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        view = webView
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
}
