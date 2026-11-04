package ai.mintech.kimgosu.customer

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import ai.mintech.kimgosu.expert.ExpertCopy
import ai.mintech.kimgosu.expert.ExpertFailure
import ai.mintech.kimgosu.expert.ExpertLoading
import ai.mintech.kimgosu.ui.DesignTokens
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException

data class CustomerMessage(
    val id: String,
    val senderId: String,
    val body: String,
    val createdAt: String,
)

data class CustomerQuote(
    val id: String,
    val amount: Long,
    val totalAmount: Long,
    val status: String,
    val effectiveStatus: String,
    val message: String,
    val version: Int,
    val customerConfirmedAt: String?,
    val expertConfirmedAt: String?,
    val createdAt: String,
)

sealed interface CustomerChatState {
    data object Loading : CustomerChatState
    data class Empty(val ownId: String) : CustomerChatState
    data class Failed(val network: Boolean, val code: String) : CustomerChatState
    data class Ready(
        val ownId: String,
        val messages: List<CustomerMessage>,
        val quotes: List<CustomerQuote>,
    ) : CustomerChatState
}

class CustomerChatModel(
    private val transport: AuthTransport = MembershipHttp(),
    private val sessions: SecureSession,
) {
    var state by mutableStateOf<CustomerChatState>(CustomerChatState.Loading); private set
    var sending by mutableStateOf(false); private set
    var actionBusy by mutableStateOf(false); private set
    var actionError by mutableStateOf<String?>(null); private set

    suspend fun refresh(ledgerId: String) {
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) {
            state = CustomerChatState.Failed(network = false, code = "SESSION_REQUIRED")
            return
        }
        if (state !is CustomerChatState.Ready && state !is CustomerChatState.Empty) state = CustomerChatState.Loading
        try {
            val me = transport.request("GET", "/v1/me", token).getString("id")
            val messages = decodeMessages(transport.request("GET", "/v1/ledgers/" + enc(ledgerId) + "/messages?limit=50", token))
            val quotes = decodeQuotes(transport.request("GET", "/v1/ledgers/" + enc(ledgerId) + "/quotes", token))
            state = if (messages.isEmpty() && quotes.isEmpty()) CustomerChatState.Empty(me)
            else CustomerChatState.Ready(me, messages, quotes)
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthFailure) {
            state = CustomerChatState.Failed(network = false, code = e.code)
        } catch (_: IOException) {
            state = CustomerChatState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
        } catch (_: Exception) {
            state = CustomerChatState.Failed(network = false, code = "INVALID_API_RESPONSE")
        }
    }

    suspend fun send(ledgerId: String, body: String) {
        if (sending || body.isBlank()) return
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) {
            actionError = "세션이 만료되었습니다. 다시 로그인해주세요."
            return
        }
        sending = true
        actionError = null
        try {
            transport.request("POST", "/v1/ledgers/" + enc(ledgerId) + "/messages", token, JSONObject().put("body", body))
            sending = false
            refresh(ledgerId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthFailure) {
            sending = false
            actionError = if (e.status == 401) "세션이 만료되었습니다. 다시 로그인해주세요." else "메시지를 보내지 못했습니다. (${e.code})"
        } catch (_: IOException) {
            sending = false
            actionError = "네트워크에 연결할 수 없습니다."
        } catch (_: Exception) {
            sending = false
            actionError = "메시지를 보내지 못했습니다. (INVALID_API_RESPONSE)"
        }
    }

    /** 견적 상태 변경은 서버가 판정한다. 성공 후 전체를 다시 읽어 화면을 서버 값에 맞춘다. */
    suspend fun respondQuote(ledgerId: String, quote: CustomerQuote, action: String) = mutate(ledgerId) {
        transport.request("POST", "/v1/quotes/" + enc(quote.id) + "/respond", it,
            JSONObject().put("action", action).put("expectedVersion", quote.version))
    }

    suspend fun confirmComplete(ledgerId: String, quote: CustomerQuote) = mutate(ledgerId) {
        transport.request("POST", "/v1/quotes/" + enc(quote.id) + "/complete", it,
            JSONObject().put("expectedVersion", quote.version))
    }

    private suspend fun mutate(ledgerId: String, call: suspend (String) -> JSONObject) {
        if (actionBusy) return
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) {
            actionError = "세션이 만료되었습니다. 다시 로그인해주세요."
            return
        }
        actionBusy = true
        actionError = null
        try {
            call(token)
            actionBusy = false
            refresh(ledgerId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthFailure) {
            actionBusy = false
            actionError = when (e.code) {
                "ALREADY_CONFIRMED" -> "이미 완료 확인을 했습니다. 상대 확인을 기다리는 중입니다."
                "VERSION_CONFLICT" -> "다른 변경이 먼저 반영되었습니다. 새로고침 후 다시 시도해주세요."
                "QUOTE_EXPIRED" -> "견적 유효기간이 지났습니다."
                else -> if (e.status == 401) "세션이 만료되었습니다. 다시 로그인해주세요." else "요청을 처리하지 못했습니다. (${e.code})"
            }
        } catch (_: IOException) {
            actionBusy = false
            actionError = "네트워크에 연결할 수 없습니다."
        } catch (_: Exception) {
            actionBusy = false
            actionError = "요청을 처리하지 못했습니다. (INVALID_API_RESPONSE)"
        }
    }

    companion object {
        private fun enc(value: String) = java.net.URLEncoder.encode(value, "UTF-8")

        fun decodeMessages(json: JSONObject): List<CustomerMessage> {
            val array = json.getJSONArray("messages")
            return List(array.length()) { index ->
                val row = array.getJSONObject(index)
                CustomerMessage(
                    id = row.getString("id"),
                    senderId = row.getString("senderId"),
                    body = if (row.isNull("body") || row.optBoolean("deleted")) "" else row.optString("body"),
                    createdAt = row.optString("createdAt"),
                )
            }.reversed()
        }

        fun decodeQuotes(json: JSONObject): List<CustomerQuote> {
            val array = json.getJSONArray("quotes")
            return List(array.length()) { index ->
                val row = array.getJSONObject(index)
                CustomerQuote(
                    id = row.getString("id"),
                    amount = row.optLong("amount"),
                    totalAmount = row.optLong("totalAmount"),
                    status = row.optString("status"),
                    effectiveStatus = row.optString("effectiveStatus", row.optString("status")),
                    message = row.optString("message"),
                    version = row.optInt("version"),
                    customerConfirmedAt = if (row.isNull("customerConfirmedAt")) null else row.optString("customerConfirmedAt"),
                    expertConfirmedAt = if (row.isNull("expertConfirmedAt")) null else row.optString("expertConfirmedAt"),
                    createdAt = row.optString("createdAt"),
                )
            }
        }

        /** 진행 중(PROPOSED/ACCEPTED) 견적을 우선하고, 없으면 가장 최근 완료 견적을 고른다. */
        fun activeQuote(quotes: List<CustomerQuote>): CustomerQuote? {
            val ordered = quotes.sortedByDescending { it.createdAt }
            return ordered.firstOrNull { it.effectiveStatus == "PROPOSED" || it.effectiveStatus == "ACCEPTED" }
                ?: ordered.firstOrNull { it.effectiveStatus == "COMPLETED" }
        }
    }
}

