import Foundation

enum KGAuthAction: String {
    case BACK, CANCEL, BROWSE, START_SOCIAL, OPEN, OPEN_DOCUMENT, RETRY_DOCUMENT
    case CHANGE_INPUT, CHANGE_CONSENT, CHANGE_ALL_CONSENTS, SUBMIT_CONSENTS, SUBMIT_MEMBER
    case SEND_SMS, VERIFY_SMS, VERIFY_LINK_OWNERSHIP, CONFIRM_LINK, OTHER_LOGIN, SUPPORT, REFRESH_ACCOUNT
    case CONFIRM_WITHDRAW, CONTINUE_REJOIN, WITHDRAW_MARKETING, CONFIRM_LOGOUT
    case CHANGE_NOTIFICATION, OPEN_OS_SETTINGS
}
struct KGAuthEvent { let action: KGAuthAction; var key = ""; var value = "" }
enum KGAuthDocumentKind: String, CaseIterable { case TERMS, PRIVACY_CONSENT, PRIVACY_POLICY, MARKETING, OPERATIONS }
enum KGAuthDocumentStatus { case PREPARING, LOADING, READY, DRAFT, ERROR }
struct KGAuthDocument {
    let kind: KGAuthDocumentKind
    let title: String
    var status: KGAuthDocumentStatus
    var body = ""
    var version = ""
    var effectiveDate = ""
    var `operator` = ""
    var serverConsentEligible: Bool? = nil
    var canConsent: Bool {
        if let serverConsentEligible { return serverConsentEligible }
        return
        status == .READY && !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !effectiveDate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !`operator`.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
struct KGAuthConsentOption {
    let id: String
    let title: String
    let required: Bool
    var document: KGAuthDocumentKind? = nil
}
struct KGAuthConsentRecord { let title, version, status, recordedAt: String }
let KGAuthSignupOptions = [
    KGAuthConsentOption(id: "age14", title: "만 14세 이상입니다.", required: true),
    KGAuthConsentOption(id: "terms", title: "김고수 서비스 이용약관 동의", required: true, document: .TERMS),
    KGAuthConsentOption(id: "privacy", title: "개인정보 수집 및 이용 동의", required: true, document: .PRIVACY_CONSENT),
    KGAuthConsentOption(id: "marketing", title: "마케팅 정보 수신 동의", required: false, document: .MARKETING)
]
struct KGAuthState {
    var screen: KGAuthScreen
    var busy = false
    var preview = false
    var policyReady = true
    var inputs: [String: String] = [:]
    var accepted: Set<String> = []
    var options = KGAuthSignupOptions
    var documents: [KGAuthDocumentKind: KGAuthDocument] = [:]
    var selectedDocument = KGAuthDocumentKind.TERMS
    var records: [KGAuthConsentRecord] = []
    var notifications: [String: Bool] = [:]
    var marketingConsented = false
    var osPermission = "확인 중"
    var smsAvailable = false
    var canSendSms = false
    var challengeActive = false
    var remainingSeconds = 0
    var withdrawalAcknowledged = false
    var nickname = ""
    var email = ""
    var customerNumber = ""
    var provider = ""
    var detail = ""
    var error = ""
    var supportAvailable = false
    var linkOwnershipVerified = false
    func input(_ key: String) -> String { inputs[key, default: ""] }
    func consentEnabled(_ option: KGAuthConsentOption) -> Bool {
        !busy && (option.document == nil || documents[option.document!]?.canConsent == true)
    }
    var canContinue: Bool {
        !busy && policyReady && options.contains { $0.required } && options.filter { $0.required }.allSatisfy {
            accepted.contains($0.id) && consentEnabled($0)
        }
    }
    var canSend: Bool { !busy && smsAvailable && canSendSms && KGAuthInput.validPhone(input("phone")) }
    var canVerify: Bool {
        !busy && smsAvailable && challengeActive && remainingSeconds > 0 &&
        KGAuthInput.validPhone(input("phone")) && KGAuthInput.validCode(input("code")) &&
        ![KGAuthScreen.SMS_DUPLICATE, .SMS_SEND_ERROR, .SMS_EXPIRED].contains(screen)
    }
    var canSubmitMember: Bool {
        !busy && !input("name").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        KGAuthInput.validEmail(input("email")) && (input("nickname").isEmpty || KGAuthInput.validNickname(input("nickname")))
    }
}
enum KGAuthInput {
    static func phone(_ value: String) -> String { String(value.filter { $0 >= "0" && $0 <= "9" }.prefix(11)) }
    static func code(_ value: String) -> String { String(value.filter { $0 >= "0" && $0 <= "9" }.prefix(5)) }
    static func withdrawalDetail(_ value: String) -> String { String(String.UnicodeScalarView(value.unicodeScalars.prefix(500))) }
    static func validPhone(_ value: String) -> Bool { value.range(of: "^010[0-9]{8}$", options: .regularExpression) != nil }
    static func validCode(_ value: String) -> Bool { value.range(of: "^[0-9]{5}$", options: .regularExpression) != nil }
    static func validNickname(_ value: String) -> Bool {
        (1...10).contains(value.unicodeScalars.count) && value.range(of: "^[\\p{L}\\p{N}]+$", options: .regularExpression) != nil
    }
    static func validEmail(_ value: String) -> Bool { value.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil }
}
