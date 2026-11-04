import SwiftUI

/// 고수 홈. 활동 상태의 저장소는 서버(전문가 프로필)뿐이며, 토글은 즉시 PATCH 하고
/// 실패하면 이전 값으로 되돌린다. 업무 데이터를 로컬 DB에 저장하지 않는다.
enum KGExpertAvailability: String, CaseIterable, Equatable {
    case AVAILABLE, PAUSED, VACATION
    var label: String {
        switch self {
        case .AVAILABLE: return "수신 중"
        case .PAUSED: return "일시중지"
        case .VACATION: return "휴가"
        }
    }
}

struct KGExpertRequest: Identifiable, Equatable {
    let id: String
    let customerNickname: String
    let amount: Int
    let vatIncluded: Bool
}

struct KGExpertHomeReady: Equatable {
    var availability: KGExpertAvailability
    let receivedThisMonth: Int
    let completedThisMonth: Int
    let requests: [KGExpertRequest]
}

enum KGExpertHomeState: Equatable {
    case loading
    case empty
    case failed(network: Bool, code: String)
    case ready(KGExpertHomeReady)
}

@MainActor final class KGExpertHomeModel: ObservableObject {
    @Published private(set) var state: KGExpertHomeState = .loading
    @Published private(set) var toggleBusy = false
    @Published private(set) var toggleError: String?
    private let transport: KGAuthTransport
    private let sessions: KGSessionStorage
    private var task: Task<Void, Never>?

    init(transport: KGAuthTransport = KGMembershipHTTP(), sessions: KGSessionStorage = KGSecureSession()) {
        self.transport = transport
        self.sessions = sessions
    }

    #if DEBUG
    /// --open-expert-home은 스플래시 직후 진입하므로, 개발 로그인이 세션을 발급할 때까지 기다린 뒤 조회한다.
    func loadAfterDevLogin() async {
        for _ in 0..<60 {
            if (try? sessions.read()) != nil { break }
            try? await Task.sleep(for: .milliseconds(250))
        }
        load()
    }
    #endif

    func load() {
        task?.cancel()
        guard let token = try? sessions.read() else {
            state = .failed(network: false, code: "SESSION_REQUIRED")
            return
        }
        state = .loading
        toggleError = nil
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let expert = try await self.transport.request("GET", "/v1/me/expert", token: token, body: nil)
                let quotes = try await self.transport.request("GET", "/v1/me/quotes?limit=100", token: token, body: nil)
                if Task.isCancelled { return }
                self.state = Self.decode(expert: expert, quotes: quotes)
            } catch {
                if Task.isCancelled { return }
                if let api = error as? KGAuthAPIError, api.status == 404, api.code == "EXPERT_PROFILE_REQUIRED" {
                    self.state = .empty
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

    /// 낙관적 갱신: 실패하면 화면을 이전 상태로 되돌리고 오류를 남긴다.
    func setAvailability(_ target: KGExpertAvailability) {
        guard case .ready(let current) = state, !toggleBusy, current.availability != target else { return }
        guard let token = try? sessions.read() else {
            toggleError = "세션이 만료되었습니다. 다시 로그인해주세요."
            return
        }
        var optimistic = current
        optimistic.availability = target
        state = .ready(optimistic)
        toggleBusy = true
        toggleError = nil
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let saved = try await self.transport.request("PATCH", "/v1/me/expert/availability", token: token,
                                                             body: ["availability": target.rawValue])
                var confirmed = current
                confirmed.availability = KGExpertAvailability(rawValue: saved["availability"] as? String ?? "") ?? target
                self.state = .ready(confirmed)
            } catch {
                self.state = .ready(current)
                if let api = error as? KGAuthAPIError {
                    self.toggleError = api.status == 401 ? "세션이 만료되었습니다. 다시 로그인해주세요."
                        : "상태를 저장하지 못했습니다. (\(api.code))"
                } else {
                    self.toggleError = "네트워크에 연결할 수 없어 이전 상태로 되돌렸습니다."
                }
            }
            self.toggleBusy = false
        }
    }

