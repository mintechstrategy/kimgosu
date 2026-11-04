import SwiftUI

/// 고수 받은 견적 · 원장 상세.
///
/// 서버가 모든 전이와 version을 결정한다. 이 화면은 `GET /v1/me/quotes`,
/// `POST /v1/ledgers/:id/quotes`, `POST /v1/quotes/:id/complete`의 응답만 그린다.
/// 금액·상태·완료 여부를 클라이언트에서 계산하지 않는다.
struct ExpertQuote: Identifiable, Equatable {
    let id, ledgerId, ledgerName, customerNickname, priceType, status, message: String
    let amount: Int
    let vatIncluded: Bool
    let version: Int
    let createdAt, expiresAt, acceptedAt, rejectedAt, expertConfirmedAt, customerConfirmedAt, completedAt: String?

    static func decode(_ o: [String: Any]) -> ExpertQuote? {
        guard let id = o["id"] as? String, let ledgerId = o["ledgerId"] as? String else { return nil }
        let amount: Int
        if let n = o["amount"] as? Int { amount = n }
        else if let d = o["amount"] as? Double { amount = Int(d) }
        else if let s = o["amount"] as? String, let d = Double(s) { amount = Int(d) }
        else { return nil }
        func text(_ key: String) -> String? {
            guard let value = o[key] as? String, !value.isEmpty else { return nil }
            return value
        }
        return ExpertQuote(
            id: id, ledgerId: ledgerId,
            ledgerName: o["ledgerName"] as? String ?? "",
            customerNickname: o["customerNickname"] as? String ?? "",
            priceType: o["priceType"] as? String ?? "TOTAL",
            status: o["status"] as? String ?? "",
            message: o["message"] as? String ?? "",
            amount: amount,
            vatIncluded: o["vatIncluded"] as? Bool ?? false,
            version: o["version"] as? Int ?? 1,
            createdAt: text("createdAt"), expiresAt: text("expiresAt"),
            acceptedAt: text("acceptedAt"), rejectedAt: text("rejectedAt"),
            expertConfirmedAt: text("expertConfirmedAt"), customerConfirmedAt: text("customerConfirmedAt"),
            completedAt: text("completedAt"))
    }
}

@MainActor final class ExpertQuotesModel: ObservableObject {
    enum LoadState {
        case loading
        case ready([ExpertQuote])
        case failed(network: Bool, code: String)
    }
    enum ActionState: Equatable {
        case idle, busy
        case done(String)
        case failed(network: Bool, code: String)
    }
    @Published private(set) var state: LoadState = .loading
    @Published private(set) var selected: ExpertQuote?
    @Published private(set) var filter: String?
    @Published private(set) var action = ActionState.idle
    private let transport: KGAuthTransport
    private let sessions: KGSessionStorage
    private var task: Task<Void, Never>?
    private var started = false

    init(transport: KGAuthTransport = KGMembershipHTTP(), sessions: KGSessionStorage = KGSecureSession()) {
        self.transport = transport
        self.sessions = sessions
    }

    func loadIfNeeded() {
        guard !started else { return }
        started = true
        refresh()
    }

    func select(_ quote: ExpertQuote?) {
        selected = quote
        action = .idle
    }

    func setFilter(_ status: String?) {
        guard filter != status else { return }
        filter = status
        refresh()
    }

