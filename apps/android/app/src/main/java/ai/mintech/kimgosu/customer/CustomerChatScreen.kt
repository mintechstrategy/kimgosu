package ai.mintech.kimgosu.customer

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import ai.mintech.kimgosu.chat.ChatApi
import ai.mintech.kimgosu.expert.ExpertCopy
import ai.mintech.kimgosu.expert.ExpertFailure
import ai.mintech.kimgosu.expert.ExpertLoading
import ai.mintech.kimgosu.ui.DesignTokens
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class CustomerMessage(
    val id: String,
    val senderId: String,
    val body: String,
    val imageUrl: String?,
    val imageWidth: Int?,
    val imageHeight: Int?,
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

/**
 * WS-71 거래 취소 상태. 서버가 유일한 근거이며 화면은 그대로 표시만 한다.
 * requestedByMe가 true면 내가 요청한 것이고, false면 상대가 요청한 것이다.
 */
data class CustomerCancellation(
    val status: String,
    val requestedByMe: Boolean?,
    val reasonCode: String?,
    val detail: String?,
    val requestedAt: String?,
    val cancelledAt: String?,
) {
    companion object {
        fun decode(json: JSONObject) = CustomerCancellation(
            status = json.getString("status"),
            requestedByMe = if (json.isNull("requestedByMe")) null else json.getBoolean("requestedByMe"),
            reasonCode = if (json.isNull("reasonCode")) null else json.optString("reasonCode"),
            detail = if (json.isNull("detail")) null else json.optString("detail"),
            requestedAt = if (json.isNull("requestedAt")) null else json.optString("requestedAt"),
            cancelledAt = if (json.isNull("cancelledAt")) null else json.optString("cancelledAt"),
        )
    }
}

/** 서버가 허용하는 사유 코드(ledger.ts CANCEL_REASON_CODES)와 화면 문구. */
internal val CANCEL_REASONS = listOf(
    "SCHEDULE" to "일정이 맞지 않음",
    "PRICE" to "금액·조건이 맞지 않음",
    "SCOPE_CHANGED" to "작업 범위가 바뀜",
    "OTHER" to "기타",
)

internal fun cancelReasonLabel(code: String?): String =
    CANCEL_REASONS.firstOrNull { it.first == code }?.second ?: "사유 미기록"

sealed interface CustomerChatState {
    data object Loading : CustomerChatState
    data class Empty(val ownId: String, val cancellation: CustomerCancellation) : CustomerChatState
    data class Failed(val network: Boolean, val code: String) : CustomerChatState
    data class Ready(
        val ownId: String,
        val messages: List<CustomerMessage>,
        val quotes: List<CustomerQuote>,
        val cancellation: CustomerCancellation,
    ) : CustomerChatState
}

class CustomerChatModel(
    private val transport: AuthTransport = MembershipHttp(),
    private val sessions: SecureSession,
) {
    private val chat = ChatApi(transport)
    var state by mutableStateOf<CustomerChatState>(CustomerChatState.Loading); private set
    var sending by mutableStateOf(false); private set
    var sendingPhoto by mutableStateOf(false); private set
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
            val cancellation = CustomerCancellation.decode(
                transport.request("GET", "/v1/ledgers/" + enc(ledgerId) + "/cancel", token))
            state = if (messages.isEmpty() && quotes.isEmpty() && cancellation.status == "ACTIVE")
                CustomerChatState.Empty(me, cancellation)
            else CustomerChatState.Ready(me, messages, quotes, cancellation)
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

    /** 사진은 presign → R2 PUT → imageKey 전송까지 ChatApi가 처리한다. */
    suspend fun sendPhoto(ledgerId: String, photo: PickedPhoto) {
        if (sending || sendingPhoto) return
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) {
            actionError = "세션이 만료되었습니다. 다시 로그인해주세요."
            return
        }
        sendingPhoto = true
        actionError = null
        try {
            chat.sendPhoto(token, ledgerId, photo.bytes, PHOTO_CONTENT_TYPE, photo.width, photo.height)
            sendingPhoto = false
            refresh(ledgerId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthFailure) {
            sendingPhoto = false
            actionError = if (e.status == 401) "세션이 만료되었습니다. 다시 로그인해주세요." else "사진을 보내지 못했습니다. (${e.code})"
        } catch (_: IOException) {
            sendingPhoto = false
            actionError = "네트워크에 연결할 수 없습니다."
        } catch (_: Exception) {
            sendingPhoto = false
            actionError = "사진을 보내지 못했습니다. (INVALID_API_RESPONSE)"
        }
    }

    fun reportPhotoUnreadable() {
        actionError = "사진을 읽지 못했습니다. 다른 사진을 선택해주세요."
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

    /**
     * 취소 요청과 수락은 같은 엔드포인트다. 이미 요청이 있으면 서버가 이 호출을
     * 상대의 수락으로 처리하므로 클라이언트는 상태를 보내지 않는다.
     */
    suspend fun requestCancel(ledgerId: String, reasonCode: String, detail: String) = mutate(ledgerId) {
        val payload = JSONObject().put("reasonCode", reasonCode)
        if (detail.isNotBlank()) payload.put("detail", detail.trim())
        transport.request("POST", "/v1/ledgers/" + enc(ledgerId) + "/cancel", it, payload)
    }

    suspend fun acceptCancel(ledgerId: String) = mutate(ledgerId) {
        transport.request("POST", "/v1/ledgers/" + enc(ledgerId) + "/cancel", it)
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
                "LEDGER_COMPLETED" -> "완료된 거래는 취소할 수 없습니다."
                "CANCEL_ALREADY_REQUESTED" -> "이미 취소를 요청했습니다. 상대 수락을 기다리는 중입니다."
                "ALREADY_CANCELLED" -> "이미 취소된 거래입니다."
                "LEDGER_CANCELLED" -> "취소된 거래에는 후기를 작성할 수 없습니다."
                "REASON_REQUIRED" -> "취소 사유를 선택해주세요."
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
                    imageUrl = if (row.isNull("imageUrl")) null else row.optString("imageUrl").takeIf { it.isNotBlank() },
                    imageWidth = if (row.isNull("imageWidth")) null else row.optInt("imageWidth").takeIf { it > 0 },
                    imageHeight = if (row.isNull("imageHeight")) null else row.optInt("imageHeight").takeIf { it > 0 },
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

/**
 * 갤러리 원본은 HEIC처럼 서버가 받지 않는 형식일 수 있어 JPEG로 정규화하고,
 * 긴 변을 1600px로 줄여 업로드 크기를 묶는다.
 */
private const val PHOTO_CONTENT_TYPE = "image/jpeg"

class PickedPhoto(val bytes: ByteArray, val width: Int, val height: Int)

private fun readPhoto(context: Context, uri: Uri): PickedPhoto? = runCatching {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1600) sample *= 2
    val decoded = resolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: return null
    val scale = 1600f / maxOf(decoded.width, decoded.height)
    val bitmap = if (scale < 1f) {
        Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt().coerceAtLeast(1),
            (decoded.height * scale).toInt().coerceAtLeast(1), true)
    } else {
        decoded
    }
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
    PickedPhoto(out.toByteArray(), bitmap.width, bitmap.height)
}.getOrNull()

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
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            val photo = withContext(Dispatchers.IO) { readPhoto(context, uri) }
            if (photo == null) model.reportPhotoUnreadable() else model.sendPhoto(ledgerId, photo)
        }
    }
    LaunchedEffect(ledgerId) { model.refresh(ledgerId) }
    CustomerChatContent(
        expertNickname = expertNickname,
        state = model.state,
        sending = model.sending || model.sendingPhoto,
        actionBusy = model.actionBusy,
        actionError = model.actionError,
        onRetry = { scope.launch { model.refresh(ledgerId) } },
        onSend = { text -> scope.launch { model.send(ledgerId, text) } },
        onPickPhoto = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
        onAccept = { quote -> scope.launch { model.respondQuote(ledgerId, quote, "accept") } },
        onComplete = { quote -> scope.launch { model.confirmComplete(ledgerId, quote) } },
        onRequestCancel = { reason, detail -> scope.launch { model.requestCancel(ledgerId, reason, detail) } },
        onAcceptCancel = { scope.launch { model.acceptCancel(ledgerId) } },
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
    onPickPhoto: () -> Unit,
    onAccept: (CustomerQuote) -> Unit,
    onComplete: (CustomerQuote) -> Unit,
    onRequestCancel: (String, String) -> Unit,
    onAcceptCancel: () -> Unit,
    onWriteReview: () -> Unit,
    onBack: () -> Unit,
) {
    var draft by remember { mutableStateOf("") }
    var cancelDialog by remember { mutableStateOf(false) }
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
                CancelCard(state.cancellation, actionBusy, onOpen = { cancelDialog = true }, onAccept = onAcceptCancel)
                EmptyMessages(Modifier.weight(1f))
                Composer(draft, sending, onDraft = { draft = it }, onSend = { text -> onSend(text); draft = "" }, onPickPhoto = onPickPhoto)
            }
            is CustomerChatState.Ready -> {
                val cancelled = state.cancellation.status == "CANCELLED"
                CancelCard(state.cancellation, actionBusy, onOpen = { cancelDialog = true }, onAccept = onAcceptCancel)
                val quote = CustomerChatModel.activeQuote(state.quotes)
                if (quote != null) QuoteCard(quote, actionBusy, cancelled, onAccept, onComplete, onWriteReview)
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
                Composer(draft, sending, onDraft = { draft = it }, onSend = { text -> onSend(text); draft = "" }, onPickPhoto = onPickPhoto)
            }
        }
        if (cancelDialog) {
            CancelRequestDialog(
                busy = actionBusy,
                onDismiss = { cancelDialog = false },
                onSubmit = { reason, detail -> cancelDialog = false; onRequestCancel(reason, detail) })
        }
    }
}