    /// 이번 달 요약은 서버가 준 견적 목록에서 계산한다. 월 경계는 기기 달력 기준.
    static func decode(expert: [String: Any], quotes envelope: [String: Any], now: Date = Date(),
                       calendar: Calendar = .current) -> KGExpertHomeState {
        let availability = KGExpertAvailability(rawValue: expert["availability"] as? String ?? "") ?? .AVAILABLE
        let rows = envelope["quotes"] as? [[String: Any]] ?? []
        let thisMonth = rows.filter { row in
            guard let raw = row["createdAt"] as? String, let date = timestamp(raw) else { return false }
            return calendar.isDate(date, equalTo: now, toGranularity: .month)
        }
        let requests = rows.filter { $0["status"] as? String == "PROPOSED" }.prefix(3).compactMap { row -> KGExpertRequest? in
            guard let id = row["id"] as? String else { return nil }
            return KGExpertRequest(id: id,
                                   customerNickname: row["customerNickname"] as? String ?? "",
                                   amount: row["amount"] as? Int ?? 0,
                                   vatIncluded: row["vatIncluded"] as? Bool ?? false)
        }
        return .ready(KGExpertHomeReady(
            availability: availability,
            receivedThisMonth: thisMonth.count,
            completedThisMonth: thisMonth.filter { $0["status"] as? String == "COMPLETED" }.count,
            requests: Array(requests)))
    }

    private static func timestamp(_ value: String) -> Date? {
        let plain = ISO8601DateFormatter()
        if let date = plain.date(from: value) { return date }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value)
    }
}

