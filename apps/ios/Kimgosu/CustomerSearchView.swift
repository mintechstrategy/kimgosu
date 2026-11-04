import SwiftUI

/// 고객 거래 흐름의 공통 문구 스타일. A1과 같은 Pretendard·토큰을 그대로 쓴다.
func customerCopy(_ text: String, size: CGFloat = 14, bold: Bool = false, color: Color = DesignTokens.navy,
                  semibold: Bool = false, align: TextAlignment = .leading) -> some View {
    Text(text)
        .font(.custom(semibold ? "Pretendard-SemiBold" : (bold ? "Pretendard-Bold" : "Pretendard-Regular"), size: size, relativeTo: .body))
        .foregroundStyle(color).multilineTextAlignment(align)
}

func customerWon(_ amount: Int) -> String {
    let formatter = NumberFormatter(); formatter.numberStyle = .decimal
    return (formatter.string(from: NSNumber(value: amount)) ?? String(amount)) + "원"
}

struct KGCustomerExpertCard: Identifiable, Equatable {
    let id: String
    let nickname: String
    let introduction: String
    let activityRegion: String
    let serviceCount: Int
    let fromPrice: Int?
}

enum KGCustomerSearchState: Equatable {
    case loading
    case empty
    case failed(network: Bool, code: String)
    case ready([KGCustomerExpertCard])
}

@MainActor final class KGCustomerSearchModel: ObservableObject {
    @Published private(set) var state: KGCustomerSearchState = .loading
    @Published private(set) var nextCursor: String?
    @Published private(set) var loadingMore = false
    @Published private(set) var moreFailed = false
    private let transport: KGAuthTransport
    private var task: Task<Void, Never>?

    init(transport: KGAuthTransport = KGMembershipHTTP()) { self.transport = transport }

    func load(category: String?) {
        task?.cancel()
        state = .loading
        nextCursor = nil
        moreFailed = false
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let json = try await self.transport.request("GET", Self.searchPath(category), token: nil, body: nil)
                if Task.isCancelled { return }
                self.nextCursor = json["nextCursor"] as? String
                let experts = Self.decode(json)
                self.state = experts.isEmpty ? .empty : .ready(experts)
            } catch {
                if Task.isCancelled { return }
                if let api = error as? KGAuthAPIError, !KGNetworkFailure.isNetwork(error) {
                    self.state = .failed(network: false, code: api.code)
                } else if KGNetworkFailure.isNetwork(error) {
                    self.state = .failed(network: true, code: "NETWORK_UNAVAILABLE")
                } else {
                    self.state = .failed(network: false, code: "INVALID_API_RESPONSE")
                }
            }
        }
    }

    /// 첫 페이지를 지우지 않고 서버 커서 다음 페이지를 뒤에 붙인다.
    func loadMore(category: String?) {
        guard let cursor = nextCursor, case .ready(let loaded) = state, !loadingMore else { return }
        loadingMore = true
        moreFailed = false
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.loadingMore = false }
            do {
                let json = try await self.transport.request("GET", Self.searchPath(category, cursor: cursor), token: nil, body: nil)
                self.nextCursor = json["nextCursor"] as? String
                if case .ready(let current) = self.state { self.state = .ready(current + Self.decode(json)) }
                else { self.state = .ready(loaded + Self.decode(json)) }
            } catch {
                self.moreFailed = true
            }
        }
    }

    static func searchPath(_ category: String?, cursor: String? = nil) -> String {
        var path = "/v1/experts?limit=20"
        if let category, !category.isEmpty, let encoded = category.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&category=" + encoded
        }
        if let cursor {
            // 서버 커서는 base64url이라 그대로 쿼리에 넣어도 안전하다.
            path += "&cursor=" + cursor
        }
        return path
    }

    static func decode(_ json: [String: Any]) -> [KGCustomerExpertCard] {
        guard let rows = json["experts"] as? [[String: Any]] else { return [] }
        return rows.compactMap { row in
            guard let id = row["expertId"] as? String else { return nil }
            return KGCustomerExpertCard(
                id: id,
                nickname: row["nickname"] as? String ?? "",
                introduction: row["introduction"] as? String ?? "",
                activityRegion: row["activityRegion"] as? String ?? "",
                serviceCount: row["serviceCount"] as? Int ?? 0,
                fromPrice: row["fromPrice"] as? Int)
        }
    }
}

