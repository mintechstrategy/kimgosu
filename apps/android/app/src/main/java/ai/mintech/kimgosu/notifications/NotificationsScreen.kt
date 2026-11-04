package ai.mintech.kimgosu.notifications

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import ai.mintech.kimgosu.expert.ExpertCopy
import ai.mintech.kimgosu.expert.expertFont
import ai.mintech.kimgosu.ui.DesignTokens
import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class InboxNotification(
    val id: String,
    val kind: String,
    val title: String,
    val body: String,
    val createdAt: String?,
    val read: Boolean,
)

sealed interface InboxState {
    data object Loading : InboxState
    data object Empty : InboxState
    data class Failed(val network: Boolean, val code: String) : InboxState
    data class Ready(val items: List<InboxNotification>) : InboxState
}

/** 알림함 필터 칩. kind 값이 그대로 서버 쿼리 파라미터가 된다(null은 전체). */
val InboxFilters = listOf<Pair<String, String?>>(
    "전체" to null,
    "견적" to "QUOTE",
    "완료" to "AGREEMENT",
    "후기" to "REVIEW",
    "신고" to "REPORT",
)

/**
 * 알림 목록과 배지는 서버 값을 그대로 쓴다. 읽음 여부·읽지 않은 개수를
 * 클라이언트에서 세지 않는다(GET/POST 응답의 unreadCount가 유일한 근거).
 */
class NotificationsModel(application: Application) : AndroidViewModel(application) {
    private val transport = MembershipHttp(application)
    private val sessions = SecureSession(application)
    private var job: Job? = null

    var state by mutableStateOf<InboxState>(InboxState.Loading); private set
    var filter by mutableStateOf<String?>(null); private set
    var unreadCount by mutableStateOf<Int?>(null); private set
    var readAllBusy by mutableStateOf(false); private set
    var readAllError by mutableStateOf<String?>(null); private set

    fun chooseFilter(kind: String?) {
        if (filter == kind) return
        filter = kind
        refresh()
    }

    fun refresh() {
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) { state = InboxState.Failed(network = false, code = "SESSION_REQUIRED"); return }
        job?.cancel()
        state = InboxState.Loading
        job = viewModelScope.launch {
            try {
                val path = "/v1/notifications" + (filter?.let { "?kind=$it" } ?: "")
                state = decode(transport.request("GET", path, token))
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                state = InboxState.Failed(network = false, code = e.code)
            } catch (_: IOException) {
                state = InboxState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
            } catch (_: Exception) {
                state = InboxState.Failed(network = false, code = "INVALID_API_RESPONSE")
            }
        }
    }

    private fun decode(body: JSONObject): InboxState {
        unreadCount = body.optInt("unreadCount", 0)
        val rows = body.optJSONArray("notifications") ?: return InboxState.Failed(false, "INVALID_API_RESPONSE")
        val items = List(rows.length()) { index ->
            val row = rows.getJSONObject(index)
            InboxNotification(
                id = row.getString("id"),
                kind = row.getString("kind"),
                title = row.getString("title"),
                body = row.getString("body"),
                createdAt = row.optString("createdAt", "").ifEmpty { null },
                read = !row.isNull("readAt"),
            )
        }
        return if (items.isEmpty()) InboxState.Empty else InboxState.Ready(items)
    }

    fun markAllRead() {
        if (readAllBusy) return
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) { readAllError = "세션이 만료되었습니다. 다시 로그인해주세요."; return }
        readAllBusy = true
        readAllError = null
        viewModelScope.launch {
            try {
                transport.request("POST", "/v1/notifications/read-all", token, JSONObject())
                unreadCount = 0
                readAllBusy = false
                // 다시 읽어 항목별 읽음 표시를 서버 값으로 맞춘다.
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                readAllBusy = false
                readAllError = if (e.status == 401) "세션이 만료되었습니다. 다시 로그인해주세요."
                else "모두 읽음 처리에 실패했습니다. (${e.code})"
            } catch (_: IOException) {
                readAllBusy = false
                readAllError = "네트워크에 연결할 수 없습니다."
            } catch (_: Exception) {
                readAllBusy = false
                readAllError = "모두 읽음 처리에 실패했습니다. (INVALID_API_RESPONSE)"
            }
        }
    }
}

private val inboxTimeFormat = DateTimeFormatter.ofPattern("MM.dd HH:mm")

