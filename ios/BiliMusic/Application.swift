import AVFAudio
import UIKit
import WebKit

@main
final class Application: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = PlayerViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class PlayerViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let bridge = PlayerBridge()
    private let resources = BundleScheme()

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.setURLSchemeHandler(resources, forURLScheme: "bilimusic")
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "nativePlayer")
        if let script = Bundle.main.url(forResource: "bridge", withExtension: "js"),
           let source = try? String(contentsOf: script, encoding: .utf8) {
            config.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let player = WKWebView(frame: .zero, configuration: config)
        player.navigationDelegate = self
        player.uiDelegate = self
        player.scrollView.contentInsetAdjustmentBehavior = .never
        player.scrollView.bounces = false
        player.scrollView.alwaysBounceVertical = false
        player.allowsBackForwardNavigationGestures = false
        view = player
        player.load(URLRequest(url: URL(string: "bilimusic://app/index.html")!))
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.scheme == "bilimusic" && url?.host == "app" ? .allow : .cancel)
    }
}

// Bundle-only resource handler. No listening socket or embedded HTTP server.
final class BundleScheme: NSObject, WKURLSchemeHandler {
    private let types = ["html": "text/html", "css": "text/css", "js": "text/javascript", "mjs": "text/javascript",
                         "svg": "image/svg+xml", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                         "webp": "image/webp", "json": "application/json", "wav": "audio/wav", "mp3": "audio/mpeg",
                         "m4a": "audio/mp4", "flac": "audio/flac", "woff2": "font/woff2"]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.host == "app",
              let root = Bundle.main.resourceURL?.appendingPathComponent("src", isDirectory: true) else {
            urlSchemeTask.didFailWithError(URLError(.unsupportedURL)); return
        }
        let file = root.appendingPathComponent(url.path).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path + "/"),
              let bytes = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let headers = ["Content-Type": types[file.pathExtension.lowercased()] ?? "application/octet-stream",
                       "Content-Length": String(bytes.count), "Access-Control-Allow-Origin": "*"]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            urlSchemeTask.didFailWithError(URLError(.badServerResponse)); return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(bytes)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

@MainActor
final class BiliLoginViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKHTTPCookieStoreObserver {
    static func matches(_ domain: String) -> Bool {
        let lower = domain.lowercased()
        return lower == "bilibili.com" || lower.hasSuffix(".bilibili.com")
    }
    private let player = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    private var completion: (() -> Void)?
    private var finishing = false
    private var appLogin: Task<Void, Never>?
    private var syncingAccount = false

    private struct QRResponse: Decodable {
        struct Result: Decodable {
            let code: Int?
            let url: String?
            let qrcode_key: String?
        }
        let code: Int
        let data: Result?
    }

