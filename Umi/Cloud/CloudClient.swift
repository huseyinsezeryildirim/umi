import Foundation
import Security

/// Where Umi Cloud lives and the account token. The token is kept in the Keychain.
enum CloudConfig {
    private static let baseKey = "cloudBaseURL"
    private static let service = "cam.umi.cloud"

    /// Production once deployed; can point at `wrangler dev` (http://localhost:8787) for testing.
    static var baseURL: URL {
        get { UserDefaults.standard.string(forKey: baseKey).flatMap(URL.init(string:)) ?? URL(string: "https://umi.cam")! }
        set { UserDefaults.standard.set(newValue.absoluteString, forKey: baseKey) }
    }

    static var token: String? {
        get {
            var result: AnyObject?
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                        kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
            guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        }
        set {
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
            SecItemDelete(query as CFDictionary)
            guard let newValue, !newValue.isEmpty else { return }
            var add = query
            add[kSecValueData as String] = Data(newValue.utf8)
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    static var isConfigured: Bool { token != nil }
}

/// A shared video as the server describes it.
struct CloudVideo: Codable, Hashable {
    var id: String
    var url: URL
    var title: String
    var status: String
    var sizeBytes: Int?
    var durationMs: Int?
    var width: Int?
    var height: Int?
    var thumbnailUrl: URL?
    var allowDownload: Bool
    var hasPassword: Bool
    var allowComments: Bool?
    var expiresAt: Date?
    var expired: Bool?
}

struct CloudError: LocalizedError {
    var status: Int
    var code: String
    var message: String
    var errorDescription: String? { message }

    var needsPlan: Bool { status == 402 }
    var unauthorized: Bool { status == 401 }
}

/// Talks to the Umi Cloud API (see web/README.md).
struct CloudClient {
    var baseURL = CloudConfig.baseURL
    var token = CloudConfig.token ?? ""

    struct UploadPlan: Decodable {
        struct Part: Decodable { var partNumber: Int; var url: URL }
        var uploadId: String
        var partSize: Int
        var partCount: Int
        var parts: [Part]
        var thumbnailUrl: URL?
        var gifUrl: URL?
    }

    struct Created: Decodable {
        var video: CloudVideo
        var upload: UploadPlan
    }

    struct Settings: Encodable {
        var title: String?
        var allowDownload: Bool?
        var allowComments: Bool?
        /// "" removes the password.
        var password: String?
        /// Explicit null removes the expiry; nil leaves it.
        var expiresAt: Date??

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: Keys.self)
            try c.encodeIfPresent(title, forKey: .title)
            try c.encodeIfPresent(allowDownload, forKey: .allowDownload)
            try c.encodeIfPresent(allowComments, forKey: .allowComments)
            try c.encodeIfPresent(password, forKey: .password)
            if let expiresAt { try c.encode(expiresAt, forKey: .expiresAt) }
        }

        enum Keys: String, CodingKey { case title, allowDownload, allowComments, password, expiresAt }
    }

    func create(title: String, sizeBytes: Int, durationMs: Int, width: Int, height: Int) async throws -> Created {
        let body: [String: Any] = ["title": title, "sizeBytes": sizeBytes, "contentType": "video/mp4",
                                   "durationMs": durationMs, "width": width, "height": height, "allowDownload": true]
        return try await send("POST", "api/videos", json: try JSONSerialization.data(withJSONObject: body))
    }

    func complete(id: String, etags: [Int: String]) async throws -> CloudVideo {
        let parts = etags.keys.sorted().map { ["partNumber": $0, "etag": etags[$0]!] as [String: Any] }
        let data = try JSONSerialization.data(withJSONObject: ["parts": parts])
        let response: VideoResponse = try await send("POST", "api/videos/\(id)/complete", json: data)
        return response.video
    }

    func update(id: String, _ settings: Settings) async throws -> CloudVideo {
        let response: VideoResponse = try await send("PATCH", "api/videos/\(id)", json: try Self.encoder.encode(settings))
        return response.video
    }

    func video(id: String) async throws -> CloudVideo {
        let response: VideoResponse = try await send("GET", "api/videos/\(id)", json: nil)
        return response.video
    }

    func delete(id: String) async throws {
        let _: OK = try await send("DELETE", "api/videos/\(id)", json: nil)
    }

    /// PUTs raw bytes to a signed upload URL; returns the ETag.
    static func put(_ data: Data, to url: URL, contentType: String) async throws -> String {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let (_, response) = try await URLSession.shared.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw CloudError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, code: "upload_failed", message: "Upload failed. Check your connection and try again.")
        }
        return http.value(forHTTPHeaderField: "ETag") ?? ""
    }

    // MARK: Private

    private struct VideoResponse: Decodable { var video: CloudVideo }
    private struct OK: Decodable { var ok: Bool }
    private struct ErrorBody: Decodable {
        struct Inner: Decodable { var code: String; var message: String }
        var error: Inner
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let string = try decoder.singleValueContainer().decode(String.self)
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = f.date(from: string) ?? ISO8601DateFormatter().date(from: string) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(string)"))
        }
        return d
    }()

    private func send<T: Decodable>(_ method: String, _ path: String, json: Data?) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let json {
            request.httpBody = json
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if let body = try? JSONDecoder().decode(ErrorBody.self, from: data) {
                throw CloudError(status: status, code: body.error.code, message: body.error.message)
            }
            throw CloudError(status: status, code: "http_\(status)", message: "Umi Cloud answered \(status).")
        }
        return try Self.decoder.decode(T.self, from: data)
    }
}
