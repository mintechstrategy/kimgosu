package ai.mintech.kimgosu.settings

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import android.app.Application
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.Settings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** 알림 설정·동의 화면의 서버/로컬 상태. 화면은 이 값만 그린다. */
enum class Fetch { LOADING, READY, EMPTY, ERROR, OFFLINE }
enum class MarketingStatus { CONSENTED, NOT_CONSENTED, UNKNOWN }
enum class OsPermission { ALLOWED, DENIED, UNDECIDED, UNKNOWN }

data class ConsentRecord(val kind: String, val title: String?, val version: String?, val status: String?, val recordedAt: String?)

sealed interface Edit {
    data object Idle : Edit
    data class Saving(val key: String) : Edit
    data class Saved(val key: String) : Edit
    data class Error(val key: String, val network: Boolean) : Edit
    data object Uncertain : Edit
    data object Refreshed : Edit
}

sealed interface Withdraw {
    data object Closed : Withdraw
    data object Checking : Withdraw
    data object Question : Withdraw
    data object Working : Withdraw
    data object Empty : Withdraw
    data object Unavailable : Withdraw
    data object Error : Withdraw
    data object Offline : Withdraw
    data object Uncertain : Withdraw
}

sealed interface Doc {
    data object Loading : Doc
    data class Ready(val version: String, val effectiveAt: String, val body: String, val draft: Boolean) : Doc
    data object Empty : Doc
    data object Error : Doc
    data object Offline : Doc
    data object MetaMissing : Doc
    data object Preparing : Doc
}

sealed interface Permission {
    data object Loading : Permission
    data object Denied : Permission
    data object UnknownOs : Permission
    data object Failed : Permission
}

/** 저장 중에는 다른 설정 쓰기도 잠근다. 조회·뒤로가기는 막지 않는다. */
class AlarmConsentModel(application: Application) : AndroidViewModel(application) {
    private val transport: AuthTransport = MembershipHttp(application)
    private val sessions = SecureSession(application)
    private var job: Job? = null

    var fetch by mutableStateOf(Fetch.LOADING); private set
    var values by mutableStateOf<Map<String, Boolean>>(emptyMap()); private set
    var marketing by mutableStateOf(MarketingStatus.UNKNOWN); private set
    var records by mutableStateOf<List<ConsentRecord>?>(null); private set
    var edit by mutableStateOf<Edit>(Edit.Idle); private set
    var withdraw by mutableStateOf<Withdraw>(Withdraw.Closed); private set
    var withdrawDone by mutableStateOf(false); private set
    var doc by mutableStateOf<Doc>(Doc.Loading); private set
    var os by mutableStateOf(OsPermission.UNKNOWN); private set
    var osError by mutableStateOf(false); private set
    var osOffline by mutableStateOf(false); private set
    var permission by mutableStateOf<Permission?>(null); private set

    private var version = 0

    val writesLocked get() = edit is Edit.Saving || edit is Edit.Uncertain || withdraw is Withdraw.Working
    val hasValues get() = values.isNotEmpty()
    val canWithdraw get() = marketing == MarketingStatus.CONSENTED && !writesLocked

    fun refreshOsPermission() { os = readOsPermission() }

    fun load() {
        val token = sessions.read()
        if (token == null) { fetch = Fetch.ERROR; return }
        job?.cancel()
        if (values.isEmpty()) fetch = Fetch.LOADING
        job = viewModelScope.launch {
            try {
                val prefs = transport.request("GET", "/v1/me/notifications", token)
                val consents = transport.request("GET", "/v1/me/consents", token)
                val parsed = preferences(prefs)
                if (parsed == null) {
                    // 누락된 선호는 거짓(OFF)이 아니다. 값을 만들지 않고 빈 상태로 알린다.
                    fetch = Fetch.EMPTY
                    return@launch
                }
                version = parsed.first
                values = parsed.second
                records = consentRecords(consents)
                marketing = marketingOf(records ?: emptyList())
                fetch = Fetch.READY
                edit = Edit.Idle
            } catch (e: CancellationException) {
                throw e
            } catch (_: IOException) {
                fetch = Fetch.OFFLINE
            } catch (_: AuthFailure) {
                fetch = Fetch.ERROR
            }
        }
    }

    fun toggle(key: String, value: Boolean) {
        val token = sessions.read() ?: return
        if (writesLocked || fetch != Fetch.READY) return
        if (key == "advertising" && marketing != MarketingStatus.CONSENTED) return
        if (!online()) { edit = Edit.Error(key, network = true); return }
        job?.cancel()
        edit = Edit.Saving(key)
        job = viewModelScope.launch {
            try {
                transport.request("PATCH", "/v1/me/notifications", token,
                    JSONObject().put("expectedVersion", version).put(key, value))
                // 응답만으로 저장 성공을 단정하지 않는다. 같은 계정에서 다시 읽어 확인한다.
                val parsed = preferences(transport.request("GET", "/v1/me/notifications", token))
                if (parsed == null) { edit = Edit.Uncertain; return@launch }
                version = parsed.first
                values = parsed.second
                edit = if (parsed.second[key] == value) Edit.Saved(key) else Edit.Refreshed
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                if (e.status == 409) { load(); edit = Edit.Refreshed } else edit = Edit.Error(key, network = false)
            } catch (_: IOException) {
                edit = Edit.Uncertain
            }
        }
    }