    init(completion: @escaping () -> Void) {
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func loadView() {
        title = "哔哩哔哩官方登录"
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "用 App 确认", style: .plain, target: self, action: #selector(confirmInApp))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "关闭", style: .done, target: self, action: #selector(closeLogin))
        player.navigationDelegate = self
        player.uiDelegate = self
        view = player
        player.configuration.websiteDataStore.httpCookieStore.add(self)
        player.load(URLRequest(url: URL(string: "https://passport.bilibili.com/login")!))
    }
    private func official(_ url: URL?) -> Bool {
        guard let url = url, url.scheme == "https", let host = url.host, url.port == nil || url.port == 443,
              url.user == nil, url.password == nil else { return false }
        return Self.matches(host)
    }

    // Only hand off the scan challenge generated by the official API for this login attempt.
    private func scanURL(_ value: String?, key: String) -> URL? {
        guard let value, let url = URL(string: value), official(url),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.queryItems?.first(where: { $0.name == "qrcode_key" })?.value == key else { return nil }
        switch (parts.host, parts.path) {
        case ("account.bilibili.com", "/h5/account-h5/auth/scan-web"),
             ("passport.bilibili.com", "/h5-app/passport/login/scan"):
            return url
        default: return nil
        }
    }

    private func qrRequest(_ session: URLSession, _ path: String, key: String? = nil) async throws -> QRResponse.Result {
        var parts = URLComponents()
        parts.scheme = "https"
        parts.host = "passport.bilibili.com"
        parts.path = "/x/passport-login/web/qrcode/" + path
        if let key { parts.queryItems = [URLQueryItem(name: "qrcode_key", value: key)] }
        guard let url = parts.url else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.setValue("https://passport.bilibili.com/login", forHTTPHeaderField: "Referer")
        let (bytes, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.url?.host == "passport.bilibili.com" else { throw URLError(.badServerResponse) }
        let json = try JSONDecoder().decode(QRResponse.self, from: bytes)
        guard json.code == 0, let result = json.data else { throw URLError(.cannotParseResponse) }
        return result
    }

    @objc private func confirmInApp() {
        guard appLogin == nil else { return }
        navigationItem.leftBarButtonItem?.isEnabled = false
        navigationItem.prompt = "正在创建官方扫码登录请求…"
        appLogin = Task { [weak self] in
            guard let self else { return }
            defer {
                self.appLogin = nil
                self.navigationItem.leftBarButtonItem?.isEnabled = true
            }
            do { try await self.runAppLogin() }
            catch {
                if !self.finishing { self.navigationItem.prompt = "官方登录请求未完成，可重试或使用下方登录页" }
            }
        }
    }

    private func runAppLogin() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 12
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let challenge = try await qrRequest(session, "generate")
        guard let key = challenge.qrcode_key, key.utf8.count == 32,
              let scan = scanURL(challenge.url, key: key) else { throw URLError(.badServerResponse) }
        var link = URLComponents()
        link.scheme = "bilibili"
        link.host = "browser"
        link.path = "/"
        link.queryItems = [URLQueryItem(name: "url", value: scan.absoluteString)]
        try Task.checkCancellation()
        guard let url = link.url, await UIApplication.shared.open(url) else {
            navigationItem.prompt = "未能打开哔哩哔哩，可在此页继续登录"
            return
        }
        navigationItem.prompt = "在哔哩哔哩确认后，返回 BiliMusic"
        let expires = Date().addingTimeInterval(180)
        while Date() < expires {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            guard UIApplication.shared.applicationState == .active else { continue }
            let poll = try await qrRequest(session, "poll", key: key)
            try Task.checkCancellation()
            switch poll.code {
            case 0:
                let cookies = (session.configuration.httpCookieStorage?.cookies ?? []).filter { Self.matches($0.domain) }
                guard cookies.contains(where: { $0.name == "SESSDATA" && !$0.value.isEmpty }) else {
                    throw URLError(.userAuthenticationRequired)
                }
                let store = player.configuration.websiteDataStore.httpCookieStore
                syncingAccount = true
                for cookie in cookies { await store.setCookie(cookie) }
                syncingAccount = false
                closeLogin()
                return
            case 86101, 86090: continue
            case 86038: navigationItem.prompt = "请求已过期，请重新点「用 App 确认」"; return
            default: throw URLError(.badServerResponse)
            }
        }
        navigationItem.prompt = "请求已过期，请重新点「用 App 确认」"
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(navigationAction.request.url?.scheme == "https" ? .allow : .cancel)
        } else { decisionHandler(official(navigationAction.request.url) ? .allow : .cancel) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if official(navigationAction.request.url) { webView.load(navigationAction.request) }
        return nil
    }
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        guard !syncingAccount, !finishing else { return }
        cookieStore.getAllCookies { [weak self] cookies in
            if self?.syncingAccount == false, cookies.contains(where: { Self.matches($0.domain) && $0.name == "SESSDATA" && !$0.value.isEmpty }) {
                self?.closeLogin()
            }
        }
    }
    @objc private func closeLogin() {
        if finishing || syncingAccount { return }
        finishing = true
        appLogin?.cancel()
        let store = player.configuration.websiteDataStore.httpCookieStore
        store.remove(self)
        store.getAllCookies { [weak self] cookies in
            guard let self = self else { return }
            let jar = HTTPCookieStorage.shared
            for cookie in cookies where Self.matches(cookie.domain) { jar.setCookie(cookie) }
            let done = self.completion
            self.completion = nil
            self.dismiss(animated: true, completion: done)
        }
    }
}
