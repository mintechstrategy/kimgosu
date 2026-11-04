import SwiftUI

enum KGCustomerReviewSubmit: Equatable {
    case idle, busy
    case failed(String)
}

@MainActor final class KGCustomerReviewModel: ObservableObject {
    @Published private(set) var submit: KGCustomerReviewSubmit = .idle
    private let transport: KGAuthTransport
    private let sessions: KGSessionStorage

    init(transport: KGAuthTransport = KGMembershipHTTP(), sessions: KGSessionStorage = KGSecureSession()) {
        self.transport = transport
        self.sessions = sessions
    }

    /// 후기 자격(완료된 거래·기간·중복)은 서버가 판정한다. 화면은 응답 코드만 안내한다.
    func submit(ledgerId: String, rating: Int, body: String, onDone: @escaping () -> Void) {
        guard submit != .busy else { return }
        guard (1...5).contains(rating) else {
            submit = .failed("별점을 선택해주세요.")
            return
        }
        guard let token = (try? sessions.read()) ?? nil else {
            submit = .failed("세션이 만료되었습니다. 다시 로그인해주세요.")
            return
        }
        submit = .busy
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                _ = try await self.transport.request("POST", "/v1/ledgers/" + ledgerId + "/reviews", token: token,
                                                     body: ["rating": rating, "body": body])
                self.submit = .idle
                onDone()
            } catch {
                if let api = error as? KGAuthAPIError {
                    switch api.code {
                    case "REVIEW_EXISTS": self.submit = .failed("이미 후기를 작성했습니다.")
                    case "REVIEW_NOT_ELIGIBLE": self.submit = .failed("완료된 거래에만 후기를 남길 수 있습니다.")
                    case "REVIEW_WINDOW_CLOSED": self.submit = .failed("후기 작성 기간이 지났습니다.")
                    default: self.submit = .failed(api.status == 401 ? "세션이 만료되었습니다. 다시 로그인해주세요." : "후기를 저장하지 못했습니다. (\(api.code))")
                    }
                } else if KGNetworkFailure.isNetwork(error) {
                    self.submit = .failed("네트워크에 연결할 수 없습니다.")
                } else {
                    self.submit = .failed("후기를 저장하지 못했습니다. (INVALID_API_RESPONSE)")
                }
            }
        }
    }
}

struct KGCustomerReviewView: View {
    let ledgerId: String
    let expertNickname: String
    let onBack: () -> Void
    let onDone: () -> Void
    @StateObject private var model = KGCustomerReviewModel()
    @State private var rating = 0
    @State private var reviewBody = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                customerCopy("후기 작성", size: 22, bold: true).accessibilityIdentifier("customer-review-title")
                Spacer()
                Button("뒤로") { onBack() }.frame(minHeight: 44).accessibilityIdentifier("customer-review-back")
            }.padding(.horizontal, 20).padding(.top, 8)
            customerCopy((expertNickname.isEmpty ? "고수" : expertNickname) + " 님과의 거래는 어떠셨나요?", size: 15, color: DesignTokens.muted)
                .padding(.horizontal, 20).padding(.top, 16)
            HStack(spacing: 8) {
                ForEach(1...5, id: \.self) { value in
                    Button { rating = value } label: {
                        customerCopy("★", size: 18, color: rating >= value ? DesignTokens.navy : DesignTokens.muted, align: .center)
                            .frame(width: 48, height: 48)
                            .background(rating >= value ? DesignTokens.soft : Color.white, in: RoundedRectangle(cornerRadius: 6))
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(rating >= value ? DesignTokens.navy : DesignTokens.border))
                    }.buttonStyle(.plain).accessibilityIdentifier("customer-rating-\(value)")
                }
            }.padding(.horizontal, 20).padding(.top, 16)
            customerCopy(rating == 0 ? "별점을 선택해주세요." : "\(rating) 점", size: 13, color: DesignTokens.muted)
                .padding(.horizontal, 20).padding(.top, 8).accessibilityIdentifier("customer-rating-value")
            TextField("후기를 남겨주세요 (선택)", text: $reviewBody, axis: .vertical)
                .font(.custom("Pretendard-Regular", size: 14, relativeTo: .body))
                .lineLimit(4...8)
                .padding(12).overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                .padding(.horizontal, 20).padding(.top, 16).accessibilityIdentifier("customer-review-body")
            if case .failed(let message) = model.submit {
                customerCopy(message, size: 13).padding(.horizontal, 20).padding(.top, 10)
                    .accessibilityIdentifier("customer-review-error")
            }
            Button {
                model.submit(ledgerId: ledgerId, rating: rating, body: reviewBody, onDone: onDone)
            } label: {
                customerCopy(model.submit == .busy ? "등록 중…" : "후기 등록", color: .white, semibold: true)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(DesignTokens.navy, in: RoundedRectangle(cornerRadius: 6))
            }.buttonStyle(.plain).disabled(model.submit == .busy)
                .padding(.horizontal, 20).padding(.top, 20).accessibilityIdentifier("customer-review-submit")
            Spacer(minLength: 0)
        }.background(Color.white)
    }
}
