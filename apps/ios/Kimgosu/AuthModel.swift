import Foundation
import Combine
import UIKit
import AuthenticationServices

/// ASWebAuthenticationSession은 kimgosu:// 콜백을 직접 가로채므로 Safari로 나가지 않는다.
@MainActor private final class KGGoogleAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    func start(_ url: URL, completion: @escaping (Result<URL, Error>) -> Void) {
        session?.cancel()
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "kimgosu") { callback, error in
            if let callback { completion(.success(callback)) }
            else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                completion(.failure(KGAuthAPIError(status: 0, code: "CANCELLED")))
            } else {
                completion(.failure(error ?? KGAuthAPIError(status: 0, code: "OAUTH_SESSION_FAILED")))
            }
        }
        session.presentationContextProvider = self
        self.session = session
        _ = session.start()
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive }?.keyWindow
            ?? scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? UIWindow()
    }
}

struct KGReturnTarget {
    var screenId = "A1"
    var targetId: String? = nil
    var filter: String? = nil
    var scroll = 0
    var draftReference: String? = nil
}
@MainActor final class KGAuthModel: ObservableObject {
    @Published var state = KGAuthState(screen: .E1, policyReady: false)
    @Published private(set) var browsing = false
    @Published private(set) var stack: [KGAuthScreen] = [.E1]
    private(set) var entry = "PUBLIC"
    private(set) var returnTarget = KGReturnTarget()
    private let repository: KGAuthRepository
    private let sessions: KGSessionStorage
    private let webAuth = KGGoogleAuthSession()
    private var oauthPending = false
    private var token: String?
    private var task: Task<Void, Never>?
    private var automation: Task<Void, Never>?
    private var sequence = 0
    private var version: Int?
    private var started = false
    private var registrationTicket: String?
    private var challengeId: String?
    private var phoneVerified = false
    private var mutationUnknown = false
    private var mutationEpoch: Int?
    private var countdown: Task<Void, Never>?
    private let clock = ContinuousClock()
    private(set) var snapshot: KGPolicySnapshot?
    init(repository: KGAuthRepository = KGAuthRepository(), sessions: KGSessionStorage = KGSecureSession()) {
        self.repository = repository; self.sessions = sessions
    }
    func start() {
        guard !started else { return }; started = true
        #if DEBUG
        // 만료 토큰 주입은 실제 서버 401 응답을 받기 위한 개발 검증용 훅이다(성공 위조 아님).
        if KGDebugHooks.clearSession { try? sessions.clear() }
        if KGDebugHooks.injectExpiredSession, let expired = sessionForExpiryCheck { try? sessions.write(expired) }
        #endif
        execute {
            self.token = try self.sessions.read()
            if self.token != nil {
                // 세션이 있으면 A1을 먼저 표시하고(로딩 상태) /v1/me 결과로 채운다.
                // 실패하면 A1이 오류/네트워크 실패 상태를 그대로 보여준다(failure()가 401·403 화면을 얹는다).
                self.browsing = true; self.stack = []
                try await self.loadAccount()
                if self.state.screen == .ACCOUNT_RESTRICTED { self.browsing = false }
            } else {
                self.state.member = .signedOut
                _ = try await self.loadConfig(); try await self.loadPolicies()
            }
        }
        loadDevAccounts()
        #if DEBUG
        if let slot = KGDebugHooks.devLoginSlot, KGEnvironment.isConfigured, !KGEnvironment.isProduction {
            automation = Task { @MainActor [weak self] in
                while let self, self.state.busy { try? await Task.sleep(for: .milliseconds(50)); if Task.isCancelled { return } }
                self?.devLogin(slot: slot)
            }
        }
        #endif
    }
    #if DEBUG
    /// 32자 이상 형식은 만족하지만 서버에 없는 토큰 → /v1/me가 실제 401 SESSION_INVALID를 반환한다.
    private var sessionForExpiryCheck: String? { "expired-session-" + String(repeating: "0", count: 16) }
    #endif
    /// A1 표시용 회원 정보 재조회. 실패 시 상태만 바꾸고 로그인 흐름은 유지한다.
    func retryMember() {
        execute {
            self.token = try self.sessions.read()
            guard self.token != nil else { self.state.member = .signedOut; return }
            try await self.loadAccount()
        }
    }
    /// 개발 환경 전용 임시 로그인 계정 목록. 운영 빌드에서는 호출하지 않는다.
    func loadDevAccounts() {
        guard KGEnvironment.isConfigured, !KGEnvironment.isProduction else { return }
        state.devAccountsLoading = true; state.devAccountsError = false
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let result = try await self.repository.devAccounts(); try Task.checkCancellation()
                guard let rows = result["accounts"] as? [[String: Any]] else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
                self.state.devAccounts = rows.compactMap { row in
                    guard let slot = row["slot"] as? Int, let label = row["label"] as? String,
                          let nickname = row["nickname"] as? String, let role = row["role"] as? String else { return nil }
                    return KGDevAccount(slot: slot, label: label, nickname: nickname, role: role)
                }
                self.state.devAccountsError = self.state.devAccounts.isEmpty
                if self.state.input("devSlot").isEmpty, let first = self.state.devAccounts.first { self.state.inputs["devSlot"] = String(first.slot) }
            } catch {
                if !Task.isCancelled { self.state.devAccountsError = true }
            }
            self.state.devAccountsLoading = false
        }
    }
    /// 서버가 실제로 발급한 세션으로만 로그인한다. 클라이언트가 토큰을 만들지 않는다.
    func devLogin(slot: Int) {
        guard !state.busy, KGEnvironment.isConfigured, !KGEnvironment.isProduction else { return }
        state.inputs["devSlot"] = String(slot)
        execute {
            let result = try await self.repository.devLogin(slot: slot); try Task.checkCancellation()
            guard let session = result["session"] as? [String: Any], let bearer = session["accessToken"] as? String else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
            let me = try await self.repository.me(bearer); try Task.checkCancellation()
            guard let status = me["status"] as? String, ["ACTIVE", "RESTRICTED"].contains(status) else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
            try self.sessions.write(bearer); self.token = bearer; self.mutationUnknown = false
            try await self.loadAccount()
            if status == "ACTIVE" { self.stack = []; self.browsing = true }
            self.state.devAccountsError = false
        }
    }
    func enter(_ target: KGReturnTarget = KGReturnTarget(), origin: String = "PROTECTED") {
        cancelRequest(); returnTarget = target; entry = origin
        stack = [token == nil ? .E1 : .F1]; show(stack.last!)
        if token != nil { execute { try await self.loadAccount() } }
    }
    private func show(_ screen: KGAuthScreen) { state.screen = screen; state.busy = false; state.error = ""; state.detail = "" }
    private func open(_ screen: KGAuthScreen) {
        cancelRequest()
        if let document = KGAuthSurfaces[screen]?.document { self.document(document); return }
        let protected: [KGAuthScreen] = [.F1, .F4_NOTI, .CONSENT_HISTORY, .F5, .LOGOUT_CONFIRM, .CONSENT_WITHDRAW_CONFIRM, .WITHDRAW_CONFIRM]
        if protected.contains(screen) && token == nil { enter(returnTarget); return }
        stack.append(screen); show(screen)
        switch screen {
        case .F1: execute { try await self.loadAccount() }
        case .F4_NOTI, .CONSENT_HISTORY: execute { try await self.loadPreferencesAndConsents() }
        case .E2_TERMS, .MEMBER_INFO: execute { try await self.loadPolicies() }
        default: break
        }
    }
    private func cancelRequest() { if mutationEpoch == sequence { mutationUnknown = true }; sequence += 1; task?.cancel(); task = nil; state.busy = false }
    func back() {
        let uncertain = state.busy && [.LOGOUT_CONFIRM, .F4_NOTI, .E2_SMS, .SMS_SENT, .E2_TERMS, .CONSENT_WITHDRAW_CONFIRM].contains(state.screen)
        if uncertain { mutationUnknown = true }
        cancelRequest()
        if stack.count > 1 { stack.removeLast(); show(stack.last!) } else { stack = []; browsing = true }
        if [.E2_TERMS, .MEMBER_INFO].contains(state.screen) { refreshPolicy() }
        if uncertain { state.error = "처리가 취소되어 결과를 확정할 수 없습니다. 다시 열어 서버 상태를 확인해주세요." }
    }
    func popPages(to count: Int) {
        let pages = stack.filter { !["modal", "sheet"].contains(KGAuthSurfaces[$0]!.kind) }
        guard count < pages.count else { return }
        cancelRequest(); stack = Array(pages.prefix(count)); if let last = stack.last { show(last) } else { browsing = true }
    }
    private func browse() { cancelRequest(); stack = []; browsing = true }
    private func execute(_ block: @escaping @MainActor () async throws -> Void) {
        cancelRequest(); let current = sequence; state.busy = true; state.error = ""
        task = Task {
            do { try await block() }
            catch is CancellationError { }
            catch { if current == self.sequence && !Task.isCancelled { self.failure(error) } }
            if current == self.sequence { self.state.busy = false }
        }
    }
    func failure(_ error: Error) {
        if let d = try? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("ws17-error-log.txt"),
           let data = ("WS17ERR \(type(of: error)) :: \(error)\n").data(using: .utf8) {
            let h = try? FileHandle(forWritingTo: d)
            if let h { h.seekToEndOfFile(); h.write(data); try? h.close() } else { try? data.write(to: d) }
        }
        let api = error as? KGAuthAPIError
        let status = api?.status
        if api?.requestContext == .public {
            invalidatePolicy()
            state.error = "공개 문서·연결을 확인할 수 없습니다. 다시 시도하거나 닫아주세요. 동의는 진행되지 않습니다."; return
        }
        let privateRequest = api?.requestContext == .private
        if privateRequest && api?.code == "POLICY_VERSION_CHANGED" {
            invalidatePolicy()
            if KGAuthSurfaces[state.screen]?.family == "sms" { stack = [.E1, .MEMBER_INFO, .E2_TERMS]; show(.E2_TERMS) }
            execute { try await self.loadPolicies(); self.state.error = "정책이 변경되었습니다. 전문을 다시 확인하고 동의를 선택해주세요." }; return
        }
        switch status {
        case 401 where privateRequest && ["AUTH_REQUIRED", "SESSION_INVALID", "SESSION_REQUIRED"].contains(api?.code ?? ""):
            var cleared = true
            do { try sessions.clear() } catch { cleared = false }
            token = nil; version = nil
            state.member = .signedOut
            state.nickname = ""; state.email = ""; state.customerNumber = ""; state.records = []; state.notifications = [:]; state.marketingConsented = false
            stack = [.E1, .SESSION_EXPIRED]; show(.SESSION_EXPIRED); entry = "SESSION_EXPIRED"
            if !cleared { state.error = "안전한 세션 저장소를 정리하지 못했습니다. 다시 시도해주세요." }
        case 403 where privateRequest && ["CONSENT_RENEWAL_REQUIRED", "ACCOUNT_RESTRICTED"].contains(api?.code ?? ""):
            let screen: KGAuthScreen = api?.code == "CONSENT_RENEWAL_REQUIRED" ? .RECONSENT : .ACCOUNT_RESTRICTED
            stack.append(screen); show(screen)
            if screen == .RECONSENT { state.options = []; state.detail = "필수 문서의 변경 분류를 서버에서 확인하는 기능이 준비 중입니다. 임의 재동의는 받지 않습니다." }
        case 409: state.error = "서버의 최신 버전과 다릅니다. 최신 설정을 다시 불러온 후 직접 변경해주세요."
        case 404: state.error = "회원 API 또는 문서가 아직 준비되지 않았습니다. 가입·동의 성공으로 처리하지 않습니다."
        default: state.error = "서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도해주세요."
        }
    }
    private func loadConfig() async throws -> [String: Any] {
        let json = try await repository.config(); try Task.checkCancellation()
        guard json["providers"] is [[String: Any]], let ready = json["signupReady"] as? Bool else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
        try installSnapshot(json)
        guard let sms = json["sms"] as? [String: Any] else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
        let available = ready && sms["available"] as? Bool == true && sms["codeDigits"] as? Int == 5 && sms["expiresInSeconds"] as? Int == 60 && sms["phonePattern"] as? String == "^010[0-9]{8}$"
        state.smsAvailable = available; state.canSendSms = available && registrationTicket != nil && !mutationUnknown
        state.detail = ready ? "서버 인증·필수정보와 현재 문서 확인 후 가입을 진행합니다." : "소셜 로그인·문자 인증·정식 정책 준비 중입니다. 실제 가입은 아직 완료할 수 없습니다."
        return json
    }
    private func invalidatePolicy() {
        snapshot = nil; state.policyReady = false; state.accepted.formIntersection(["age14"]); state.documents = state.documents.mapValues { old in var doc = old; doc.serverConsentEligible = false; return doc }
    }
    @discardableResult private func installSnapshot(_ result: [String: Any]) throws -> KGPolicySnapshot {
        let next: KGPolicySnapshot
        do { next = try KGPolicySnapshot.decode(result) } catch { invalidatePolicy(); throw error }
        let changed = snapshot?.identity != next.identity
        snapshot = next
        state.documents = Dictionary(uniqueKeysWithValues: KGAuthDocumentKind.allCases.compactMap { kind in
            guard let row = next.display(kind.rawValue) else { return nil }
            return (kind, KGAuthDocument(kind: kind, title: row.title, status: row.status == "READY" ? .READY : .DRAFT,
                body: row.body, version: row.version, effectiveDate: row.effectiveAt ?? "", operator: row.operator ?? "", serverConsentEligible: row.isCurrent && row.canConsent))
        })
        state.policyReady = next.ready
        if changed { state.accepted.formIntersection(["age14"]) }
        state.options = state.options.map { option in
            guard let kind = option.document else { return option }
            return KGAuthConsentOption(id: option.id, title: option.title, required: next.requirements.requiredGrantKinds.contains(kind.rawValue), document: kind)
        }
        return next
    }
    private func loadPolicies() async throws {
        do { let json = try await repository.policies(); try Task.checkCancellation(); try installSnapshot(json) }
        catch { if !Task.isCancelled { invalidatePolicy() }; throw error }
    }
    func refreshPolicy() {
        guard started, !stack.isEmpty, ![KGAuthScreen.F4_NOTI, .LOGOUT_CONFIRM].contains(state.screen) else { return }
        if let kind = KGAuthSurfaces[state.screen]?.document { document(kind, retry: true) }
        else { execute { try await self.loadPolicies() } }
    }
    private func document(_ kind: KGAuthDocumentKind, retry: Bool = false) {
        if !retry {
            cancelRequest()
            guard let screen = KGAuthSurfaces.first(where: { $0.value.document == kind })?.key else { return }
            stack.append(screen); show(screen)
        }
        state.selectedDocument = kind; state.policyReady = false
        state.documents[kind] = KGAuthDocument(kind: kind, title: "문서 확인", status: .LOADING)
        execute {
            do {
                let result = try await self.repository.policy(kind); try Task.checkCancellation()
                let next = try KGPolicySnapshot.decode(result)
                guard let row = next.display(kind.rawValue),
                      let id = result["id"] as? String, id.utf8.elementsEqual(row.id.utf8),
                      let version = result["version"] as? String, version.utf8.elementsEqual(row.version.utf8),
                      result["bodySha256"] as? String == row.bodySha256,
                      let body = result["body"] as? String, body.utf8.elementsEqual(row.body.utf8) else { throw KGPolicySnapshot.invalid() }
                try self.installSnapshot(result)
            } catch {
                if !Task.isCancelled {
                    self.invalidatePolicy()
                    self.state.documents[kind] = KGAuthDocument(kind: kind, title: "문서 확인", status: (error as? KGAuthAPIError)?.status == 404 ? .PREPARING : .ERROR)
                }
                throw error
            }
        }
    }
    private func confirmPolicy(_ message: String) {
        let selected = snapshot?.identity
        execute {
            try await self.loadPolicies()
            self.state.error = selected != self.snapshot?.identity ? "정책이 변경되었습니다. 전문을 다시 확인하고 동의를 선택해주세요." : message
        }
    }
    private func loadAccount() async throws {
        guard let token else {
            state.member = .signedOut
            throw KGAuthAPIError(status: 401, code: "SESSION_REQUIRED", requestContext: .private)
        }
        // A1은 이 상태를 그대로 표시한다: 로딩 → 성공/오류(재시도)/네트워크 실패.
        state.member = .loading
        let me: [String: Any]
        do {
            me = try await repository.me(token); try Task.checkCancellation()
        } catch {
            if !Task.isCancelled { state.member = .failed(KGNetworkFailure.isNetwork(error) ? .network : .server) }
            throw error
        }
        guard let status = me["status"] as? String, ["ACTIVE", "RESTRICTED"].contains(status),
              let member = KGMember(payload: me) else {
            state.member = .failed(.server)
            throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE")
        }
        state.nickname = member.nickname; state.email = member.email; state.customerNumber = member.customerNumber
        state.member = .loaded(member)
        if status == "RESTRICTED" { stack = [.F1, .ACCOUNT_RESTRICTED]; show(.ACCOUNT_RESTRICTED) }
    }
    private func preferences(_ json: [String: Any]) throws {
        let keys = ["advertising", "chat", "comment", "quote", "inquiry"]
        guard let version = json["version"] as? Int, version >= 0, keys.allSatisfy({ json[$0] is Bool }) else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
        self.version = version; state.notifications = Dictionary(uniqueKeysWithValues: keys.map { ($0, json[$0] as! Bool) })
    }
    private func loadPreferencesAndConsents() async throws {
        guard let token else { throw KGAuthAPIError(status: 401, code: "SESSION_REQUIRED", requestContext: .private) }
        let json = try await repository.consents(token); try Task.checkCancellation()
        guard let records = json["records"] as? [[String: Any]] else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
        var marketing = false
        state.records = try records.map { record in
            guard let kind = record["kind"] as? String, let title = record["title"] as? String,
                  let version = record["version"] as? String, let status = record["status"] as? String, let date = record["recordedAt"] as? String else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
            if kind == "MARKETING" { marketing = status == "GRANTED" }
            return KGAuthConsentRecord(title: title, version: version, status: status, recordedAt: date)
        }
        state.marketingConsented = marketing
        let notifications = try await repository.notifications(token); try Task.checkCancellation(); try preferences(notifications)
    }
    /// 외부 브라우저(ASWebAuthenticationSession)로 구글 동의 화면을 연다.
    private func startGoogleLogin() {
        guard !state.busy else { return }
        execute {
            do {
                let result = try await self.repository.oauthStart("google"); try Task.checkCancellation()
                guard let raw = result["authorizationUrl"] as? String, let url = URL(string: raw),
                      url.scheme == "https", url.host == "accounts.google.com" else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
                self.oauthPending = true
                self.webAuth.start(url) { [weak self] result in self?.finishGoogleLogin(result) }
            } catch let error as KGAuthAPIError {
                if error.code == "PROVIDER_NOT_CONFIGURED" { self.openFailure("구글 로그인이 아직 연결되지 않았습니다.") }
                else { throw error }
            }
        }
    }
    private func finishGoogleLogin(_ result: Result<URL, Error>) {
        guard oauthPending else { return }
        switch result {
        case .success(let url): handleOAuthCallback(url)
        case .failure(let error):
            oauthPending = false
            state.error = (error as? KGAuthAPIError)?.code == "CANCELLED"
                ? "로그인을 취소하셨습니다." : "네트워크에 연결하지 못했습니다. 연결을 확인하고 다시 시도해주세요."
        }
    }
    /// kimgosu://auth/callback?token=… 또는 ?error=…. 토큰은 /v1/me 검증을 통과해야만 저장된다.
    func handleOAuthCallback(_ url: URL) {
        guard url.scheme == "kimgosu", url.host == "auth", url.path == "/callback" else { return }
        oauthPending = false
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let token = items.first(where: { $0.name == "token" })?.value, !token.isEmpty { establishVerifiedSession(token); return }
        state.error = items.first(where: { $0.name == "error" })?.value == "CANCELLED"
            ? "로그인을 취소하셨습니다." : "로그인을 완료하지 못했습니다. 다시 시도해주세요."
    }
    private func openFailure(_ message: String) {
        stack.append(.LOGIN_FAILURE); show(.LOGIN_FAILURE); state.detail = message
    }
    // Only an approved provider callback may call this. No debug login or synthetic success is exposed.
    func establishVerifiedSession(_ bearer: String) {
        execute {
            let me = try await self.repository.me(bearer); try Task.checkCancellation()
            guard let status = me["status"] as? String, ["ACTIVE", "RESTRICTED"].contains(status) else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
            try self.sessions.write(bearer); self.token = bearer; self.mutationUnknown = false; try await self.loadAccount()
            if status == "ACTIVE" { self.stack = []; self.browsing = true }
            // Never replay a pending mutation. Return to mounted A1 and ask for a fresh confirmation.
        }
    }
    // Normal result consumer; actual native provider/callback binding remains a design dependency.
    // Test-only host uses a genuine backend-issued local ticket, never a shipping flag/secret.
    func acceptRegistrationResult(_ result: [String: Any]) throws {
        guard result["outcome"] as? String == "REGISTRATION_REQUIRED", let ticket = result["registrationTicket"] as? String,
              ticket.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let seconds = result["expiresInSeconds"] as? Int, seconds > 0 else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
        cancelRequest(); countdown?.cancel(); registrationTicket = ticket; challengeId = nil; phoneVerified = false; mutationUnknown = false
        state = KGAuthState(screen: .MEMBER_INFO, policyReady: false); stack = [.E1, .MEMBER_INFO]
        execute { _ = try await self.loadConfig(); try await self.loadPolicies() }
    }
    private func selectedKinds() -> [String] { state.options.filter { state.accepted.contains($0.id) }.compactMap { $0.document?.rawValue } }
    private var validMember: Bool { !state.input("name").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && KGAuthInput.validEmail(state.input("email")) && state.input("nickname").isEmpty }
    private func freshConfirmation() async throws -> KGPolicySnapshot? {
        let selected = snapshot?.identity; try await loadPolicies()
        if selected != snapshot?.identity || !state.policyReady {
            if KGAuthSurfaces[state.screen]?.family == "sms" {
                while stack.last != .E2_TERMS && !stack.isEmpty { stack.removeLast() }
                if stack.isEmpty { stack = [.E1, .MEMBER_INFO, .E2_TERMS] }; show(.E2_TERMS)
            }
            state.error = "정책이 변경되었습니다. 전문을 다시 확인하고 동의를 선택해주세요."; return nil
        }
        return snapshot
    }
    private func unknown() { mutationUnknown = true; state.canSendSms = false; state.error = "처리 결과를 확정할 수 없습니다. UNKNOWN · 자동 재전송하지 않습니다. 서버 내역을 확인하거나 새 인증을 진행해주세요." }
    private func mutation(_ block: @MainActor () async throws -> Void) async throws {
        let current = sequence; mutationEpoch = current
        defer { if mutationEpoch == current { mutationEpoch = nil } }
        do { try await block() }
        catch is CancellationError { if current == sequence { mutationUnknown = true }; throw CancellationError() }
        catch { if current != sequence { return }; if let api = error as? KGAuthAPIError, (400...499).contains(api.status) && api.code != "INVALID_API_RESPONSE" { throw error }; unknown() }
    }
    private func verifyConsentReadback(_ bearer: String, _ expected: KGPolicySnapshot, _ kinds: [String]) async throws {
        let r = try await repository.consents(bearer); try Task.checkCancellation()
        guard let records = r["records"] as? [[String: Any]], kinds.allSatisfy({ kind in records.contains { row in
            row["kind"] as? String == kind && (row["version"] as? String)?.utf8.elementsEqual(expected.current(kind)?.version.utf8 ?? "".utf8) == true && row["status"] as? String == "GRANTED"
        } }) else { throw KGAuthAPIError(status: 0, code: "READBACK_MISMATCH") }
        try await loadPreferencesAndConsents()
    }
    private func submitConsents() {
        let kinds = selectedKinds()
        execute {
            guard let fresh = try await self.freshConfirmation() else { return }
            if let token = self.token {
                try await self.mutation {
                    let r = try await self.repository.recordConsents(token, snapshot: fresh, kinds: kinds); try Task.checkCancellation()
                    guard r["recorded"] as? Bool == true else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
                    try await self.verifyConsentReadback(token, fresh, kinds); self.state.detail = "동의 저장과 서버 재조회를 확인했습니다."
                }
            } else {
                guard self.registrationTicket != nil && self.validMember else { throw KGAuthAPIError(status: 0, code: "REGISTRATION_REQUIRED") }
                _ = try await self.loadConfig(); guard self.state.smsAvailable else { return }
                self.stack.append(.E2_SMS); self.show(.E2_SMS)
            }
        }
    }
    private func sendSms() {
        guard let ticket = registrationTicket else { return }; let phone = state.input("phone")
        execute { try await self.mutation {
            let start = self.clock.now
            let r = try await self.repository.sendSms(ticket, phone: phone); try Task.checkCancellation()
            let f = ISO8601DateFormatter(); f.formatOptions.insert(.withFractionalSeconds)
            guard let server = r["serverTime"] as? String, let end = r["expiresAt"] as? String,
                  let a = f.date(from: server), let b = f.date(from: end), let challenge = r["challengeId"] as? String,
                  r["codeDigits"] as? Int == 5, r["expiresInSeconds"] as? Int == 60, UUID(uuidString: challenge) != nil,
                  let retry = r["retryAfter"] as? String, f.date(from: retry) != nil, b.timeIntervalSince(a) > 0, b.timeIntervalSince(a) <= 60 else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
            let duration = b.timeIntervalSince(a); self.challengeId = challenge; self.phoneVerified = false
            self.show(.SMS_SENT); self.stack[self.stack.count - 1] = .SMS_SENT; self.state.challengeActive = true; self.state.canSendSms = true; self.state.inputs["code"] = ""
            self.countdown?.cancel(); self.countdown = Task { @MainActor [weak self] in
                while let self, self.challengeId != nil && !self.phoneVerified && !Task.isCancelled {
                    let d = start.duration(to: self.clock.now).components
                    let elapsed = Double(d.seconds) + Double(d.attoseconds) / 1e18
                    self.state.remainingSeconds = Int(max(0, duration - elapsed).rounded(.down))
                    if self.state.remainingSeconds == 0 { break }
                    try? await Task.sleep(for: .milliseconds(250))
                }
            }
        } }
    }
    private func verifyAndSignup() {
        guard let ticket = registrationTicket, let challenge = challengeId else { return }; let code = state.input("code"), kinds = selectedKinds()
        execute { try await self.mutation {
            if !self.phoneVerified {
                do {
                    let r = try await self.repository.verifySms(ticket, challenge: challenge, code: code); try Task.checkCancellation()
                    guard r["verified"] as? Bool == true else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
                    self.phoneVerified = true; self.countdown?.cancel()
                } catch let api as KGAuthAPIError {
                    if api.code == "SMS_CODE_INVALID_OR_EXPIRED" { self.state.error = "인증번호가 잘못되었거나 만료되었습니다. 서버에서 거절했습니다. 다시 확인하거나 재전송해주세요."; return }; throw api
                }
            }
            guard let fresh = try await self.freshConfirmation() else { return }
            guard self.state.accepted.contains("age14") && self.validMember else { throw KGAuthAPIError(status: 0, code: "INVALID_MEMBER") }
            let r = try await self.repository.signup(["registrationTicket": ticket, "name": self.state.input("name"), "email": self.state.input("email"), "age14Confirmed": true, "expertRequested": false], snapshot: fresh, kinds: kinds); try Task.checkCancellation()
            guard r["outcome"] as? String == "REGISTERED", let session = r["session"] as? [String: Any], let bearer = session["accessToken"] as? String else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
            let me = try await self.repository.me(bearer); try Task.checkCancellation()
            guard let status = me["status"] as? String, ["ACTIVE", "RESTRICTED"].contains(status) else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
            try self.sessions.write(bearer); self.token = bearer
            try await self.loadAccount(); try await self.verifyConsentReadback(bearer, fresh, kinds)
            self.registrationTicket = nil; self.challengeId = nil
            if status == "ACTIVE" { self.stack = [.F1]; self.show(.F1) }
            self.state.inputs = [:]; self.state.accepted = []
        } }
    }
    private func withdrawMarketing() {
        guard let token else { return }
        execute { try await self.mutation {
            let r = try await self.repository.withdrawMarketing(token); try Task.checkCancellation()
            guard r["withdrawn"] as? Bool == true else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
            try await self.loadPreferencesAndConsents()
            guard !self.state.marketingConsented && self.state.notifications["advertising"] == false else { throw KGAuthAPIError(status: 0, code: "READBACK_MISMATCH") }
            self.stack.removeLast(); self.show(self.stack.last ?? .CONSENT_HISTORY)
        } }
    }
    func handle(_ event: KGAuthEvent) {
        switch event.action {
        case .BACK, .CANCEL: back()
        case .BROWSE: browse()
        case .OPEN: if let screen = KGAuthScreen(rawValue: event.key) { open(screen) }
        case .OPEN_DOCUMENT: if let kind = KGAuthDocumentKind(rawValue: event.key) { document(kind) }
        case .RETRY_DOCUMENT: if let kind = KGAuthDocumentKind(rawValue: event.key) { document(kind, retry: true) }
        case .OTHER_LOGIN: cancelRequest(); stack = [.E1]; show(.E1)
        case .START_SOCIAL:
            if event.key == "google" { startGoogleLogin() } else { execute {
                let config = try await self.loadConfig()
                let provider = (config["providers"] as? [[String: Any]])?.first { $0["id"] as? String == event.key }
                self.stack.append(.LOGIN_FAILURE); self.state.screen = .LOGIN_FAILURE
                self.state.detail = provider?["enabled"] as? Bool != true ? "선택한 소셜 로그인 제공자의 실제 연결이 준비되지 않았습니다. 로그인·가입은 완료되지 않았습니다." : "제공자 인증 경로의 계약·앱 연결이 아직 준비되지 않았습니다. 인증 성공으로 처리하지 않습니다."
            } }
        case .CHANGE_INPUT:
            guard !state.busy else { return }
            let value: String
            switch event.key { case "phone": value = KGAuthInput.phone(event.value); case "code": value = KGAuthInput.code(event.value); case "withdrawDetail": value = KGAuthInput.withdrawalDetail(event.value); default: value = event.value }
            if event.key == "phone" && value == state.input("phone") { return }
            state.inputs[event.key] = value
            if event.key == "phone" { countdown?.cancel(); challengeId = nil; phoneVerified = false; state.challengeActive = false; state.remainingSeconds = 0; state.inputs["code"] = "" }
        case .CHANGE_CONSENT:
            if event.key == "withdrawAcknowledged" { state.withdrawalAcknowledged = event.value == "true" }
            else if let option = state.options.first(where: { $0.id == event.key }), state.consentEnabled(option) {
                if event.value == "true" { state.accepted.insert(option.id) } else { state.accepted.remove(option.id) }
            }
        case .CHANGE_ALL_CONSENTS: state.accepted = event.value == "true" ? Set(state.options.filter { state.consentEnabled($0) }.map { $0.id }) : []
        case .CHANGE_NOTIFICATION:
            guard !state.busy else { return }
            execute {
                guard let token = self.token else { throw KGAuthAPIError(status: 401, code: "SESSION_REQUIRED", requestContext: .private) }
                guard let version = self.version else { throw KGAuthAPIError(status: 409, code: "VERSION_REQUIRED") }
                do {
                    _ = try await self.repository.changeNotification(token, version: version, key: event.key, value: event.value == "true")
                    try Task.checkCancellation()
                    let json = try await self.repository.notifications(token); try Task.checkCancellation(); try self.preferences(json)
                    guard self.state.notifications[event.key] == (event.value == "true") else { throw KGAuthAPIError(status: 409, code: "READBACK_MISMATCH") }
                } catch let error as KGAuthAPIError { if error.status == 409 { try await self.loadPreferencesAndConsents() }; throw error }
            }
        case .CONFIRM_LOGOUT:
            guard !state.busy else { return }
            execute {
                guard let token = self.token else { throw KGAuthAPIError(status: 401, code: "SESSION_REQUIRED", requestContext: .private) }
                let result = try await self.repository.logout(token); try Task.checkCancellation()
                guard result["loggedOut"] as? Bool == true else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
                do { _ = try await self.repository.me(token); throw KGAuthAPIError(status: 409, code: "REVOCATION_NOT_CONFIRMED") }
                catch let error as KGAuthAPIError { if error.status != 401 || !["AUTH_REQUIRED", "SESSION_INVALID"].contains(error.code) { throw error } }
                try Task.checkCancellation(); guard self.token == token else { return }; try self.sessions.clear(); self.token = nil; self.version = nil
                self.state = KGAuthState(screen: .HOME_SIGNED_OUT); self.state.member = .signedOut; self.stack = []; self.browsing = true
            }
        case .REFRESH_ACCOUNT: execute { try await self.loadAccount() }
        case .LOAD_DEV_ACCOUNTS: loadDevAccounts()
        case .DEV_LOGIN: if !state.busy, let slot = Int(state.input("devSlot")) { devLogin(slot: slot) }
        case .SUBMIT_CONSENTS: if state.canContinue && !mutationUnknown { submitConsents() }
        case .SUBMIT_MEMBER:
            if state.canSubmitMember {
                if registrationTicket == nil { state.error = "검증된 제공자 가입 인증이 필요합니다. 가입하지 않았습니다." }
                else if !state.input("nickname").isEmpty { state.error = "닉네임 변경은 가입 후 별도 확인이 필요합니다. 입력을 보존했으며 아직 가입하지 않았습니다." }
                else { open(.E2_TERMS) }
            }
        case .SEND_SMS: if state.canSend && !mutationUnknown { sendSms() }
        case .VERIFY_SMS: if state.canVerify && !mutationUnknown { verifyAndSignup() }
        case .CONFIRM_WITHDRAW: state.error = "탈퇴 API·자료별 보관정책 검토가 준비되지 않았습니다. 탈퇴 처리하지 않았으며 계정은 유지됩니다."
        case .WITHDRAW_MARKETING: if !state.busy && state.marketingConsented && !mutationUnknown { withdrawMarketing() }
        case .VERIFY_LINK_OWNERSHIP, .CONFIRM_LINK, .CONTINUE_REJOIN: state.error = "실제 인증·소유 확인 API 연결 준비 중입니다. 계정 연결·재가입을 처리하지 않았습니다."
        case .SUPPORT: state.error = "지원 경로 준비 중입니다."
        case .OPEN_OS_SETTINGS: break
        }
    }
}
