import SwiftUI

struct KGCustomerServiceItem: Identifiable, Equatable {
    let id: String
    let title: String
    let category: String
    let priceType: String
    let basePrice: Int?
    let imageUrl: String?
}

struct KGCustomerPublicReview: Identifiable, Equatable {
    let id: String
    let rating: Int
    let body: String
    let authorNickname: String
}

struct KGCustomerExpertDetail: Equatable {
    let nickname: String
    let introduction: String
    let career: String
    let activityRegion: String
    let services: [KGCustomerServiceItem]
    var reviews: [KGCustomerPublicReview] = []
    var reviewCount: Int = 0
    var reviewAverage: Double?
}

enum KGCustomerExpertState: Equatable {
    case loading
    case empty(String)
    case failed(network: Bool, code: String)
    case ready(detail: KGCustomerExpertDetail, reviewsUnavailable: Bool)
}

enum KGCustomerStartState: Equatable {
    case idle, busy
    case failed(String)
}

@MainActor final class KGCustomerExpertModel: ObservableObject {
    @Published private(set) var state: KGCustomerExpertState = .loading
    @Published private(set) var start: KGCustomerStartState = .idle
    @Published private(set) var loadingMoreReviews = false
    @Published private(set) var reviewsMoreFailed = false
    private let transport: KGAuthTransport
    private let sessions: KGSessionStorage
    private var task: Task<Void, Never>?

    init(transport: KGAuthTransport = KGMembershipHTTP(), sessions: KGSessionStorage = KGSecureSession()) {
        self.transport = transport
        self.sessions = sessions
    }

