import SwiftUI
import UIKit

private let navy = Color(red: 11/255, green: 30/255, blue: 53/255)
private let lime = Color(red: 197/255, green: 251/255, blue: 31/255)
private let soft = Color(red: 239/255, green: 248/255, blue: 216/255)
private let muted = Color(red: 82/255, green: 98/255, blue: 119/255)
private let brandBorder = Color(red: 214/255, green: 223/255, blue: 232/255)

struct HomeItem: Decodable, Sendable { let label: String; let icon: String }
struct HomeContent: Decodable, Sendable {
    let screenId, designVersion, brand, introduction, search, quoteCopy, quoteAction: String
    let recentTitle, registerCopy, registerAction, popularTitle, historyTitle, historyEmpty: String
    let unavailable, scopeNotice: String
    let popularTabs: [String]
    let categories, navigation: [HomeItem]
}

@MainActor final class LaunchModel: ObservableObject {
    @Published var home: HomeContent?
    @Published var entered = false
    @Published var failed = false
    @Published var apiStatus = "연결 확인 중"
    private var started = false
    private var probeTask: Task<Void, Never>?
    var holdSplash: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--hold-splash")
        #else
        false
        #endif
    }
    var verifyAPI: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--verify-api")
        #else
        false
        #endif
    }
    func record(_ state: String) {
        #if DEBUG
        let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("launch-events.jsonl")
        let item: [String: Any] = ["state": state, "uptimeMs": ProcessInfo.processInfo.systemUptime * 1000]
        if let line = try? JSONSerialization.data(withJSONObject: item) {
            var all = (try? Data(contentsOf: file)) ?? Data()
            all.append(line); all.append(Data("\n".utf8)); try? all.write(to: file, options: .atomic)
        }
        #endif
    }
    func prepare() async {
        guard !started else { return }
        started = true
        do {
            guard let url = Bundle.main.url(forResource: "home", withExtension: "json", subdirectory: "MobileAssets") else { throw CocoaError(.fileNoSuchFile) }
            let content = try await Task.detached(priority: .userInitiated) {
                try JSONDecoder().decode(HomeContent.self, from: Data(contentsOf: url))
            }.value
            guard content.categories.count == 8, content.navigation.count == 5 else { throw CocoaError(.coderReadCorrupt) }
            home = content
            if !holdSplash { try await Task.sleep(for: .seconds(3)); entered = true }
            // A splash-scoped .task is cancelled when the main view replaces it.
            // Keep the non-blocking regression request owned by the app model instead.
            if verifyAPI { probeTask = Task { await probe() } }
        } catch { failed = true }
    }
    func retry() async { started = false; failed = false; await prepare() }
    private func probe() async {
        #if DEBUG
        guard KGEnvironment.isConfigured, let url = URL(string: KGEnvironment.apiBaseURL + "/health") else {
            apiStatus = "연결 주소가 설정되지 않았습니다 · 메인은 계속 이용할 수 있습니다"
            let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("api-receipt.json")
            let receipt: [String: Any] = ["platform": "iOS", "url": NSNull(), "observedAt": ISO8601DateFormatter().string(from: Date()),
                                          "status": "UNAVAILABLE", "failureInjection": "NONE", "errorType": "KGEnvironment", "errorCode": "API_BASE_URL_UNAVAILABLE"]
            if let data = try? JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: file, options: .atomic) }
            return
        }
        let endpoint = url.absoluteString
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 10
        let offline = ProcessInfo.processInfo.arguments.contains("--offline")
        if offline { config.protocolClasses = [OfflineProtocol.self] }
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        var receipt: [String: Any] = ["platform": "iOS", "url": endpoint, "observedAt": ISO8601DateFormatter().string(from: Date()), "transportBlocked": offline,
                                    "failureInjection": offline ? "URL_LOADING_FAILURE_BEFORE_REMOTE_IO" : "NONE"]
        do {
            let (data, response) = try await session.data(from: URL(string: endpoint)!)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let ray = http.value(forHTTPHeaderField: "cf-ray"), !ray.isEmpty,
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let release = body["release"] as? String,
                  body["status"] as? String == "ok", body["scope"] as? String == "diagnostic-only",
                  release.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { throw URLError(.badServerResponse) }
            receipt.merge(["status": "PASS", "httpStatus": 200, "cfRay": ray, "release": release]) { _, new in new }
            apiStatus = "연결 확인 완료"
        } catch {
            receipt["status"] = "UNAVAILABLE"
            receipt["errorType"] = String(describing: type(of: error))
            receipt["errorCode"] = (error as NSError).code
            apiStatus = "연결 불가 · 메인은 계속 이용할 수 있습니다"
        }
        let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("api-receipt.json")
        if let data = try? JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: file, options: .atomic) }
        #endif
    }
}
#if DEBUG
// Deterministic app-transport denial, not a simulated success or a host network toggle.
final class OfflineProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() { }
}
#endif