@Composable
fun CustomerChatScreen(
    ledgerId: String,
    expertNickname: String,
    onBack: () -> Unit,
    onWriteReview: (ledgerId: String, expertNickname: String) -> Unit,
) {
    val context: Context = LocalContext.current.applicationContext
    val model = remember(ledgerId) { CustomerChatModel(MembershipHttp(context), SecureSession(context)) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(ledgerId) { model.refresh(ledgerId) }
    CustomerChatContent(
        expertNickname = expertNickname,
        state = model.state,
        sending = model.sending,
        actionBusy = model.actionBusy,
        actionError = model.actionError,
        onRetry = { scope.launch { model.refresh(ledgerId) } },
        onSend = { text -> scope.launch { model.send(ledgerId, text) } },
        onAccept = { quote -> scope.launch { model.respondQuote(ledgerId, quote, "accept") } },
        onComplete = { quote -> scope.launch { model.confirmComplete(ledgerId, quote) } },
        onWriteReview = { onWriteReview(ledgerId, expertNickname) },
        onBack = onBack,
    )
}

@Composable
fun CustomerChatContent(
    expertNickname: String,
    state: CustomerChatState,
    sending: Boolean,
    actionBusy: Boolean,
    actionError: String?,
    onRetry: () -> Unit,
    onSend: (String) -> Unit,
    onAccept: (CustomerQuote) -> Unit,
    onComplete: (CustomerQuote) -> Unit,
    onWriteReview: () -> Unit,
    onBack: () -> Unit,
) {
    var draft by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().testTag("customer-chat")) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                ExpertCopy("채팅", size = 12, color = DesignTokens.muted)
                ExpertCopy(expertNickname.ifBlank { "고수" } + " 님과의 거래", Modifier.padding(top = 2.dp), 19, bold = true)
            }
            TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp).testTag("customer-chat-back")) { ExpertCopy("뒤로") }
        }
        when (state) {
            CustomerChatState.Loading -> ExpertLoading()
            is CustomerChatState.Failed -> ExpertFailure(state.network, state.code, onRetry)
            is CustomerChatState.Empty -> {
                EmptyMessages(Modifier.weight(1f))
                Composer(draft, sending, onDraft = { draft = it }, onSend = { text -> onSend(text); draft = "" })
            }
            is CustomerChatState.Ready -> {
                val quote = CustomerChatModel.activeQuote(state.quotes)
                if (quote != null) QuoteCard(quote, actionBusy, onAccept, onComplete, onWriteReview)
                actionError?.let { ExpertCopy(it, Modifier.padding(horizontal = 20.dp, vertical = 6.dp).testTag("customer-chat-error"), 13) }
                if (state.messages.isEmpty()) {
                    EmptyMessages(Modifier.weight(1f))
                } else {
                    val listState = rememberLazyListState()
                    LaunchedEffect(state.messages.size) { listState.animateScrollToItem(state.messages.lastIndex) }
                    LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth().testTag("customer-messages")) {
                        items(state.messages, key = { it.id }) { message -> MessageBubble(message, message.senderId == state.ownId) }
                    }
                }
                Composer(draft, sending, onDraft = { draft = it }, onSend = { text -> onSend(text); draft = "" })
            }
        }
    }
}

