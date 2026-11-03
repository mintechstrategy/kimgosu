package ai.mintech.kimgosu.auth.ui

enum class AuthAction {
    BACK, CANCEL, BROWSE, START_SOCIAL, OPEN, OPEN_DOCUMENT, RETRY_DOCUMENT,
    CHANGE_INPUT, CHANGE_CONSENT, CHANGE_ALL_CONSENTS, SUBMIT_CONSENTS, SUBMIT_MEMBER,
    SEND_SMS, VERIFY_SMS, VERIFY_LINK_OWNERSHIP, CONFIRM_LINK, OTHER_LOGIN, SUPPORT, REFRESH_ACCOUNT,
    CONFIRM_WITHDRAW, CONTINUE_REJOIN, WITHDRAW_MARKETING, CONFIRM_LOGOUT,
    CHANGE_NOTIFICATION, OPEN_OS_SETTINGS
}
data class AuthEvent(val action: AuthAction, val key: String = "", val value: String = "")
enum class AuthDocumentKind { TERMS, PRIVACY_CONSENT, PRIVACY_POLICY, MARKETING, OPERATIONS }
enum class AuthDocumentStatus { PREPARING, LOADING, READY, DRAFT, ERROR }
data class AuthDocument(
    val kind: AuthDocumentKind, val title: String, val status: AuthDocumentStatus,
    val body: String = "", val version: String = "", val effectiveDate: String = "", val operator: String = "",
    val serverConsentEligible: Boolean? = null
) {
    val canConsent: Boolean get() = serverConsentEligible ?: (status == AuthDocumentStatus.READY && body.isNotBlank() &&
        version.isNotBlank() && effectiveDate.isNotBlank() && operator.isNotBlank())
}
data class AuthConsentOption(val id: String, val title: String, val required: Boolean, val document: AuthDocumentKind? = null)
data class AuthConsentRecord(val title: String, val version: String, val status: String, val recordedAt: String)
val AuthSignupOptions = listOf(
    AuthConsentOption("age14", "만 14세 이상입니다.", true),
    AuthConsentOption("terms", "김고수 서비스 이용약관 동의", true, AuthDocumentKind.TERMS),
    AuthConsentOption("privacy", "개인정보 수집 및 이용 동의", true, AuthDocumentKind.PRIVACY_CONSENT),
    AuthConsentOption("marketing", "마케팅 정보 수신 동의", false, AuthDocumentKind.MARKETING)
)
data class AuthState(
    val screen: AuthScreen,
    val busy: Boolean = false,
    val preview: Boolean = false,
    val policyReady: Boolean = true,
    val inputs: Map<String, String> = emptyMap(),
    val accepted: Set<String> = emptySet(),
    val options: List<AuthConsentOption> = AuthSignupOptions,
    val documents: Map<AuthDocumentKind, AuthDocument> = emptyMap(),
    val selectedDocument: AuthDocumentKind = AuthDocumentKind.TERMS,
    val records: List<AuthConsentRecord> = emptyList(),
    val notifications: Map<String, Boolean> = emptyMap(),
    val marketingConsented: Boolean = false,
    val osPermission: String = "확인 중",
    val smsAvailable: Boolean = false,
    val canSendSms: Boolean = false,
    val challengeActive: Boolean = false,
    val remainingSeconds: Int = 0,
    val withdrawalAcknowledged: Boolean = false,
    val nickname: String = "",
    val email: String = "",
    val customerNumber: String = "",
    val provider: String = "",
    val detail: String = "",
    val error: String = "",
    val supportAvailable: Boolean = false,
    val linkOwnershipVerified: Boolean = false
) {
    fun input(key: String) = inputs[key].orEmpty()
    fun consentEnabled(option: AuthConsentOption) = !busy && (option.document == null || documents[option.document]?.canConsent == true)
    val canContinue: Boolean get() = !busy && policyReady && options.any { it.required } && options.filter { it.required }.all {
        it.id in accepted && consentEnabled(it)
    }
    val canSend: Boolean get() = !busy && smsAvailable && canSendSms && AuthInput.validPhone(input("phone"))
    val canVerify: Boolean get() = !busy && smsAvailable && challengeActive && remainingSeconds > 0 &&
        AuthInput.validPhone(input("phone")) && AuthInput.validCode(input("code")) &&
        screen !in listOf(AuthScreen.SMS_DUPLICATE, AuthScreen.SMS_SEND_ERROR, AuthScreen.SMS_EXPIRED)
    val canSubmitMember: Boolean get() = !busy && input("name").isNotBlank() &&
        AuthInput.validEmail(input("email")) && (input("nickname").isEmpty() || AuthInput.validNickname(input("nickname")))
}
object AuthInput {
    fun phone(value: String) = value.filter { it in '0'..'9' }.take(11)
    fun code(value: String) = value.filter { it in '0'..'9' }.take(5)
    fun withdrawalDetail(value: String): String {
        val points = value.codePoints().limit(500).toArray()
        return String(points, 0, points.size)
    }
    fun validPhone(value: String) = Regex("010[0-9]{8}").matches(value)
    fun validCode(value: String) = Regex("[0-9]{5}").matches(value)
    fun validNickname(value: String) = Regex("[\\p{L}\\p{N}]{1,10}").matches(value)
    fun validEmail(value: String) = Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+").matches(value)
}
