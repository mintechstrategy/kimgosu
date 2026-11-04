import Foundation
import Security
import CryptoKit

enum KGAuthRequestContext { case unknown, `public`, `private` }

/// Debug/Release 서버 구분은 빌드 설정의 `KG_API_BASE_URL`(→ Info.plist `KGAPIBaseURL`) 하나로만 정한다.
/// 코드에 호스트를 하드코딩하지 않으며, 값이 없거나 형식이 틀리면 요청을 만들지 않는다(fail-closed).
enum KGEnvironment {
    static let apiBaseURL: String = {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "KGAPIBaseURL") as? String else { return "" }
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasSuffix("/") { value.removeLast() }
        guard let url = URL(string: value), url.scheme == "https", let host = url.host, host.contains("."),
              url.user == nil, url.password == nil, url.port == nil, url.query == nil,
              url.fragment == nil, url.path.isEmpty else { return "" }
        return value
    }()
    /// 환경 이름도 빌드 설정(`KG_ENVIRONMENT` → Info.plist `KGEnvironment`)에서만 온다. 값이 없거나 알 수 없으면 운영으로 보지 않는다.
    static let name: String = {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "KGEnvironment") as? String else { return "" }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["dev", "prod"].contains(value) ? value : ""
    }()
    static var isConfigured: Bool { !apiBaseURL.isEmpty && !name.isEmpty }
    static var isProduction: Bool { name == "prod" }
    static var label: String { isProduction ? "운영" : "개발" }
    static func configurationError() -> KGAuthAPIError { KGAuthAPIError(status: 0, code: "API_BASE_URL_UNAVAILABLE") }
}
struct KGAuthAPIError: Error {
    let status: Int
    let code: String
    var requestContext: KGAuthRequestContext = .unknown
}
/// 네트워크 도달 실패(전송 계층)와 서버 응답 오류를 구분한다. 재시도 안내 문구와 상태 표시가 다르다.
enum KGNetworkFailure {
    static func isNetwork(_ error: Error) -> Bool {
        if error is URLError { return true }
        let ns = error as NSError
        return ns.domain == NSURLErrorDomain || ns.domain == (URLError.errorDomain)
    }
}
#if DEBUG
/// 결정론적 개발 검증용 스위치. 기본값은 꺼짐이며 릴리스 빌드에는 포함되지 않는다.
/// 성공을 위조하지 않고 전송 계층 실패·지연만 주입한다(기존 `--offline`/`--hold-splash`와 같은 방식).
enum KGDebugHooks {
    static var apiOffline: Bool { ProcessInfo.processInfo.arguments.contains("--api-offline") }
    static var apiDelayMs: Int {
        guard let raw = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--api-delay-ms=") }) else { return 0 }
        return max(0, min(10_000, Int(raw.dropFirst("--api-delay-ms=".count)) ?? 0))
    }
    static var devLoginSlot: Int? {
        guard let raw = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--dev-login-slot=") }) else { return nil }
        return Int(raw.dropFirst("--dev-login-slot=".count))
    }
    static var injectExpiredSession: Bool { ProcessInfo.processInfo.arguments.contains("--inject-expired-session") }
    /// 클라이언트 측 오류 주입(성공 위조 아님). 서버 오류 화면·재시도를 결정론적으로 확인하기 위한 것이며,
    /// 실제 서버 5xx를 받은 것으로 표시하지 않는다.
    static var apiFailStatus: Int? {
        guard let raw = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--api-fail-status=") }) else { return nil }
        guard let value = Int(raw.dropFirst("--api-fail-status=".count)), (400...599).contains(value) else { return nil }
        return value
    }
    /// 테스트 시작 상태를 결정론적으로 만들기 위한 Keychain 초기화. 성공을 위조하지 않는다.
    static var clearSession: Bool { ProcessInfo.processInfo.arguments.contains("--clear-session") }
}
#endif