    func refresh() {
        guard let token = try? sessions.read() else {
            state = .failed(network: false, code: "SESSION_REQUIRED")
            return
        }
        task?.cancel()
        state = .loading
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let path = "/v1/me/quotes" + (self.filter.map { "?status=\($0)" } ?? "")
                let body = try await self.transport.request("GET", path, token: token, body: nil)
                let rows = body["quotes"] as? [[String: Any]] ?? []
                if Task.isCancelled { return }
                self.state = .ready(rows.compactMap(ExpertQuote.decode))
            } catch {
                if error is CancellationError { return }
                self.state = .failed(network: KGNetworkFailure.isNetwork(error), code: Self.code(error))
            }
        }
    }

    func complete(_ quote: ExpertQuote) {
        mutate("완료 확인을 보냈습니다. 고객 확인 후 완료로 바뀝니다.",
               path: "/v1/quotes/\(quote.id)/complete", body: ["expectedVersion": quote.version])
    }

    func propose(_ quote: ExpertQuote, amount: Int, message: String, vatIncluded: Bool) {
        mutate("견적을 제시했습니다.", path: "/v1/ledgers/\(quote.ledgerId)/quotes",
               body: ["amount": amount, "message": message, "vatIncluded": vatIncluded])
    }

    private func mutate(_ done: String, path: String, body: [String: Any]) {
        guard let token = try? sessions.read() else {
            action = .failed(network: false, code: "SESSION_REQUIRED")
            return
        }
        action = .busy
        Task { [weak self] in
            guard let self else { return }
            do {
                let response = try await self.transport.request("POST", path, token: token, body: body)
                if let quote = ExpertQuote.decode(response) { self.selected = quote }
                self.action = .done(done)
                self.refresh()
            } catch {
                if error is CancellationError { return }
                self.action = .failed(network: KGNetworkFailure.isNetwork(error), code: Self.code(error))
            }
        }
    }

    private static func code(_ error: Error) -> String {
        if let api = error as? KGAuthAPIError { return api.code }
        return KGNetworkFailure.isNetwork(error) ? "NETWORK_UNAVAILABLE" : "INVALID_API_RESPONSE"
    }
}

private let kgQuoteTime: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.dateFormat = "yyyy.MM.dd HH:mm"
    return formatter
}()
private let kgQuoteISO: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()
private let kgQuoteISOPlain = ISO8601DateFormatter()
private let kgQuoteNumber: NumberFormatter = {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.locale = Locale(identifier: "ko_KR")
    return formatter
}()

private func quoteTime(_ iso: String?) -> String? {
    guard let iso, let date = kgQuoteISO.date(from: iso) ?? kgQuoteISOPlain.date(from: iso) else { return nil }
    return kgQuoteTime.string(from: date)
}

private func quotePrice(_ amount: Int) -> String {
    (kgQuoteNumber.string(from: NSNumber(value: amount)) ?? String(amount)) + "원"
}

private func quoteStatusLabel(_ status: String) -> String {
    switch status {
    case "PROPOSED": return "제시됨"
    case "ACCEPTED": return "수락됨"
    case "REJECTED": return "거절됨"
    case "COMPLETED": return "완료"
    case "EXPIRED": return "만료"
    case "CANCELLED": return "취소"
    default: return status
    }
}

private func quoteHistory(_ q: ExpertQuote) -> [(String, String?)] {
    [("견적 제시", q.createdAt), ("수락", q.acceptedAt), ("거절", q.rejectedAt),
     ("고수 완료 확인", q.expertConfirmedAt), ("고객 완료 확인", q.customerConfirmedAt), ("완료", q.completedAt)]
        .filter { $0.1 != nil }
}

private let quoteFilters: [(String, String?)] = [
    ("전체", nil), ("제시됨", "PROPOSED"), ("수락됨", "ACCEPTED"), ("완료", "COMPLETED"), ("거절됨", "REJECTED"),
]

struct ExpertQuotesView: View {
    @StateObject private var model = ExpertQuotesModel()

