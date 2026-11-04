package ai.mintech.kimgosu.customer

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import ai.mintech.kimgosu.expert.ExpertCopy
import ai.mintech.kimgosu.expert.ExpertFailure
import ai.mintech.kimgosu.expert.ExpertLoading
import ai.mintech.kimgosu.ui.DesignTokens
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class CustomerServiceItem(
    val id: String,
    val title: String,
    val category: String,
    val priceType: String,
    val basePrice: Long?,
    val imageUrl: String?,
)

data class CustomerPublicReview(
    val id: String,
    val rating: Int,
    val body: String,
    val authorNickname: String,
)

data class CustomerExpertDetail(
    val nickname: String,
    val introduction: String,
    val career: String,
    val activityRegion: String,
    val services: List<CustomerServiceItem>,
    val reviews: List<CustomerPublicReview>,
    val reviewCount: Int,
    val reviewAverage: Double?,
)

sealed interface CustomerExpertState {
    data object Loading : CustomerExpertState
    data class Empty(val message: String) : CustomerExpertState
    data class Failed(val network: Boolean, val code: String) : CustomerExpertState
    data class Ready(val detail: CustomerExpertDetail, val reviewsUnavailable: Boolean) : CustomerExpertState
}

sealed interface CustomerStartState {
    data object Idle : CustomerStartState
    data object Busy : CustomerStartState
    data class Failed(val message: String) : CustomerStartState
}

class CustomerExpertModel(
    private val transport: AuthTransport = MembershipHttp(),
    private val sessions: SecureSession,
) {
    var state by mutableStateOf<CustomerExpertState>(CustomerExpertState.Loading); private set
    var start by mutableStateOf<CustomerStartState>(CustomerStartState.Idle); private set

    suspend fun load(expertId: String) {
        state = CustomerExpertState.Loading
        start = CustomerStartState.Idle
        try {
            val detail = decodeDetail(transport.request("GET", "/v1/experts/" + enc(expertId), null, null))
            val reviews = runCatching { transport.request("GET", "/v1/experts/" + enc(expertId) + "/reviews?limit=20", null, null) }
            val list = reviews.getOrNull()?.let(::decodeReviews).orEmpty()
            val summary = reviews.getOrNull()?.getJSONObject("summary")
            state = CustomerExpertState.Ready(
                detail.copy(
                    reviews = list,
                    reviewCount = summary?.optInt("count") ?: list.size,
                    reviewAverage = summary?.let { if (it.isNull("average")) null else it.optDouble("average") },
                ),
                reviewsUnavailable = reviews.isFailure,
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthFailure) {
            state = if (e.status == 404) CustomerExpertState.Empty("고수 정보를 찾을 수 없습니다.")
            else CustomerExpertState.Failed(network = false, code = e.code)
        } catch (_: IOException) {
            state = CustomerExpertState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
        } catch (_: Exception) {
            state = CustomerExpertState.Failed(network = false, code = "INVALID_API_RESPONSE")
        }
    }

    /** 원장 생성은 서버가 (고수, 고객) 조합에 하나만 유지한다. 이미 있으면 같은 id가 200으로 온다. */
    suspend fun startDeal(expertId: String, onStarted: (String) -> Unit) {
        if (start is CustomerStartState.Busy) return
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) {
            start = CustomerStartState.Failed("세션이 만료되었습니다. 다시 로그인해주세요.")
            return
        }
        start = CustomerStartState.Busy
        try {
            val response = transport.request("POST", "/v1/ledgers", token, JSONObject().put("expertId", expertId))
            start = CustomerStartState.Idle
            onStarted(response.getString("id"))
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthFailure) {
            start = CustomerStartState.Failed(
                if (e.status == 401) "세션이 만료되었습니다. 다시 로그인해주세요."
                else "거래를 시작하지 못했습니다. (${e.code})")
        } catch (_: IOException) {
            start = CustomerStartState.Failed("네트워크에 연결할 수 없습니다.")
        } catch (_: Exception) {
            start = CustomerStartState.Failed("거래를 시작하지 못했습니다. (INVALID_API_RESPONSE)")
        }
    }

    companion object {
        private fun enc(value: String) = java.net.URLEncoder.encode(value, "UTF-8")

        fun decodeDetail(json: JSONObject): CustomerExpertDetail {
            if (json.isNull("expert")) throw IOException("EXPERT_MISSING")
            val expert = json.getJSONObject("expert")
            val services = json.optJSONArray("services")?.let { array ->
                List(array.length()) { index ->
                    val row = array.getJSONObject(index)
                    CustomerServiceItem(
                        id = row.getString("id"),
                        title = row.optString("title"),
                        category = row.optString("category"),
                        priceType = row.optString("priceType"),
                        basePrice = if (row.isNull("basePrice")) null else row.optLong("basePrice"),
                        imageUrl = if (row.isNull("imageUrl")) null else row.optString("imageUrl").takeIf { it.isNotBlank() },
                    )
                }
            }.orEmpty()
            return CustomerExpertDetail(
                nickname = expert.optString("nickname"),
                introduction = expert.optString("introduction"),
                career = if (expert.isNull("career")) "" else expert.optString("career"),
                activityRegion = expert.optString("activityRegion"),
                services = services,
                reviews = emptyList(),
                reviewCount = 0,
                reviewAverage = null,
            )
        }

        fun decodeReviews(json: JSONObject): List<CustomerPublicReview> {
            val array = json.getJSONArray("reviews")
            return List(array.length()) { index ->
                val row = array.getJSONObject(index)
                CustomerPublicReview(
                    id = row.getString("id"),
                    rating = row.optInt("rating"),
                    body = if (row.isNull("body")) "" else row.optString("body"),
                    authorNickname = row.optString("authorNickname"),
                )
            }
        }
    }
}

