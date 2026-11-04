package ai.mintech.kimgosu.expert

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import ai.mintech.kimgosu.ui.DesignTokens
import android.app.Application
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * 고수 받은 견적 · 원장 상세.
 *
 * The server decides every transition and the version. This screen only renders
 * what `GET /v1/me/quotes`, `POST /v1/ledgers/:id/quotes` and
 * `POST /v1/quotes/:id/complete` return; no money amount, status or completion
 * flag is derived locally.
 */
data class ExpertQuote(
    val id: String,
    val ledgerId: String,
    val ledgerName: String,
    val customerNickname: String,
    val amount: Long,
    val vatIncluded: Boolean,
    val priceType: String,
    val status: String,
    val version: Int,
    val message: String,
    val createdAt: String?,
    val expiresAt: String?,
    val acceptedAt: String?,
    val rejectedAt: String?,
    val expertConfirmedAt: String?,
    val customerConfirmedAt: String?,
    val completedAt: String?,
)

sealed interface QuotesState {
    data object Loading : QuotesState
    data class Ready(val quotes: List<ExpertQuote>) : QuotesState
    data class Failed(val network: Boolean, val code: String) : QuotesState
}

sealed interface QuotesAction {
    data object Idle : QuotesAction
    data object Busy : QuotesAction
    data class Done(val message: String) : QuotesAction
    data class Failed(val network: Boolean, val code: String) : QuotesAction
}

class ExpertQuotesModel(application: Application) : AndroidViewModel(application) {
    private val transport: AuthTransport = MembershipHttp(application)
    private val sessions = SecureSession(application)
    private var job: Job? = null

    var state by mutableStateOf<QuotesState>(QuotesState.Loading); private set
    var selected by mutableStateOf<ExpertQuote?>(null); private set
    var filter by mutableStateOf<String?>(null); private set
    var action by mutableStateOf<QuotesAction>(QuotesAction.Idle); private set

    fun select(quote: ExpertQuote?) { selected = quote; action = QuotesAction.Idle }

    fun chooseFilter(status: String?) {
        if (filter == status) return
        filter = status
        refresh()
    }

    fun refresh() {
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) { state = QuotesState.Failed(network = false, code = "SESSION_REQUIRED"); return }
        job?.cancel()
        state = QuotesState.Loading
        job = viewModelScope.launch {
            try {
                val path = "/v1/me/quotes" + (filter?.let { "?status=$it" } ?: "")
                val body = transport.request("GET", path, token)
                val rows = body.getJSONArray("quotes")
                state = QuotesState.Ready(List(rows.length()) { decodeQuote(rows.getJSONObject(it)) })
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                state = QuotesState.Failed(network = false, code = e.code)
            } catch (_: IOException) {
                state = QuotesState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
            } catch (_: Exception) {
                state = QuotesState.Failed(network = false, code = "INVALID_API_RESPONSE")
            }
        }
    }

    fun complete(quote: ExpertQuote) = mutate("완료 확인을 보냈습니다. 고객 확인 후 완료로 바뀝니다.") { token ->
        transport.request("POST", "/v1/quotes/${quote.id}/complete", token,
            JSONObject().put("expectedVersion", quote.version))
    }

    fun propose(quote: ExpertQuote, amount: Long, message: String, vatIncluded: Boolean) =
        mutate("견적을 제시했습니다.") { token ->
            transport.request("POST", "/v1/ledgers/${quote.ledgerId}/quotes", token,
                JSONObject().put("amount", amount).put("message", message).put("vatIncluded", vatIncluded))
        }

    private fun mutate(done: String, call: suspend (String) -> JSONObject) {
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) { action = QuotesAction.Failed(network = false, code = "SESSION_REQUIRED"); return }
        action = QuotesAction.Busy
        viewModelScope.launch {
            try {
                val response = call(token)
                selected = runCatching { decodeQuote(response) }.getOrNull() ?: selected
                action = QuotesAction.Done(done)
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                action = QuotesAction.Failed(network = false, code = e.code)
            } catch (_: IOException) {
                action = QuotesAction.Failed(network = true, code = "NETWORK_UNAVAILABLE")
            } catch (_: Exception) {
                action = QuotesAction.Failed(network = false, code = "INVALID_API_RESPONSE")
            }
        }
    }
}