    var body: some View {
        Group {
            if let quote = model.selected {
                ExpertQuoteDetailView(model: model, quote: quote)
            } else {
                ExpertQuotesListView(model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
        .preferredColorScheme(.light)
        .task { model.loadIfNeeded() }
    }
}

private struct ExpertQuotesListView: View {
    @ObservedObject var model: ExpertQuotesModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                copy("받은 견적", size: 23, bold: true)
                Spacer()
                if case .ready(let quotes) = model.state { copy("\(quotes.count)건", size: 13, color: DesignTokens.muted) }
            }.padding(.horizontal, 20).padding(.top, 8)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(quoteFilters.enumerated()), id: \.offset) { _, option in
                        Button { model.setFilter(option.1) } label: {
                            copy(option.0, size: 13).padding(.horizontal, 14).frame(minHeight: 36)
                                .background(model.filter == option.1 ? DesignTokens.soft : Color.white, in: Capsule())
                                .overlay(Capsule().stroke(DesignTokens.border))
                        }.frame(minHeight: 44).accessibilityAddTraits(model.filter == option.1 ? .isSelected : [])
                    }
                }.padding(.horizontal, 20)
            }.padding(.top, 8)
            switch model.state {
            case .loading:
                VStack { HStack(spacing: 10) { ProgressView().controlSize(.small); copy("견적을 불러오는 중…", size: 13, color: DesignTokens.muted) } }
                    .frame(maxWidth: .infinity, maxHeight: .infinity).accessibilityIdentifier("quotes-loading")
            case .failed(let network, let code):
                VStack(alignment: .leading, spacing: 4) {
                    copy(network ? "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
                         : "견적을 불러오지 못했습니다. (\(code))", size: 14)
                    Button("다시 시도") { model.refresh() }.frame(minHeight: 48)
                        .accessibilityIdentifier("quotes-retry")
                }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    .accessibilityIdentifier(network ? "quotes-network" : "quotes-error")
            case .ready(let quotes):
                if quotes.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        copy("받은 견적이 없습니다.", size: 15, bold: true)
                        copy("고객에게 견적을 제시하면 여기에 표시됩니다.", size: 13, color: DesignTokens.muted)
                    }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                        .accessibilityIdentifier("quotes-empty")
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(quotes) { quote in
                                Button { model.select(quote) } label: { ExpertQuoteRow(quote: quote) }
                                    .buttonStyle(.plain).accessibilityIdentifier("quotes-row")
                            }
                        }.padding(20)
                    }.accessibilityIdentifier("quotes-list")
                }
            }
        }
    }
}

private struct ExpertQuoteRow: View {
    let quote: ExpertQuote

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                copy(quote.customerNickname.isEmpty ? "고객" : quote.customerNickname, size: 16, bold: true)
                Spacer(minLength: 0)
                QuoteStatusBadge(status: quote.status)
            }
            if !quote.ledgerName.isEmpty {
                copy(quote.ledgerName, size: 12, color: DesignTokens.muted).padding(.top, 2)
            }
            HStack(spacing: 6) {
                copy(quotePrice(quote.amount), size: 17, bold: true)
                copy(quote.vatIncluded ? "부가세 포함" : "부가세 별도", size: 11, color: DesignTokens.muted)
                Spacer(minLength: 0)
                copy(quoteTime(quote.createdAt) ?? "", size: 12, color: DesignTokens.muted)
            }.padding(.top, 8)
            if !quote.message.isEmpty {
                copy(quote.message, size: 13, color: DesignTokens.muted).lineLimit(2).padding(.top, 6)
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
    }
}

private struct QuoteStatusBadge: View {
    let status: String

    var body: some View {
        copy(quoteStatusLabel(status), size: 11, semibold: true)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(status == "COMPLETED" ? DesignTokens.lime : DesignTokens.soft, in: RoundedRectangle(cornerRadius: 4))
            .accessibilityIdentifier("quote-status-\(status.lowercased())")
    }
}

private struct ExpertQuoteDetailView: View {
    @ObservedObject var model: ExpertQuotesModel
    let quote: ExpertQuote
    @State private var amountText = ""
    @State private var message = ""
    @State private var vatIncluded = false
    @State private var inputError: String?

