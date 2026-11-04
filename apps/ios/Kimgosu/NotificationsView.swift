import SwiftUI

struct KGInboxNotification: Identifiable, Equatable {
    let id: String
    let kind: String
    let title: String
    let body: String
    let createdAt: String?
    let read: Bool
}

enum KGInboxState: Equatable {
    case loading
    case empty
    case failed(network: Bool, code: String)
    case ready([KGInboxNotification])
}

/// 알림함 필터 칩. kind 값이 그대로 서버 쿼리 파라미터가 된다(nil은 전체).
let KGInboxFilters: [(label: String, kind: String?)] = [
    ("전체", nil), ("견적", "QUOTE"), ("완료", "AGREEMENT"), ("후기", "REVIEW"), ("신고", "REPORT"),
]

/// 알림 목록과 배지는 서버 값을 그대로 쓴다. 읽음 여부·읽지 않은 개수를
/// 클라이언트에서 세지 않는다(GET/POST 응답의 unreadCount가 유일한 근거).
@MainActor final class KGNotificationsModel: ObservableObject {
    @Published private(set) var state: KGInboxState = .loading
    @Published private(set) var filter: String?
    @Published private(set) var unreadCount: Int?
    @Published private(set) var readAllBusy = false
    @Published private(set) var readAllError: String?

    private let transport: KGAuthTransport
    private let sessions: KGSessionStorage
    private var task: Task<Void, Never>?

    init(transport: KGAuthTransport = KGMembershipHTTP(), sessions: KGSessionStorage = KGSecureSession()) {
        self.transport = transport
        self.sessions = sessions
    }

    func chooseFilter(_ kind: String?) {
        guard filter != kind else { return }
        filter = kind
        refresh()
    }

    func refresh() {
        guard let token = (try? sessions.read()) ?? nil else {
            state = .failed(network: false, code: "SESSION_REQUIRED")
            return
        }
        task?.cancel()
        state = .loading
        let kind = filter
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let path = "/v1/notifications" + (kind.map { "?kind=\($0)" } ?? "")
                let body = try await self.transport.request("GET", path, token: token, body: nil)
                self.apply(body)
            } catch {
                if let api = error as? KGAuthAPIError {
                    self.state = .failed(network: false, code: api.code)
                } else if KGNetworkFailure.isNetwork(error) {
                    self.state = .failed(network: true, code: "NETWORK_UNAVAILABLE")
                } else {
                    self.state = .failed(network: false, code: "INVALID_API_RESPONSE")
                }
            }
        }
    }

    private func apply(_ body: [String: Any]) {
        unreadCount = body["unreadCount"] as? Int ?? 0
        guard let rows = body["notifications"] as? [[String: Any]] else {
            state = .failed(network: false, code: "INVALID_API_RESPONSE")
            return
        }
        let items = rows.compactMap { row -> KGInboxNotification? in
            guard let id = row["id"] as? String, let kind = row["kind"] as? String,
                  let title = row["title"] as? String, let text = row["body"] as? String else { return nil }
            let createdAt = (row["createdAt"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return KGInboxNotification(id: id, kind: kind, title: title, body: text,
                                       createdAt: createdAt, read: !(row["readAt"] is NSNull) && row["readAt"] != nil)
        }
        state = items.isEmpty ? .empty : .ready(items)
    }

    func markAllRead() {
        guard !readAllBusy else { return }
        guard let token = (try? sessions.read()) ?? nil else {
            readAllError = "세션이 만료되었습니다. 다시 로그인해주세요."
            return
        }
        readAllBusy = true
        readAllError = nil
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                _ = try await self.transport.request("POST", "/v1/notifications/read-all", token: token, body: [:])
                self.unreadCount = 0
                self.readAllBusy = false
                // 다시 읽어 항목별 읽음 표시를 서버 값으로 맞춘다.
                self.refresh()
            } catch {
                self.readAllBusy = false
                if let api = error as? KGAuthAPIError {
                    self.readAllError = api.status == 401 ? "세션이 만료되었습니다. 다시 로그인해주세요."
                        : "모두 읽음 처리에 실패했습니다. (\(api.code))"
                } else if KGNetworkFailure.isNetwork(error) {
                    self.readAllError = "네트워크에 연결할 수 없습니다."
                } else {
                    self.readAllError = "모두 읽음 처리에 실패했습니다. (INVALID_API_RESPONSE)"
                }
            }
        }
    }
}

