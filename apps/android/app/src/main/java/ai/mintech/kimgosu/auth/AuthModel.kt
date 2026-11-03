package ai.mintech.kimgosu.auth

import android.app.Application
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ai.mintech.kimgosu.auth.ui.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.time.Instant

/** Navigation context intentionally contains no token, phone, email, or pending write payload. */
data class ReturnTarget(val screenId: String = "A1", val targetId: String? = null,
    val filter: String? = null, val scroll: Int = 0, val draftReference: String? = null)
class AuthModel @JvmOverloads constructor(application: Application, private val repository: AuthRepository = AuthRepository(MembershipHttp(application))) : AndroidViewModel(application) {
    var state by mutableStateOf(AuthState(AuthScreen.E1, policyReady = false)); private set
    var browsing by mutableStateOf(false); private set
    var stack by mutableStateOf(listOf(AuthScreen.E1)); private set
    var entry by mutableStateOf("PUBLIC"); private set
    var returnTarget: ReturnTarget = ReturnTarget(); private set
    private val sessions = SecureSession(application)
    private var token: String? = null
    private var job: Job? = null
    private var sequence = 0
    private var config: JSONObject? = null
    internal var snapshot: PolicySnapshot? = null; private set
    private var version: Int? = null
    private var started = false
    private var registrationTicket: String? = null
    private var challengeId: String? = null
    private var phoneVerified = false
    private var mutationUnknown = false
    private var mutationEpoch: Int? = null
    private var countdown: Job? = null
    private var smsAnchor = 0L
    private var smsDuration = 0L
    fun setOsPermission(value: String) { state = state.copy(osPermission = value) }
    fun start() {
        if (started) return
        started = true
        execute {
            token = sessions.read()
            // A stored session enters A1 before any network call: an offline cold start must
            // show the main screen with its account-error/retry state, never the login entry.
            // Only a server rejection of the session (401) returns to the auth entry below.
            if (token != null) { stack = emptyList(); browsing = true; loadAccount() }
            else { loadConfig(); loadPolicies() }
        }
    }
    fun enter(target: ReturnTarget = ReturnTarget(), origin: String = "PROTECTED") {
        cancelRequest(); returnTarget = target; entry = origin
        stack = listOf(if (token == null) AuthScreen.E1 else AuthScreen.F1)
        show(stack.last())
        if (token != null) execute { loadAccount() }
    }
    private fun show(screen: AuthScreen) { state = state.copy(screen = screen, busy = false, error = "", detail = "") }
    private fun open(screen: AuthScreen) {
        cancelRequest()
        if (AuthSurfaces.getValue(screen).family == "document") { document(AuthSurfaces.getValue(screen).document!!); return }
        val protected = screen in listOf(AuthScreen.F1, AuthScreen.F4_NOTI, AuthScreen.CONSENT_HISTORY, AuthScreen.F5, AuthScreen.LOGOUT_CONFIRM, AuthScreen.CONSENT_WITHDRAW_CONFIRM, AuthScreen.WITHDRAW_CONFIRM)
        if (protected && token == null) { enter(returnTarget); return }
        stack = stack + screen; show(screen)
        when (screen) {
            AuthScreen.F1 -> execute { loadAccount() }
            AuthScreen.F4_NOTI, AuthScreen.CONSENT_HISTORY -> execute { loadPreferencesAndConsents() }
            AuthScreen.E2_TERMS, AuthScreen.MEMBER_INFO -> execute { loadPolicies() }
            else -> Unit
        }
    }
    private fun cancelRequest() { if (mutationEpoch == sequence) mutationUnknown = true; sequence++; job?.cancel(); job = null; state = state.copy(busy = false) }
    fun back() {
        val uncertain = state.busy && (AuthSurfaces[state.screen]?.family == "sms" || state.screen in listOf(AuthScreen.LOGOUT_CONFIRM, AuthScreen.F4_NOTI, AuthScreen.E2_TERMS, AuthScreen.CONSENT_WITHDRAW_CONFIRM))
        if (uncertain) mutationUnknown = true
        cancelRequest()
        if (stack.size > 1) { stack = stack.dropLast(1); show(stack.last()) }
        else { stack = emptyList(); browsing = true }
        if (state.screen in listOf(AuthScreen.E2_TERMS, AuthScreen.MEMBER_INFO)) refreshPolicy()
        if (uncertain) state = state.copy(error = "처리가 취소되어 결과를 확정할 수 없습니다. 다시 열어 서버 상태를 확인해주세요.")
    }
    private fun browse() { cancelRequest(); stack = emptyList(); browsing = true }
    private fun execute(block: suspend () -> Unit) {
        cancelRequest(); val current = sequence
        state = state.copy(busy = true, error = "")
        job = viewModelScope.launch {
            try { block() }
            catch (_: CancellationException) { }
            catch (e: Exception) { if (current == sequence) failure(e) }
            finally { if (current == sequence) state = state.copy(busy = false) }
        }
    }
    internal fun failure(e: Exception) {
        val api = e as? AuthFailure
        if (api?.requestContext == AuthRequestContext.PUBLIC) {
            invalidatePolicy()
            state = state.copy(error = "공개 문서·연결을 확인할 수 없습니다. 다시 시도하거나 닫아주세요. 동의는 진행되지 않습니다.")
            return
        }
        val privateRequest = api?.requestContext == AuthRequestContext.PRIVATE
        if (privateRequest && api?.code == "POLICY_VERSION_CHANGED") {
            invalidatePolicy()
            if (AuthSurfaces[state.screen]?.family == "sms") { stack = listOf(AuthScreen.E1, AuthScreen.MEMBER_INFO, AuthScreen.E2_TERMS); show(AuthScreen.E2_TERMS) }
            execute { loadPolicies(); state = state.copy(error = "정책이 변경되었습니다. 전문을 다시 확인하고 동의를 선택해주세요.") }; return
        }
        when {
            privateRequest && api?.status == 401 && api.code in listOf("AUTH_REQUIRED", "SESSION_INVALID", "SESSION_REQUIRED") -> {
                val cleared = runCatching { sessions.clear() }.isSuccess; token = null; version = null
                browsing = false
                state = state.copy(nickname = "", email = "", customerNumber = "", records = emptyList(), notifications = emptyMap(), marketingConsented = false)
                stack = listOf(AuthScreen.E1, AuthScreen.SESSION_EXPIRED); show(AuthScreen.SESSION_EXPIRED)
                entry = "SESSION_EXPIRED"
                if (!cleared) state = state.copy(error = "안전한 세션 저장소를 정리하지 못했습니다. 다시 시도해주세요.")
            }
            privateRequest && api?.status == 403 && api.code in listOf("CONSENT_RENEWAL_REQUIRED", "ACCOUNT_RESTRICTED") -> {
                val screen = if (api.code == "CONSENT_RENEWAL_REQUIRED") AuthScreen.RECONSENT else AuthScreen.ACCOUNT_RESTRICTED
                stack = stack + screen; show(screen)
                if (screen == AuthScreen.RECONSENT) state = state.copy(options = emptyList(), detail = "필수 문서의 변경 분류를 서버에서 확인하는 기능이 준비 중입니다. 임의 재동의는 받지 않습니다.")
            }
            else -> state = state.copy(error = when ((e as? AuthFailure)?.status) {
                409 -> "서버의 최신 버전과 다릅니다. 최신 설정을 다시 불러온 후 직접 변경해주세요."
                404 -> "회원 API 또는 문서가 아직 준비되지 않았습니다. 가입·동의 성공으로 처리하지 않습니다."
                else -> "서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도해주세요."
            })
        }
    }
    private suspend fun loadConfig() {
        val result = repository.config()
        require(result.has("providers") && result.has("signupReady"))
        installSnapshot(result)
        config = result
        val sms = result.getJSONObject("sms")
        val available = result.getBoolean("signupReady") && sms.getBoolean("available") && sms.getInt("codeDigits") == 5 && sms.getInt("expiresInSeconds") == 60 && sms.getString("phonePattern") == "^010[0-9]{8}$"
        state = state.copy(smsAvailable = available, canSendSms = available && registrationTicket != null && !mutationUnknown,
            detail = if (!result.getBoolean("signupReady")) "소셜 로그인·문자 인증·정식 정책 준비 중입니다. 실제 가입은 아직 완료할 수 없습니다." else "서버 인증·필수정보와 현재 문서 확인 후 가입을 진행합니다.")
    }
    private fun invalidatePolicy() {
        snapshot = null
        state = state.copy(policyReady = false, accepted = state.accepted.intersect(setOf("age14")), documents = state.documents.mapValues { (_, doc) -> doc.copy(serverConsentEligible = false) })
    }
    private fun installSnapshot(result: JSONObject): PolicySnapshot {
        val next = try { PolicySnapshot.decode(result) } catch (e: Exception) { invalidatePolicy(); throw e }
        val changed = snapshot?.identity != next.identity
        snapshot = next
        val documents = AuthDocumentKind.entries.mapNotNull { kind -> next.display(kind.name)?.let { row ->
            kind to AuthDocument(kind, row.title, if (row.status == "READY") AuthDocumentStatus.READY else AuthDocumentStatus.DRAFT,
                row.body, row.version, row.effectiveAt.orEmpty(), row.operator.orEmpty(), row.isCurrent && row.canConsent)
        } }.toMap()
        state = state.copy(documents = documents, policyReady = next.ready,
            accepted = if (changed) state.accepted.intersect(setOf("age14")) else state.accepted,
            options = state.options.map { o -> if (o.document == null) o else o.copy(required = o.document.name in next.requirements.requiredGrantKinds) })
        return next
    }
    private suspend fun loadPolicies() {
        try { installSnapshot(repository.policies()) } catch (e: Exception) { if (e !is CancellationException) invalidatePolicy(); throw e }
    }
    /** Explicit fresh fetch on entry/return/resume; never time-cache or replay a mutation. */
    fun refreshPolicy() {
        if (!started || stack.isEmpty() || state.screen in listOf(AuthScreen.F4_NOTI, AuthScreen.LOGOUT_CONFIRM)) return
        val kind = AuthSurfaces[state.screen]?.document
        if (kind != null) document(kind, true) else execute { loadPolicies() }
    }
    private fun document(kind: AuthDocumentKind, retry: Boolean = false) {
        if (!retry) {
            cancelRequest(); val screen = AuthSurfaces.entries.first { it.value.document == kind }.key
            stack = stack + screen; show(screen)
        }
        state = state.copy(selectedDocument = kind, policyReady = false,
            documents = state.documents + (kind to AuthDocument(kind, "문서 확인", AuthDocumentStatus.LOADING)))
        execute {
            try {
                val result = repository.policy(kind.name)
                val next = PolicySnapshot.decode(result)
                val selected = next.display(kind.name) ?: throw PolicySnapshot.invalid()
                require(result.get("id") == selected.id && result.get("version") == selected.version && result.get("bodySha256") == selected.bodySha256 && result.get("body") == selected.body)
                installSnapshot(result)
            } catch (e: Exception) {
                if (e !is CancellationException) {
                    invalidatePolicy()
                    state = state.copy(documents = mapOf(kind to AuthDocument(kind, "문서 확인", if ((e as? AuthFailure)?.status == 404) AuthDocumentStatus.PREPARING else AuthDocumentStatus.ERROR)))
                }
                throw e
            }
        }
    }
    private fun confirmPolicy(message: String) {
        val selected = snapshot?.identity
        execute {
            loadPolicies()
            state = state.copy(error = if (selected != snapshot?.identity) "정책이 변경되었습니다. 전문을 다시 확인하고 동의를 선택해주세요." else message)
        }
    }
    private suspend fun loadAccount() {
        val t = token ?: throw AuthFailure(401, "SESSION_REQUIRED", AuthRequestContext.PRIVATE)
        val me = repository.me(t)
        require(me.getString("status") in listOf("ACTIVE", "RESTRICTED"))
        state = state.copy(nickname = me.getString("nickname"), email = me.getString("email"), customerNumber = me.getString("customerNumber"))
        if (me.getString("status") == "RESTRICTED") {
            stack = listOf(AuthScreen.F1, AuthScreen.ACCOUNT_RESTRICTED); show(AuthScreen.ACCOUNT_RESTRICTED)
        }
    }
    private fun preferences(json: JSONObject) {
        val keys = listOf("advertising", "chat", "comment", "quote", "inquiry")
        val v = json.getInt("version"); require(v >= 0)
        version = v; state = state.copy(notifications = keys.associateWith { json.getBoolean(it) })
    }
    private suspend fun loadPreferencesAndConsents() {
        val t = token ?: throw AuthFailure(401, "SESSION_REQUIRED", AuthRequestContext.PRIVATE)
        val records = repository.consents(t).getJSONArray("records")
        var marketing = false
        val parsed = List(records.length()) { i ->
            val r = records.getJSONObject(i)
            if (r.getString("kind") == "MARKETING") marketing = r.getString("status") == "GRANTED"
            AuthConsentRecord(r.getString("title"), r.getString("version"), r.getString("status"), r.getString("recordedAt"))
        }
        state = state.copy(records = parsed, marketingConsented = marketing)
        preferences(repository.notifications(t))
    }
    /** For a future approved OAuth callback only. Must revalidate before granting member UI. */
    fun establishVerifiedSession(bearer: String) {
        execute {
            val me = repository.me(bearer)
            require(me.getString("status") in listOf("ACTIVE", "RESTRICTED"))
            sessions.write(bearer); token = bearer; mutationUnknown = false
            loadAccount()
            // No previous mutation is replayed. Original home and its draft/scroll remain mounted.
            if (me.getString("status") == "ACTIVE") { stack = emptyList(); browsing = true }
        }
    }
    /** Normal provider-result boundary. Caller owns verified single-use callback state binding.
     * No browser/native registration is invented here; test-only hosts may pass real local backend results. */
    fun acceptRegistrationResult(result: JSONObject) {
        require(result.getString("outcome") == "REGISTRATION_REQUIRED")
        val ticket = result.getString("registrationTicket")
        require(ticket.matches(Regex("[A-Za-z0-9_-]{43}")) && result.getInt("expiresInSeconds") > 0)
        cancelRequest(); countdown?.cancel(); registrationTicket = ticket; challengeId = null; phoneVerified = false; mutationUnknown = false
        state = AuthState(AuthScreen.MEMBER_INFO, policyReady = false); stack = listOf(AuthScreen.E1, AuthScreen.MEMBER_INFO)
        execute { loadConfig(); loadPolicies() }
    }
    private fun validMember() = state.input("name").isNotBlank() && AuthInput.validEmail(state.input("email")) && state.input("nickname").isEmpty()
    private fun selectedKinds() = state.options.filter { it.id in state.accepted }.mapNotNull { it.document?.name }
    private suspend fun freshConfirmation(): PolicySnapshot? {
        val selected = snapshot?.identity; loadPolicies()
        if (selected != snapshot?.identity || !state.policyReady) {
            if (AuthSurfaces[state.screen]?.family == "sms") { stack = stack.dropLastWhile { it != AuthScreen.E2_TERMS }; if (stack.isEmpty()) stack = listOf(AuthScreen.E1, AuthScreen.MEMBER_INFO, AuthScreen.E2_TERMS); show(AuthScreen.E2_TERMS) }
            state = state.copy(error = "정책이 변경되었습니다. 전문을 다시 확인하고 동의를 선택해주세요."); return null
        }
        return snapshot
    }
    private fun unknown() {
        mutationUnknown = true
        state = state.copy(canSendSms = false, error = "처리 결과를 확정할 수 없습니다. UNKNOWN · 자동 재전송하지 않습니다. 서버 내역을 확인하거나 새 인증을 진행해주세요.")
    }
    private suspend fun mutation(block: suspend () -> Unit) {
        val current = sequence; mutationEpoch = current
        try { block() } catch (e: CancellationException) { if (current == sequence) mutationUnknown = true; throw e }
        catch (e: Exception) { if (current != sequence) return; if (e !is AuthFailure || e.status !in 400..499 || e.code == "INVALID_API_RESPONSE") { unknown(); return }; throw e }
        finally { if (mutationEpoch == current) mutationEpoch = null }
    }
    private suspend fun verifyConsentReadback(t: String, expected: PolicySnapshot, kinds: List<String>) {
        val records = repository.consents(t).getJSONArray("records")
        require(kinds.all { kind -> (0 until records.length()).any { i -> val r = records.getJSONObject(i); r.getString("kind") == kind && r.getString("version") == expected.current(kind)?.version && r.getString("status") == "GRANTED" } })
        loadPreferencesAndConsents()
    }
    private fun submitConsents() {
        val kinds = selectedKinds()
        execute {
            val fresh = freshConfirmation() ?: return@execute
            val t = token
            if (t == null) {
                check(registrationTicket != null && validMember())
                loadConfig(); if (!state.smsAvailable) return@execute
                stack = stack + AuthScreen.E2_SMS; show(AuthScreen.E2_SMS)
            } else mutation {
                require(repository.recordConsents(t, fresh, kinds).getBoolean("recorded"))
                verifyConsentReadback(t, fresh, kinds)
                state = state.copy(detail = "동의 저장과 서버 재조회를 확인했습니다.")
            }
        }
    }
    private fun sendSms() {
        val ticket = registrationTicket ?: return; val phone = state.input("phone")
        execute { mutation {
            val start = android.os.SystemClock.elapsedRealtime()
            val r = repository.sendSms(ticket, phone)
            val duration = Instant.parse(r.getString("expiresAt")).toEpochMilli() - Instant.parse(r.getString("serverTime")).toEpochMilli()
            require(r.getInt("codeDigits") == 5 && r.getInt("expiresInSeconds") == 60 && duration in 1..60000 && r.getString("challengeId").matches(Regex("[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}")))
            Instant.parse(r.getString("retryAfter"))
            challengeId = r.getString("challengeId"); phoneVerified = false; smsAnchor = start; smsDuration = duration
            show(AuthScreen.SMS_SENT); stack = stack.dropLast(1) + AuthScreen.SMS_SENT
            state = state.copy(challengeActive = true, canSendSms = true, inputs = state.inputs + ("code" to ""))
            countdown?.cancel(); countdown = viewModelScope.launch {
                while (challengeId != null && !phoneVerified) {
                    val remaining = ((smsDuration - (android.os.SystemClock.elapsedRealtime() - smsAnchor)).coerceAtLeast(0) / 1000).toInt()
                    state = state.copy(remainingSeconds = remaining)
                    if (remaining == 0) break
                    delay(250)
                }
            }
        } }
    }
    private fun verifyAndSignup() {
        val ticket = registrationTicket ?: return; val challenge = challengeId ?: return; val code = state.input("code"); val kinds = selectedKinds()
        execute { mutation {
            if (!phoneVerified) {
                try { require(repository.verifySms(ticket, challenge, code).getBoolean("verified")); phoneVerified = true; countdown?.cancel() }
                catch (e: AuthFailure) {
                    if (e.code == "SMS_CODE_INVALID_OR_EXPIRED") { state = state.copy(error = "인증번호가 잘못되었거나 만료되었습니다. 서버에서 거절했습니다. 다시 확인하거나 재전송해주세요."); return@mutation }; throw e
                }
            }
            val fresh = freshConfirmation() ?: return@mutation
            require("age14" in state.accepted && validMember())
            val r = repository.signup(JSONObject().put("registrationTicket", ticket).put("name", state.input("name")).put("email", state.input("email")).put("age14Confirmed", true).put("expertRequested", false), fresh, kinds)
            require(r.getString("outcome") == "REGISTERED")
            val bearer = r.getJSONObject("session").getString("accessToken")
            val me = repository.me(bearer); require(me.getString("status") in listOf("ACTIVE", "RESTRICTED"))
            kotlinx.coroutines.currentCoroutineContext().ensureActive(); sessions.write(bearer); token = bearer
            loadAccount(); verifyConsentReadback(bearer, fresh, kinds)
            registrationTicket = null; challengeId = null
            if (me.getString("status") == "ACTIVE") { stack = listOf(AuthScreen.F1); show(AuthScreen.F1) }
            state = state.copy(inputs = emptyMap(), accepted = emptySet())
        } }
    }
    private fun withdrawMarketing() {
        val t = token ?: return
        execute { mutation {
            require(repository.withdrawMarketing(t).getBoolean("withdrawn"))
            loadPreferencesAndConsents(); require(!state.marketingConsented && state.notifications["advertising"] == false)
            stack = stack.dropLast(1); show(stack.last())
        } }
    }
    fun handle(event: AuthEvent) {
        when (event.action) {
            AuthAction.BACK, AuthAction.CANCEL -> back()
            AuthAction.BROWSE -> browse()
            AuthAction.OPEN -> runCatching { AuthScreen.valueOf(event.key) }.getOrNull()?.let(::open)
            AuthAction.OPEN_DOCUMENT -> document(AuthDocumentKind.valueOf(event.key))
            AuthAction.RETRY_DOCUMENT -> document(AuthDocumentKind.valueOf(event.key), true)
            AuthAction.OTHER_LOGIN -> { cancelRequest(); stack = listOf(AuthScreen.E1); show(AuthScreen.E1) }
            AuthAction.START_SOCIAL -> execute {
                loadConfig()
                val providers = config!!.getJSONArray("providers")
                val provider = (0 until providers.length()).map { providers.getJSONObject(it) }.firstOrNull { it.getString("id") == event.key }
                openFailure(if (provider?.optBoolean("enabled") != true) "선택한 소셜 로그인 제공자의 실제 연결이 준비되지 않았습니다. 로그인·가입은 완료되지 않았습니다."
                    else "제공자 인증 경로의 계약·앱 연결이 아직 준비되지 않았습니다. 인증 성공으로 처리하지 않습니다.")
            }
            AuthAction.CHANGE_INPUT -> if (!state.busy) {
                val value = when(event.key) { "phone" -> AuthInput.phone(event.value); "code" -> AuthInput.code(event.value); "withdrawDetail" -> AuthInput.withdrawalDetail(event.value); else -> event.value }
                if (event.key == "phone" && value == state.input("phone")) return
                state = state.copy(inputs = state.inputs + (event.key to value) + (if (event.key == "phone") mapOf("code" to "") else emptyMap()), challengeActive = if (event.key == "phone") false else state.challengeActive,
                    remainingSeconds = if (event.key == "phone") 0 else state.remainingSeconds)
                if (event.key == "phone") { countdown?.cancel(); challengeId = null; phoneVerified = false }
            }
            AuthAction.CHANGE_CONSENT -> {
                if (event.key == "withdrawAcknowledged") state = state.copy(withdrawalAcknowledged = event.value == "true")
                else state.options.firstOrNull { it.id == event.key && state.consentEnabled(it) }?.let {
                    state = state.copy(accepted = if (event.value == "true") state.accepted + it.id else state.accepted - it.id)
                }
            }
            AuthAction.CHANGE_ALL_CONSENTS -> state = state.copy(accepted = if (event.value == "true") state.options.filter { state.consentEnabled(it) }.map { it.id }.toSet() else emptySet())
            AuthAction.CHANGE_NOTIFICATION -> if (!state.busy) execute {
                val t = token ?: throw AuthFailure(401, "SESSION_REQUIRED", AuthRequestContext.PRIVATE)
                val v = version ?: throw AuthFailure(409, "VERSION_REQUIRED")
                try {
                    repository.changeNotification(t, v, event.key, event.value == "true")
                    // A response alone is not persistence proof: read exact target back.
                    preferences(repository.notifications(t))
                    require(state.notifications[event.key] == (event.value == "true"))
                } catch (e: AuthFailure) {
                    if (e.status == 409) loadPreferencesAndConsents()
                    throw e
                }
            }
            AuthAction.CONFIRM_LOGOUT -> if (!state.busy) execute {
                val t = token ?: throw AuthFailure(401, "SESSION_REQUIRED", AuthRequestContext.PRIVATE)
                require(repository.logout(t).getBoolean("loggedOut"))
                try { repository.me(t); throw AuthFailure(409, "REVOCATION_NOT_CONFIRMED") }
                catch (e: AuthFailure) { if (e.status != 401 || e.code !in listOf("AUTH_REQUIRED", "SESSION_INVALID")) throw e }
                check(token == t); sessions.clear(); token = null; version = null
                state = AuthState(AuthScreen.HOME_SIGNED_OUT); stack = emptyList(); browsing = true
            }
            AuthAction.REFRESH_ACCOUNT -> execute { loadAccount() }
            AuthAction.SUBMIT_CONSENTS -> if (state.canContinue && !mutationUnknown) submitConsents()
            AuthAction.SUBMIT_MEMBER -> if (state.canSubmitMember) {
                if (registrationTicket == null) state = state.copy(error = "검증된 제공자 가입 인증이 필요합니다. 가입하지 않았습니다.")
                else if (state.input("nickname").isNotEmpty()) state = state.copy(error = "닉네임 변경은 가입 후 별도 확인이 필요합니다. 입력을 보존했으며 아직 가입하지 않았습니다.")
                else open(AuthScreen.E2_TERMS)
            }
            AuthAction.SEND_SMS -> if (state.canSend && !mutationUnknown) sendSms()
            AuthAction.VERIFY_SMS -> if (state.canVerify && !mutationUnknown) verifyAndSignup()
            AuthAction.CONFIRM_WITHDRAW -> state = state.copy(error = "탈퇴 API·자료별 보관정책 검토가 준비되지 않았습니다. 탈퇴 처리하지 않았으며 계정은 유지됩니다.")
            AuthAction.WITHDRAW_MARKETING -> if (!state.busy && state.marketingConsented && !mutationUnknown) withdrawMarketing()
            AuthAction.VERIFY_LINK_OWNERSHIP, AuthAction.CONFIRM_LINK, AuthAction.CONTINUE_REJOIN -> state = state.copy(error = "실제 인증·소유 확인 API 연결 준비 중입니다. 계정 연결·재가입을 처리하지 않았습니다.")
            AuthAction.SUPPORT -> state = state.copy(error = "지원 경로 준비 중입니다.")
            AuthAction.OPEN_OS_SETTINGS -> Unit // Native host owns OS navigation.
        }
    }
    private fun openFailure(message: String) { stack = stack + AuthScreen.LOGIN_FAILURE; state = state.copy(screen = AuthScreen.LOGIN_FAILURE, detail = message, busy = false) }
}
