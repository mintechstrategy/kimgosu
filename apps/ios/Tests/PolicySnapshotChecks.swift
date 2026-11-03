import Foundation

@MainActor final class KGPolicyLocalTransport: KGAuthTransport {
    var response: [String: Any]
    var slow = false
    var reject = false
    var calls: [(String,String,[String:Any]?)] = []
    init(_ response: [String: Any]) { self.response = response }
    func request(_ method: String, _ path: String, token: String?, body: [String: Any]?) async throws -> [String: Any] {
        calls.append((method,path,body))
        if method == "POST" { if reject { throw KGAuthAPIError(status:409,code:"POLICY_VERSION_CHANGED") }; return ["recorded":true] }
        precondition(path.contains("metadata=policy-v0.3") && token == nil)
        let captured = response
        if slow { await withCheckedContinuation { c in DispatchQueue.global().asyncAfter(deadline:.now()+0.15) { c.resume() } } }
        return captured
    }
}
@MainActor enum KGPolicyChecks {
    static func wait(_ model: KGAuthModel) async throws {
        for _ in 0..<200 { if !model.state.busy { return }; try await Task.sleep(for:.milliseconds(10)) }; preconditionFailure("MODEL_TIMEOUT")
    }
    static func run(_ data: Data) async throws -> [String] {
        let cases = try JSONSerialization.jsonObject(with:data) as! [[String:Any]]
        var receipts:[String] = []
        for row in cases {
            let id = row["id"] as! String, valid = row["valid"] as! Bool
            var parsed: KGPolicySnapshot?
            do { parsed = try KGPolicySnapshot.decode(row["envelope"] as! [String:Any]) } catch { precondition(!valid, id) }
            precondition((parsed != nil) == valid, id)
            if let parsed {
                precondition(parsed.ready == row["ready"] as! Bool, id)
                precondition(parsed.current("TERMS")?.id == row["currentTerms"] as? String, id)
                if parsed.ready {
                    let body = try parsed.consentBody(parsed.requirements.requiredGrantKinds)
                    precondition((body["consents"] as! [[String:String]]).map{$0["kind"]!} == ["TERMS","PRIVACY_CONSENT"])
                    precondition(body["expectedPolicyRevision"] as? String == parsed.policyRevision)
                }
            }
            receipts.append("snapshot-"+id)
        }
        let base = cases.first!["envelope"] as! [String:Any]
        let transport = KGPolicyLocalTransport(base)
        let model = KGAuthModel(repository:KGAuthRepository(transport:transport),sessions:KGRepairSession())
        model.start();try await wait(model);model.handle(KGAuthEvent(action:.OPEN,key:"E2_TERMS"));try await wait(model)
        model.handle(KGAuthEvent(action:.CHANGE_ALL_CONSENTS,value:"true"));precondition(model.state.canContinue)
        // Spaces in operator and future server-time/effective date do not override server permission.
        precondition(model.state.documents[.TERMS]?.canConsent == true)
        receipts.append("model-server-authority-no-local-clock-or-trim-veto")
        let before = transport.calls.count;model.refreshPolicy();try await wait(model)
        precondition(model.state.canContinue && transport.calls.count == before+1)
        receipts.append("model-resume-fresh-no-store-same-revision-retains")
        model.handle(KGAuthEvent(action:.OPEN_DOCUMENT,key:"TERMS"));try await wait(model)
        precondition(model.state.documents[.TERMS]?.body == base["body"] as? String)
        model.back();try await wait(model);precondition(model.state.canContinue)
        receipts.append("model-detail-and-return-fresh-single-snapshot")
        transport.response = cases.first{$0["id"] as? String == "revision-changed"}!["envelope"] as! [String:Any]
        model.handle(KGAuthEvent(action:.SUBMIT_CONSENTS));try await wait(model)
        precondition(!model.state.canContinue && model.state.accepted == ["age14"] && model.state.error.contains("정책이 변경"))
        precondition(!transport.calls.contains{$0.0 == "POST"});receipts.append("model-final-fresh-revision-change-clear-no-replay")
        model.handle(KGAuthEvent(action:.CHANGE_ALL_CONSENTS,value:"true"))
        transport.response = cases.first{$0["id"] as? String == "same-revision-hash-changed"}!["envelope"] as! [String:Any]
        model.refreshPolicy();try await wait(model);precondition(!model.state.canContinue)
        receipts.append("model-raw-hash-change-clears")
        transport.response = [:];model.refreshPolicy();try await wait(model)
        precondition(!model.state.canContinue && !model.state.policyReady && model.snapshot == nil)
        receipts.append("model-missing-failclosed-retry")
        transport.response=base;model.refreshPolicy();try await wait(model);precondition(model.snapshot != nil)
        transport.slow=true;model.handle(KGAuthEvent(action:.OPEN_DOCUMENT,key:"TERMS"));try await Task.sleep(for:.milliseconds(20));model.back()
        try await Task.sleep(for:.milliseconds(350));precondition(model.state.screen == .E2_TERMS && !model.state.busy)
        receipts.append("model-cancel-epoch-late-snapshot-no-navigation")
        transport.slow=false;transport.reject=true
        let repo=KGAuthRepository(transport:transport), snap=try KGPolicySnapshot.decode(base)
        for operation in ["signup","grant"] {
            let count=transport.calls.filter{$0.0=="POST"}.count
            do {
                if operation=="signup" { _ = try await repo.signup(["name":"보존 이름","email":"test@example.invalid","age14Confirmed":true,"expertRequested":false,"registrationTicket":"local-only"],snapshot:snap,kinds:snap.requirements.requiredGrantKinds) }
                else { _ = try await repo.recordConsents("test-only",snapshot:snap,kinds:snap.requirements.requiredGrantKinds) }
                preconditionFailure("expected conflict")
            } catch let e as KGAuthAPIError { precondition(e.code=="POLICY_VERSION_CHANGED" && e.requestContext == .private) }
            precondition(transport.calls.filter{$0.0=="POST"}.count == count+1)
            precondition(transport.calls.last!.2?["expectedPolicyRevision"] as? String == snap.policyRevision)
            receipts.append("repository-"+operation+"-bound-revision-conflict-single-send")
        }
        model.failure(KGAuthAPIError(status:409,code:"POLICY_VERSION_CHANGED",requestContext:.private));try await wait(model)
        precondition(model.state.accepted == ["age14"] && model.state.error.contains("정책이 변경"))
        receipts.append("model-private-revision-rejection-refresh-no-post")
        transport.response=base
        model.handle(KGAuthEvent(action:.BROWSE));model.enter();model.handle(KGAuthEvent(action:.OPEN,key:"E2_TERMS"));try await wait(model)
        model.handle(KGAuthEvent(action:.CHANGE_ALL_CONSENTS,value:"true"));precondition(model.state.canContinue)
        transport.response=cases.first{$0["id"] as? String == "revision-changed"}!["envelope"] as! [String:Any]
        let reentryBefore=transport.calls.count;model.refreshPolicy();try await wait(model)
        precondition(transport.calls.count==reentryBefore+1 && model.state.accepted == ["age14"] && !model.state.canContinue)
        transport.response=base;model.refreshPolicy();try await wait(model)
        model.handle(KGAuthEvent(action:.CHANGE_ALL_CONSENTS,value:"true"));model.handle(KGAuthEvent(action:.OPEN_DOCUMENT,key:"TERMS"));try await wait(model)
        transport.response=cases.first{$0["id"] as? String == "revision-changed"}!["envelope"] as! [String:Any]
        let documentBefore=transport.calls.count;model.refreshPolicy();try await wait(model)
        precondition(transport.calls.count==documentBefore+1 && model.state.accepted == ["age14"] && model.state.screen == .TERMS_DOC)
        receipts.append("model-browsing-return-resume-current-refresh")
        return receipts
    }
}
#if POLICY_HOST_CHECKS
@main struct KGPolicyHostChecks {
    @MainActor static func main() async throws {
        let rows=try await KGPolicyChecks.run(Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))
        for row in rows { print("CASE " + row + " PASS") }; print("PASS POLICY_CASES \(rows.count)")
    }
}
#endif