private let kgInboxTimeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "MM.dd HH:mm"
    return formatter
}()

private func inboxTime(_ iso: String?) -> String {
    guard let iso, let date = ISO8601DateFormatter().date(from: iso) else { return "" }
    return kgInboxTimeFormatter.string(from: date)
}

struct KGNotificationsView: View {
    @ObservedObject var model: KGNotificationsModel
    let onBack: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                customerCopy("알림", size: 23, bold: true).accessibilityIdentifier("inbox-title")
                Spacer()
                Button {
                    model.markAllRead()
                } label: {
                    customerCopy(model.readAllBusy ? "처리 중…" : "모두 읽음", semibold: true).frame(minHeight: 44)
                }.disabled(model.readAllBusy).accessibilityIdentifier("inbox-read-all")
                Button("닫기") { onBack() }.frame(minHeight: 44).accessibilityIdentifier("inbox-back")
            }.padding(.horizontal, 20).padding(.top, 8)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(KGInboxFilters, id: \.label) { item in
                        Button { model.chooseFilter(item.kind) } label: {
                            customerCopy(item.label, size: 13)
                                .padding(.horizontal, 14).frame(minHeight: 36)
                                .background(model.filter == item.kind ? DesignTokens.soft : Color.white,
                                            in: Capsule())
                                .overlay(Capsule().stroke(model.filter == item.kind ? DesignTokens.navy : DesignTokens.border))
                        }.buttonStyle(.plain).accessibilityIdentifier("inbox-filter-\(item.kind ?? "ALL")")
                    }
                }.padding(.horizontal, 20)
            }.padding(.top, 4)
            if let readAllError = model.readAllError {
                customerCopy(readAllError, size: 13).padding(.horizontal, 20).padding(.top, 6)
                    .accessibilityIdentifier("inbox-read-all-error")
            }
            content
        }.background(Color.white).task { model.refresh() }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            HStack(spacing: 10) {
                ProgressView().tint(DesignTokens.navy)
                customerCopy("알림을 불러오는 중…", size: 13, color: DesignTokens.muted)
            }.frame(maxWidth: .infinity, maxHeight: .infinity).accessibilityIdentifier("inbox-loading")
        case .empty:
            VStack(alignment: .leading, spacing: 6) {
                customerCopy("새 알림이 없습니다.", size: 15, bold: true)
                customerCopy("견적·완료·후기·신고 소식이 도착하면 여기에 표시됩니다.", size: 13, color: DesignTokens.muted)
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading).padding(24)
                .accessibilityIdentifier("inbox-empty")
        case .failed(let network, let code):
            VStack(alignment: .leading, spacing: 8) {
                customerCopy(code == "SESSION_REQUIRED" ? "로그인하면 알림을 볼 수 있습니다."
                             : (network ? "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
                                : "알림을 불러오지 못했습니다. (\(code))"))
                if code != "SESSION_REQUIRED" {
                    Button("다시 시도") { model.refresh() }.frame(minHeight: 44)
                        .accessibilityIdentifier("inbox-retry")
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading).padding(24)
                .accessibilityIdentifier(code == "SESSION_REQUIRED" ? "inbox-session" : (network ? "inbox-network" : "inbox-error"))
        case .ready(let items):
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(items) { item in
                        HStack(alignment: .top, spacing: 10) {
                            Circle().fill(item.read ? Color.clear : DesignTokens.navy)
                                .frame(width: 6, height: 6).padding(.top, 6)
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    customerCopy(item.title, size: 15, bold: !item.read)
                                    Spacer(minLength: 8)
                                    customerCopy(inboxTime(item.createdAt), size: 11, color: DesignTokens.muted)
                                }
                                customerCopy(item.body, size: 13, color: DesignTokens.muted)
                            }
                        }
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .background(item.read ? Color.white : DesignTokens.soft, in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                        .accessibilityIdentifier("inbox-row")
                    }
                }.padding(20)
            }.accessibilityIdentifier("inbox-list")
        }
    }
}
