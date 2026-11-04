import PhotosUI
import SwiftUI

struct KGCustomerMessage: Identifiable, Equatable {
    let id: String
    let senderId: String
    let body: String
    let imageUrl: String?
    let createdAt: String
}

struct KGCustomerQuote: Identifiable, Equatable {
    let id: String
    let amount: Int
    let totalAmount: Int
    let status: String
    let effectiveStatus: String
    let message: String
    let version: Int
    let customerConfirmedAt: String?
    let expertConfirmedAt: String?
    let createdAt: String
}

enum KGCustomerChatState: Equatable {
    case loading
    case empty(ownId: String)
    case failed(network: Bool, code: String)
    case ready(ownId: String, messages: [KGCustomerMessage], quotes: [KGCustomerQuote])
}

@MainActor final class KGCustomerChatModel: ObservableObject {
    @Published private(set) var state: KGCustomerChatState = .loading
    @Published private(set) var sending = false
    @Published private(set) var sendingPhoto = false
    @Published private(set) var actionBusy = false
    @Published private(set) var actionError: String?
    private let transport: KGAuthTransport
    private let sessions: KGSessionStorage
    private var task: Task<Void, Never>?

    init(transport: KGAuthTransport = KGMembershipHTTP(), sessions: KGSessionStorage = KGSecureSession()) {
        self.transport = transport
        self.sessions = sessions
    }

