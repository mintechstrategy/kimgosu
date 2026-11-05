import SwiftUI
import UIKit

struct KGAuthView: View {
    let state: KGAuthState
    let onEvent: (KGAuthEvent) -> Void
    private var surface: KGAuthSurface { KGAuthSurfaces[state.screen]! }
    var body: some View {
        // 알림 설정·동의 화면은 자체 모델과 4상태를 가진 화면이 그린다(WS-87). 나머지 회원 화면은 그대로 둔다.
        if state.screen == .F4_NOTI || state.screen == .CONSENT_HISTORY {
            KGAlarmConsentView(start: state.screen == .F4_NOTI ? .notifications : .history) { send(.BACK) }
        } else {
            page
        }
    }
    private var page: some View {
        VStack(spacing: 0) {
            HStack {
                Button { send(.BACK) } label: {
                    Image(systemName: [.E1, .E2_TERMS, .E2_SMS].contains(state.screen) ? "xmark" : "chevron.left")
                        .frame(width: 44, height: 44)
                }.accessibilityLabel("닫기 또는 이전 화면")
                kgCopy(surface.title, size: 18, bold: true).frame(maxWidth: .infinity)
                environmentMarker
            }.padding(.horizontal, 20)
            if state.preview {
                kgCopy("개발용 UI 예시 · 실제 인증·동의·거래 아님", size: 12)
                    .frame(maxWidth: .infinity).padding(8).background(DesignTokens.soft)
            }
            if state.busy { ProgressView("처리 중").padding(8).accessibilityLabel("처리 중") }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    content
                    if !state.detail.isEmpty { panel(state.detail) }
                    if !state.error.isEmpty { kgCopy(state.error, color: .red).accessibilityIdentifier("auth-error") }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.vertical, 20)
            }.scrollDismissesKeyboard(.interactively)
            footer
        }.background(Color.white).foregroundStyle(DesignTokens.navy).tint(DesignTokens.navy)
            .font(.custom("Pretendard-Regular", size: 14, relativeTo: .body))
            .preferredColorScheme(.light)
    }
    @ViewBuilder private var content: some View {
        switch surface.family {
        case "login": login
        case "terms": terms
        case "sms": sms
        case "document": document
        case "account": account
        case "withdraw": withdraw
        case "member": member
        default: status
        }
    }
    // 개발 빌드에서만 44pt 슬롯 안쪽에 환경 표시를 그린다. 운영 빌드는 기존과 같은 빈 슬롯이므로 제목 위치가 바뀌지 않는다.
    @ViewBuilder private var environmentMarker: some View {
        #if DEBUG
        if KGEnvironment.isConfigured && !KGEnvironment.isProduction {
            kgCopy(KGEnvironment.label, size: 10, bold: true, color: DesignTokens.muted)
                .padding(.horizontal, 6).frame(minHeight: 18)
                .background(DesignTokens.soft, in: Capsule()).overlay(Capsule().stroke(DesignTokens.border))
                .frame(width: 44, height: 44, alignment: .trailing)
                .accessibilityElement().accessibilityLabel("개발 서버 연결")
        } else {
            Color.clear.frame(width: 44, height: 44)
        }
        #else
        Color.clear.frame(width: 44, height: 44)
        #endif
    }
    private func send(_ action: KGAuthAction, _ key: String = "", _ value: String = "") { onEvent(KGAuthEvent(action: action, key: key, value: value)) }
    private func heading(_ text: String) -> some View { kgCopy(text, size: 20, bold: true).accessibilityAddTraits(.isHeader) }
    private func panel(_ text: String) -> some View {
        kgCopy(text).frame(maxWidth: .infinity, alignment: .leading).padding(14).background(DesignTokens.soft, in: RoundedRectangle(cornerRadius: 6))
    }
    private func action(_ title: String, enabled: Bool = true, primary: Bool = false, _ event: KGAuthAction, key: String = "") -> some View {
        Button { send(event, key) } label: {
            kgCopy(title, size: primary ? 15 : 14, bold: primary, color: enabled ? (primary ? .white : DesignTokens.navy) : DesignTokens.muted)
                .frame(maxWidth: .infinity, minHeight: 48).padding(.horizontal, 12)
                .background(primary ? (enabled ? DesignTokens.navy : DesignTokens.border) : .white, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(primary ? .clear : DesignTokens.border))
        }.disabled(!enabled)
    }
    private var login: some View {
        VStack(spacing: 20) {
            kgCopy("김고수", size: 34, bold: true).padding(.top, 16)
            kgCopy(surface.body, size: 20, bold: true).multilineTextAlignment(.center)
            Image(uiImage: UIImage(named: "MobileAssets/app_icon.png")!)
                .resizable().scaledToFit().frame(width: 146, height: 146)
                .padding(8).frame(maxWidth: .infinity)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border)).accessibilityLabel("우리동네 김고수")
            provider("kakao", "카카오로 시작", DesignTokens.kakao)
            provider("naver", "네이버로 시작", DesignTokens.naver)
            provider("google", "Google로 시작", .white)
            #if DEBUG
            devLoginSection
            #endif
        }.frame(maxWidth: .infinity)
    }
    #if DEBUG
    // 승인 디자인의 소셜 로그인 버튼은 그대로 두고, 개발 환경에서만 실제 서버 세션을 만드는
    // 임시 테스트 로그인을 덧붙인다. 운영 빌드에는 컴파일되지 않는다.
    @ViewBuilder private var devLoginSection: some View {
        if KGEnvironment.isConfigured && !KGEnvironment.isProduction {
            VStack(alignment: .leading, spacing: 10) {
                Divider().overlay(DesignTokens.border)
                kgCopy("개발용 테스트 계정 · 실제 서버 세션 발급", size: 12, color: DesignTokens.muted)
                if state.devAccounts.isEmpty {
                    action(state.devAccountsLoading ? "테스트 계정 목록 불러오는 중…" : "테스트 계정 목록 불러오기",
                           enabled: !state.busy && !state.devAccountsLoading, .LOAD_DEV_ACCOUNTS)
                    if state.devAccountsError {
                        kgCopy("테스트 계정 목록을 불러오지 못했습니다. 네트워크를 확인해주세요.", size: 12, color: .red)
                            .accessibilityIdentifier("dev-accounts-error")
                    }
                } else {
                    Menu {
                        ForEach(state.devAccounts) { account in
                            Button("\(account.slot). \(account.label) · \(account.nickname)") {
                                send(.CHANGE_INPUT, "devSlot", String(account.slot))
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            kgCopy(selectedDevAccountText, size: 14)
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.down").font(.system(size: 12)).foregroundStyle(DesignTokens.muted)
                        }.padding(12).frame(maxWidth: .infinity, minHeight: 48).overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                    }.accessibilityIdentifier("dev-account-menu")
                    action("테스트 계정으로 로그인", enabled: !state.busy, primary: true, .DEV_LOGIN)
                }
            }.padding(.top, 4).accessibilityIdentifier("dev-login-section")
        }
    }
    private var selectedDevAccountText: String {
        guard let slot = Int(state.input("devSlot")), let account = state.devAccounts.first(where: { $0.slot == slot }) else { return "테스트 계정 선택" }
        return "\(account.label) · \(account.nickname)"
    }
    #endif
    private func provider(_ id: String, _ title: String, _ color: Color) -> some View {
        Button { send(.START_SOCIAL, id) } label: {
            HStack(spacing: 12) {
                if id == "google" {
                    Image(uiImage: UIImage(named: "MobileAssets/google-g.png")!).resizable().scaledToFit().frame(width: 18, height: 18).accessibilityHidden(true)
                }
                kgCopy(title, size: 16, color: id == "naver" ? .white : Color(white: 0.12))
            }.frame(maxWidth: .infinity, minHeight: 48).background(color, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(id == "google" ? DesignTokens.googleBorder : .clear))
        }.disabled(state.busy).accessibilityLabel(title)
    }
    private func check(_ label: String, checked: Bool, enabled: Bool, change: @escaping (Bool) -> Void) -> some View {
        Button { change(!checked) } label: {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .foregroundStyle(DesignTokens.navy).background(checked ? DesignTokens.lime : .white).font(.system(size: 20))
                kgCopy(label).frame(maxWidth: .infinity, alignment: .leading)
            }.frame(minHeight: 48)
        }.disabled(!enabled).accessibilityLabel(label).accessibilityValue(checked ? "선택됨" : "선택 안 됨")
            .accessibilityAddTraits(checked ? .isSelected : [])
    }
    private var terms: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading(surface.heading); kgCopy(surface.body)
            if state.screen == .E2_TERMS {
                check("약관 전체 동의 (선택 포함)", checked: state.options.allSatisfy { state.accepted.contains($0.id) }, enabled: !state.busy) {
                    send(.CHANGE_ALL_CONSENTS, "", String($0))
                }
            }
            ForEach(state.options, id: \.id) { option in
                VStack(alignment: .leading, spacing: 0) {
                    check("[\(option.required ? "필수" : "선택")] \(option.title)", checked: state.accepted.contains(option.id), enabled: state.consentEnabled(option)) {
                        send(.CHANGE_CONSENT, option.id, String($0))
                    }
                    if let kind = option.document {
                        Button { send(.OPEN_DOCUMENT, kind.rawValue) } label: { kgCopy("전문 보기  ›", color: DesignTokens.muted).frame(minHeight: 44) }
                        if state.documents[kind]?.canConsent != true { kgCopy("문서 준비·승인 확인 후 동의할 수 있습니다.", size: 12, color: DesignTokens.muted) }
                    }
                }
            }
            action("서비스 운영정책 열람", .OPEN_DOCUMENT, key: KGAuthDocumentKind.OPERATIONS.rawValue)
            action("개인정보 처리방침 열람", .OPEN_DOCUMENT, key: KGAuthDocumentKind.PRIVACY_POLICY.rawValue)
        }
    }
    private func input(_ key: String, _ label: String, keyboard: UIKeyboardType = .default, multiline: Bool = false) -> some View {
        let binding = Binding<String>(get: { state.input(key) }, set: { value in
            let filtered: String
            switch key {
            case "phone": filtered = KGAuthInput.phone(value)
            case "code": filtered = KGAuthInput.code(value)
            case "withdrawDetail": filtered = KGAuthInput.withdrawalDetail(value)
            default: filtered = value
            }
            send(.CHANGE_INPUT, key, filtered)
        })
        return VStack(alignment: .leading, spacing: 8) {
            kgCopy(label, bold: true)
            TextField(label, text: binding, axis: multiline ? .vertical : .horizontal)
                .lineLimit(multiline ? 3...5 : 1...1).keyboardType(keyboard).textInputAutocapitalization(.never)
                .autocorrectionDisabled().padding(12).frame(minHeight: 48)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(DesignTokens.border))
                .disabled(state.busy).accessibilityLabel(label)
                .textContentType(key == "code" ? .oneTimeCode : (key == "email" ? .emailAddress : nil))
        }
    }
    private var sms: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading(surface.heading); kgCopy(surface.body)
            input("phone", "휴대폰 번호 · 010 시작 숫자 11자리", keyboard: .phonePad)
            if !state.input("phone").isEmpty && !KGAuthInput.validPhone(state.input("phone")) { kgCopy("010으로 시작하는 숫자 11자리를 입력해주세요.", size: 12) }
            action(state.screen == .E2_SMS ? "인증번호 전송" : "인증번호 재전송", enabled: state.canSend, .SEND_SMS)
            if !state.smsAvailable { panel("문자 인증 서비스 연결 준비 중입니다. 실제 문자는 발송되지 않으며 가입을 완료할 수 없습니다.") }
            if state.challengeActive { kgCopy("남은 시간 \(max(0, state.remainingSeconds))초 · 인증번호 5자리") }
            input("code", "인증번호 · 숫자 5자리", keyboard: .numberPad)
            kgCopy("재전송하면 이전 인증번호는 사용할 수 없습니다. SMS 점유 인증은 실명 확인이 아닙니다.", size: 12, color: DesignTokens.muted)
            if state.screen == .SMS_DUPLICATE { action("계정 확인", .OTHER_LOGIN) }
        }
    }
    private var document: some View {
        let kind = surface.document ?? state.selectedDocument
        let doc = state.documents[kind]
        let status = state.screen == .LEGAL_ERROR ? KGAuthDocumentStatus.ERROR : (doc?.status ?? .PREPARING)
        return VStack(alignment: .leading, spacing: 16) {
            heading(doc?.title ?? surface.heading)
            if !surface.body.isEmpty { kgCopy(surface.body) }
            switch status {
            case .LOADING: ProgressView("문서를 불러오는 중입니다.")
            case .PREPARING: panel("문서 준비 중입니다. 운영자 정보·시행일·법률 검토를 확인한 후 제공됩니다.")
            case .ERROR:
                panel("문서를 확인할 수 없습니다. 동의는 진행되지 않습니다.")
                action("다시 시도", enabled: !state.busy, .RETRY_DOCUMENT, key: kind.rawValue)
            case .READY, .DRAFT:
                if let doc {
                    if !doc.canConsent { panel("사용자 검토용 초안 · 법률 확정·실제 동의용 아님") }
                    kgCopy("버전: \(doc.version.isEmpty ? "미확정" : doc.version)\n시행일: \(doc.effectiveDate.isEmpty ? "미확정" : doc.effectiveDate)\n운영자: \(doc.operator.isEmpty ? "미확정" : doc.operator)", size: 12, color: DesignTokens.muted)
                    kgCopy(doc.body).textSelection(.enabled)
                }
            }
            kgCopy("문서를 열거나 닫는 동작은 동의가 아닙니다.", size: 12, color: DesignTokens.muted)
        }
    }
    private var account: some View {
        VStack(alignment: .leading, spacing: 16) {
            action("프로필 수정 · 후속 단계", enabled: false, .OPEN, key: "PROFILE_EDIT")
            HStack(spacing: 12) {
                Image(systemName: "person").font(.system(size: 24)).padding(12).background(DesignTokens.soft, in: Circle()).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    kgCopy(state.nickname.isEmpty ? "회원 정보 확인 중" : state.nickname, bold: true)
                    kgCopy(state.email, size: 12, color: DesignTokens.muted)
                    kgCopy("고객번호 \(state.customerNumber.isEmpty ? "서버 확인 중" : state.customerNumber)", size: 12, color: DesignTokens.muted)
                }
            }
            action("견적요청/서비스 관리 · 후속 단계", enabled: false, .OPEN)
            action("찜한 전문가 · 후속 단계", enabled: false, .OPEN)
            action("알림 설정", enabled: !state.busy, .OPEN, key: "F4_NOTI")
            action("동의 내역·철회", enabled: !state.busy, .OPEN, key: "CONSENT_HISTORY")
            action("서비스 운영정책", enabled: !state.busy, .OPEN, key: "OPERATIONS_DOC")
            action("로그아웃", enabled: !state.busy, .OPEN, key: "LOGOUT_CONFIRM")
            action("회원탈퇴", enabled: !state.busy, .OPEN, key: "F5")
            action("고객센터", enabled: !state.busy && state.supportAvailable, .SUPPORT)
            action("고수 모드 · 후속 단계", enabled: false, .OPEN)
            kgCopy("고수는 필수정보 입력·신청 후 즉시 활성화합니다. 자격 인증 배지는 별도 확인 전 표시하지 않습니다.", size: 12, color: DesignTokens.muted)
        }
    }
    private var withdraw: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading(surface.heading); panel(surface.body)
            check("위 안내 사항을 확인하고 동의합니다.", checked: state.withdrawalAcknowledged, enabled: !state.busy) { send(.CHANGE_CONSENT, "withdrawAcknowledged", String($0)) }
            heading("탈퇴 사유가 무엇인가요?")
            ForEach(["알림이 너무 많이와요", "사용하기 어려워요", "오류가 많아서 불편해요", "기타"], id: \.self) { reason in
                Button { send(.CHANGE_INPUT, "withdrawReason", reason) } label: {
                    HStack(spacing: 12) { Image(systemName: state.input("withdrawReason") == reason ? "largecircle.fill.circle" : "circle"); kgCopy(reason); Spacer() }.frame(minHeight: 44)
                }.disabled(state.busy).accessibilityValue(state.input("withdrawReason") == reason ? "선택됨" : "선택 안 됨")
            }
            input("withdrawDetail", "상세 사유 (선택, 최대 500자)", multiline: true)
            kgCopy("\(state.input("withdrawDetail").unicodeScalars.count)/500", size: 12, color: DesignTokens.muted).frame(maxWidth: .infinity, alignment: .trailing)
        }
    }
    private var member: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading(surface.heading); kgCopy(surface.body)
            input("name", "이름 (필수)")
            input("email", "이메일 (필수)", keyboard: .emailAddress)
            input("nickname", "자동 생성 닉네임 수정 (선택)")
            if !state.input("nickname").isEmpty && !KGAuthInput.validNickname(state.input("nickname")) { kgCopy("닉네임은 문자·숫자만 최대 10자입니다. 공백·특수문자를 제외해주세요.", size: 12) }
            kgCopy("공급자 필수정보가 없으면 확인·보완 후 진행합니다. 고객번호와 자동 닉네임은 서버가 부여합니다.", size: 12, color: DesignTokens.muted)
        }
    }
    private var status: some View {
        VStack(alignment: .leading, spacing: 16) {
            heading(surface.heading); panel(surface.body)
            if state.screen == .ACCOUNT_LINK && !state.provider.isEmpty { kgCopy("연결할 로그인: \(state.provider)") }
            if let event = surface.action {
                action(surface.actionLabel, enabled: statusEnabled(event), primary: true, event)
            }
            if state.screen == .ACCOUNT_LINK && !state.linkOwnershipVerified {
                kgCopy("계정 소유 확인이 완료되면 연결할 수 있습니다.", size: 12)
                action("계정 소유 다시 확인", enabled: !state.busy, .VERIFY_LINK_OWNERSHIP)
            }
            if state.screen == .HOME_SIGNED_OUT { action("로그인/가입", .OPEN, key: "E1") }
            if [.ACCOUNT_RESTRICTED, .RESTRICTION_CARRIED].contains(state.screen) { action("홈으로", .BROWSE) }
            action(["sheet", "modal"].contains(surface.kind) ? "취소" : "돌아가기", .CANCEL)
        }
    }
    private func statusEnabled(_ event: KGAuthAction) -> Bool {
        guard !state.busy else { return false }
        switch event {
        case .SUPPORT: return state.supportAvailable
        case .CONFIRM_LINK: return state.linkOwnershipVerified
        case .CONFIRM_WITHDRAW: return state.withdrawalAcknowledged
        case .WITHDRAW_MARKETING: return state.marketingConsented
        default: return true
        }
    }
    @ViewBuilder private var footer: some View {
        if ["login", "terms", "sms", "withdraw", "member", "document"].contains(surface.family) {
            Divider().overlay(DesignTokens.border)
            Group {
                switch surface.family {
                case "login": action("둘러보기", .BROWSE)
                case "terms": action(state.busy ? "처리 중…" : (state.screen == .RECONSENT ? "필수 정책 동의" : "다음 단계"), enabled: state.canContinue, primary: true, .SUBMIT_CONSENTS)
                case "sms": action(state.busy ? "처리 중…" : "회원가입 완료", enabled: state.canVerify, primary: true, .VERIFY_SMS)
                case "withdraw": action(state.busy ? "처리 중…" : "회원 탈퇴하기", enabled: state.withdrawalAcknowledged && !state.busy, primary: true, .OPEN, key: "WITHDRAW_CONFIRM")
                case "member": action(state.busy ? "처리 중…" : "정보 확인 후 계속", enabled: state.canSubmitMember, primary: true, .SUBMIT_MEMBER)
                default: action("닫기", .BACK)
                }
            }.padding(.horizontal, 20).padding(.vertical, 8)
        }
    }
}
private func kgCopy(_ text: String, size: CGFloat = 14, bold: Bool = false, color: Color = DesignTokens.navy) -> some View {
    Text(text).font(.custom(bold ? "Pretendard-Bold" : "Pretendard-Regular", size: size, relativeTo: .body))
        .foregroundStyle(color).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
}
private struct KGAuthSwitchStyle: ToggleStyle {
    let label: String
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 16) {
            configuration.label.font(.custom("Pretendard-SemiBold", size: 14, relativeTo: .body)).frame(maxWidth: .infinity, alignment: .leading)
            Button { configuration.isOn.toggle() } label: {
                Capsule().fill(configuration.isOn ? DesignTokens.lime : DesignTokens.track)
                    .overlay(Capsule().stroke(DesignTokens.navy))
                    .overlay(Circle().fill(DesignTokens.navy).frame(width: 18, height: 18).padding(3), alignment: configuration.isOn ? .trailing : .leading)
                    .frame(width: 40, height: 24).frame(width: 48, height: 48)
            }.accessibilityLabel(label).accessibilityValue(configuration.isOn ? "켜짐" : "꺼짐")
        }.frame(minHeight: 56)
    }
}
