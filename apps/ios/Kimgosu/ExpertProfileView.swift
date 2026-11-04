import SwiftUI

/// 고수 프로필 조회·수정 (WS-42).
///
/// 저장 값의 정본은 서버다. 저장 후 `GET /v1/me/expert`를 다시 읽어 화면을 갱신하므로
/// 로컬 DB나 낙관적 캐시를 두지 않는다. 값 검증·보정은 서버가 하며 클라이언트는
/// 사용자가 입력한 값을 그대로 보내고 서버가 준 오류 코드를 표시한다.

struct ExpertProfile: Hashable {
    let introduction: String
    let career: String
    let activityRegion: String
}

enum ExpertProfileState: Equatable {
    case loading
    case empty(String)
    case failed(network: Bool, code: String)
    case ready(ExpertProfile)
}

enum ExpertSaveState: Equatable {
    case idle
    case saving
    case saved(String)
    case failed(network: Bool, code: String)
}

@MainActor final class ExpertProfileModel: ObservableObject {
    @Published private(set) var state: ExpertProfileState = .loading
    @Published private(set) var save: ExpertSaveState = .idle
    private let repository: KGAuthRepository
    private let sessions: KGSessionStorage
    private var task: Task<Void, Never>?

    init(repository: KGAuthRepository = KGAuthRepository(), sessions: KGSessionStorage = KGSecureSession()) {
        self.repository = repository
        self.sessions = sessions
    }

    func load() {
        task?.cancel()
        save = .idle
        guard let token = (try? sessions.read()) ?? nil else {
            state = .empty("로그인하면 고수 프로필을 관리할 수 있습니다.")
            return
        }
        state = .loading
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let json = try await repository.expertSelf(token)
                try Task.checkCancellation()
                state = Self.decode(json)
            } catch is CancellationError {
                return
            } catch let error as KGAuthAPIError {
                state = Self.failure(error)
            } catch {
                state = .failed(network: KGNetworkFailure.isNetwork(error), code: "NETWORK_UNAVAILABLE")
            }
        }
    }

    func save(introduction: String, career: String, activityRegion: String) {
        guard case .ready(let current) = state else { return }
        guard let token = (try? sessions.read()) ?? nil else {
            state = .empty("로그인하면 고수 프로필을 관리할 수 있습니다.")
            return
        }
        // 변경된 항목만 보낸다. 빈 문자열도 보정하지 않고 그대로 전송해 서버 판정을 받는다.
        var fields: [String: Any] = [:]
        if introduction != current.introduction { fields["introduction"] = introduction }
        if career != current.career { fields["career"] = career }
        if activityRegion != current.activityRegion { fields["activityRegion"] = activityRegion }
        if fields.isEmpty { save = .saved("변경된 내용이 없습니다."); return }
        save = .saving
        task?.cancel()
        task = Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await repository.patchExpertProfile(token, fields: fields)
            } catch is CancellationError {
                return
            } catch let error as KGAuthAPIError {
                save = .failed(network: error.status == 0, code: error.code)
                return
            } catch {
                save = .failed(network: KGNetworkFailure.isNetwork(error), code: "NETWORK_UNAVAILABLE")
                return
            }
            do {
                let json = try await repository.expertSelf(token)
                try Task.checkCancellation()
                state = Self.decode(json)
                save = .saved("저장했습니다. 서버에서 다시 읽어 확인했습니다.")
            } catch is CancellationError {
                return
            } catch {
                save = .saved("저장했습니다. 최신 정보를 다시 불러오지 못했습니다.")
            }
        }
    }

    nonisolated static func decode(_ json: [String: Any]) -> ExpertProfileState {
        .ready(ExpertProfile(
            introduction: json["introduction"] as? String ?? "",
            career: json["career"] as? String ?? "",
            activityRegion: json["activityRegion"] as? String ?? ""
        ))
    }

    nonisolated static func failure(_ error: KGAuthAPIError) -> ExpertProfileState {
        switch error.code {
        case "SESSION_REQUIRED", "SESSION_INVALID": return .empty("로그인이 필요합니다.")
        case "EXPERT_ROLE_REQUIRED": return .empty("고수로 등록된 계정이 아닙니다.")
        case "EXPERT_PROFILE_REQUIRED": return .empty("고수 프로필이 아직 없습니다.")
        default: return .failed(network: false, code: error.code)
        }
    }
}