@Composable
fun CustomerExpertScreen(expertId: String, onBack: () -> Unit, onStartChat: (String, String) -> Unit) {
    val context = LocalContext.current.applicationContext
    val model = remember(expertId) { CustomerExpertModel(MembershipHttp(context), SecureSession(context)) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(expertId) { model.load(expertId) }
    CustomerExpertContent(
        state = model.state,
        start = model.start,
        onRetry = { scope.launch { model.load(expertId) } },
        onStartDeal = {
            val nickname = (model.state as? CustomerExpertState.Ready)?.detail?.nickname.orEmpty()
            scope.launch { model.startDeal(expertId) { ledgerId -> onStartChat(ledgerId, nickname) } }
        },
        onBack = onBack,
    )
}

@Composable
fun CustomerExpertContent(
    state: CustomerExpertState,
    start: CustomerStartState,
    onRetry: () -> Unit,
    onStartDeal: () -> Unit,
    onBack: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().testTag("customer-expert")) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            ExpertCopy("고수 상세", Modifier.weight(1f), 22, bold = true)
            TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp).testTag("customer-expert-back")) { ExpertCopy("뒤로") }
        }
        when (state) {
            CustomerExpertState.Loading -> ExpertLoading()
            is CustomerExpertState.Empty -> Column(Modifier.padding(20.dp)) { ExpertCopy(state.message, color = DesignTokens.muted) }
            is CustomerExpertState.Failed -> ExpertFailure(state.network, state.code, onRetry)
            is CustomerExpertState.Ready -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
                ExpertCopy(state.detail.nickname.ifBlank { "고수" }, Modifier.padding(top = 8.dp), 22, bold = true)
                val meta = listOf(state.detail.activityRegion).filter { it.isNotBlank() }
                if (meta.isNotEmpty()) ExpertCopy(meta.joinToString(" · "), Modifier.padding(top = 4.dp), 13, color = DesignTokens.muted)
                if (state.detail.introduction.isNotBlank()) {
                    ExpertCopy("소개", Modifier.padding(top = 22.dp), 17, bold = true)
                    ExpertCopy(state.detail.introduction, Modifier.padding(top = 8.dp), 14)
                }
                if (state.detail.career.isNotBlank()) {
                    ExpertCopy("경력", Modifier.padding(top = 20.dp), 17, bold = true)
                    ExpertCopy(state.detail.career, Modifier.padding(top = 8.dp), 14)
                }
                ExpertCopy("서비스", Modifier.padding(top = 22.dp), 17, bold = true)
                if (state.detail.services.isEmpty()) {
                    ExpertCopy("등록된 서비스가 없습니다.", Modifier.padding(top = 8.dp), 13, color = DesignTokens.muted)
                } else {
                    state.detail.services.forEach { service -> ServiceRow(service) }
                }
                ExpertCopy("후기", Modifier.padding(top = 22.dp), 17, bold = true)
                if (state.reviewsUnavailable) {
                    ExpertCopy("후기를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.", Modifier.padding(top = 8.dp), 13, color = DesignTokens.muted)
                } else if (state.detail.reviews.isEmpty()) {
                    ExpertCopy("아직 후기가 없습니다.", Modifier.padding(top = 8.dp).fillMaxWidth()
                        .border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(16.dp).testTag("customer-review-empty"),
                        13, color = DesignTokens.muted)
                } else {
                    val average = state.detail.reviewAverage
                    ExpertCopy("평점 " + (average?.let { String.format(java.util.Locale.KOREA, "%.1f", it) } ?: "-") +
                        " · 후기 ${state.detail.reviewCount}개", Modifier.padding(top = 8.dp).testTag("customer-review-summary"), 13, color = DesignTokens.muted)
                    state.detail.reviews.forEach { review -> ReviewRow(review) }
                }
                Button(onClick = onStartDeal, enabled = start !is CustomerStartState.Busy,
                    modifier = Modifier.padding(top = 24.dp, bottom = 24.dp).fillMaxWidth().heightIn(min = 50.dp).testTag("customer-start-deal"),
                    colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy)) {
                    ExpertCopy(if (start is CustomerStartState.Busy) "거래를 시작하는 중…" else "거래 시작", color = Color.White, weight = FontWeight.SemiBold)
                }
                (start as? CustomerStartState.Failed)?.let { ExpertCopy(it.message, Modifier.padding(bottom = 20.dp).testTag("customer-start-error"), 13) }
            }
        }
    }
}

