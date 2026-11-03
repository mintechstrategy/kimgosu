import Foundation

// Same source is compiled for macOS host and the iOS Simulator test runner.
// No production launch flag/session injector, external provider or database is involved.
final class KGRepairSession: KGSessionStorage {
    var value: String?
    func read() throws -> String? { value }
    func write(_ token: String) throws { value = token }
    func clear() throws { value = nil }
}
@MainActor final class KGRepairTransport: KGAuthTransport {
    var response: (Int,String)?
    var failingPath = ""
    var revoked = false, slow = false
    var calls: [String] = []
    func request(_ method: String, _ wirePath: String, token: String?, body: [String: Any]?) async throws -> [String: Any] {
        if wirePath.hasPrefix("/v1/policies") || wirePath.hasPrefix("/v1/auth/config") { precondition(wirePath.contains("metadata=policy-v0.3")) }
        let path = wirePath.replacingOccurrences(of: "?metadata=policy-v0.3&", with: "?").replacingOccurrences(of: "?metadata=policy-v0.3", with: "")
        calls.append(method + " " + path)
        if path.hasPrefix("/v1/policies") || path == "/v1/auth/config" { precondition(token == nil) }
        if path == failingPath {
            if slow { await withCheckedContinuation { continuation in DispatchQueue.global().asyncAfter(deadline:.now()+0.25) { continuation.resume() } } }
            if let response { return try decodeMembershipResponse(response.0,Data(response.1.utf8)) }
        }
        if path == "/v1/auth/config" { return KGPolicyTestFixture.draft() }
        if path == "/v1/policies" { return KGPolicyTestFixture.draft() }
        if path.hasPrefix("/v1/policies/") { return KGPolicyTestFixture.draft() }
        if path == "/v1/me" {
            if revoked { throw KGAuthAPIError(status:401,code:"SESSION_INVALID") }
            return ["status":"ACTIVE","nickname":"회귀시험","email":"fixture@example.invalid","customerNumber":"fixture-only"]
        }
        if path == "/v1/me/consents" { return ["records":[]] }
        if path == "/v1/me/notifications" { return ["version":1,"advertising":false,"chat":false,"comment":false,"quote":false,"inquiry":false] }
        if path == "/v1/auth/logout" { revoked=true;return ["loggedOut":true] }
        fatalError("UNEXPECTED_ROUTE")
    }
}
@MainActor enum KGCoreRepairChecks {
    static let scenarios: [(Int,String)] = [
        (401,"{\"error\":{\"code\":\"SESSION_INVALID\"}}"),
        (401,"{\"error\":{\"code\":\"AUTH_REQUIRED\"}}"),
        (403,"{\"error\":{\"code\":\"ACCOUNT_RESTRICTED\"}}"),
        (403,"{\"error\":{\"code\":\"CONSENT_RENEWAL_REQUIRED\"}}"),
        (401,"<html>edge</html>"),(403,"<html>edge</html>"),
        (401,"{\"message\":\"edge\"}"),(403,"{\"message\":\"edge\"}"),
        (401,"{\"error\":{\"code\":\"EDGE_DENIED\"}}"),(403,"{\"error\":{\"code\":\"EDGE_DENIED\"}}"),
        (401,"{\"error\":{\"code\":42}}"),(403,"{\"error\":{\"code\":\"invalid code\"}}")
    ]
    static func wait(_ model: KGAuthModel) async throws {
        for _ in 0..<200 { if !model.state.busy { return };try await Task.sleep(for:.milliseconds(10)) }
        fatalError("MODEL_TIMEOUT")
    }
    static func make(_ fake:KGRepairTransport,_ signedIn:Bool) async throws -> (KGAuthModel,KGRepairSession) {
        let store=KGRepairSession()
        let bound=KGAuthModel(repository:KGAuthRepository(transport:fake),sessions:store)
        if signedIn { bound.establishVerifiedSession(UUID().uuidString) } else { bound.start() }
        try await wait(bound)
        bound.handle(KGAuthEvent(action:.OPEN,key:"E2_TERMS")); try await wait(bound)
        bound.handle(KGAuthEvent(action:.CHANGE_INPUT,key:"name",value:"보존 입력"))
        bound.handle(KGAuthEvent(action:.CHANGE_ALL_CONSENTS,value:"true"))
        return (bound,store)
    }
    static func run() async throws -> [String] {
        var receipts: [String] = []
        for signedIn in [false,true] { for route in ["config","list","detail","version"] { for (index,response) in scenarios.enumerated() {
            let fake=KGRepairTransport();let (model,store)=try await make(fake,signedIn);let before=store.value
            fake.response=response
            fake.failingPath = ["config":"/v1/auth/config","list":"/v1/policies","detail":"/v1/policies/TERMS","version":"/v1/policies/TERMS?version=old/v1"][route]!
            let repository=KGAuthRepository(transport:fake)
            do {
                switch route { case "config": _ = try await repository.config();case "list": _ = try await repository.policies();case "detail": _ = try await repository.policy(.TERMS);default: _ = try await repository.policy(.TERMS,version:"old/v1") }
                fatalError("EXPECTED_FAILURE")
            } catch let error as KGAuthAPIError {
                precondition(error.requestContext == .public && error.status == response.0)
                let stack=model.stack;model.failure(error)
                precondition(model.stack == stack && model.state.screen == .E2_TERMS)
                precondition(model.state.customerNumber == (signedIn ? "fixture-only" : "") && store.value == before)
                precondition(model.state.input("name") == "보존 입력" && model.state.accepted == ["age14"] && !model.state.canContinue && model.state.error.contains("다시 시도"))
            }
            receipts.append("public-\(signedIn)-\(route)-\(index)")
        } } }
        for signedIn in [false,true] { for (index,response) in scenarios.enumerated() {
            let fake=KGRepairTransport();let (model,store)=try await make(fake,signedIn);let before=store.value
            fake.response=response;fake.failingPath="/v1/policies/TERMS"
            model.handle(KGAuthEvent(action:.OPEN_DOCUMENT,key:"TERMS"));try await wait(model)
            precondition(model.state.screen == .TERMS_DOC && model.state.documents[.TERMS]?.status == .ERROR && model.state.documents[.TERMS]?.canConsent == false)
            model.handle(KGAuthEvent(action:.RETRY_DOCUMENT,key:"TERMS"));try await wait(model)
            precondition(model.state.screen == .TERMS_DOC)
            fake.response=nil;model.handle(KGAuthEvent(action:.RETRY_DOCUMENT,key:"TERMS"));try await wait(model)
            precondition(model.state.documents[.TERMS]?.status == .DRAFT)
            model.back();precondition(model.state.screen == .E2_TERMS && model.state.input("name") == "보존 입력" && !model.state.canContinue && store.value == before)
            fake.response=response;fake.failingPath="/v1/auth/config"
            model.handle(KGAuthEvent(action:.START_SOCIAL,key:"google"));try await wait(model)
            precondition(model.state.screen == .E2_TERMS && store.value == before)
            receipts.append("public-actions-\(signedIn)-\(index)")
        } }
        for route in ["me","mutation"] { for (index,response) in scenarios.enumerated() {
            let fake=KGRepairTransport();let (model,store)=try await make(fake,true)
            model.handle(KGAuthEvent(action:.OPEN,key:"F4_NOTI"));try await wait(model)
            fake.response=response;fake.failingPath=route == "me" ? "/v1/me" : "/v1/me/notifications"
            model.handle(KGAuthEvent(action:route == "me" ? .REFRESH_ACCOUNT : .CHANGE_NOTIFICATION,key:"chat",value:"true"));try await wait(model)
            let expected:KGAuthScreen = index<2 ? .SESSION_EXPIRED : index == 2 ? .ACCOUNT_RESTRICTED : index == 3 ? .RECONSENT : .F4_NOTI
            precondition(model.state.screen == expected && model.state.customerNumber == (index<2 ? "" : "fixture-only") && (store.value == nil) == (index<2))
            if index>=4 { precondition(!model.state.error.isEmpty) }
            let mutations=fake.calls.filter{$0.hasPrefix("PATCH")}.count
            fake.response=nil;model.establishVerifiedSession(UUID().uuidString);try await wait(model)
            precondition(fake.calls.filter{$0.hasPrefix("PATCH")}.count == mutations)
            receipts.append("private-\(route)-\(index)")
        } }
        let fake=KGRepairTransport();let (model,store)=try await make(fake,true);let before=store.value
        fake.response=scenarios[0];fake.failingPath="/v1/policies/TERMS";fake.slow=true
        model.handle(KGAuthEvent(action:.OPEN_DOCUMENT,key:"TERMS"));try await Task.sleep(for:.milliseconds(40));model.back()
        try await Task.sleep(for:.milliseconds(400))
        precondition(model.state.screen == .E2_TERMS && model.state.error.isEmpty && !model.state.busy && model.state.documents[.TERMS]?.canConsent == false && store.value == before)
        fake.slow=false;fake.response=(200,"{}")
        model.handle(KGAuthEvent(action:.OPEN_DOCUMENT,key:"TERMS"));try await wait(model)
        precondition(model.state.screen == .TERMS_DOC && model.state.documents[.TERMS]?.status == .ERROR && store.value == before)
        receipts.append("cancel-late-invalid-success")
        return receipts
    }
}