struct ExpertProfileView: View {
    @StateObject private var model = ExpertProfileModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            expertTitle("프로필")
            switch model.state {
            case .loading:
                expertLoading()
            case .empty(let message):
                expertEmpty(message, onRetry: model.load)
            case .failed(let network, let code):
                expertFailure(network: network, code: code, onRetry: model.load)
            case .ready(let profile):
                ExpertProfileForm(profile: profile, save: model.save, onSave: model.save)
                    .id(profile)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.white)
        .accessibilityIdentifier("expert-profile")
        .task { model.load() }
    }
}

struct ExpertProfileForm: View {
    let profile: ExpertProfile
    let save: ExpertSaveState
    let onSave: (String, String, String) -> Void
    @State private var introduction: String
    @State private var career: String
    @State private var activityRegion: String

    init(profile: ExpertProfile, save: ExpertSaveState, onSave: @escaping (String, String, String) -> Void) {
        self.profile = profile
        self.save = save
        self.onSave = onSave
        _introduction = State(initialValue: profile.introduction)
        _career = State(initialValue: profile.career)
        _activityRegion = State(initialValue: profile.activityRegion)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                expertField("소개", text: $introduction, lines: 4, limit: 1000)
                    .accessibilityIdentifier("profile-field-introduction")
                expertField("경력", text: $career, lines: 6, limit: 2000)
                    .accessibilityIdentifier("profile-field-career")
                expertField("활동지역", text: $activityRegion, lines: 1, limit: 100)
                    .accessibilityIdentifier("profile-field-activity-region")
                Button {
                    onSave(introduction, career, activityRegion)
                } label: {
                    expertCopy(save == .saving ? "저장 중…" : "저장", size: 15, semibold: true, color: .white)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(DesignTokens.navy, in: RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .disabled(save == .saving)
                .accessibilityIdentifier("profile-save")
                switch save {
                case .idle, .saving:
                    EmptyView()
                case .saved(let message):
                    expertCopy(message, size: 13, color: DesignTokens.muted)
                        .accessibilityIdentifier("profile-save-saved")
                case .failed(let network, let code):
                    expertCopy(network ? "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
                                       : "저장하지 못했습니다. (\(code))", size: 13)
                        .accessibilityIdentifier(network ? "profile-save-network" : "profile-save-error")
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 8)
        }
    }
}

/// WS-42 화면 두 개가 함께 쓰는 표시 도우미. 공통 파일(App.swift)을 건드리지 않는다.
func expertCopy(_ text: String, size: CGFloat = 14, bold: Bool = false,
                semibold: Bool = false, color: Color = DesignTokens.navy) -> some View {
    Text(text)
        .font(.custom(semibold ? "Pretendard-SemiBold" : (bold ? "Pretendard-Bold" : "Pretendard-Regular"), size: size, relativeTo: .body))
        .foregroundStyle(color)
        .fixedSize(horizontal: false, vertical: true)
}

func expertTitle(_ text: String) -> some View {
    expertCopy(text, size: 20, bold: true).accessibilityAddTraits(.isHeader)
        .padding(.leading, 20).padding(.top, 16).padding(.bottom, 8)
}

func expertLoading() -> some View {
    HStack(spacing: 10) {
        ProgressView().controlSize(.small)
        expertCopy("불러오는 중입니다…", color: DesignTokens.muted)
    }
    .padding(20).frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("expert-loading")
}

func expertEmpty(_ message: String, onRetry: @escaping () -> Void) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        expertCopy(message, color: DesignTokens.muted)
        Button("새로고침", action: onRetry).frame(minHeight: 48)
            .accessibilityIdentifier("expert-retry")
    }
    .padding(20).frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
    .padding(20)
    .accessibilityIdentifier("expert-empty")
}

func expertFailure(network: Bool, code: String, onRetry: @escaping () -> Void) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        expertCopy(network ? "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
                           : "정보를 불러오지 못했습니다. (\(code))")
        Button("다시 시도", action: onRetry).frame(minHeight: 48)
            .accessibilityIdentifier("expert-retry")
    }
    .padding(20).frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
    .padding(20)
    .accessibilityIdentifier(network ? "expert-network-failure" : "expert-error")
}

func expertField(_ label: String, text: Binding<String>, lines: Int, limit: Int) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        expertCopy(label, size: 13, color: DesignTokens.muted)
        TextField(label, text: text, axis: .vertical)
            .lineLimit(lines, reservesSpace: lines > 1)
            .textFieldStyle(.plain)
            .font(.custom("Pretendard-Regular", size: 14, relativeTo: .body))
            .foregroundStyle(DesignTokens.navy)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
            .onChange(of: text.wrappedValue) { _, newValue in
                if newValue.count > limit { text.wrappedValue = String(newValue.prefix(limit)) }
            }
    }
}