@main struct KimgosuApp: App {
    @StateObject private var model = LaunchModel()
    @StateObject private var auth = KGAuthModel()
    var body: some Scene {
        WindowGroup {
            Group {
                if model.failed {
                    VStack(spacing: 20) {
                        copy("앱 화면을 준비하지 못했습니다.")
                        Button("다시 시도") { Task { await model.retry() } }
                    }.padding(24)
                } else if !model.entered {
                    GeometryReader { geometry in
                        Image(uiImage: UIImage(named: "MobileAssets/splash.jpg") ?? UIImage())
                            .resizable().scaledToFit().frame(width: geometry.size.width, height: geometry.size.height)
                            .accessibilityLabel("김고수 시작 화면").accessibilityIdentifier("splash-image")
                    }.background(Color.white).ignoresSafeArea()
                        .task {
                            model.record("splash-appeared")
                            await Task.yield()
                            await model.prepare()
                        }
                } else if let home = model.home {
                    KGAuthHost(model: auth) {
                        HomeView(home: home, apiStatus: model.verifyAPI ? model.apiStatus : nil,
                            onProtected: { auth.enter(KGReturnTarget(targetId: $0)) },
                            onPolicy: { auth.handle(KGAuthEvent(action: .OPEN_DOCUMENT, key: $0)) })
                    }
                        .onAppear { model.record("main-appeared") }
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.white)
                .preferredColorScheme(.light).tint(navy)
        }
    }
}

private func copy(_ text: String, size: CGFloat = 14, bold: Bool = false, color: Color = navy, semibold: Bool = false) -> some View {
    Text(text).font(.custom(semibold ? "Pretendard-SemiBold" : (bold ? "Pretendard-Bold" : "Pretendard-Regular"), size: size, relativeTo: .body)).foregroundStyle(color)
}
private func asset(_ name: String, size: CGFloat) -> some View {
    Image(uiImage: UIImage(named: "MobileAssets/" + name) ?? UIImage()).resizable().scaledToFit()
        .frame(width: size, height: size).accessibilityHidden(true)
}

struct HomeView: View {
    let home: HomeContent
    let apiStatus: String?
    let onProtected: (String) -> Void
    let onPolicy: (String) -> Void
    @State private var notice: String?
    @State private var popular = 0
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            copy(home.brand, size: 23, bold: true)
                            Capsule().fill(lime).frame(width: 26, height: 3)
                        }
                        Spacer()
                        Button { onProtected("알림") } label: {
                            asset("notification.png", size: 23).frame(width: 44, height: 44)
                        }.accessibilityLabel("알림")
                    }.padding(.top, 8)
                    copy(home.introduction, size: 20, bold: true).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity).padding(.top, 20).accessibilityIdentifier("main-introduction")
                    Button { notice = "검색" } label: {
                        HStack(spacing: 14) { asset("nav_1.png", size: 20); copy(home.search, size: 16, color: muted); Spacer(minLength: 0) }
                            .padding(14).frame(minHeight: 48).overlay(RoundedRectangle(cornerRadius: 6).stroke(brandBorder))
                    }.padding(.top, 16).accessibilityIdentifier("search")
                    GeometryReader { geometry in
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .top, spacing: 8) {
                                ForEach(0..<5, id: \.self) { column in
                                    VStack(spacing: 10) {
                                        ForEach(0..<2, id: \.self) { row in
                                            let item = home.categories[(column * 2 + row) % 8]
                                            Button { notice = item.label } label: {
                                                VStack(spacing: 6) {
                                                    asset(item.icon, size: 48)
                                                    copy(item.label, size: 12).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                                                }.frame(width: (geometry.size.width - 32) / 4.5, alignment: .top).frame(minHeight: 90, alignment: .top).padding(.top, 4)
                                            }.accessibilityHidden(column == 4)
                                        }
                                    }
                                }
                            }
                        }.accessibilityIdentifier("categories")
                            .mask {
                                HStack(spacing: 0) {
                                    Color.black
                                    LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing).frame(width: 24)
                                }
                            }
                    }.frame(height: 208).padding(.top, 16)
                    banner(home.quoteCopy, action: home.quoteAction)
                    section(home.recentTitle, message: home.unavailable)
                    banner(home.registerCopy, action: home.registerAction)
                    copy(home.popularTitle, size: 19, bold: true).accessibilityAddTraits(.isHeader).padding(.top, 20)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(home.popularTabs.enumerated()), id: \.offset) { index, title in
                                Button { popular = index } label: {
                                    copy(title).padding(.horizontal, 14).frame(minHeight: 36)
                                        .background(popular == index ? soft : Color.white, in: Capsule())
                                        .overlay(Capsule().stroke(brandBorder))
                                }.frame(minHeight: 44).accessibilityAddTraits(popular == index ? .isSelected : [])
                            }
                        }
                    }.padding(.top, 8)
                    empty(home.unavailable)
                    section(home.historyTitle, message: home.historyEmpty)
                    Button("로그인/가입 · 회원관리") { onProtected("마이페이지") }.frame(minHeight: 44)
                    Button("서비스 운영정책") { onPolicy("OPERATIONS") }.frame(minHeight: 44)
                    Button("개인정보 처리방침") { onPolicy("PRIVACY_POLICY") }.frame(minHeight: 44)
                    copy("소셜 로그인·문자 인증은 준비 중이며, 공개 탐색은 계속 이용할 수 있습니다.", size: 12, color: muted).padding(.vertical, 24)
                    if let apiStatus { copy(apiStatus, size: 12, color: muted).padding(.bottom, 16).accessibilityIdentifier("api-status") }
                }.padding(.horizontal, 20)
            }.accessibilityIdentifier("main-scroll")
            Rectangle().fill(brandBorder).frame(height: 1)
            HStack(spacing: 0) {
                ForEach(Array(home.navigation.enumerated()), id: \.offset) { index, item in
                    Button { if index != 0 { open(item.label) } } label: {
                        VStack(spacing: 3) {
                            asset(item.icon, size: 26)
                            copy(item.label, size: 11, bold: index == 0, color: index == 0 ? navy : muted)
                        }.frame(maxWidth: .infinity, minHeight: 58)
                            .background(index == 0 ? soft : Color.white, in: RoundedRectangle(cornerRadius: 8)).padding(.horizontal, 4)
                    }.accessibilityIdentifier("nav-\(index)").accessibilityAddTraits(index == 0 ? .isSelected : [])
                }
            }.padding(.vertical, 5)
        }.background(Color.white)
            .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button("확인", role: .cancel) { notice = nil }
            } message: { Text("이 기능은 다음 개발 단계에서 연결됩니다. 공개 탐색과 회원·정책 화면을 이용할 수 있습니다.") }
    }
    private func open(_ title: String) {
        if ["알림", "마이페이지", "마이", "내정보", "견적요청", "서비스등록", "채팅", "원장"].contains(title) || title.contains("요청") || title.contains("등록") { onProtected(title) } else { notice = title }
    }
    private func banner(_ text: String, action: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            copy(text, size: 15, semibold: true).fixedSize(horizontal: false, vertical: true)
            Button { open(action) } label: {
                HStack { Spacer(); copy(action, semibold: true); Image(systemName: "arrow.right") }.frame(minHeight: 44)
            }
        }.padding(14).background(Color(white: 0.957), in: RoundedRectangle(cornerRadius: 6)).padding(.top, 18)
    }
    private func section(_ title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            copy(title, size: 19, bold: true).accessibilityAddTraits(.isHeader).padding(.top, 20)
            empty(message)
        }
    }
    private func empty(_ message: String) -> some View {
        copy(message, color: muted).frame(maxWidth: .infinity, alignment: .leading).padding(20)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(brandBorder)).padding(.top, 13)
    }
}