/** 취소 요청 카드. 상태 4종(요청 가능·요청됨·상대 요청·취소됨)을 서버 값으로만 그린다. */
@Composable
private fun CancelCard(
    cancellation: CustomerCancellation,
    busy: Boolean,
    onOpen: () -> Unit,
    onAccept: () -> Unit,
) {
    Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp).fillMaxWidth()
        .border(1.dp, if (cancellation.status == "CANCELLED") DesignTokens.border else DesignTokens.navy, RoundedCornerShape(6.dp))
        .padding(14.dp).testTag("customer-cancel")) {
        when (cancellation.status) {
            "CANCELLED" -> {
                ExpertCopy("취소된 거래입니다", size = 15, bold = true)
                ExpertCopy("사유: " + cancelReasonLabel(cancellation.reasonCode), Modifier.padding(top = 4.dp), 13, color = DesignTokens.muted)
                cancellation.detail?.takeIf { it.isNotBlank() }?.let {
                    ExpertCopy(it, Modifier.padding(top = 2.dp), 13, color = DesignTokens.muted)
                }
            }
            "CANCEL_REQUESTED" -> {
                val mine = cancellation.requestedByMe == true
                ExpertCopy(if (mine) "취소를 요청했습니다" else "상대가 취소를 요청했습니다", size = 15, bold = true)
                ExpertCopy("사유: " + cancelReasonLabel(cancellation.reasonCode), Modifier.padding(top = 4.dp), 13, color = DesignTokens.muted)
                cancellation.detail?.takeIf { it.isNotBlank() }?.let {
                    ExpertCopy(it, Modifier.padding(top = 2.dp), 13, color = DesignTokens.muted)
                }
                if (mine) {
                    ExpertCopy("상대 수락을 기다리는 중입니다.", Modifier.padding(top = 8.dp).testTag("customer-cancel-waiting"), 13, color = DesignTokens.muted)
                } else {
                    Button(onClick = onAccept, enabled = !busy,
                        modifier = Modifier.padding(top = 10.dp).fillMaxWidth().heightIn(min = 48.dp).testTag("customer-cancel-accept"),
                        colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy)) {
                        ExpertCopy(if (busy) "처리 중…" else "취소 수락", color = Color.White, weight = FontWeight.SemiBold)
                    }
                }
            }
            else -> TextButton(onClick = onOpen, enabled = !busy,
                modifier = Modifier.heightIn(min = 48.dp).testTag("customer-cancel-open")) {
                ExpertCopy("거래 취소", weight = FontWeight.SemiBold, color = DesignTokens.navy)
            }
        }
    }
}

