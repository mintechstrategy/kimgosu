package ai.mintech.kimgosu.customer

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import ai.mintech.kimgosu.expert.ExpertCopy
import ai.mintech.kimgosu.expert.ExpertFailure
import ai.mintech.kimgosu.expert.ExpertLoading
import ai.mintech.kimgosu.ui.DesignTokens
import ai.mintech.kimgosu.ui.RemoteImage
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException

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
    var loadingMoreReviews by mutableStateOf(false); private set
    var reviewsMoreFailed by mutableStateOf(false); private set

    suspend fun load(expertId: String) {
        state = CustomerExpertState.Loading
        start = CustomerStartState.Idle
        reviewsMoreFailed = false
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

    /** 서버가 준 offset 다음 후기부터 붙인다. 이미 받은 후기는 다시 요청하지 않는다. */
    suspend fun loadMoreReviews(expertId: String) {
        val current = state as? CustomerExpertState.Ready ?: return
        if (loadingMoreReviews || current.detail.reviews.size >= current.detail.reviewCount) return
        loadingMoreReviews = true
        reviewsMoreFailed = false
        try {
            val json = transport.request("GET",
                "/v1/experts/" + enc(expertId) + "/reviews?limit=20&offset=" + current.detail.reviews.size, null, null)
            val latest = state as? CustomerExpertState.Ready ?: return
            state = latest.copy(detail = latest.detail.copy(reviews = latest.detail.reviews + decodeReviews(json)))
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            reviewsMoreFailed = true
        } finally {
            loadingMoreReviews = false
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
        onLoadMoreReviews = { scope.launch { model.loadMoreReviews(expertId) } },
        loadingMoreReviews = model.loadingMoreReviews,
        reviewsMoreFailed = model.reviewsMoreFailed,
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
    loadingMoreReviews: Boolean = false,
    reviewsMoreFailed: Boolean = false,
    onLoadMoreReviews: () -> Unit = {},
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
            is CustomerExpertState.Ready -> LazyColumn(Modifier.weight(1f).padding(horizontal = 20.dp)) {
                item {
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
                }
                if (state.detail.services.isEmpty()) {
                    item { ExpertCopy("등록된 서비스가 없습니다.", Modifier.padding(top = 8.dp), 13, color = DesignTokens.muted) }
                } else {
                    items(state.detail.services, key = { it.id }) { service -> ServiceRow(service) }
                }
                item {
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
                    }
                }
                items(state.detail.reviews, key = { it.id }) { review -> ReviewRow(review) }
                if (state.detail.reviews.size < state.detail.reviewCount) {
                    item("reviews-more") {
                        TextButton(onClick = onLoadMoreReviews, enabled = !loadingMoreReviews,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("customer-reviews-more")) {
                            ExpertCopy(if (loadingMoreReviews) "불러오는 중…" else if (reviewsMoreFailed) "후기를 더 불러오지 못했습니다. 다시 시도" else "후기 더 보기",
                                weight = FontWeight.SemiBold)
                        }
                    }
                }
                item {
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
}

@Composable
private fun ServiceRow(service: CustomerServiceItem) {
    Column(Modifier.padding(top = 8.dp).fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(12.dp)) {
        service.imageUrl?.let { url ->
            RemoteImage(url, Modifier.fillMaxWidth().height(160.dp))
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