    func load(expertId: String) {
        task?.cancel()
        state = .loading
        start = .idle
        reviewsMoreFailed = false
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let json = try await self.transport.request("GET", "/v1/experts/" + expertId, token: nil, body: nil)
                var detail = try Self.decodeDetail(json, expertId: expertId)
                if Task.isCancelled { return }
                var reviewsUnavailable = false
                do {
                    let reviews = try await self.transport.request("GET", "/v1/experts/" + expertId + "/reviews?limit=20", token: nil, body: nil)
                    detail.reviews = Self.decodeReviews(reviews)
                    if let summary = reviews["summary"] as? [String: Any] {
                        detail.reviewCount = summary["count"] as? Int ?? detail.reviews.count
                        detail.reviewAverage = summary["average"] as? Double
                    }
                } catch {
                    if Task.isCancelled { return }
                    reviewsUnavailable = true
                }
                self.state = .ready(detail: detail, reviewsUnavailable: reviewsUnavailable)
            } catch {
                if Task.isCancelled { return }
                if let api = error as? KGAuthAPIError, api.status == 404 {
                    self.state = .empty("고수 정보를 찾을 수 없습니다.")
                } else if KGNetworkFailure.isNetwork(error) {
                    self.state = .failed(network: true, code: "NETWORK_UNAVAILABLE")
                } else if let api = error as? KGAuthAPIError {
                    self.state = .failed(network: false, code: api.code)
                } else {
                    self.state = .failed(network: false, code: "INVALID_API_RESPONSE")
                }
            }
        }
    }

    /// 서버가 준 offset 다음 후기부터 붙인다. 이미 받은 후기는 다시 요청하지 않는다.
    func loadMoreReviews(expertId: String) {
        guard case .ready(let detail, let reviewsUnavailable) = state, !reviewsUnavailable,
              detail.reviews.count < detail.reviewCount, !loadingMoreReviews else { return }
        loadingMoreReviews = true
        reviewsMoreFailed = false
        let offset = detail.reviews.count
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.loadingMoreReviews = false }
            do {
                let json = try await self.transport.request(
                    "GET", "/v1/experts/" + expertId + "/reviews?limit=20&offset=\(offset)", token: nil, body: nil)
                guard case .ready(var latest, let unavailable) = self.state else { return }
                latest.reviews += Self.decodeReviews(json)
                self.state = .ready(detail: latest, reviewsUnavailable: unavailable)
            } catch {
                self.reviewsMoreFailed = true
            }
        }
    }

    /// 원장 생성은 서버가 (고수, 고객) 조합에 하나만 유지한다. 이미 있으면 같은 id가 200으로 온다.
    func startDeal(expertId: String, onStarted: @escaping (String, String) -> Void) {
        guard start != .busy else { return }
        guard let token = (try? sessions.read()) ?? nil else {
            start = .failed("세션이 만료되었습니다. 다시 로그인해주세요.")
            return
        }
        let nickname: String = { if case .ready(let detail, _) = state { return detail.nickname }; return "" }()
        start = .busy
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let json = try await self.transport.request("POST", "/v1/ledgers", token: token, body: ["expertId": expertId])
                guard let id = json["id"] as? String else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
                self.start = .idle
                onStarted(id, nickname)
            } catch {
                if let api = error as? KGAuthAPIError {
                    self.start = .failed(api.status == 401 ? "세션이 만료되었습니다. 다시 로그인해주세요." : "거래를 시작하지 못했습니다. (\(api.code))")
                } else if KGNetworkFailure.isNetwork(error) {
                    self.start = .failed("네트워크에 연결할 수 없습니다.")
                } else {
                    self.start = .failed("거래를 시작하지 못했습니다. (INVALID_API_RESPONSE)")
                }
            }
        }
    }

    static func decodeDetail(_ json: [String: Any], expertId: String) throws -> KGCustomerExpertDetail {
        guard let expert = json["expert"] as? [String: Any] else { throw KGAuthAPIError(status: 0, code: "INVALID_API_RESPONSE") }
        let services = (json["services"] as? [[String: Any]] ?? []).compactMap { row -> KGCustomerServiceItem? in
            guard let id = row["id"] as? String else { return nil }
            let image = row["imageUrl"] as? String
            return KGCustomerServiceItem(id: id, title: row["title"] as? String ?? "",
                                         category: row["category"] as? String ?? "",
                                         priceType: row["priceType"] as? String ?? "",
                                         basePrice: row["basePrice"] as? Int,
                                         imageUrl: (image?.isEmpty == false) ? image : nil)
        }
        return KGCustomerExpertDetail(nickname: expert["nickname"] as? String ?? "",
                                      introduction: expert["introduction"] as? String ?? "",
                                      career: expert["career"] as? String ?? "",
                                      activityRegion: expert["activityRegion"] as? String ?? "",
                                      services: services)
    }

    static func decodeReviews(_ json: [String: Any]) -> [KGCustomerPublicReview] {
        (json["reviews"] as? [[String: Any]] ?? []).compactMap { row in
            guard let id = row["id"] as? String else { return nil }
            return KGCustomerPublicReview(id: id, rating: row["rating"] as? Int ?? 0,
                                          body: row["body"] as? String ?? "",
                                          authorNickname: row["authorNickname"] as? String ?? "")
        }
    }
}

