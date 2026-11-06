import Foundation
import UIKit
import WebKit

private let providerDomains = ["bilibili.com", "bilivideo.com", "bilivideo.cn", "biliapi.net", "biliapi.com",
                               "hdslb.com", "bilivideo.net", "akamaized.net", "kuwo.cn", "kuwo.com"]
private let neteaseCatalog = Set(["/api/cloudsearch/pc", "/api/song/detail/", "/api/song/lyric",
                                  "/api/song/enhance/player/url/v1", "/api/v1/artist/songs"])

private func isAllowed(_ url: URL?) -> Bool {
    guard let url = url, url.scheme?.lowercased() == "https", let host = url.host?.lowercased(),
          url.user == nil, url.password == nil else { return false }
    // Authentication responses stay inside BiliLoginViewController and its dedicated native session.
    if ["passport.bilibili.com", "account.bilibili.com"].contains(host) { return false }
    if url.port == 8082 && host.hasSuffix(".mcdn.bilivideo.cn") { return true }
    if url.port == 4483 && host.hasSuffix(".edge.mountaintoys.cn") { return true }
    let netease = host.hasSuffix(".music.126.net") || (host == "music.163.com" &&
        (neteaseCatalog.contains(url.path) || neteaseCatalog.contains(url.path + "/") ||
         url.path.range(of: #"^/api/v1/(album/[1-9]\d*|resource/(hotcomments|comments)/R_SO_4_[1-9]\d*)$"#, options: .regularExpression) != nil))
    return (url.port == nil || url.port == 443) && (netease || providerDomains.contains { host == $0 || host.hasSuffix("." + $0) })
}

private final class RemoteDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(isAllowed(request.url) ? request : nil)
    }
}

private struct PlayerError: LocalizedError {
    let errorDescription: String?
    init(_ text: String) { errorDescription = text }
}

@MainActor
final class PlayerBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 240
        config.httpCookieAcceptPolicy = .always
        config.httpCookieStorage = HTTPCookieStorage.shared
        return URLSession(configuration: config, delegate: RemoteDelegate(), delegateQueue: nil)
    }()
    private let allowedHeaders = Set(["accept", "accept-language", "origin", "referer", "user-agent",
                                      "csrf", "secret", "cross", "x-requested-with", "x-csrf-token"])
    private var files: [String: URL] = [:]
    private let chunkSize = 512 * 1024

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == "bilimusic",
              message.frameInfo.request.url?.host == "app", let input = message.body as? [String: Any],
              let action = input["action"] as? String else {
            replyHandler(nil, "无效的请求来源"); return
        }
        Task {
            do {
                switch action {
                case "openSource":
                    guard let id = input["id"] as? String,
                          let file = Bundle.main.resourceURL?.appendingPathComponent("src/hifi-links.json"),
                          let data = try? Data(contentsOf: file),
                          let links = try? JSONDecoder().decode([String: String].self, from: data),
                          let text = links[id], let url = URL(string: text), url.scheme == "https" else {
                        throw PlayerError("未知音源")
                    }
                    let opened = await UIApplication.shared.open(url)
                    guard opened else { throw PlayerError("无法打开音源官网") }
                    replyHandler(true, nil)
                case "loginBilibili":
                    guard let presenter = message.webView?.window?.rootViewController,
                          presenter.presentedViewController == nil else { throw PlayerError("已有窗口正在打开") }
                    let login = BiliLoginViewController { replyHandler(true, nil) }
                    let container = UINavigationController(rootViewController: login)
                    container.isModalInPresentation = true
                    presenter.present(container, animated: true)
                case "logoutBilibili":
                    let jar = HTTPCookieStorage.shared
                    for cookie in jar.cookies ?? [] where BiliLoginViewController.matches(cookie.domain) { jar.deleteCookie(cookie) }
                    let store = WKWebsiteDataStore.default().httpCookieStore
                    for cookie in await store.allCookies() where BiliLoginViewController.matches(cookie.domain) {
                        await store.deleteCookie(cookie)
                    }
                    replyHandler(true, nil)
                case "request", "media":
                    let result = try await download(input, media: action == "media")
                    replyHandler(result, nil)
                case "chunk":
                    guard let id = input["id"] as? String, let file = files[id],
                          let offset = input["offset"] as? Int, offset >= 0 else { throw PlayerError("音频缓存已释放") }
                    let handle = try FileHandle(forReadingFrom: file)
                    defer { try? handle.close() }
                    try handle.seek(toOffset: UInt64(offset))
                    let data = try handle.read(upToCount: chunkSize) ?? Data()
                    replyHandler(data.base64EncodedString(), nil)
                case "release":
                    if let id = input["id"] as? String, let file = files.removeValue(forKey: id) {
                        try? FileManager.default.removeItem(at: file)
                    }
                    replyHandler(true, nil)
                default: throw PlayerError("未知的原生请求")
                }
            } catch { replyHandler(nil, error.localizedDescription) }
        }
    }

    private func download(_ input: [String: Any], media: Bool) async throws -> [String: Any] {
        guard let text = input["url"] as? String, let url = URL(string: text), isAllowed(url) else {
            throw PlayerError("该来源地址不在受支持的平台范围内")
        }
        var request = URLRequest(url: url)
        for (key, value) in input["headers"] as? [String: String] ?? [:] where allowedHeaders.contains(key.lowercased()) {
            if value.rangeOfCharacter(from: .newlines) == nil { request.setValue(value, forHTTPHeaderField: key) }
        }
        let (file, rawResponse) = try await session.download(for: request)
        defer { try? FileManager.default.removeItem(at: file) }
        guard let response = rawResponse as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        if !media {
            guard size <= 8 * 1024 * 1024 else { throw PlayerError("来源响应过大") }
            var headers: [String: String] = [:]
            for (key, value) in response.allHeaderFields {
                if let name = key as? String, name.lowercased() != "set-cookie" { headers[name.lowercased()] = String(describing: value) }
            }
            let data = try Data(contentsOf: file)
            return ["status": response.statusCode, "body": String(decoding: data, as: UTF8.self), "headers": headers]
        }
        guard (200..<300).contains(response.statusCode) else { throw PlayerError("音源返回 HTTP \(response.statusCode)") }
        guard size > 0, size <= 160 * 1024 * 1024 else { throw PlayerError("iOS 单曲缓存支持 160 MiB 以内的音频") }
        let id = UUID().uuidString
        let target = FileManager.default.temporaryDirectory.appendingPathComponent(id)
        try FileManager.default.moveItem(at: file, to: target)
        files[id] = target
        return ["id": id, "size": size, "mimeType": response.mimeType ?? "application/octet-stream"]
    }
}