/** 사유 선택. 서버가 허용한 코드만 보내고 직접 입력한 사유는 detail로만 전달한다. */
@Composable
private fun CancelRequestDialog(busy: Boolean, onDismiss: () -> Unit, onSubmit: (String, String) -> Unit) {
    var reason by remember { mutableStateOf(CANCEL_REASONS.first().first) }
    var detail by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { ExpertCopy("거래 취소 요청", size = 19, bold = true) },
        text = {
            Column {
                ExpertCopy("사유를 선택해주세요.", size = 13, color = DesignTokens.muted)
                CANCEL_REASONS.forEach { (code, label) ->
                    Row(Modifier.padding(top = 6.dp).fillMaxWidth().heightIn(min = 44.dp)
                        .clickable { reason = code }.padding(horizontal = 4.dp, vertical = 10.dp).testTag("customer-cancel-reason-$code"),
                        verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = reason == code, onClick = { reason = code })
                        ExpertCopy(label, Modifier.padding(start = 4.dp), 14)
                    }
                }
                OutlinedTextField(value = detail, onValueChange = { if (it.length <= 500) detail = it },
                    modifier = Modifier.padding(top = 8.dp).fillMaxWidth().testTag("customer-cancel-detail"),
                    placeholder = { Text("상세 사유 (선택)", fontSize = 13.sp) },
                    textStyle = TextStyle(fontFamily = ai.mintech.kimgosu.expert.expertFont(), fontSize = 13.sp, color = DesignTokens.navy),
                    shape = RoundedCornerShape(6.dp), maxLines = 3)
            }
        },
        confirmButton = {
            TextButton(onClick = { onSubmit(reason, detail) }, enabled = !busy,
                modifier = Modifier.heightIn(min = 48.dp).testTag("customer-cancel-submit")) {
                ExpertCopy("취소 요청", weight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { ExpertCopy("닫기") }
        },
    )
}

