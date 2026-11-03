import Foundation

// Host-only isolated model contract tests, NOT provider/API/DB or iOS touch evidence.
final class MemorySession: KGSessionStorage {
    var value: String?
    func read() throws -> String? { value }
    func write(_ token: String) throws { value = token }
    func clear() throws { value = nil }
}
@MainActor final class ModelTransport: KGAuthTransport {
    var calls: [String] = []
    var revoked = false, expire = false, conflict = false, slow = false
    var prefs: [String: Any] = ["advertising":true,"chat":false,"comment":false,"quote":false,"inquiry":false,"version":2]
    func request(_ method: String, _ wirePath: String, token: String?, body: [String: Any]?) async throws -> [String: Any] {
        if wirePath.hasPrefix("/v1/policies") || wirePath.hasPrefix("/v1/auth/config") { precondition(wirePath.contains("metadata=policy-v0.3")) }
        let path = wirePath.replacingOccurrences(of: "?metadata=policy-v0.3&", with: "?").replacingOccurrences(of: "?metadata=policy-v0.3", with: "")
        calls.append(method + " " + path)
        switch path {
        case "/v1/auth/config": return KGPolicyTestFixture.draft()
        case "/v1/policies": return KGPolicyTestFixture.draft()
        case "/v1/policies/TERMS":
            if slow { try await Task.sleep(for: .milliseconds(300)) }
            return KGPolicyTestFixture.draft()
        case "/v1/me":
            if revoked || expire { throw KGAuthAPIError(status:401,code:"SESSION_INVALID") }
            return ["status":"ACTIVE","nickname":"모델시험","email":"unit@example.invalid","customerNumber":"unit-only"]
        case "/v1/me/consents": return ["records":[["kind":"MARKETING","title":"시험","version":"unit","status":"GRANTED","recordedAt":"2026-10-31T00:00:00Z"]]]
        case "/v1/me/notifications":
            if method == "PATCH" {
                precondition(body?["expectedVersion"] as? Int == 2 && body?["memberId"] == nil)
                if conflict { prefs["version"] = 3; throw KGAuthAPIError(status:409,code:"VERSION_CONFLICT") }
                for key in ["advertising","chat","comment","quote","inquiry"] { if let value = body?[key] as? Bool { prefs[key] = value } }
                prefs["version"] = 3
            }
            return prefs
        case "/v1/auth/logout": revoked = true; return ["loggedOut":true]
        default: fatalError("UNEXPECTED_ROUTE")
        }
    }
}
@main struct AuthModelChecks {
    @MainActor static func wait(_ model: KGAuthModel) async throws {
        for _ in 0..<120 { if !model.state.busy { return }; try await Task.sleep(for: .milliseconds(10)) }
        fatalError("MODEL_TIMEOUT")
    }
    @MainActor static func main() async throws {
        let fake = ModelTransport(), session = MemorySession()
        let model = KGAuthModel(repository:KGAuthRepository(transport:fake),sessions:session)
        model.start(); try await wait(model)
        model.handle(KGAuthEvent(action:.OPEN,key:"E2_TERMS")); try await wait(model)
        model.handle(KGAuthEvent(action:.CHANGE_ALL_CONSENTS,value:"true"))
        precondition(model.state.accepted == ["age14"] && !model.state.canContinue)
        model.handle(KGAuthEvent(action:.CHANGE_INPUT,key:"name",value:"보존할 입력"))
        model.handle(KGAuthEvent(action:.OPEN_DOCUMENT,key:"TERMS")); try await wait(model)
        precondition(model.state.documents[.TERMS]?.canConsent == false)
        model.back(); precondition(model.state.screen == .E2_TERMS && model.state.input("name") == "보존할 입력" && model.state.accepted == ["age14"])
        let target = KGReturnTarget(targetId:"draft-item",filter:"nearby",scroll:120,draftReference:"draft-unit")
        model.enter(target); model.back(); precondition(model.browsing && model.returnTarget.draftReference == "draft-unit" && model.returnTarget.scroll == 120)
        precondition(KGAuthInput.code("123456") == "12345" && !KGAuthInput.validPhone("０1012345678"))
        precondition(!KGAuthInput.validNickname("공백 닉") && KGAuthInput.validNickname("고수123"))
        precondition(KGAuthInput.withdrawalDetail(String(repeating:"가",count:501)).unicodeScalars.count == 500)
        print("PASS draft_gate_input_validation_document_return_protected_cancel")
        model.establishVerifiedSession(UUID().uuidString); try await wait(model)
        model.enter(); model.handle(KGAuthEvent(action:.OPEN,key:"F4_NOTI")); try await wait(model)
        precondition(model.state.marketingConsented)
        model.handle(KGAuthEvent(action:.CHANGE_NOTIFICATION,key:"advertising",value:"false")); try await wait(model)
        precondition(model.state.notifications["advertising"] == false && model.state.marketingConsented && fake.calls.last == "GET /v1/me/notifications")
        model.handle(KGAuthEvent(action:.OPEN,key:"LOGOUT_CONFIRM")); model.back(); precondition(!fake.revoked)
        model.handle(KGAuthEvent(action:.OPEN,key:"LOGOUT_CONFIRM")); model.handle(KGAuthEvent(action:.CONFIRM_LOGOUT)); try await wait(model)
        precondition(fake.revoked && model.browsing && session.value == nil && fake.calls.last == "GET /v1/me")
        print("PASS preference_expected_version_readback_off_not_withdrawal_logout_cancel_and_revocation")
        let stale = ModelTransport(), store = MemorySession()
        stale.conflict = true
        let conflict = KGAuthModel(repository:KGAuthRepository(transport:stale),sessions:store)
        conflict.establishVerifiedSession(UUID().uuidString); try await wait(conflict)
        conflict.enter(); conflict.handle(KGAuthEvent(action:.OPEN,key:"F4_NOTI")); try await wait(conflict)
        conflict.handle(KGAuthEvent(action:.CHANGE_NOTIFICATION,key:"advertising",value:"false")); try await wait(conflict)
        precondition(conflict.state.notifications["advertising"] == true && conflict.state.error.contains("최신 버전"))
        stale.expire = true; conflict.handle(KGAuthEvent(action:.REFRESH_ACCOUNT)); try await wait(conflict)
        precondition(conflict.state.screen == .SESSION_EXPIRED && conflict.state.customerNumber.isEmpty && store.value == nil)
        print("PASS stale_version_refresh_no_optimistic_success_session_expiry_clear")
        let delayed = ModelTransport(); delayed.slow = true
        let cancel = KGAuthModel(repository:KGAuthRepository(transport:delayed),sessions:MemorySession())
        cancel.handle(KGAuthEvent(action:.OPEN_DOCUMENT,key:"TERMS")); cancel.back()
        try await Task.sleep(for:.milliseconds(400))
        precondition(cancel.state.screen == .E1 && !cancel.state.busy && cancel.state.documents[.TERMS]?.canConsent != true)
        print("PASS cancellation_no_late_navigation")
        let repair = try await KGCoreRepairChecks.run()
        for id in repair { print("CASE " + id + " PASS") }
        print("PASS CORE_REPAIR_CASES " + String(repair.count))
    }
}