private fun inboxTime(iso: String?): String? = iso?.let {
    runCatching { Instant.parse(it).atZone(ZoneId.systemDefault()).format(inboxTimeFormat) }.getOrNull()
}

@Composable
fun NotificationsScreen(model: NotificationsModel, onBack: () -> Unit) {
    LaunchedEffect(Unit) { model.refresh() }
    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().testTag("inbox")) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            ExpertCopy("알림", Modifier.weight(1f), 23, bold = true)
            TextButton(onClick = model::markAllRead, enabled = !model.readAllBusy,
                modifier = Modifier.heightIn(min = 48.dp).testTag("inbox-read-all")) {
                ExpertCopy(if (model.readAllBusy) "처리 중…" else "모두 읽음", size = 14, weight = FontWeight.SemiBold)
            }
            TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp).testTag("inbox-back")) { ExpertCopy("닫기") }
        }
        Row(Modifier.padding(top = 4.dp).horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            InboxFilters.forEach { (label, kind) ->
                FilterChip(selected = model.filter == kind, onClick = { model.chooseFilter(kind) },
                    label = { ExpertCopy(label, size = 13) }, shape = RoundedCornerShape(percent = 50),
                    modifier = Modifier.testTag("inbox-filter-${kind ?: "ALL"}"),
                    colors = FilterChipDefaults.filterChipColors(selectedContainerColor = DesignTokens.soft))
            }
        }
        model.readAllError?.let {
            ExpertCopy(it, Modifier.padding(horizontal = 20.dp, vertical = 6.dp).testTag("inbox-read-all-error"), 13)
        }
        when (val state = model.state) {
            InboxState.Loading -> Box(Modifier.fillMaxSize().testTag("inbox-loading"), contentAlignment = Alignment.Center) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(16.dp), color = DesignTokens.navy, strokeWidth = 2.dp)
                    ExpertCopy("알림을 불러오는 중…", Modifier.padding(start = 10.dp), 13, color = DesignTokens.muted)
                }
            }
            InboxState.Empty -> Column(Modifier.fillMaxSize().padding(24.dp).testTag("inbox-empty"), verticalArrangement = Arrangement.Center) {
                ExpertCopy("새 알림이 없습니다.", size = 15, bold = true)
                ExpertCopy("견적·완료·후기·신고 소식이 도착하면 여기에 표시됩니다.",
                    Modifier.padding(top = 6.dp), 13, color = DesignTokens.muted)
            }
            is InboxState.Failed -> Column(Modifier.fillMaxSize().padding(24.dp)
                .testTag(if (state.code == "SESSION_REQUIRED") "inbox-session" else if (state.network) "inbox-network" else "inbox-error"),
                verticalArrangement = Arrangement.Center) {
                ExpertCopy(when {
                    state.code == "SESSION_REQUIRED" -> "로그인하면 알림을 볼 수 있습니다."
                    state.network -> "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
                    else -> "알림을 불러오지 못했습니다. (${state.code})"
                }, size = 14)
                if (state.code != "SESSION_REQUIRED") {
                    TextButton(onClick = model::refresh, modifier = Modifier.heightIn(min = 48.dp).testTag("inbox-retry")) {
                        ExpertCopy("다시 시도", size = 14, weight = FontWeight.SemiBold)
                    }
                }
            }
            is InboxState.Ready -> LazyColumn(Modifier.fillMaxSize().testTag("inbox-list"),
                contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(state.items, key = { it.id }) { item -> InboxRow(item) }
            }
        }
    }
}

@Composable
private fun InboxRow(item: InboxNotification) {
    Row(Modifier.fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp))
        .background(if (item.read) Color.White else DesignTokens.soft, RoundedCornerShape(6.dp))
        .padding(14.dp).testTag("inbox-row")) {
        Box(Modifier.padding(top = 6.dp).size(6.dp)
            .background(if (item.read) Color.Transparent else DesignTokens.navy, RoundedCornerShape(percent = 50)))
        Column(Modifier.padding(start = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ExpertCopy(item.title, Modifier.weight(1f), 15, bold = !item.read)
                ExpertCopy(inboxTime(item.createdAt) ?: "", size = 11, color = DesignTokens.muted)
            }
            ExpertCopy(item.body, Modifier.padding(top = 4.dp), 13, color = DesignTokens.muted)
        }
    }
}
