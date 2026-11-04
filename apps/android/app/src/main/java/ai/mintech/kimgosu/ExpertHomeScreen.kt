package ai.mintech.kimgosu

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import ai.mintech.kimgosu.ui.DesignTokens
import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.time.ZoneId

/**
 * 고수 홈. 활동 상태는 서버(전문가 프로필)가 유일한 저장소이며, 토글은 즉시
 * PATCH 하고 실패하면 이전 값으로 되돌린다. 업무 데이터를 로컬에 저장하지 않는다.
 */
enum class ExpertAvailability(val label: String) {
    AVAILABLE("수신 중"),
    PAUSED("일시중지"),
    VACATION("휴가");

    companion object {
        fun from(raw: String): ExpertAvailability = entries.firstOrNull { it.name == raw } ?: AVAILABLE
    }
}

data class ExpertRequest(
    val id: String,
    val customerNickname: String,
    val amount: Long,
    val vatIncluded: Boolean,
)

sealed interface ExpertHomeState {
    data object Loading : ExpertHomeState
    data object Empty : ExpertHomeState
    data class Failed(val network: Boolean, val code: String) : ExpertHomeState
    data class Ready(
        val availability: ExpertAvailability,
        val receivedThisMonth: Int,
        val completedThisMonth: Int,
        val requests: List<ExpertRequest>,
    ) : ExpertHomeState
}

class ExpertHomeModel @JvmOverloads constructor(
    application: Application,
    private val transport: AuthTransport = MembershipHttp(application),
    private val sessions: SecureSession = SecureSession(application),
) : AndroidViewModel(application) {
    var state by mutableStateOf<ExpertHomeState>(ExpertHomeState.Loading); private set
    var toggleBusy by mutableStateOf(false); private set
    var toggleError by mutableStateOf<String?>(null); private set

    // Debug-only QA switches, assigned from intent extras in MainActivity under BuildConfig.DEBUG.
    @Volatile var qaLoadingHoldMillis: Long = 0
    @Volatile var qaServerError: Boolean = false

    private var job: Job? = null

    fun refresh() {
        job?.cancel()
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) { state = ExpertHomeState.Failed(network = false, code = "SESSION_REQUIRED"); return }
        state = ExpertHomeState.Loading
        toggleError = null
        job = viewModelScope.launch {
            try {
                if (qaLoadingHoldMillis > 0) delay(qaLoadingHoldMillis)
                if (qaServerError) throw AuthFailure(500, "QA_INJECTED_SERVER_ERROR")
                val expert = transport.request("GET", "/v1/me/expert", token)
                val quotes = transport.request("GET", "/v1/me/quotes?limit=100", token)
                state = decode(expert, quotes)
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                state = if (e.status == 404 && e.code == "EXPERT_PROFILE_REQUIRED") ExpertHomeState.Empty
                    else ExpertHomeState.Failed(network = false, code = e.code)
            } catch (_: IOException) {
                state = ExpertHomeState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
            } catch (_: Exception) {
                state = ExpertHomeState.Failed(network = false, code = "INVALID_API_RESPONSE")
            }
        }
    }

    /** 낙관적 갱신: 실패하면 화면을 이전 상태로 되돌리고 오류를 남긴다. */
    fun setAvailability(target: ExpertAvailability) {
        val current = state as? ExpertHomeState.Ready ?: return
        if (toggleBusy || current.availability == target) return
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) { toggleError = "세션이 만료되었습니다. 다시 로그인해주세요."; return }
        val previous = current.availability
        toggleBusy = true
        toggleError = null
        state = current.copy(availability = target)
        viewModelScope.launch {
            try {
                val saved = transport.request("PATCH", "/v1/me/expert/availability", token,
                    JSONObject().put("availability", target.name))
                state = current.copy(availability = ExpertAvailability.from(saved.optString("availability", target.name)))
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                state = current.copy(availability = previous)
                toggleError = if (e.status == 401) "세션이 만료되었습니다. 다시 로그인해주세요."
                    else "상태를 저장하지 못했습니다. (${e.code})"
            } catch (_: IOException) {
                state = current.copy(availability = previous)
                toggleError = "네트워크에 연결할 수 없어 이전 상태로 되돌렸습니다."
            } catch (_: Exception) {
                state = current.copy(availability = previous)
                toggleError = "상태를 저장하지 못했습니다. (INVALID_API_RESPONSE)"
            } finally {
                toggleBusy = false
            }
        }
    }

    companion object {
        /** 이번 달 요약은 서버가 준 견적 목록에서 계산한다. 월 경계는 기기 시간대 기준. */
        fun decode(expert: JSONObject, quotesEnvelope: JSONObject, now: Instant = Instant.now(),
                   zone: ZoneId = ZoneId.systemDefault()): ExpertHomeState.Ready {
            val localMonth = now.atZone(zone)
            val all = quotesEnvelope.getJSONArray("quotes").let { array ->
                List(array.length()) { array.getJSONObject(it) }
            }
            val thisMonth = all.filter { quote ->
                val created = runCatching { Instant.parse(quote.getString("createdAt")).atZone(zone) }.getOrNull()
                created != null && created.year == localMonth.year && created.monthValue == localMonth.monthValue
            }
            return ExpertHomeState.Ready(
                availability = ExpertAvailability.from(expert.getString("availability")),
                receivedThisMonth = thisMonth.size,
                completedThisMonth = thisMonth.count { it.optString("status") == "COMPLETED" },
                requests = all.filter { it.optString("status") == "PROPOSED" }.take(3).map { quote ->
                    ExpertRequest(
                        id = quote.getString("id"),
                        customerNickname = quote.optString("customerNickname"),
                        amount = quote.optLong("amount"),
                        vatIncluded = quote.optBoolean("vatIncluded"),
                    )
                },
            )
        }
    }
}