    func refresh(ledgerId: String) {
        guard let token = (try? sessions.read()) ?? nil else {
            state = .failed(network: false, code: "SESSION_REQUIRED")
            return
        }
        task?.cancel()
        if case .ready = state {} else if case .empty = state {} else { state = .loading }
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let me = try await self.transport.request("GET", "/v1/me", token: token, body: nil)
                let messages = try await self.transport.request("GET", "/v1/ledgers/" + ledgerId + "/messages?limit=50", token: token, body: nil)
                let quotes = try await self.transport.request("GET", "/v1/ledgers/" + ledgerId + "/quotes", token: token, body: nil)
                if Task.isCancelled { return }
                let ownId = me["id"] as? String ?? ""
                let list = Self.decodeMessages(messages)
                let quoteList = Self.decodeQuotes(quotes)
                self.state = (list.isEmpty && quoteList.isEmpty)
                    ? .empty(ownId: ownId)
                    : .ready(ownId: ownId, messages: list, quotes: quoteList)
            } catch {
                if Task.isCancelled { return }
                if KGNetworkFailure.isNetwork(error) {
                    self.state = .failed(network: true, code: "NETWORK_UNAVAILABLE")
                } else if let api = error as? KGAuthAPIError {
                    self.state = .failed(network: false, code: api.code)
                } else {
                    self.state = .failed(network: false, code: "INVALID_API_RESPONSE")
                }
            }
        }
    }

    func send(ledgerId: String, body: String) {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sending, !text.isEmpty else { return }
        guard let token = (try? sessions.read()) ?? nil else {
            actionError = "세션이 만료되었습니다. 다시 로그인해주세요."
            return
        }
        sending = true
        actionError = nil
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                _ = try await self.transport.request("POST", "/v1/ledgers/" + ledgerId + "/messages",
                                                    token: token, body: ["body": text])
                self.sending = false
                self.refresh(ledgerId: ledgerId)
            } catch {
                self.sending = false
                self.actionError = Self.message(for: error, fallback: "메시지를 보내지 못했습니다.")
            }
        }
    }

    /// 견적 상태 변경은 서버가 판정한다. 성공 후 전체를 다시 읽어 화면을 서버 값에 맞춘다.
    func respond(ledgerId: String, quote: KGCustomerQuote, action: String) {
        mutate(ledgerId: ledgerId, path: "/v1/quotes/" + quote.id + "/respond",
               body: ["action": action, "expectedVersion": quote.version])
    }

    func confirmComplete(ledgerId: String, quote: KGCustomerQuote) {
        mutate(ledgerId: ledgerId, path: "/v1/quotes/" + quote.id + "/complete", body: ["expectedVersion": quote.version])
    }

    /// 사진은 presign → R2 PUT → imageKey 전송까지 KGChatApi가 처리한다.
    /// 서버는 jpeg/png/webp만 받으므로 선택한 사진을 JPEG로 정규화하고 긴 변을 1600px로 줄인다.
    func sendPhoto(ledgerId: String, image: UIImage) {
        guard !sending, !sendingPhoto else { return }
        guard let token = (try? sessions.read()) ?? nil else {
            actionError = "세션이 만료되었습니다. 다시 로그인해주세요."
            return
        }
        guard let jpeg = Self.jpegData(image) else {
            reportPhotoUnreadable()
            return
        }
        sendingPhoto = true
        actionError = nil
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                _ = try await KGChatApi(transport: self.transport).sendPhoto(
                    token, ledgerId: ledgerId, bytes: jpeg.data, contentType: "image/jpeg",
                    width: jpeg.width, height: jpeg.height)
                self.sendingPhoto = false
                self.refresh(ledgerId: ledgerId)
            } catch {
                self.sendingPhoto = false
                self.actionError = Self.message(for: error, fallback: "사진을 보내지 못했습니다.")
            }
        }
    }

    func reportPhotoUnreadable() {
        actionError = "사진을 읽지 못했습니다. 다른 사진을 선택해주세요."
    }

    private static func jpegData(_ image: UIImage) -> (data: Data, width: Int, height: Int)? {
        let longest = max(image.size.width, image.size.height)
        guard longest > 0 else { return nil }
        let scale = min(1, 1600 / longest)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let data = resized.jpegData(compressionQuality: 0.85) else { return nil }
        return (data, Int(size.width), Int(size.height))
    }

    private func mutate(ledgerId: String, path: String, body: [String: Any]) {
        guard !actionBusy else { return }
        guard let token = (try? sessions.read()) ?? nil else {
            actionError = "세션이 만료되었습니다. 다시 로그인해주세요."
            return
        }
        actionBusy = true
        actionError = nil
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                _ = try await self.transport.request("POST", path, token: token, body: body)
                self.actionBusy = false
                self.refresh(ledgerId: ledgerId)
            } catch {
                self.actionBusy = false
                if let api = error as? KGAuthAPIError {
                    switch api.code {
                    case "ALREADY_CONFIRMED": self.actionError = "이미 완료 확인을 했습니다. 상대 확인을 기다리는 중입니다."
                    case "VERSION_CONFLICT": self.actionError = "다른 변경이 먼저 반영되었습니다. 새로고침 후 다시 시도해주세요."
                    case "QUOTE_EXPIRED": self.actionError = "견적 유효기간이 지났습니다."
                    default: self.actionError = api.status == 401 ? "세션이 만료되었습니다. 다시 로그인해주세요." : "요청을 처리하지 못했습니다. (\(api.code))"
                    }
                } else {
                    self.actionError = Self.message(for: error, fallback: "요청을 처리하지 못했습니다.")
                }
            }
        }
    }

    private static func message(for error: Error, fallback: String) -> String {
        KGNetworkFailure.isNetwork(error) ? "네트워크에 연결할 수 없습니다." : fallback + " (INVALID_API_RESPONSE)"
    }

    static func decodeMessages(_ json: [String: Any]) -> [KGCustomerMessage] {
        let rows = (json["messages"] as? [[String: Any]] ?? []).compactMap { row -> KGCustomerMessage? in
            guard let id = row["id"] as? String, let sender = row["senderId"] as? String else { return nil }
            let deleted = row["deleted"] as? Bool ?? false
            let rawImage = deleted ? nil : (row["imageUrl"] as? String)
            return KGCustomerMessage(id: id, senderId: sender,
                                     body: deleted ? "" : (row["body"] as? String ?? ""),
                                     imageUrl: (rawImage?.isEmpty == false) ? rawImage : nil,
                                     createdAt: row["createdAt"] as? String ?? "")
        }
        return rows.reversed()
    }

    static func decodeQuotes(_ json: [String: Any]) -> [KGCustomerQuote] {
        (json["quotes"] as? [[String: Any]] ?? []).compactMap { row in
            guard let id = row["id"] as? String else { return nil }
            let status = row["status"] as? String ?? ""
            return KGCustomerQuote(id: id,
                                   amount: row["amount"] as? Int ?? 0,
                                   totalAmount: row["totalAmount"] as? Int ?? 0,
                                   status: status,
                                   effectiveStatus: row["effectiveStatus"] as? String ?? status,
                                   message: row["message"] as? String ?? "",
                                   version: row["version"] as? Int ?? 1,
                                   customerConfirmedAt: row["customerConfirmedAt"] as? String,
                                   expertConfirmedAt: row["expertConfirmedAt"] as? String,
                                   createdAt: row["createdAt"] as? String ?? "")
        }
    }

    /// 진행 중(PROPOSED/ACCEPTED) 견적을 우선하고, 없으면 가장 최근 완료 견적을 고른다.
    static func activeQuote(_ quotes: [KGCustomerQuote]) -> KGCustomerQuote? {
        let ordered = quotes.sorted { $0.createdAt > $1.createdAt }
        return ordered.first { $0.effectiveStatus == "PROPOSED" || $0.effectiveStatus == "ACCEPTED" }
            ?? ordered.first { $0.effectiveStatus == "COMPLETED" }
    }
}