@Composable
private fun ServiceRow(service: CustomerServiceItem) {
    Column(Modifier.padding(top = 8.dp).fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(12.dp)) {
        service.imageUrl?.let { url ->
            RemoteThumb(url, Modifier.fillMaxWidth().height(160.dp).background(DesignTokens.soft, RoundedCornerShape(4.dp)))
        }
        ExpertCopy(service.title.ifBlank { service.category }, Modifier.padding(top = 8.dp), 15, bold = true)
        val meta = buildList {
            if (service.category.isNotBlank()) add(service.category)
            if (service.basePrice != null) add(if (service.priceType == "NEGOTIABLE") "협의" else won(service.basePrice))
        }
        if (meta.isNotEmpty()) ExpertCopy(meta.joinToString(" · "), Modifier.padding(top = 4.dp), 12, color = DesignTokens.muted)
    }
}

@Composable
private fun ReviewRow(review: CustomerPublicReview) {
    Column(Modifier.padding(top = 8.dp).fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(12.dp)) {
        ExpertCopy("★ ${review.rating}.0 · ${review.authorNickname.ifBlank { "고객" }}", size = 13, weight = FontWeight.SemiBold)
        if (review.body.isNotBlank()) ExpertCopy(review.body, Modifier.padding(top = 6.dp), 13, color = DesignTokens.muted)
    }
}

/** 서버가 imageUrl을 줄 때만 표시한다. 이미지 자체는 공개 URL에서 읽고 업무 데이터로 저장하지 않는다. */
@Composable
private fun RemoteThumb(url: String, modifier: Modifier) {
    var bitmap by remember(url) { mutableStateOf<android.graphics.Bitmap?>(null) }
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
    bitmap?.let { Image(it.asImageBitmap(), null, modifier, contentScale = ContentScale.Crop) }
}
