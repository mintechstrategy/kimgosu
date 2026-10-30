import SwiftUI

@main
struct KimgosuDiagnosticApp: App {
    var body: some Scene { WindowGroup { DiagnosticView() } }
}
struct DiagnosticView: View {
    @State private var status = "API 연결 확인 중"
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("김고수 개발환경 점검").font(.largeTitle).bold()
            Text("iOS 진단 앱 · 제품 화면 아님").foregroundStyle(.secondary)
            Text(status).accessibilityIdentifier("api-status")
            Button("다시 확인") { Task { await check() } }
        }.padding(32).task { await check() }
    }
    @MainActor func check() async {
        do {
            let url = URL(string: "https://api-dev-kimgosu.mintech.ai/health")!
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let ray = http.value(forHTTPHeaderField: "cf-ray"),
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let release = body["release"] as? String else { throw URLError(.badServerResponse) }
            status = "API 연결 성공\nCloudflare → Railway\n" + release.prefix(12)
            let receipt: [String: Any] = ["status": "PASS", "httpStatus": 200, "cfRay": ray, "release": release, "platform": "iOS Simulator", "observedAt": ISO8601DateFormatter().string(from: Date())]
            let path = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("api-receipt.json")
            try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: path)
        } catch { status = "연결 실패: " + error.localizedDescription }
    }
}