private fun decodeQuote(o: JSONObject) = ExpertQuote(
    id = o.getString("id"),
    ledgerId = o.getString("ledgerId"),
    ledgerName = o.optString("ledgerName", ""),
    customerNickname = o.optString("customerNickname", ""),
    // The inbox sends `amount` as the stored numeric column; it may arrive as a
    // JSON number or a numeric string depending on the driver. No derived total
    // is read here — the server owns that arithmetic.
    amount = o.optString("amount", "").toDoubleOrNull()?.toLong() ?: 0L,
    vatIncluded = o.optBoolean("vatIncluded", false),
    priceType = o.optString("priceType", "TOTAL"),
    status = o.optString("status", ""),
    version = o.optInt("version", 1),
    message = o.optString("message", ""),
    createdAt = o.optString("createdAt", "").ifEmpty { null },
    expiresAt = o.optString("expiresAt", "").ifEmpty { null },
    acceptedAt = o.optString("acceptedAt", "").ifEmpty { null },
    rejectedAt = o.optString("rejectedAt", "").ifEmpty { null },
    expertConfirmedAt = o.optString("expertConfirmedAt", "").ifEmpty { null },
    customerConfirmedAt = o.optString("customerConfirmedAt", "").ifEmpty { null },
    completedAt = o.optString("completedAt", "").ifEmpty { null },
)

private val timeFormat = DateTimeFormatter.ofPattern("yyyy.MM.dd HH:mm")

private fun time(iso: String?): String? = iso?.let {
    runCatching { Instant.parse(it).atZone(ZoneId.systemDefault()).format(timeFormat) }.getOrNull()
}

private fun price(amount: Long): String = NumberFormat.getNumberInstance(Locale.KOREA).format(amount) + "원"

private fun statusLabel(status: String) = when (status) {
    "PROPOSED" -> "제시됨"
    "ACCEPTED" -> "수락됨"
    "REJECTED" -> "거절됨"
    "COMPLETED" -> "완료"
    "EXPIRED" -> "만료"
    "CANCELLED" -> "취소"
    else -> status
}

private fun history(q: ExpertQuote): List<Pair<String, String?>> = listOf(
    "견적 제시" to q.createdAt,
    "수락" to q.acceptedAt,
    "거절" to q.rejectedAt,
    "고수 완료 확인" to q.expertConfirmedAt,
    "고객 완료 확인" to q.customerConfirmedAt,
    "완료" to q.completedAt,
).filter { it.second != null }

private val filters = listOf<Pair<String, String?>>(
    "전체" to null,
    "제시됨" to "PROPOSED",
    "수락됨" to "ACCEPTED",
    "완료" to "COMPLETED",
    "거절됨" to "REJECTED",
)

@Composable
fun ExpertQuotesScreen(model: ExpertQuotesModel) {
    LaunchedEffect(Unit) { model.refresh() }
    val selected = model.selected
    BackHandler(enabled = selected != null) { model.select(null) }
    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding()) {
        if (selected == null) QuotesList(model) else QuoteDetail(model, selected)
    }
}

@Composable
private fun QuotesList(model: ExpertQuotesModel) {
    val font = brandFont()
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        T("받은 견적", 23, bold = true, font = font)
        Spacer(Modifier.weight(1f))
        (model.state as? QuotesState.Ready)?.let { T("${it.quotes.size}건", 13, color = DesignTokens.muted, font = font) }
    }
    Row(Modifier.padding(top = 12.dp).horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        filters.forEach { (label, status) ->
            FilterChip(selected = model.filter == status, onClick = { model.chooseFilter(status) },
                label = { T(label, 13, font = font) }, shape = RoundedCornerShape(percent = 50),
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = DesignTokens.soft))
        }
    }
    when (val state = model.state) {
        QuotesState.Loading -> Box(Modifier.fillMaxSize().testTag("quotes-loading"), contentAlignment = Alignment.Center) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(16.dp), color = DesignTokens.navy, strokeWidth = 2.dp)
                T("견적을 불러오는 중…", 13, color = DesignTokens.muted, font = font, modifier = Modifier.padding(start = 10.dp))
            }
        }
        is QuotesState.Failed -> Column(Modifier.fillMaxSize().padding(24.dp).testTag(
            if (state.network) "quotes-network" else "quotes-error"), verticalArrangement = Arrangement.Center) {
            T(if (state.network) "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
            else "견적을 불러오지 못했습니다. (${state.code})", 14, font = font)
            TextButton(onClick = model::refresh, modifier = Modifier.heightIn(min = 48.dp).testTag("quotes-retry")) {
                T("다시 시도", 14, weight = FontWeight.SemiBold, font = font)
            }
        }
        is QuotesState.Ready -> if (state.quotes.isEmpty()) {
            Column(Modifier.fillMaxSize().padding(24.dp).testTag("quotes-empty"), verticalArrangement = Arrangement.Center) {
                T("받은 견적이 없습니다.", 15, bold = true, font = font)
                T("고객에게 견적을 제시하면 여기에 표시됩니다.", 13, color = DesignTokens.muted, font = font,
                    modifier = Modifier.padding(top = 6.dp))
            }
        } else LazyColumn(Modifier.fillMaxSize().testTag("quotes-list"),
            contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(state.quotes, key = { it.id }) { quote -> QuoteRow(quote, font) { model.select(quote) } }
        }
    }
}