func decodeMembershipResponse(_ status: Int, _ data: Data) throws -> [String: Any] {
    guard data.count <= 1_000_000,
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw KGAuthAPIError(status: status, code: "INVALID_API_RESPONSE")
    }
    guard (200...299).contains(status) else {
        let raw = (json["error"] as? [String: Any])?["code"] as? String ?? "HTTP_ERROR"
        let safe = raw.range(of: "^[A-Z][A-Z0-9_]{0,79}$", options: .regularExpression) != nil ? raw : "HTTP_ERROR"
        throw KGAuthAPIError(status: status, code: safe)
    }
    return json
}
protocol KGAuthTransport {
    func request(_ method: String, _ path: String, token: String?, body: [String: Any]?) async throws -> [String: Any]
}
protocol KGSessionStorage {
    func read() throws -> String?
    func write(_ token: String) throws
    func clear() throws
}
struct KGSecureSession: KGSessionStorage {
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "ai.mintech.kimgosu.auth",
         kSecAttrAccount as String: "session.v1", kSecAttrSynchronizable as String: false]
    }
    func read() throws -> String? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            throw KGAuthAPIError(status: 0, code: "SESSION_STORAGE_UNAVAILABLE_\(status)")
        }
        return value
    }
    func write(_ token: String) throws {
        guard !token.isEmpty, !token.contains("\r"), !token.contains("\n") else { throw KGAuthAPIError(status: 0, code: "INVALID_SESSION") }
        let values: [String: Any] = [kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KGAuthAPIError(status: 0, code: "SESSION_STORAGE_UNAVAILABLE") }
    }
    func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KGAuthAPIError(status: 0, code: "SESSION_STORAGE_UNAVAILABLE") }
    }
}
private final class KGNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
final class KGMembershipHTTP: KGAuthTransport {
    private let session: URLSession
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 8; configuration.timeoutIntervalForResource = 12
        session = URLSession(configuration: configuration, delegate: KGNoRedirects(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    func request(_ method: String, _ path: String, token: String? = nil, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard path.hasPrefix("/v1/") || path == "/health" else { throw KGAuthAPIError(status: 0, code: "INVALID_PATH") }
        guard KGEnvironment.isConfigured, let url = URL(string: KGEnvironment.apiBaseURL + path) else { throw KGEnvironment.configurationError() }
        var request = URLRequest(url: url); request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        #if DEBUG
        if KGDebugHooks.apiDelayMs > 0 { try await Task.sleep(for: .milliseconds(KGDebugHooks.apiDelayMs)) }
        if KGDebugHooks.apiOffline { throw URLError(.notConnectedToInternet) }
        if let status = KGDebugHooks.apiFailStatus { throw KGAuthAPIError(status: status, code: "INJECTED_TEST_FAULT") }
        #endif
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        #if DEBUG
        if let http = response as? HTTPURLResponse {
            let receipt: [String: Any] = ["method":method,"path":path,"httpStatus":http.statusCode,"observedAt":ISO8601DateFormatter().string(from:Date()),"cfRay":http.value(forHTTPHeaderField:"cf-ray") ?? NSNull()]
            if let line = try? JSONSerialization.data(withJSONObject:receipt), let directory = FileManager.default.urls(for:.documentDirectory,in:.userDomainMask).first {
                let file = directory.appendingPathComponent("membership-http.jsonl"); var all = (try? Data(contentsOf:file)) ?? Data(); all.append(line); all.append(Data("\n".utf8)); try? all.write(to:file,options:.atomic)
            }
        }
        #endif
        guard let http = response as? HTTPURLResponse else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
        return try decodeMembershipResponse(http.statusCode, data)
    }
}
struct KGAuthRepository {
    var transport: KGAuthTransport = KGMembershipHTTP()
    // The operation owns scope. Holding a bearer does not make public reads private.
    private func request(_ context: KGAuthRequestContext, _ method: String, _ path: String,
                         token: String? = nil, body: [String: Any]? = nil) async throws -> [String: Any] {
        do {
            let result = try await transport.request(method, path, token: token, body: body)
            try Task.checkCancellation()
            return result
        } catch var error as KGAuthAPIError {
            try Task.checkCancellation()
            error.requestContext = context
            throw error
        }
    }
    func health() async throws -> [String: Any] { try await request(.public, "GET", "/health") }
    func config() async throws -> [String: Any] { try await request(.public, "GET", "/v1/auth/config?metadata=policy-v0.3") }
    /// 서버가 state를 저장하고 인가 URL을 발급한다. 토큰 교환은 콜백 페이지가 서버에 맡긴다.
    func oauthStart(_ provider: String) async throws -> [String: Any] {
        guard provider == "google" else { throw KGAuthAPIError(status: 0, code: "INVALID_PROVIDER") }
        return try await request(.public, "POST", "/v1/auth/oauth/\(provider)/start")
    }
    func policies() async throws -> [String: Any] { try await request(.public, "GET", "/v1/policies?metadata=policy-v0.3") }
    func policy(_ kind: KGAuthDocumentKind, version: String? = nil) async throws -> [String: Any] {
        var components = URLComponents(); components.path = "/v1/policies/" + kind.rawValue
        components.queryItems = [URLQueryItem(name: "metadata", value: "policy-v0.3")]
        if let version { components.queryItems!.append(URLQueryItem(name: "version", value: version)) }
        return try await request(.public, "GET", components.string!)
    }
    func sendSms(_ ticket: String, phone: String) async throws -> [String: Any] { try await request(.private, "POST", "/v1/auth/sms/send", body: ["registrationTicket": ticket, "phone": phone]) }
    func verifySms(_ ticket: String, challenge: String, code: String) async throws -> [String: Any] { try await request(.private, "POST", "/v1/auth/sms/verify", body: ["registrationTicket": ticket, "challengeId": challenge, "code": code]) }
    func withdrawMarketing(_ token: String) async throws -> [String: Any] { try await request(.private, "POST", "/v1/me/consents/withdraw", token: token, body: ["kind": "MARKETING"]) }
    func me(_ token: String) async throws -> [String: Any] { try await request(.private, "GET", "/v1/me", token: token) }
    func consents(_ token: String) async throws -> [String: Any] { try await request(.private, "GET", "/v1/me/consents", token: token) }
    func notifications(_ token: String) async throws -> [String: Any] { try await request(.private, "GET", "/v1/me/notifications", token: token) }
    func changeNotification(_ token: String, version: Int, key: String, value: Bool) async throws -> [String: Any] {
        guard ["advertising", "chat", "comment", "quote", "inquiry"].contains(key) else { throw KGAuthAPIError(status: 0, code: "INVALID_KEY") }
        return try await request(.private, "PATCH", "/v1/me/notifications", token: token, body: ["expectedVersion": version, key: value])
    }
    func recordConsents(_ token: String, snapshot: KGPolicySnapshot, kinds: [String]) async throws -> [String: Any] {
        try await request(.private, "POST", "/v1/me/consents", token: token, body: snapshot.consentBody(kinds))
    }
    func signup(_ input: [String: Any], snapshot: KGPolicySnapshot, kinds: [String]) async throws -> [String: Any] {
        let body = try input.merging(snapshot.consentBody(kinds)) { _, bound in bound }
        return try await request(.private, "POST", "/v1/auth/signup", body: body)
    }
    func logout(_ token: String) async throws -> [String: Any] { try await request(.private, "POST", "/v1/auth/logout", token: token) }
    // Expert self-view and owner writes. The server re-reads the expert flag and
    // rejects invalid price combinations; the client never corrects a payload.
    func expertSelf(_ token: String) async throws -> [String: Any] { try await request(.private, "GET", "/v1/me/expert", token: token) }
    func patchExpertProfile(_ token: String, fields: [String: Any]) async throws -> [String: Any] {
        try await request(.private, "PATCH", "/v1/expert/profile", token: token, body: fields)
    }
    func createExpertService(_ token: String, body: [String: Any]) async throws -> [String: Any] {
        try await request(.private, "POST", "/v1/expert/services", token: token, body: body)
    }
    func patchExpertService(_ token: String, id: String, body: [String: Any]) async throws -> [String: Any] {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await request(.private, "PATCH", "/v1/expert/services/" + encoded, token: token, body: body)
    }
    /// 개발 환경 전용 임시 로그인. 운영 빌드에서는 호출하지 않는다(KGEnvironment.isProduction 가드).
    /// 응답은 실제 서버가 발급한 세션이며 클라이언트가 토큰을 만들지 않는다.
    func devAccounts() async throws -> [String: Any] { try await request(.public, "GET", "/v1/auth/dev/accounts") }
    func devLogin(slot: Int) async throws -> [String: Any] {
        guard (1...20).contains(slot) else { throw KGAuthAPIError(status: 0, code: "INVALID_DEV_SLOT") }
        return try await request(.private, "POST", "/v1/auth/dev/login", body: ["slot": slot])
    }
}

// v0.3 wire DTOs. IDs/revisions/versions remain opaque; local time never grants/vetoes.
struct KGPolicyRow: Decodable {
    let id, kind, version, status, title, body, bodySha256: String
    let `operator`, effectiveAt, approvedAt: String?
    let createdAt: String
    let canConsent, isCurrent, isDisplay: Bool
}
struct KGPolicyCurrent: Decodable, Equatable {
    let id, kind, version, bodySha256, status: String
    let canConsent: Bool
}
struct KGPolicySlot: Decodable { let kind: String; let currentDocument: KGPolicyCurrent? }
struct KGPolicyRequirements: Decodable {
    let requiredGrantKinds, requiredReadyKindsForGrant, optionalGrantKinds: [String]
    let operationsConsentRequired: Bool
}
struct KGPolicyCache: Decodable { let control: String; let ttlSeconds: Int; let revalidateBeforeConsent: Bool }
struct KGPolicyLimitations: Decodable { let commitFence: Bool; let allowedActions, materialChangeClassification: String }
struct KGPolicySnapshot: Decodable {
    let schemaVersion, policyRevision, serverTime, timeAuthority: String
    let cache: KGPolicyCache
    let requirements: KGPolicyRequirements
    let currentDocuments: [KGPolicySlot]
    let missingReadyKinds: [String]
    let documents: [KGPolicyRow]
    let limitations: KGPolicyLimitations
    var identity: String {
        let parts = documents.sorted { $0.id < $1.id }.map { [$0.id,$0.kind,$0.version,$0.bodySha256,String($0.isCurrent),String($0.canConsent)] }
        return policyRevision + SHA256.hash(data: (try? JSONSerialization.data(withJSONObject: parts)) ?? Data()).map { String(format:"%02x",$0) }.joined()
    }
    var ready: Bool { missingReadyKinds.isEmpty }
    func current(_ kind: String) -> KGPolicyRow? { documents.first { $0.kind == kind && $0.isCurrent } }
    func display(_ kind: String) -> KGPolicyRow? { current(kind) ?? documents.first { $0.kind == kind && $0.isDisplay } }
    static func invalid() -> KGAuthAPIError { KGAuthAPIError(status: 503, code: "POLICY_METADATA_UNAVAILABLE", requestContext: .public) }
    static func decode(_ envelope: [String: Any]) throws -> KGPolicySnapshot {
        do {
            guard let raw = envelope["policySnapshot"] as? [String: Any] else { throw invalid() }
            // Decodable Optional accepts missing keys; the wire contract requires explicit nullable keys.
            let rowKeys = ["id","kind","version","status","title","body","bodySha256","operator","effectiveAt","approvedAt","createdAt","canConsent","isCurrent","isDisplay"]
            guard let rows = raw["documents"] as? [[String: Any]], rows.allSatisfy({ Set(rowKeys).isSubset(of: Set($0.keys)) }),
                  let slots = raw["currentDocuments"] as? [[String: Any]], slots.allSatisfy({ $0.keys.contains("currentDocument") }),
                  let constraints = raw["constraints"] as? NSDictionary,
                  constraints.isEqual(to: try JSONSerialization.jsonObject(with: Data(KGPolicyConstraints.utf8)) as! [AnyHashable: Any]) else { throw invalid() }
            let result = try JSONDecoder().decode(Self.self, from: JSONSerialization.data(withJSONObject: raw))
            try result.validate()
            return result
        } catch { throw invalid() }
    }
    func validate() throws {
        let kinds = Set(KGAuthDocumentKind.allCases.map { $0.rawValue })
        func check(_ ok: Bool) throws { if !ok { throw Self.invalid() } }
        func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
        func timestamp(_ value: String) -> Bool {
            guard matches(value, "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$") else { return false }
            let f = ISO8601DateFormatter(); if f.date(from: value) != nil { return true }; f.formatOptions.insert(.withFractionalSeconds); return f.date(from: value) != nil
        }
        try check(schemaVersion == "policy-v0.3" && matches(policyRevision, "^ps3-[0-9a-f]{64}$") && timestamp(serverTime) && timeAuthority == "POSTGRES_TRANSACTION_NOW")
        try check(cache.control == "no-store" && cache.ttlSeconds == 0 && cache.revalidateBeforeConsent)
        try check(requirements.requiredGrantKinds == ["TERMS","PRIVACY_CONSENT"] && requirements.requiredReadyKindsForGrant == ["TERMS","PRIVACY_CONSENT","PRIVACY_POLICY"] && requirements.optionalGrantKinds == ["MARKETING"] && !requirements.operationsConsentRequired)
        try check(!limitations.commitFence && limitations.allowedActions == "NOT_IMPLEMENTED" && limitations.materialChangeClassification == "NOT_IMPLEMENTED")
        try check(currentDocuments.count == kinds.count && Set(currentDocuments.map { $0.kind }) == kinds)
        try check(Set(documents.map { Data($0.id.utf8) }).count == documents.count)
        var versions: Set<[Data]> = []; var currents: Set<String> = []; var displays: Set<String> = []
        for row in documents {
            try check(kinds.contains(row.kind) && !row.id.isEmpty && !row.version.isEmpty && ["DRAFT","READY","RETIRED"].contains(row.status))
            try check(versions.insert([Data(row.kind.utf8),Data(row.version.utf8)]).inserted)
            try check(timestamp(row.createdAt) && (row.effectiveAt.map(timestamp) ?? true) && (row.approvedAt.map(timestamp) ?? true))
            try check(matches(row.bodySha256,"^[0-9a-f]{64}$") && SHA256.hash(data: Data(row.body.utf8)).map { String(format:"%02x",$0) }.joined() == row.bodySha256)
            // Server eligibility is authoritative, not a client reconstruction of its SQL/time predicate.
            try check(!row.canConsent || row.status == "READY")
            if row.isCurrent { try check(row.canConsent && row.status == "READY" && currents.insert(row.kind).inserted) }
            if row.isDisplay { try check(displays.insert(row.kind).inserted) }
        }
        for slot in currentDocuments {
            let row = current(slot.kind)
            if let c = slot.currentDocument {
                try check(c.kind == slot.kind && c.status == "READY" && c.canConsent && row != nil)
                try check(row!.id.utf8.elementsEqual(c.id.utf8) && row!.version.utf8.elementsEqual(c.version.utf8) && row!.bodySha256 == c.bodySha256)
            } else { try check(row == nil) }
        }
        let missing = requirements.requiredReadyKindsForGrant.filter { current($0) == nil }
        try check(Set(missingReadyKinds).count == missingReadyKinds.count && Set(missingReadyKinds) == Set(missing))
    }
    func consentBody(_ kinds: [String]) throws -> [String: Any] {
        guard ready, Set(kinds).count == kinds.count,
              Set(requirements.requiredGrantKinds).isSubset(of: Set(kinds)),
              Set(kinds).isSubset(of: Set(requirements.requiredGrantKinds + requirements.optionalGrantKinds)) else { throw Self.invalid() }
        let rows = try kinds.map { kind -> [String: String] in
            guard let row = current(kind), row.canConsent, row.version.count <= 100 else { throw Self.invalid() }
            return ["kind":kind,"version":row.version]
        }
        return ["consents":rows,"expectedPolicyRevision":policyRevision]
    }
}

private let KGPolicyConstraints = #"{"consentInputs":{"type":"array","minItems":2,"maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["kind","version"],"properties":{"kind":{"type":"string","enum":["TERMS","PRIVACY_CONSENT","MARKETING"]},"version":{"type":"string","minLength":1,"maxLength":100}}}},"nickname":{"type":"string","pattern":"^[\\p{L}\\p{N}]{1,10}$","maxLength":10}}"#