func customerQuoteStatusLabel(_ quote: KGCustomerQuote) -> String {
    switch quote.effectiveStatus {
    case "COMPLETED": return "거래 완료"
    case "ACCEPTED": return quote.customerConfirmedAt != nil ? "완료 확인함" : "수락됨"
    case "PROPOSED": return "견적 도착"
    case "REJECTED": return "거절됨"
    case "EXPIRED": return "만료됨"
    default: return quote.effectiveStatus
    }
}

struct KGCustomerChatView: View {
    let ledgerId: String
    let expertNickname: String
    let onBack: () -> Void
    let onWriteReview: (String, String) -> Void
    @StateObject private var model = KGCustomerChatModel()
    @State private var draft = ""
    @State private var pickedPhoto: PhotosPickerItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    customerCopy("채팅", size: 12, color: DesignTokens.muted).accessibilityIdentifier("customer-chat-title")
                    customerCopy((expertNickname.isEmpty ? "고수" : expertNickname) + " 님과의 거래", size: 19, bold: true)
                }
                Spacer()
                Button("뒤로") { onBack() }.frame(minHeight: 44).accessibilityIdentifier("customer-chat-back")
            }.padding(.horizontal, 20).padding(.top, 8)
            content
        }
        .background(Color.white)
        .task(id: ledgerId) { model.refresh(ledgerId: ledgerId) }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                customerCopy("대화를 불러오는 중입니다…", color: DesignTokens.muted)
                Spacer(minLength: 0)
            }.padding(20).accessibilityIdentifier("customer-chat-loading")
        case .failed(let network, let code):
            customerFailure(network: network, code: code, retry: { model.refresh(ledgerId: ledgerId) })
        case .empty(let ownId):
            messageList(ownId: ownId, messages: [])
            composer
        case .ready(let ownId, let messages, let quotes):
            if let quote = KGCustomerChatModel.activeQuote(quotes) {
                quoteCard(quote)
            }
            if let error = model.actionError {
                customerCopy(error, size: 13).padding(.horizontal, 20).padding(.top, 6)
                    .accessibilityIdentifier("customer-chat-error")
            }
            messageList(ownId: ownId, messages: messages)
            composer
        }
    }

    @ViewBuilder private func messageList(ownId: String, messages: [KGCustomerMessage]) -> some View {
        if messages.isEmpty {
            Spacer(minLength: 0)
            customerCopy("아직 메시지가 없습니다.\n첫 메시지를 보내보세요.", size: 14, color: DesignTokens.muted, align: .center)
                .frame(maxWidth: .infinity).accessibilityIdentifier("customer-chat-empty")
            Spacer(minLength: 0)
        } else {
            ScrollViewReader { proxy in
              ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(messages) { message in
                        HStack {
                            if message.senderId == ownId { Spacer(minLength: 40) }
                            VStack(alignment: .leading, spacing: 3) {
                                if message.senderId != ownId { customerCopy("고수", size: 11, color: DesignTokens.muted) }
                                if let raw = message.imageUrl {
                                    RemoteImage(url: raw, contentMode: .fit)
                                        .frame(maxWidth: 220, maxHeight: 260)
                                        .background(DesignTokens.soft, in: RoundedRectangle(cornerRadius: 6))
                                        .accessibilityIdentifier("customer-message-image")
                                }
                                if !message.body.isEmpty {
                                    customerCopy(message.body)
                                } else if message.imageUrl == nil {
                                    customerCopy("삭제된 메시지")
                                }
                                customerCopy(hhmm(message.createdAt), size: 10, color: DesignTokens.muted)
                            }.padding(.horizontal, 12).padding(.vertical, 9)
                                .background(message.senderId == ownId ? DesignTokens.soft : DesignTokens.track,
                                            in: RoundedRectangle(cornerRadius: 8))
                            if message.senderId != ownId { Spacer(minLength: 40) }
                        }.id(message.id)
                    }
                }.padding(.horizontal, 16).padding(.vertical, 8)
              }
              .onAppear { if let last = messages.last { proxy.scrollTo(last.id, anchor: .bottom) } }
              .onChange(of: messages.last?.id) { _, id in if let id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } } }
            }.accessibilityIdentifier("customer-messages")
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            PhotosPicker(selection: $pickedPhoto, matching: .images, photoLibrary: .shared()) {
                customerCopy("사진", color: DesignTokens.navy, semibold: true).frame(minHeight: 48)
            }.accessibilityIdentifier("customer-message-photo")
                .onChange(of: pickedPhoto) { _, item in
                    guard let item else { return }
                    pickedPhoto = nil
                    Task {
                        guard let data = try? await item.loadTransferable(type: Data.self),
                              let image = UIImage(data: data) else {
                            model.reportPhotoUnreadable()
                            return
                        }
                        model.sendPhoto(ledgerId: ledgerId, image: image)
                    }
                }
            TextField("메시지를 입력하세요", text: $draft, axis: .vertical)
                .font(.custom("Pretendard-Regular", size: 14, relativeTo: .body))
                .lineLimit(1...4)
                .padding(10).overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                .accessibilityIdentifier("customer-message-input")
            Button {
                let text = draft; draft = ""; model.send(ledgerId: ledgerId, body: text)
            } label: {
                customerCopy(model.sending || model.sendingPhoto ? "전송 중" : "전송", color: .white, semibold: true)
                    .padding(.horizontal, 14).frame(minHeight: 48)
                    .background(DesignTokens.navy, in: RoundedRectangle(cornerRadius: 6))
            }.buttonStyle(.plain)
                .disabled(model.sending || model.sendingPhoto || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("customer-message-send")
        }.padding(12)
    }

    private func quoteCard(_ quote: KGCustomerQuote) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            customerCopy("견적", size: 12, color: DesignTokens.muted)
            HStack {
                customerCopy(customerWon(quote.totalAmount), size: 20, bold: true)
                Spacer()
                customerCopy(customerQuoteStatusLabel(quote), size: 12, semibold: true)
            }
            if !quote.message.isEmpty { customerCopy(quote.message, size: 13, color: DesignTokens.muted) }
            quoteAction(quote)
        }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
            .padding(.horizontal, 20).padding(.top, 8)
    }

    @ViewBuilder private func quoteAction(_ quote: KGCustomerQuote) -> some View {
        switch quote.effectiveStatus {
        case "PROPOSED":
            primaryButton(model.actionBusy ? "처리 중…" : "견적 수락", id: "customer-quote-accept") {
                model.respond(ledgerId: ledgerId, quote: quote, action: "accept")
            }.disabled(model.actionBusy)
        case "ACCEPTED" where quote.customerConfirmedAt == nil:
            primaryButton(model.actionBusy ? "처리 중…" : "거래 완료 확인", id: "customer-complete") {
                model.confirmComplete(ledgerId: ledgerId, quote: quote)
            }.disabled(model.actionBusy)
        case "ACCEPTED":
            customerCopy("상대 확인 대기 중입니다. 고수가 완료를 확인하면 거래가 종료됩니다.", size: 13, color: DesignTokens.muted)
                .padding(.top, 4).accessibilityIdentifier("customer-waiting-counterpart")
        case "COMPLETED":
            primaryButton("후기 작성", id: "customer-write-review") { onWriteReview(ledgerId, expertNickname) }
        default:
            EmptyView()
        }
    }

    private func primaryButton(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            customerCopy(title, color: .white, semibold: true)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(DesignTokens.navy, in: RoundedRectangle(cornerRadius: 6))
        }.buttonStyle(.plain).padding(.top, 4).accessibilityIdentifier(id)
    }

    private func hhmm(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
        let out = DateFormatter(); out.dateFormat = "HH:mm"
        return out.string(from: date)
    }
}