    private var busy: Bool { model.action == .busy }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button("← 목록") { model.select(nil) }.frame(minHeight: 48)
                    .accessibilityIdentifier("quotes-back")
                Spacer()
            }.padding(.horizontal, 16)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        copy(quote.customerNickname.isEmpty ? "고객" : quote.customerNickname, size: 20, bold: true)
                        Spacer(minLength: 0)
                        QuoteStatusBadge(status: quote.status)
                    }
                    if !quote.ledgerName.isEmpty {
                        copy("원장 · " + quote.ledgerName, size: 12, color: DesignTokens.muted).padding(.top, 2)
                    }
                    sectionTitle("금액")
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            copy(quotePrice(quote.amount), size: 19, bold: true)
                            copy(quote.vatIncluded ? "부가세 포함" : "부가세 별도", size: 12, color: DesignTokens.muted)
                        }
                        if quote.priceType == "HOURLY" { copy("시간당 요금", size: 12, color: DesignTokens.muted) }
                        if let expires = quoteTime(quote.expiresAt) { copy("유효기간 " + expires + " 까지", size: 12, color: DesignTokens.muted) }
                    }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))

                    sectionTitle("메시지")
                    copy(quote.message.isEmpty ? "메시지가 없습니다." : quote.message, size: 14)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))

                    sectionTitle("상태 이력")
                    VStack(spacing: 6) {
                        ForEach(Array(quoteHistory(quote).enumerated()), id: \.offset) { _, row in
                            HStack {
                                copy(row.0, size: 13, semibold: true)
                                Spacer(minLength: 0)
                                copy(quoteTime(row.1) ?? "", size: 12, color: DesignTokens.muted)
                            }
                        }
                    }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                        .accessibilityIdentifier("quotes-history")

                    sectionTitle("완료 확인")
                    confirmation
                    sectionTitle("새 견적 제시")
                    TextField("금액(원)", text: $amountText)
                        .keyboardType(.numberPad)
                        .padding(14).frame(minHeight: 48)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                        .accessibilityIdentifier("quotes-amount")
                    TextField("메시지", text: $message, axis: .vertical).lineLimit(3...6)
                        .padding(14)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                        .padding(.top, 8)
                        .accessibilityIdentifier("quotes-message")
                    Toggle("부가세 포함", isOn: $vatIncluded).frame(minHeight: 44)
                    if let inputError { copy(inputError, size: 12) }
                    Button { propose() } label: {
                        copy("견적 제시", size: 14, semibold: true, color: .white)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(DesignTokens.navy, in: RoundedRectangle(cornerRadius: 6))
                    }.disabled(busy).padding(.top, 8)
                        .accessibilityIdentifier("quotes-propose")
                    actionStatus
                }.padding(.horizontal, 20).padding(.bottom, 24)
            }.accessibilityIdentifier("quotes-detail")
        }
    }

    @ViewBuilder private var confirmation: some View {
        if quote.status == "COMPLETED" {
            copy("양측 확인이 끝나 완료된 견적입니다.", size: 13, color: DesignTokens.muted)
        } else if quote.status != "ACCEPTED" {
            copy("고객이 견적을 수락하면 완료 확인을 할 수 있습니다.", size: 13, color: DesignTokens.muted)
        } else if quote.expertConfirmedAt != nil {
            copy("완료 확인함 · 고객 확인 대기", size: 13, semibold: true)
                .accessibilityIdentifier("quotes-confirm-pending")
        } else {
            Button { model.complete(quote) } label: {
                copy("완료 확인", size: 14, semibold: true, color: .white)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(DesignTokens.navy, in: RoundedRectangle(cornerRadius: 6))
            }.disabled(busy).accessibilityIdentifier("quotes-confirm")
        }
    }

    @ViewBuilder private var actionStatus: some View {
        switch model.action {
        case .idle:
            EmptyView()
        case .busy:
            copy("처리 중…", size: 12, color: DesignTokens.muted).padding(.top, 8)
        case .done(let text):
            copy(text, size: 13, semibold: true).padding(.top, 8).accessibilityIdentifier("quotes-action-done")
        case .failed(let network, let code):
            copy(network ? "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
                 : "요청을 처리하지 못했습니다. (\(code))", size: 13)
                .padding(.top, 8).accessibilityIdentifier("quotes-action-error")
        }
    }

    private func propose() {
        let amount = Int(amountText) ?? 0
        if amount <= 0 { inputError = "금액을 입력하세요."; return }
        if amount > 2_147_483_647 { inputError = "금액은 2,147,483,647원 이하로 입력하세요."; return }
        if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { inputError = "메시지를 입력하세요."; return }
        inputError = nil
        model.propose(quote, amount: amount, message: message, vatIncluded: vatIncluded)
        amountText = ""; message = ""; vatIncluded = false
    }

    private func sectionTitle(_ text: String) -> some View {
        copy(text, size: 16, bold: true).padding(.top, 20).padding(.bottom, 8)
    }
}

private func copy(_ text: String, size: CGFloat = 14, bold: Bool = false, semibold: Bool = false,
                  color: Color = DesignTokens.navy) -> Text {
    Text(text).font(.custom(semibold ? "Pretendard-SemiBold" : (bold ? "Pretendard-Bold" : "Pretendard-Regular"), size: size, relativeTo: .body))
        .foregroundStyle(color)
}