@Composable
fun ExpertHomeScreen(nickname: String, onBack: () -> Unit, onOpenQuotes: () -> Unit) {
    val activity = LocalContext.current as ComponentActivity
    val model = remember { ViewModelProvider(activity)[ExpertHomeModel::class.java] }
    LaunchedEffect(Unit) { model.refresh() }
    ExpertHomeContent(model.state, nickname, model.toggleBusy, model.toggleError,
        model::setAvailability, model::refresh, onBack, onOpenQuotes)
}

@Composable
fun ExpertHomeContent(
    state: ExpertHomeState,
    nickname: String,
    toggleBusy: Boolean,
    toggleError: String?,
    onToggle: (ExpertAvailability) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    onOpenQuotes: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().testTag("expert-home")) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Copy("고수 홈", size = 12, color = DesignTokens.muted)
                Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Copy(if (nickname.isBlank()) "고수" else "$nickname 님", size = 22, bold = true)
                    if (state is ExpertHomeState.Ready) AvailabilityBadge(state.availability)
                }
            }
            TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp).testTag("expert-close")) { Copy("닫기") }
        }
        when (state) {
            ExpertHomeState.Loading -> Column(Modifier.fillMaxWidth().weight(1f).padding(24.dp).testTag("expert-loading"),
                verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(Modifier.size(20.dp), color = DesignTokens.navy, strokeWidth = 2.dp)
                Copy("고수 정보를 불러오는 중…", Modifier.padding(top = 12.dp), 13, color = DesignTokens.muted)
            }
            ExpertHomeState.Empty -> Column(Modifier.fillMaxWidth().weight(1f).padding(24.dp).testTag("expert-empty"),
                verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Copy("고수 프로필이 없습니다", size = 17, bold = true)
                Copy("활동 상태와 받은 견적은 고수 프로필을 등록한 뒤에 표시됩니다.",
                    Modifier.padding(top = 8.dp), size = 13, color = DesignTokens.muted)
                TextButton(onClick = onBack, modifier = Modifier.padding(top = 12.dp).heightIn(min = 48.dp)) { Copy("돌아가기") }
            }
            is ExpertHomeState.Failed -> Column(Modifier.fillMaxWidth().weight(1f).padding(24.dp),
                verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Copy(if (state.network) "네트워크에 연결할 수 없습니다." else "고수 정보를 불러오지 못했습니다.",
                    Modifier.testTag(if (state.network) "expert-network" else "expert-error"), 15, bold = true)
                Copy(if (state.network) "연결을 확인하고 다시 시도해주세요." else "잠시 후 다시 시도해주세요. (${state.code})",
                    Modifier.padding(top = 6.dp), 13, color = DesignTokens.muted)
                TextButton(onClick = onRetry, modifier = Modifier.padding(top = 12.dp).heightIn(min = 48.dp).testTag("expert-retry")) {
                    Copy("다시 시도", weight = FontWeight.SemiBold)
                }
            }
            is ExpertHomeState.Ready -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
                Copy("활동 상태", Modifier.padding(top = 22.dp).semantics { heading() }, 19, true)
                Row(Modifier.padding(top = 10.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ExpertAvailability.entries.forEach { option ->
                        val selected = option == state.availability
                        Column(Modifier.weight(1f).heightIn(min = 48.dp)
                            .background(if (selected) DesignTokens.soft else Color.White, RoundedCornerShape(6.dp))
                            .border(1.dp, if (selected) DesignTokens.navy else DesignTokens.border, RoundedCornerShape(6.dp))
                            .selectable(selected = selected, enabled = !toggleBusy, role = Role.RadioButton, onClick = { onToggle(option) })
                            .padding(vertical = 14.dp).testTag("availability-${option.name}"),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            Copy(option.label, size = 14, weight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                color = if (selected) DesignTokens.navy else DesignTokens.muted)
                        }
                    }
                }
                if (toggleBusy) Row(Modifier.padding(top = 8.dp).testTag("availability-saving"), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(14.dp), color = DesignTokens.navy, strokeWidth = 2.dp)
                    Copy("저장 중…", Modifier.padding(start = 8.dp), 12, color = DesignTokens.muted)
                }
                toggleError?.let { Copy(it, Modifier.padding(top = 8.dp).testTag("availability-error"), 12, color = DesignTokens.navy) }

                Copy("이번 달", Modifier.padding(top = 24.dp).semantics { heading() }, 19, true)
                Row(Modifier.padding(top = 10.dp).fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(vertical = 14.dp)) {
                    Stat("받은 견적", state.receivedThisMonth, "summary-received", Modifier.weight(1f))
                    Box(Modifier.width(1.dp).height(34.dp).background(DesignTokens.border))
                    Stat("완료", state.completedThisMonth, "summary-completed", Modifier.weight(1f))
                }

                Copy("새 요청", Modifier.padding(top = 24.dp).semantics { heading() }, 19, true)
                if (state.requests.isEmpty()) {
                    Copy("새 요청이 없습니다.", Modifier.padding(top = 10.dp).fillMaxWidth()
                        .border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(20.dp).testTag("request-empty"),
                        13, color = DesignTokens.muted)
                } else {
                    state.requests.forEach { request -> RequestRow(request, onOpenQuotes) }
                }
                TextButton(onClick = onOpenQuotes, modifier = Modifier.padding(top = 6.dp, bottom = 24.dp).heightIn(min = 48.dp).testTag("open-quotes")) {
                    Copy("받은 견적 전체 보기", weight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable private fun AvailabilityBadge(availability: ExpertAvailability) {
    Box(Modifier.padding(start = 8.dp).background(DesignTokens.lime, RoundedCornerShape(4.dp))
        .padding(horizontal = 7.dp, vertical = 3.dp).testTag("availability-badge")) {
        Copy(availability.label, size = 11, weight = FontWeight.SemiBold)
    }
}

@Composable private fun Stat(label: String, value: Int, tag: String, modifier: Modifier) {
    Column(modifier.testTag(tag), horizontalAlignment = Alignment.CenterHorizontally) {
        Copy(value.toString(), size = 20, bold = true)
        Copy(label, Modifier.padding(top = 2.dp), 12, color = DesignTokens.muted)
    }
}

@Composable private fun RequestRow(request: ExpertRequest, onOpen: () -> Unit) {
    Row(Modifier.padding(top = 10.dp).fillMaxWidth().heightIn(min = 56.dp)
        .border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp))
        .clickable(onClick = onOpen).padding(horizontal = 14.dp, vertical = 12.dp).testTag("request-${request.id}"),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Copy(request.customerNickname.ifBlank { "고객" }, size = 15, weight = FontWeight.SemiBold)
            Copy(if (request.vatIncluded) "부가세 포함" else "부가세 별도", Modifier.padding(top = 2.dp), 12, color = DesignTokens.muted)
        }
        Copy(won(request.amount), size = 15, weight = FontWeight.SemiBold)
    }
}

private fun won(amount: Long): String =
    java.text.NumberFormat.getNumberInstance(java.util.Locale.KOREA).format(amount) + "원"
