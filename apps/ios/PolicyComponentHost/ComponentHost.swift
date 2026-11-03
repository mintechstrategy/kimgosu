import SwiftUI

// TEST-ONLY separate bundle, not the shipping main app and not a login implementation.
@MainActor final class ComponentTransport: KGAuthTransport {
    let mode = ProcessInfo.processInfo.arguments.last ?? "ready"
    var lists=0, details=0
    func input(_ name:String) -> [String:Any] {
        let url=Bundle.main.url(forResource:name,withExtension:"json",subdirectory:"test-inputs")!
        return try! JSONSerialization.jsonObject(with:Data(contentsOf:url)) as! [String:Any]
    }
    func request(_ method:String,_ path:String,token:String?,body:[String:Any]?) async throws -> [String:Any] {
        precondition(method=="GET" && token==nil && path.contains("metadata=policy-v0.3"))
        if path.hasPrefix("/v1/policies/") {
            details+=1
            if mode=="retry" && details==1 { throw KGAuthAPIError(status:503,code:"POLICY_METADATA_UNAVAILABLE") }
            return input(mode=="retry" ? "draft":"ready")
        }
        if path.hasPrefix("/v1/policies?") { lists+=1 }
        var value=input(mode=="retry" ? "draft":"ready")
        if mode=="revision" && lists>=3 { var s=value["policySnapshot"] as! [String:Any];s["policyRevision"]="ps3-"+String(repeating:"b",count:64);value["policySnapshot"]=s }
        return value
    }
}
@main struct PolicyComponentHost: App {
    @StateObject private var model=KGAuthModel(repository:KGAuthRepository(transport:ComponentTransport()),sessions:KGRepairSession())
    var body: some Scene { WindowGroup {
        KGAuthView(state:model.state,onEvent:model.handle)
            .task { model.start();try? await KGPolicyChecks.wait(model);model.handle(KGAuthEvent(action:.OPEN,key:"E2_TERMS")) }
    } }
}