struct KGCustomerSearchView: View {
    let category: String?
    let onBack: () -> Void
    let onOpenExpert: (String, String) -> Void
    let onClearCategory: () -> Void
    @StateObject private var model = KGCustomerSearchModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                customerCopy("고수 찾기", size: 22, bold: true).accessibilityIdentifier("customer-search-title")
                Spacer()
                Button("닫기") { onBack() }.frame(minHeight: 44).accessibilityIdentifier("customer-search-close")
            }.padding(.horizontal, 20).padding(.top, 8)
            HStack(spacing: 8) {
                categoryChip("전체", selected: category == nil) { onClearCategory() }
                    .accessibilityIdentifier("customer-category-all")
                if let category { categoryChip(category, selected: true) { } }
            }.padding(.horizontal, 20).padding(.top, 8)
            content.padding(.top, 8)
            Spacer(minLength: 0)
        }
        .background(Color.white)
        .task(id: category) { model.load(category: category) }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                customerCopy("고수를 불러오는 중입니다…", color: DesignTokens.muted)
                Spacer(minLength: 0)
            }.padding(20).accessibilityIdentifier("customer-search-loading")
        case .empty:
            VStack(alignment: .leading, spacing: 6) {
                customerCopy("조건에 맞는 고수가 없습니다.", bold: true)
                customerCopy("다른 카테고리로 찾아보세요.", size: 13, color: DesignTokens.muted)
                Button("전체 보기") { onClearCategory() }.frame(minHeight: 44)
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border)).padding(.horizontal, 20)
                .accessibilityIdentifier("customer-search-empty")
        case .failed(let network, let code):
            customerFailure(network: network, code: code, retry: { model.load(category: category) })
        case .ready(let experts):
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(experts) { expert in
                        Button { onOpenExpert(expert.id, expert.nickname) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    customerCopy(expert.nickname.isEmpty ? "고수" : expert.nickname, size: 16, bold: true)
                                    Spacer()
                                    if let price = expert.fromPrice { customerCopy(customerWon(price) + "부터", size: 13, semibold: true) }
                                }
                                let meta = [expert.activityRegion, "서비스 \(expert.serviceCount)개"].filter { !$0.isEmpty }
                                if !meta.isEmpty { customerCopy(meta.joined(separator: " · "), size: 12, color: DesignTokens.muted) }
                                if !expert.introduction.isEmpty { customerCopy(expert.introduction, size: 13, color: DesignTokens.muted) }
                            }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                        }.buttonStyle(.plain).accessibilityIdentifier("expert-card-\(expert.id)")
                    }
                    if model.nextCursor != nil {
                        Button { model.loadMore(category: category) } label: {
                            customerCopy(model.loadingMore ? "불러오는 중…"
                                        : (model.moreFailed ? "더 불러오지 못했습니다. 다시 시도" : "더 보기"),
                                        size: 13, semibold: true)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .disabled(model.loadingMore)
                        .accessibilityIdentifier("customer-search-more")
                    }
                }.padding(.horizontal, 20)
            }.accessibilityIdentifier("customer-search-results-list")
        }
    }

    private func categoryChip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            customerCopy(label, size: 13, semibold: selected)
                .padding(.horizontal, 14).frame(minHeight: 44)
                .background(DesignTokens.soft, in: Capsule())
                .overlay(Capsule().stroke(selected ? DesignTokens.navy : DesignTokens.border))
        }.buttonStyle(.plain)
    }
}

@ViewBuilder func customerFailure(network: Bool, code: String, retry: @escaping () -> Void) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        customerCopy(network ? "네트워크에 연결할 수 없습니다." : "정보를 불러오지 못했습니다.", bold: true)
            .accessibilityIdentifier(network ? "customer-network-failure" : "customer-error")
        customerCopy(network ? "연결을 확인하고 다시 시도해주세요." : "잠시 후 다시 시도해주세요. (\(code))", size: 13, color: DesignTokens.muted)
        Button("다시 시도") { retry() }.frame(minHeight: 44).accessibilityIdentifier("customer-retry")
    }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border)).padding(.horizontal, 20)
}