    /** 재시도는 최신값을 다시 읽기만 한다. 보낸 요청을 자동 재전송하지 않는다. */
    fun retryEdit() {
        edit = Edit.Idle
        load()
        edit = Edit.Refreshed
    }

    fun openDocument() {
        job?.cancel()
        doc = Doc.Loading
        job = viewModelScope.launch {
            try {
                val body = transport.request("GET", "/v1/policies/MARKETING", null)
                val status = body.optString("status", "")
                val text = body.optString("body", "")
                val docVersion = body.optString("version", "")
                val effectiveAt = body.optString("effectiveAt", "")
                doc = when {
                    status == "READY" && (docVersion.isBlank() || effectiveAt.isBlank()) -> Doc.MetaMissing
                    status == "READY" && text.isBlank() -> Doc.Empty
                    status == "READY" || status == "DRAFT" -> Doc.Ready(docVersion, effectiveAt, text, status == "DRAFT")
                    else -> Doc.Preparing
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                doc = if (e.status == 404) Doc.Preparing else Doc.Error
            } catch (_: IOException) {
                doc = Doc.Offline
            }
        }
    }

    fun startWithdraw() {
        val token = sessions.read() ?: return
        if (!canWithdraw) return
        job?.cancel()
        withdraw = Withdraw.Checking
        job = viewModelScope.launch {
            try {
                applyConsents(consentRecords(transport.request("GET", "/v1/me/consents", token)))
                withdraw = when (marketing) {
                    MarketingStatus.CONSENTED -> Withdraw.Question
                    MarketingStatus.NOT_CONSENTED -> Withdraw.Empty
                    MarketingStatus.UNKNOWN -> Withdraw.Unavailable
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: IOException) {
                withdraw = Withdraw.Offline
            } catch (_: AuthFailure) {
                withdraw = Withdraw.Error
            }
        }
    }

    fun confirmWithdraw() {
        val token = sessions.read() ?: return
        if (withdraw != Withdraw.Question) return
        if (!online()) { withdraw = Withdraw.Offline; return }
        job?.cancel()
        withdraw = Withdraw.Working
        job = viewModelScope.launch {
            try {
                transport.request("POST", "/v1/me/consents/withdraw", token, JSONObject().put("kind", "MARKETING"))
                val fresh = consentRecords(transport.request("GET", "/v1/me/consents", token))
                val prefs = preferences(transport.request("GET", "/v1/me/notifications", token))
                applyConsents(fresh)
                if (prefs != null) values = prefs.second
                withdraw = if (reflected(fresh, prefs?.second)) Withdraw.Closed else Withdraw.Uncertain
                if (withdraw == Withdraw.Closed) { withdrawDone = true; fetch = Fetch.READY; edit = Edit.Idle }
            } catch (e: CancellationException) {
                throw e
            } catch (_: AuthFailure) {
                withdraw = Withdraw.Error
            } catch (_: IOException) {
                withdraw = Withdraw.Uncertain
            }
        }
    }

    /** 현재 상태 확인: 다시 읽어서 일치하면 완료, 동의가 남아 있으면 질문으로 돌아간다. */
    fun checkWithdraw() {
        val token = sessions.read() ?: return
        job?.cancel()
        withdraw = Withdraw.Checking
        job = viewModelScope.launch {
            try {
                val fresh = consentRecords(transport.request("GET", "/v1/me/consents", token))
                val prefs = preferences(transport.request("GET", "/v1/me/notifications", token))
                applyConsents(fresh)
                if (prefs != null) values = prefs.second
                withdraw = when {
                    marketing == MarketingStatus.CONSENTED -> Withdraw.Question
                    marketing == MarketingStatus.UNKNOWN -> Withdraw.Unavailable
                    reflected(fresh, prefs?.second) -> { withdrawDone = true; fetch = Fetch.READY; Withdraw.Closed }
                    else -> Withdraw.Uncertain
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: IOException) {
                withdraw = Withdraw.Offline
            } catch (_: AuthFailure) {
                withdraw = Withdraw.Error
            }
        }
    }

    fun retryWithdraw() { withdraw = Withdraw.Question; startWithdraw() }
    fun dismissWithdraw() { withdraw = Withdraw.Closed }

    fun openOsSettings() {
        osOffline = !online()
        osError = false
        // 명시적 거부일 때만 안내 모달을 먼저 띄운다. 화면 진입이나 스위치 조작으로 시스템 팝업을 열지 않는다.
        if (os == OsPermission.DENIED) permission = Permission.Denied else moveToOsSettings()
    }

    fun confirmOsSettings() {
        permission = Permission.Loading
        if (!moveToOsSettings()) permission = Permission.Failed else permission = null
    }

    fun retryOsSettings() {
        permission = Permission.Loading
        refreshOsPermission()
        permission = if (os == OsPermission.DENIED) Permission.Denied
        else if (os == OsPermission.UNKNOWN) Permission.UnknownOs else null
    }

    fun dismissPermission() { permission = null }

    private fun applyConsents(fresh: List<ConsentRecord>) {
        records = fresh
        marketing = marketingOf(fresh)
    }

    /** 철회 성공은 현재 미동의·광고 OFF·실제 철회 이력이 모두 서버 재조회로 확인된 경우에만 인정한다. */
    private fun reflected(fresh: List<ConsentRecord>, prefs: Map<String, Boolean>?): Boolean =
        marketingOf(fresh) == MarketingStatus.NOT_CONSENTED &&
            fresh.firstOrNull { it.kind == "MARKETING" }?.status == "WITHDRAWN" &&
            prefs?.get("advertising") == false

    private fun moveToOsSettings(): Boolean = try {
        val context = getApplication<Application>()
        context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        osError = false
        true
    } catch (_: Exception) {
        osError = true
        false
    }

    private fun readOsPermission(): OsPermission {
        val context = getApplication<Application>()
        return try {
            val enabled = notificationsEnabled(context)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                if (enabled) OsPermission.ALLOWED else OsPermission.UNDECIDED
            } else if (enabled) OsPermission.ALLOWED else OsPermission.DENIED
        } catch (_: Exception) {
            OsPermission.UNKNOWN
        }
    }

    private fun notificationsEnabled(context: Context): Boolean =
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()

    private fun online(): Boolean {
        val manager = getApplication<Application>().getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val active = manager.activeNetwork ?: return false
        return manager.getNetworkCapabilities(active)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }

    private fun preferences(json: JSONObject): Pair<Int, Map<String, Boolean>>? {
        val keys = listOf("advertising", "chat", "comment", "quote", "inquiry")
        val raw = json.opt("version") as? Number ?: return null
        if (raw.toInt() < 0) return null
        val parsed = keys.associateWith { key -> json.opt(key) as? Boolean ?: return null }
        return raw.toInt() to parsed
    }

    private fun consentRecords(json: JSONObject): List<ConsentRecord> {
        val rows = json.optJSONArray("records") ?: return emptyList()
        val parsed = List(rows.length()) { index ->
            val row = rows.optJSONObject(index) ?: JSONObject()
            ConsentRecord(
                kind = row.optString("kind", ""),
                title = row.optString("title", "").ifBlank { null },
                version = row.optString("version", "").ifBlank { null },
                status = row.optString("status", "").ifBlank { null },
                recordedAt = row.optString("recordedAt", "").ifBlank { null },
            )
        }
        // 서버가 준 최신 기록 순서를 유지하고 같은 이력 식별자만 한 번 표시한다.
        return parsed.distinctBy { listOf(it.kind, it.version, it.status, it.recordedAt) }
    }

    /** 현재 동의값이 확인되지 않으면 미동의로 추정하지 않고 UNKNOWN으로 둔다. */
    private fun marketingOf(rows: List<ConsentRecord>): MarketingStatus =
        when (rows.firstOrNull { it.kind == "MARKETING" }?.status) {
            "GRANTED" -> MarketingStatus.CONSENTED
            "WITHDRAWN" -> MarketingStatus.NOT_CONSENTED
            else -> MarketingStatus.UNKNOWN
        }
}

private val recordedFormat = DateTimeFormatter.ofPattern("yyyy.MM.dd HH:mm:ss")

private fun recordedText(text: String?): String? = text?.let {
    runCatching { Instant.parse(it).atZone(ZoneId.systemDefault()).format(recordedFormat) }.getOrNull()
}

internal fun marketingLabel(status: MarketingStatus) = when (status) {
    MarketingStatus.CONSENTED -> AlarmConsentStrings.S_MARKETING_YES
    MarketingStatus.NOT_CONSENTED -> AlarmConsentStrings.S_MARKETING_NO
    MarketingStatus.UNKNOWN -> AlarmConsentStrings.S_MARKETING_UNKNOWN
}

internal fun recordStatusLabel(status: String?) = when (status) {
    "GRANTED" -> AlarmConsentStrings.H_GRANTED
    "WITHDRAWN" -> AlarmConsentStrings.H_WITHDRAWN
    else -> AlarmConsentStrings.H_STATUS_MISSING
}

internal fun recordTitleLabel(record: ConsentRecord) = record.title ?: AlarmConsentStrings.H_TITLE_MISSING
internal fun recordVersionLabel(record: ConsentRecord) = record.version?.let { AlarmConsentStrings.hVersion(it) }
    ?: AlarmConsentStrings.H_VERSION_MISSING
internal fun recordTimeLabel(record: ConsentRecord) = recordedText(record.recordedAt)?.let { AlarmConsentStrings.hRecorded(it) }
    ?: AlarmConsentStrings.H_TIME_MISSING
