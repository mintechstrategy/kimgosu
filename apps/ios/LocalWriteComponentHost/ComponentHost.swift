import SwiftUI

// Separate test-only host. Real HTTP to the owned loopback backend only; no OAuth UI/registration.
final class LocalNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
final class LocalWriteTransport: KGAuthTransport {
    let mode: String
    init(_ mode: String) { self.mode = mode }
    func control(_ path: String) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18980" + path)!)
        return try decodeMembershipResponse((response as! HTTPURLResponse).statusCode, data)
    }
    func request(_ method: String, _ path: String, token: String?, body: [String: Any]?) async throws -> [String: Any] {
        precondition(path.hasPrefix("/v1/"))
        if mode == "stale" && path == "/v1/auth/signup" { _ = try await control("/revision") }
        var req = URLRequest(url: URL(string: "http://127.0.0.1:18979" + path)!); req.httpMethod = method
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let token { req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let cfg = URLSessionConfiguration.ephemeral; cfg.urlCache = nil; cfg.timeoutIntervalForRequest = 8
        let session = URLSession(configuration: cfg, delegate: LocalNoRedirects(), delegateQueue: nil); defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: req); try Task.checkCancellation()
        let status = (response as! HTTPURLResponse).statusCode
        if mode == "lost" && path == "/v1/auth/signup" && status == 200 { throw URLError(.networkConnectionLost) }
        return try decodeMembershipResponse(status, data)
    }
}
@main struct LocalWriteComponentHost: App {
    @StateObject private var model: KGAuthModel
    private let transport: LocalWriteTransport
    private let mode: String
    private let traceRun = UUID().uuidString
    init() {
        let mode = ProcessInfo.processInfo.arguments.last ?? "normal"; self.mode = mode
        let transport = LocalWriteTransport(mode); self.transport = transport
        _model = StateObject(wrappedValue: KGAuthModel(repository: KGAuthRepository(transport: transport), sessions: KGSecureSession()))
    }
    var body: some Scene { WindowGroup {
        KGAuthView(state: model.state, onEvent: { event in
            if event.action == .CHANGE_INPUT && event.key == "phone" { trace(["event":"phone-input","sameValue":event.value == model.state.input("phone"),"length":event.value.count]) }
            model.handle(event)
        })
            .onReceive(model.$state) { s in
                if KGAuthSurfaces[s.screen]?.family == "sms" { trace(["event":"state","screen":s.screen.rawValue,"busy":s.busy,"smsAvailable":s.smsAvailable,"challengeActive":s.challengeActive,"remainingSeconds":s.remainingSeconds,"phoneValid":KGAuthInput.validPhone(s.input("phone")),"codeLength":s.input("code").count,"codeValid":KGAuthInput.validCode(s.input("code")),"canVerify":s.canVerify]) }
                if s.error.contains("UNKNOWN") { do { let stored = try KGSecureSession().read(); trace(["event":"unknown-securestore","readSucceeded":true,"hasStoredSession":stored != nil]) } catch { trace(["event":"unknown-securestore","readSucceeded":false]) } }
            }
            .task {
                var setupStage = "begin"
                do {
                    if mode == "cleanup" { try KGSecureSession().clear(); trace(["event":"cleanup","secureStorageCleared":true]); return }
                    if ["consent", "account"].contains(mode) {
                        model.start(); try await wait(); model.enter(); try await wait()
                        if mode == "consent" { model.handle(KGAuthEvent(action: .OPEN, key: "E2_TERMS")); try await wait() }
                    } else {
                        setupStage = "clear-test-host-secure-storage"; try KGSecureSession().clear()
                        setupStage = "local-provider-bootstrap"; let result = try await transport.control("/bootstrap")
                        setupStage = "normal-registration-result-consumer"; try model.acceptRegistrationResult(result)
                    }
                } catch {
                    let api = error as? KGAuthAPIError; let ns = error as NSError
                    model.state.error = "Test host setup failed: " + setupStage + " / " + (api?.code ?? ns.domain + ":" + String(ns.code))
                }
            }
    } }
    private func trace(_ value: [String: Any]) {
        // Test-only Boolean/length state receipts. No phone, OTP, ticket or bearer values.
        var row = value; row["runId"] = traceRun; row["mode"] = mode
        guard let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first, let data = try? JSONSerialization.data(withJSONObject: row, options: .sortedKeys) else { return }
        let file = directory.appendingPathComponent("local-state.jsonl")
        if !FileManager.default.fileExists(atPath: file.path) { FileManager.default.createFile(atPath: file.path, contents: nil) }
        if let h = try? FileHandle(forWritingTo: file) { defer { try? h.close() }; try? h.seekToEnd(); try? h.write(contentsOf: data + Data("\n".utf8)) }
    }
    @MainActor private func wait() async throws { for _ in 0..<150 { if !model.state.busy { return }; try await Task.sleep(for: .milliseconds(100)) }; throw URLError(.timedOut) }
}