@Composable
private fun EmptyMessages(modifier: Modifier) {
    Box(modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
        ExpertCopy("아직 메시지가 없습니다.\n첫 메시지를 보내보세요.", Modifier.testTag("customer-chat-empty"), 14, color = DesignTokens.muted)
    }
}

@Composable
private fun Composer(
    draft: String,
    sending: Boolean,
    onDraft: (String) -> Unit,
    onSend: (String) -> Unit,
    onPickPhoto: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onPickPhoto, enabled = !sending,
            modifier = Modifier.heightIn(min = 48.dp).testTag("customer-message-photo")) {
            ExpertCopy("사진", color = DesignTokens.navy, weight = FontWeight.SemiBold)
        }
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
        Column(Modifier.widthIn(max = 280.dp).background(if (mine) DesignTokens.soft else DesignTokens.track, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 9.dp)) {
            if (!mine) ExpertCopy("고수", size = 11, color = DesignTokens.muted)
            message.imageUrl?.let { url -> MessageImage(url, message.imageWidth, message.imageHeight, message.body.isBlank()) }
            if (message.body.isNotBlank()) ExpertCopy(message.body, size = 14)
            else if (message.imageUrl == null) ExpertCopy("삭제된 메시지", size = 14)
            ExpertCopy(hhmm(message.createdAt), Modifier.padding(top = 3.dp), 10, color = DesignTokens.muted)
        }
    }
}

/** 원본 비율을 유지한다. 서버가 준 픽셀 크기가 없으면 고정 높이로만 표시한다. */
@Composable
private fun MessageImage(url: String, width: Int?, height: Int?, last: Boolean) {
    var bitmap by remember(url) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(url) {
        bitmap = withContext(Dispatchers.IO) {
            runCatching {
                val connection = URL(url).openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout = 8000; connection.readTimeout = 8000
                    if (connection.responseCode !in 200..299) return@runCatching null
                    connection.inputStream.use { BitmapFactory.decodeStream(it) }
                } finally { connection.disconnect() }
            }.getOrNull()
        }
    }
    val shape = RoundedCornerShape(6.dp)
    val ratio = if (width != null && height != null && width > 0 && height > 0) width.toFloat() / height else null
    Box(Modifier.padding(bottom = if (last) 0.dp else 6.dp).widthIn(max = 220.dp)
        .then(if (ratio != null) Modifier.aspectRatio(ratio) else Modifier.height(160.dp))
        .background(DesignTokens.soft, shape).testTag("customer-message-image")) {
        bitmap?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxWidth(), contentScale = ContentScale.Fit) }
    }
}

@Composable
private fun QuoteCard(
    quote: CustomerQuote,
    busy: Boolean,
    cancelled: Boolean,
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
            cancelled -> ExpertCopy("취소된 거래입니다. 견적을 더 진행할 수 없습니다.",
                Modifier.padding(top = 10.dp).testTag("customer-quote-cancelled"), 13, color = DesignTokens.muted)
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