@Composable
private fun QuoteRow(quote: ExpertQuote, font: FontFamily, onOpen: () -> Unit) {
    Column(Modifier.fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp))
        .clickable(onClick = onOpen).padding(14.dp).testTag("quotes-row")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            T(quote.customerNickname.ifBlank { "고객" }, 16, bold = true, font = font, modifier = Modifier.weight(1f))
            StatusBadge(quote.status, font)
        }
        if (quote.ledgerName.isNotBlank()) {
            T(quote.ledgerName, 12, color = DesignTokens.muted, font = font, modifier = Modifier.padding(top = 2.dp))
        }
        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            T(price(quote.amount), 17, bold = true, font = font)
            T(if (quote.vatIncluded) "부가세 포함" else "부가세 별도", 11, color = DesignTokens.muted, font = font,
                modifier = Modifier.padding(start = 6.dp))
            Spacer(Modifier.weight(1f))
            T(time(quote.createdAt) ?: "", 12, color = DesignTokens.muted, font = font)
        }
        if (quote.message.isNotBlank()) {
            T(quote.message, 13, color = DesignTokens.muted, font = font, maxLines = 2,
                modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@Composable
private fun StatusBadge(status: String, font: FontFamily) {
    val background = if (status == "COMPLETED") DesignTokens.lime else DesignTokens.soft
    Box(Modifier.background(background, RoundedCornerShape(4.dp)).padding(horizontal = 8.dp, vertical = 3.dp)
        .testTag("quote-status-${status.lowercase()}")) {
        T(statusLabel(status), 11, weight = FontWeight.SemiBold, font = font)
    }
}

@Composable
private fun QuoteDetail(model: ExpertQuotesModel, quote: ExpertQuote) {
    val font = brandFont()
    var amountText by remember(quote.id) { mutableStateOf("") }
    var message by remember(quote.id) { mutableStateOf("") }
    var vatIncluded by remember(quote.id) { mutableStateOf(false) }
    var inputError by remember(quote.id) { mutableStateOf<String?>(null) }
    val busy = model.action is QuotesAction.Busy

    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = { model.select(null) }, modifier = Modifier.heightIn(min = 48.dp).testTag("quotes-back")) {
            T("← 목록", 14, weight = FontWeight.SemiBold, font = font)
        }
        Spacer(Modifier.weight(1f))
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 24.dp)
        .testTag("quotes-detail")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            T(quote.customerNickname.ifBlank { "고객" }, 20, bold = true, font = font, modifier = Modifier.weight(1f))
            StatusBadge(quote.status, font)
        }
        if (quote.ledgerName.isNotBlank()) T("원장 · ${quote.ledgerName}", 12, color = DesignTokens.muted, font = font,
            modifier = Modifier.padding(top = 2.dp))

        SectionTitle("금액", font)
        Column(Modifier.fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                T(price(quote.amount), 19, bold = true, font = font)
                T(if (quote.vatIncluded) "부가세 포함" else "부가세 별도", 12, color = DesignTokens.muted, font = font,
                    modifier = Modifier.padding(start = 6.dp))
            }
            if (quote.priceType == "HOURLY") T("시간당 요금", 12, color = DesignTokens.muted, font = font,
                modifier = Modifier.padding(top = 4.dp))
            time(quote.expiresAt)?.let { T("유효기간 $it 까지", 12, color = DesignTokens.muted, font = font,
                modifier = Modifier.padding(top = 4.dp)) }
        }

        SectionTitle("메시지", font)
        T(quote.message.ifBlank { "메시지가 없습니다." }, 14, font = font,
            modifier = Modifier.fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(14.dp))

        SectionTitle("상태 이력", font)
        Column(Modifier.fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(14.dp)
            .testTag("quotes-history")) {
            history(quote).forEach { (label, at) ->
                Row(Modifier.padding(vertical = 3.dp)) {
                    T(label, 13, weight = FontWeight.SemiBold, font = font, modifier = Modifier.weight(1f))
                    T(time(at) ?: "", 12, color = DesignTokens.muted, font = font)
                }
            }
        }

        SectionTitle("완료 확인", font)
        when {
            quote.status == "COMPLETED" ->
                T("양측 확인이 끝나 완료된 견적입니다.", 13, color = DesignTokens.muted, font = font)
            quote.status != "ACCEPTED" ->
                T("고객이 견적을 수락하면 완료 확인을 할 수 있습니다.", 13, color = DesignTokens.muted, font = font)
            quote.expertConfirmedAt != null ->
                T("완료 확인함 · 고객 확인 대기", 13, weight = FontWeight.SemiBold, font = font,
                    modifier = Modifier.testTag("quotes-confirm-pending"))
            else -> Button(onClick = { model.complete(quote) }, enabled = !busy,
                modifier = Modifier.heightIn(min = 48.dp).testTag("quotes-confirm")) {
                T("완료 확인", 14, weight = FontWeight.SemiBold, color = Color.White, font = font)
            }
        }

        SectionTitle("새 견적 제시", font)
        OutlinedTextField(value = amountText, onValueChange = { amountText = it.filter(Char::isDigit).take(10) },
            label = { T("금액(원)", 13, font = font) }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth().testTag("quotes-amount"))
        OutlinedTextField(value = message, onValueChange = { message = it.take(2000) },
            label = { T("메시지", 13, font = font) }, minLines = 3,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag("quotes-message"))
        Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Switch(checked = vatIncluded, onCheckedChange = { vatIncluded = it })
            T("부가세 포함", 13, font = font, modifier = Modifier.padding(start = 8.dp))
        }
        inputError?.let { T(it, 12, color = DesignTokens.navy, font = font) }
        Button(onClick = {
            val amount = amountText.toLongOrNull() ?: 0L
            inputError = when {
                amount <= 0 -> "금액을 입력하세요."
                amount > 2_147_483_647L -> "금액은 2,147,483,647원 이하로 입력하세요."
                message.isBlank() -> "메시지를 입력하세요."
                else -> null
            }
            if (inputError == null) {
                model.propose(quote, amount, message, vatIncluded)
                amountText = ""; message = ""; vatIncluded = false
            }
        }, enabled = !busy, modifier = Modifier.padding(top = 8.dp).fillMaxWidth().heightIn(min = 48.dp)
            .testTag("quotes-propose")) {
            T("견적 제시", 14, weight = FontWeight.SemiBold, color = Color.White, font = font)
        }

        when (val action = model.action) {
            QuotesAction.Idle -> Unit
            QuotesAction.Busy -> TextButton(onClick = {}, enabled = false, modifier = Modifier.heightIn(min = 44.dp)) {
                T("처리 중…", 12, color = DesignTokens.muted, font = font)
            }
            is QuotesAction.Done -> T(action.message, 13, weight = FontWeight.SemiBold, font = font,
                modifier = Modifier.padding(top = 8.dp).testTag("quotes-action-done"))
            is QuotesAction.Failed -> T(if (action.network) "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
            else "요청을 처리하지 못했습니다. (${action.code})", 13, font = font,
                modifier = Modifier.padding(top = 8.dp).testTag("quotes-action-error"))
        }
    }
}

@Composable private fun SectionTitle(text: String, font: FontFamily) {
    T(text, 16, bold = true, font = font, modifier = Modifier.padding(top = 20.dp, bottom = 8.dp))
}

@Composable private fun brandFont(): FontFamily {
    val assets = LocalContext.current.assets
    return remember {
        FontFamily(Font("regular.otf", assets), Font("semibold.otf", assets, FontWeight.SemiBold),
            Font("bold.otf", assets, FontWeight.Bold))
    }
}

@Composable private fun T(text: String, size: Int = 14, bold: Boolean = false, color: Color = DesignTokens.navy,
                         font: FontFamily = FontFamily.Default, weight: FontWeight? = null,
                         modifier: Modifier = Modifier, align: TextAlign = TextAlign.Start, maxLines: Int = Int.MAX_VALUE) {
    Text(text, modifier, color = color, fontSize = size.sp, fontFamily = font,
        fontWeight = weight ?: if (bold) FontWeight.Bold else FontWeight.Normal,
        textAlign = align, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}