struct ExpertHomeView: View {
    let nickname: String
    let onBack: () -> Void
    let onOpenQuotes: () -> Void
    @StateObject private var model = KGExpertHomeModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            switch model.state {
            case .loading: loading
            case .empty: empty
            case .failed(let network, let code): failure(network: network, code: code)
            case .ready(let ready): ScrollView { content(ready) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.white)
        .task {
            #if DEBUG
            if KGExpertHomeDebug.openOnLaunch { await model.loadAfterDevLogin() } else { model.load() }
            #else
            model.load()
            #endif
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                kgText("고수 홈", size: 12, color: DesignTokens.muted)
                HStack(spacing: 0) {
                    kgText(nickname.isEmpty ? "고수" : nickname + " 님", size: 22, bold: true)
                    if case .ready(let ready) = model.state {
                        kgText(ready.availability.label, size: 11, semibold: true)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(DesignTokens.lime, in: RoundedRectangle(cornerRadius: 4))
                            .padding(.leading, 8).accessibilityIdentifier("availability-badge")
                    }
                }
            }
            Spacer(minLength: 0)
            Button("닫기") { onBack() }.frame(minHeight: 48).accessibilityIdentifier("expert-close")
        }.padding(.leading, 20).padding(.trailing, 8).padding(.top, 8)
    }

    private var loading: some View {
        VStack(spacing: 12) {
            ProgressView().controlSize(.small)
            kgText("고수 정보를 불러오는 중…", size: 13, color: DesignTokens.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(24)
        .accessibilityElement(children: .combine)
    }

    private var empty: some View {
        VStack(spacing: 8) {
            kgText("고수 프로필이 없습니다", size: 17, bold: true)
            kgText("활동 상태와 받은 견적은 고수 프로필을 등록한 뒤에 표시됩니다.", size: 13, color: DesignTokens.muted)
                .multilineTextAlignment(.center)
            Button("돌아가기") { onBack() }.frame(minHeight: 48).padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(24)
        .accessibilityElement(children: .contain)
    }

    private func failure(network: Bool, code: String) -> some View {
        VStack(spacing: 6) {
            kgText(network ? "네트워크에 연결할 수 없습니다." : "고수 정보를 불러오지 못했습니다.", size: 15, bold: true)
                .accessibilityIdentifier(network ? "expert-network" : "expert-error")
            kgText(network ? "연결을 확인하고 다시 시도해주세요." : "잠시 후 다시 시도해주세요. (\(code))",
                   size: 13, color: DesignTokens.muted)
            Button("다시 시도") { model.load() }.frame(minHeight: 48).padding(.top, 6)
                .accessibilityIdentifier("expert-retry")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(24)
    }

    private func content(_ ready: KGExpertHomeReady) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            kgText("활동 상태", size: 19, bold: true).accessibilityAddTraits(.isHeader).padding(.top, 22)
            HStack(spacing: 8) {
                ForEach(KGExpertAvailability.allCases, id: \.self) { option in
                    let selected = option == ready.availability
                    Button { model.setAvailability(option) } label: {
                        kgText(option.label, size: 14, bold: selected, color: selected ? DesignTokens.navy : DesignTokens.muted)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(selected ? DesignTokens.soft : Color.white, in: RoundedRectangle(cornerRadius: 6))
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(selected ? DesignTokens.navy : DesignTokens.border))
                    }
                    .buttonStyle(.plain)
                    .disabled(model.toggleBusy)
                    .accessibilityIdentifier("availability-\(option.rawValue)")
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }.padding(.top, 10)
            if model.toggleBusy {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.mini)
                    kgText("저장 중…", size: 12, color: DesignTokens.muted)
                }.padding(.top, 8)
            }
            if let error = model.toggleError {
                kgText(error, size: 12).padding(.top, 8).accessibilityIdentifier("availability-error")
            }

            kgText("이번 달", size: 19, bold: true).accessibilityAddTraits(.isHeader).padding(.top, 24)
            HStack(spacing: 0) {
                stat("받은 견적", value: ready.receivedThisMonth)
                Rectangle().fill(DesignTokens.border).frame(width: 1, height: 34)
                stat("완료", value: ready.completedThisMonth)
            }
            .padding(.vertical, 14).frame(maxWidth: .infinity)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border)).padding(.top, 10)

            kgText("새 요청", size: 19, bold: true).accessibilityAddTraits(.isHeader).padding(.top, 24)
            if ready.requests.isEmpty {
                kgText("새 요청이 없습니다.", size: 13, color: DesignTokens.muted)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(20)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                    .padding(.top, 10)
            } else {
                ForEach(ready.requests) { request in
                    Button { onOpenQuotes() } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                kgText(request.customerNickname.isEmpty ? "고객" : request.customerNickname, size: 15, semibold: true)
                                kgText(request.vatIncluded ? "부가세 포함" : "부가세 별도", size: 12, color: DesignTokens.muted)
                            }
                            Spacer(minLength: 0)
                            kgText(won(request.amount), size: 15, semibold: true)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 12).frame(maxWidth: .infinity, minHeight: 56)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                    }
                    .buttonStyle(.plain).padding(.top, 10)
                    .accessibilityIdentifier("request-\(request.id)")
                }
            }
            Button("받은 견적 전체 보기") { onOpenQuotes() }
                .frame(minHeight: 48).padding(.top, 6).padding(.bottom, 24)
                .accessibilityIdentifier("open-quotes")
        }.padding(.horizontal, 20)
    }

    private func stat(_ label: String, value: Int) -> some View {
        VStack(spacing: 2) {
            kgText(String(value), size: 20, bold: true)
            kgText(label, size: 12, color: DesignTokens.muted)
        }.frame(maxWidth: .infinity)
    }

    private func won(_ amount: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "ko_KR")
        return (formatter.string(from: NSNumber(value: amount)) ?? String(amount)) + "원"
    }
}

/// 진입점을 거치지 않고 고수 홈 상태만 확인하기 위한 DEBUG 실행 인자(--open-expert-home).
enum KGExpertHomeDebug {
    static var openOnLaunch: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--open-expert-home")
        #else
        false
        #endif
    }
}

private func kgText(_ text: String, size: CGFloat = 14, bold: Bool = false,
                    color: Color = DesignTokens.navy, semibold: Bool = false) -> Text {
    Text(text).font(.custom(semibold ? "Pretendard-SemiBold" : (bold ? "Pretendard-Bold" : "Pretendard-Regular"),
                            size: size, relativeTo: .body))
        .foregroundStyle(color)
}