@Composable
private fun EmptyMessages(modifier: Modifier) {
    Box(modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
        ExpertCopy("아직 메시지가 없습니다.\n첫 메시지를 보내보세요.", Modifier.testTag("customer-chat-empty"), 14, color = DesignTokens.muted)
    }
}

@Composable
private fun Composer(draft: String, sending: Boolean, onDraft: (String) -> Unit, onSend: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = draft,
            onValueChange = { if (it.length <= 2000) onDraft(it) },
            modifier = Modifier.weight(1f).testTag("customer-message-input"),
            placeholder = { Text("메시지를 입력하세요", fontFamily = ai.mintech.kimgosu.expert.expertFont(), fontSize = 14.sp) },
            textStyle = TextStyle(fontFamily = ai.mintech.kimgosu.expert.expertFont(), fontSize = 14.sp, color = DesignTokens.navy),
            shape = RoundedCornerShape(6.dp),
            maxLines = 4,
        )
        Button(onClick = { onSend(draft.trim()) }, enabled = !sending && draft.isNotBlank(),
            modifier = Modifier.padding(start = 8.dp).heightIn(min = 52.dp).testTag("customer-message-send"),
            colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy)) {
            ExpertCopy(if (sending) "전송 중" else "전송", color = Color.White, weight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun MessageBubble(message: CustomerMessage, mine: Boolean) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(Modifier.widthIn(max = 280.dp).background(if (mine) DesignTokens.soft else Color(0xFFF4F4F4), RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 9.dp)) {
            if (!mine) ExpertCopy("고수", size = 11, color = DesignTokens.muted)
            ExpertCopy(if (message.body.isBlank()) "삭제된 메시지" else message.body, size = 14)
            ExpertCopy(hhmm(message.createdAt), Modifier.padding(top = 3.dp), 10, color = DesignTokens.muted)
        }
    }
}