struct KGCustomerExpertView: View {
    let expertId: String
    let onBack: () -> Void
    let onStartChat: (String, String) -> Void
    @StateObject private var model = KGCustomerExpertModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                customerCopy("고수 상세", size: 22, bold: true).accessibilityIdentifier("customer-expert-title")
                Spacer()
                Button("뒤로") { onBack() }.frame(minHeight: 44).accessibilityIdentifier("customer-expert-back")
            }.padding(.horizontal, 20).padding(.top, 8)
            content
            Spacer(minLength: 0)
        }
        .background(Color.white)
        .task(id: expertId) { model.load(expertId: expertId) }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                customerCopy("고수 정보를 불러오는 중입니다…", color: DesignTokens.muted)
                Spacer(minLength: 0)
            }.padding(20).accessibilityIdentifier("customer-expert-loading")
        case .empty(let message):
            customerCopy(message, color: DesignTokens.muted).padding(20)
        case .failed(let network, let code):
            customerFailure(network: network, code: code, retry: { model.load(expertId: expertId) })
        case .ready(let detail, let reviewsUnavailable):
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    customerCopy(detail.nickname.isEmpty ? "고수" : detail.nickname, size: 22, bold: true).padding(.top, 8)
                    if !detail.activityRegion.isEmpty {
                        customerCopy(detail.activityRegion, size: 13, color: DesignTokens.muted).padding(.top, 4)
                    }
                    if !detail.introduction.isEmpty {
                        customerCopy("소개", size: 17, bold: true).padding(.top, 22)
                        customerCopy(detail.introduction).padding(.top, 8)
                    }
                    if !detail.career.isEmpty {
                        customerCopy("경력", size: 17, bold: true).padding(.top, 20)
                        customerCopy(detail.career).padding(.top, 8)
                    }
                    customerCopy("서비스", size: 17, bold: true).padding(.top, 22)
                    if detail.services.isEmpty {
                        customerCopy("등록된 서비스가 없습니다.", size: 13, color: DesignTokens.muted).padding(.top, 8)
                    } else {
                        ForEach(detail.services) { service in serviceRow(service) }
                    }
                    customerCopy("후기", size: 17, bold: true).padding(.top, 22)
                    if reviewsUnavailable {
                        customerCopy("후기를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.", size: 13, color: DesignTokens.muted).padding(.top, 8)
                    } else if detail.reviews.isEmpty {
                        customerCopy("아직 후기가 없습니다.", size: 13, color: DesignTokens.muted)
                            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border)).padding(.top, 8)
                            .accessibilityIdentifier("customer-review-empty")
                    } else {
                        customerCopy("평점 " + averageText(detail.reviewAverage) + " · 후기 \(detail.reviewCount)개", size: 13, color: DesignTokens.muted)
                            .padding(.top, 8).accessibilityIdentifier("customer-review-summary")
                        ForEach(detail.reviews) { review in reviewRow(review) }
                        if detail.reviews.count < detail.reviewCount {
                            Button { model.loadMoreReviews(expertId: expertId) } label: {
                                customerCopy(model.loadingMoreReviews ? "불러오는 중…"
                                            : (model.reviewsMoreFailed ? "후기를 더 불러오지 못했습니다. 다시 시도" : "후기 더 보기"),
                                            size: 13, semibold: true)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }.buttonStyle(.plain)
                                .disabled(model.loadingMoreReviews)
                                .padding(.top, 8).accessibilityIdentifier("customer-reviews-more")
                        }
                    }
                    Button {
                        model.startDeal(expertId: expertId) { ledgerId, nickname in onStartChat(ledgerId, nickname) }
                    } label: {
                        customerCopy(model.start == .busy ? "거래를 시작하는 중…" : "거래 시작", color: .white, semibold: true)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(DesignTokens.navy, in: RoundedRectangle(cornerRadius: 6))
                    }.buttonStyle(.plain).disabled(model.start == .busy)
                        .padding(.top, 24).accessibilityIdentifier("customer-start-deal")
                    if case .failed(let message) = model.start {
                        customerCopy(message, size: 13).padding(.top, 8).accessibilityIdentifier("customer-start-error")
                    }
                }.padding(.horizontal, 20).padding(.bottom, 24)
            }
        }
    }

    private func serviceRow(_ service: KGCustomerServiceItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let raw = service.imageUrl {
                RemoteImage(url: raw, contentMode: .fill).frame(height: 160)
            }
            customerCopy(service.title.isEmpty ? service.category : service.title, size: 15, bold: true).padding(.top, 4)
            let price = service.basePrice.map { service.priceType == "NEGOTIABLE" ? "협의" : customerWon($0) }
            let meta = ([service.category].filter { !$0.isEmpty } + (price.map { [$0] } ?? []))
            if !meta.isEmpty { customerCopy(meta.joined(separator: " · "), size: 12, color: DesignTokens.muted) }
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border)).padding(.top, 8)
    }

    private func reviewRow(_ review: KGCustomerPublicReview) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            customerCopy("★ \(review.rating).0 · \(review.authorNickname.isEmpty ? "고객" : review.authorNickname)", size: 13, semibold: true)
            if !review.body.isEmpty { customerCopy(review.body, size: 13, color: DesignTokens.muted) }
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border)).padding(.top, 8)
    }

    private func averageText(_ value: Double?) -> String {
        guard let value else { return "-" }
        return String(format: "%.1f", value)
    }
}