enum KGPolicyTestFixture { static func draft() -> [String: Any] { try! JSONSerialization.jsonObject(with: Data(#"{"id":"9223372036854775800","kind":"TERMS","version":"opaque/z-0000","status":"DRAFT","title":"통제 시험 TERMS","body":"LOCAL TEST ONLY — TERMS\r\n가😀 é é\r\n  끝  ","bodySha256":"cb8c1ef72c5c00bbf9063a7125ec0c20e0c36d69db69d2d4ba261db580a0c762","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true,"providers":[],"signupReady":false,"documents":[{"id":"9223372036854775800","kind":"TERMS","version":"opaque/z-0000","status":"DRAFT","title":"통제 시험 TERMS","body":"LOCAL TEST ONLY — TERMS\r\n가😀 é é\r\n  끝  ","bodySha256":"cb8c1ef72c5c00bbf9063a7125ec0c20e0c36d69db69d2d4ba261db580a0c762","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775801","kind":"PRIVACY_CONSENT","version":"opaque/z-0001","status":"DRAFT","title":"통제 시험 PRIVACY_CONSENT","body":"LOCAL TEST ONLY — PRIVACY_CONSENT\r\n가😀 é é\r\n  끝  ","bodySha256":"71d9a23e36d5b85c8ffb136b497cdd1386e324e6996a8d68fd8eacf27082b2f6","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775802","kind":"PRIVACY_POLICY","version":"opaque/z-0002","status":"DRAFT","title":"통제 시험 PRIVACY_POLICY","body":"LOCAL TEST ONLY — PRIVACY_POLICY\r\n가😀 é é\r\n  끝  ","bodySha256":"40d61bdcc1dfe868559afdc34ad1da6e23a683ec90e1c05ba59d3b89ccbf207d","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775803","kind":"MARKETING","version":"opaque/z-0003","status":"DRAFT","title":"통제 시험 MARKETING","body":"LOCAL TEST ONLY — MARKETING\r\n가😀 é é\r\n  끝  ","bodySha256":"43988519d7628b3cb5201e68b1f66f1d5c45010b7aef1f2d0953315fd26fc52c","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775804","kind":"OPERATIONS","version":"opaque/z-0004","status":"DRAFT","title":"통제 시험 OPERATIONS","body":"LOCAL TEST ONLY — OPERATIONS\r\n가😀 é é\r\n  끝  ","bodySha256":"31968db90e31dfc7c25cfcd064d2f678d3440cb2da751a22c75f9389964eac71","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true}],"policySnapshot":{"cache":{"control":"no-store","ttlSeconds":0,"revalidateBeforeConsent":true},"requirements":{"requiredGrantKinds":["TERMS","PRIVACY_CONSENT"],"requiredReadyKindsForGrant":["TERMS","PRIVACY_CONSENT","PRIVACY_POLICY"],"optionalGrantKinds":["MARKETING"],"operationsConsentRequired":false},"constraints":{"consentInputs":{"type":"array","minItems":2,"maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["kind","version"],"properties":{"kind":{"type":"string","enum":["TERMS","PRIVACY_CONSENT","MARKETING"]},"version":{"type":"string","minLength":1,"maxLength":100}}}},"nickname":{"type":"string","pattern":"^[\\p{L}\\p{N}]{1,10}$","maxLength":10}},"limitations":{"commitFence":false,"allowedActions":"NOT_IMPLEMENTED","materialChangeClassification":"NOT_IMPLEMENTED"},"schemaVersion":"policy-v0.3","policyRevision":"ps3-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","serverTime":"2040-01-01T00:00:00.000Z","timeAuthority":"POSTGRES_TRANSACTION_NOW","missingReadyKinds":["TERMS","PRIVACY_CONSENT","PRIVACY_POLICY"],"currentDocuments":[{"kind":"TERMS","currentDocument":null},{"kind":"PRIVACY_CONSENT","currentDocument":null},{"kind":"PRIVACY_POLICY","currentDocument":null},{"kind":"MARKETING","currentDocument":null},{"kind":"OPERATIONS","currentDocument":null}],"documents":[{"id":"9223372036854775800","kind":"TERMS","version":"opaque/z-0000","status":"DRAFT","title":"통제 시험 TERMS","body":"LOCAL TEST ONLY — TERMS\r\n가😀 é é\r\n  끝  ","bodySha256":"cb8c1ef72c5c00bbf9063a7125ec0c20e0c36d69db69d2d4ba261db580a0c762","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775801","kind":"PRIVACY_CONSENT","version":"opaque/z-0001","status":"DRAFT","title":"통제 시험 PRIVACY_CONSENT","body":"LOCAL TEST ONLY — PRIVACY_CONSENT\r\n가😀 é é\r\n  끝  ","bodySha256":"71d9a23e36d5b85c8ffb136b497cdd1386e324e6996a8d68fd8eacf27082b2f6","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775802","kind":"PRIVACY_POLICY","version":"opaque/z-0002","status":"DRAFT","title":"통제 시험 PRIVACY_POLICY","body":"LOCAL TEST ONLY — PRIVACY_POLICY\r\n가😀 é é\r\n  끝  ","bodySha256":"40d61bdcc1dfe868559afdc34ad1da6e23a683ec90e1c05ba59d3b89ccbf207d","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775803","kind":"MARKETING","version":"opaque/z-0003","status":"DRAFT","title":"통제 시험 MARKETING","body":"LOCAL TEST ONLY — MARKETING\r\n가😀 é é\r\n  끝  ","bodySha256":"43988519d7628b3cb5201e68b1f66f1d5c45010b7aef1f2d0953315fd26fc52c","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775804","kind":"OPERATIONS","version":"opaque/z-0004","status":"DRAFT","title":"통제 시험 OPERATIONS","body":"LOCAL TEST ONLY — OPERATIONS\r\n가😀 é é\r\n  끝  ","bodySha256":"31968db90e31dfc7c25cfcd064d2f678d3440cb2da751a22c75f9389964eac71","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true}]}}"#.utf8)) as! [String: Any] } }