@Composable
private fun QuoteCard(
    quote: CustomerQuote,
    busy: Boolean,
    onAccept: (CustomerQuote) -> Unit,
    onComplete: (CustomerQuote) -> Unit,
    onWriteReview: () -> Unit,
) {
    Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp).fillMaxWidth()
        .border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(14.dp).testTag("customer-quote")) {
        ExpertCopy("견적", size = 12, color = DesignTokens.muted)
        Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            ExpertCopy(won(quote.totalAmount), Modifier.weight(1f), 20, bold = true)
            ExpertCopy(quoteStatusLabel(quote), size = 12, weight = FontWeight.SemiBold)
        }
        if (quote.message.isNotBlank()) ExpertCopy(quote.message, Modifier.padding(top = 6.dp), 13, color = DesignTokens.muted)
        when {
            quote.effectiveStatus == "PROPOSED" -> Button(onClick = { onAccept(quote) }, enabled = !busy,
                modifier = Modifier.padding(top = 10.dp).fillMaxWidth().heightIn(min = 48.dp).testTag("customer-quote-accept"),
                colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy)) {
                ExpertCopy(if (busy) "처리 중…" else "견적 수락", color = Color.White, weight = FontWeight.SemiBold)
            }
            quote.effectiveStatus == "ACCEPTED" && quote.customerConfirmedAt == null -> Button(onClick = { onComplete(quote) }, enabled = !busy,
                modifier = Modifier.padding(top = 10.dp).fillMaxWidth().heightIn(min = 48.dp).testTag("customer-complete"),
                colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy)) {
                ExpertCopy(if (busy) "처리 중…" else "거래 완료 확인", color = Color.White, weight = FontWeight.SemiBold)
            }
            quote.effectiveStatus == "ACCEPTED" -> ExpertCopy("상대 확인 대기 중입니다. 고수가 완료를 확인하면 거래가 종료됩니다.",
                Modifier.padding(top = 10.dp).testTag("customer-waiting-counterpart"), 13, color = DesignTokens.muted)
            quote.effectiveStatus == "COMPLETED" -> Button(onClick = onWriteReview,
                modifier = Modifier.padding(top = 10.dp).fillMaxWidth().heightIn(min = 48.dp).testTag("customer-write-review"),
                colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy)) {
                ExpertCopy("후기 작성", color = Color.White, weight = FontWeight.SemiBold)
            }
        }
    }
}

internal fun quoteStatusLabel(quote: CustomerQuote): String = when {
    quote.effectiveStatus == "COMPLETED" -> "거래 완료"
    quote.effectiveStatus == "ACCEPTED" && quote.customerConfirmedAt != null -> "완료 확인함"
    quote.effectiveStatus == "ACCEPTED" -> "수락됨"
    quote.effectiveStatus == "PROPOSED" -> "견적 도착"
    quote.effectiveStatus == "REJECTED" -> "거절됨"
    quote.effectiveStatus == "EXPIRED" -> "만료됨"
    else -> quote.effectiveStatus
}

internal fun hhmm(iso: String): String = runCatching {
    java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault()).let { "%02d:%02d".format(it.hour, it.minute) }
}.getOrDefault("")
