package ai.mintech.kimgosu.customer

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.expert.ExpertCopy
import ai.mintech.kimgosu.expert.ExpertFailure
import ai.mintech.kimgosu.expert.ExpertLoading
import ai.mintech.kimgosu.expert.ExpertScreenTitle
import ai.mintech.kimgosu.ui.DesignTokens
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException

data class CustomerExpertCard(
    val expertId: String,
    val nickname: String,
    val introduction: String,
    val activityRegion: String,
    val serviceCount: Int,
    val fromPrice: Long?,
    val onVacation: Boolean,
)

sealed interface CustomerSearchState {
    data object Loading : CustomerSearchState
    data object Empty : CustomerSearchState
    data class Failed(val network: Boolean, val code: String) : CustomerSearchState
    data class Ready(val experts: List<CustomerExpertCard>) : CustomerSearchState
}

class CustomerSearchModel(private val transport: AuthTransport = MembershipHttp()) {
    var state by mutableStateOf<CustomerSearchState>(CustomerSearchState.Loading); private set
    var nextCursor by mutableStateOf<String?>(null); private set
    var loadingMore by mutableStateOf(false); private set
    var moreFailed by mutableStateOf(false); private set

    suspend fun load(category: String?) {
        state = CustomerSearchState.Loading
        nextCursor = null
        moreFailed = false
        try {
            val json = transport.request("GET", searchPath(category), null, null)
            nextCursor = cursorOf(json)
            val experts = decodeExperts(json)
            state = if (experts.isEmpty()) CustomerSearchState.Empty else CustomerSearchState.Ready(experts)
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthFailure) {
            state = CustomerSearchState.Failed(network = false, code = e.code)
        } catch (_: IOException) {
            state = CustomerSearchState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
        } catch (_: Exception) {
            state = CustomerSearchState.Failed(network = false, code = "INVALID_API_RESPONSE")
        }
    }

    /** 첫 페이지를 지우지 않고 서버 커서 다음 페이지를 뒤에 붙인다. */
    suspend fun loadMore(category: String?) {
        val cursor = nextCursor ?: return
        val loaded = (state as? CustomerSearchState.Ready)?.experts ?: return
        if (loadingMore) return
        loadingMore = true
        moreFailed = false
        try {
            val json = transport.request("GET", searchPath(category, cursor), null, null)
            nextCursor = cursorOf(json)
            state = CustomerSearchState.Ready(loaded + decodeExperts(json))
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            moreFailed = true
        } finally {
            loadingMore = false
        }
    }

    companion object {
        fun searchPath(category: String?, cursor: String? = null): String {
            var path = "/v1/experts?limit=20"
            if (!category.isNullOrBlank()) path += "&category=" + java.net.URLEncoder.encode(category, "UTF-8")
            if (cursor != null) path += "&cursor=" + java.net.URLEncoder.encode(cursor, "UTF-8")
            return path
        }

        fun decode(json: JSONObject): CustomerSearchState {
            val experts = decodeExperts(json)
            return if (experts.isEmpty()) CustomerSearchState.Empty else CustomerSearchState.Ready(experts)
        }

        fun decodeExperts(json: JSONObject): List<CustomerExpertCard> {
            val array = json.getJSONArray("experts")
            return List(array.length()) { index ->
                val row = array.getJSONObject(index)
                CustomerExpertCard(
                    expertId = row.getString("expertId"),
                    nickname = row.optString("nickname"),
                    introduction = row.optString("introduction"),
                    activityRegion = row.optString("activityRegion"),
                    serviceCount = row.optInt("serviceCount"),
                    fromPrice = if (row.isNull("fromPrice")) null else row.optLong("fromPrice"),
                    onVacation = row.optBoolean("onVacation"),
                )
            }
        }

        fun cursorOf(json: JSONObject): String? =
            if (json.isNull("nextCursor")) null else json.optString("nextCursor").takeIf { it.isNotBlank() }
    }
}

@Composable
fun CustomerSearchScreen(
    category: String?,
    onBack: () -> Unit,
    onOpenExpert: (String, String) -> Unit,
    onClearCategory: () -> Unit,
) {
    val context = LocalContext.current.applicationContext
    val model = remember { CustomerSearchModel(MembershipHttp(context)) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(category) { model.load(category) }
    CustomerSearchContent(
        category = category,
        state = model.state,
        hasMore = model.nextCursor != null,
        loadingMore = model.loadingMore,
        moreFailed = model.moreFailed,
        onRetry = { scope.launch { model.load(category) } },
        onLoadMore = { scope.launch { model.loadMore(category) } },
        onClearCategory = onClearCategory,
        onOpenExpert = onOpenExpert,
        onBack = onBack,
    )
}

@Composable
fun CustomerSearchContent(
    category: String?,
    state: CustomerSearchState,
    onRetry: () -> Unit,
    onClearCategory: () -> Unit,
    onOpenExpert: (String, String) -> Unit,
    onBack: () -> Unit,
    hasMore: Boolean = false,
    loadingMore: Boolean = false,
    moreFailed: Boolean = false,
    onLoadMore: () -> Unit = {},
) {
    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().testTag("customer-search")) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            ExpertCopy("고수 찾기", Modifier.weight(1f), 22, bold = true)
            TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp).testTag("customer-search-close")) {
                ExpertCopy("닫기")
            }
        }
        Row(Modifier.padding(horizontal = 20.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CategoryChip("전체", category == null, onClearCategory, "customer-category-all")
            if (category != null) CategoryChip(category, true, { }, "customer-category-filter")
        }
        when (state) {
            CustomerSearchState.Loading -> ExpertLoading()
            CustomerSearchState.Empty -> Column(Modifier.fillMaxWidth().padding(20.dp).border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(20.dp)
                .testTag("customer-search-empty")) {
                ExpertCopy("조건에 맞는 고수가 없습니다.", bold = true)
                ExpertCopy("다른 카테고리로 찾아보세요.", Modifier.padding(top = 6.dp), 13, color = DesignTokens.muted)
                TextButton(onClick = onClearCategory, modifier = Modifier.heightIn(min = 48.dp)) { ExpertCopy("전체 보기", weight = FontWeight.SemiBold) }
            }
            is CustomerSearchState.Failed -> ExpertFailure(state.network, state.code, onRetry)
            is CustomerSearchState.Ready -> LazyColumn(Modifier.weight(1f).padding(top = 8.dp).testTag("customer-search-results")) {
                items(state.experts, key = { it.expertId }) { expert -> ExpertCard(expert, onOpenExpert) }
                if (hasMore) {
                    item("more") {
                        TextButton(onClick = onLoadMore, enabled = !loadingMore,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("customer-search-more")) {
                            ExpertCopy(if (loadingMore) "불러오는 중…" else if (moreFailed) "더 불러오지 못했습니다. 다시 시도" else "더 보기",
                                weight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CategoryChip(label: String, selected: Boolean, onClick: () -> Unit, tag: String) {
    Box(Modifier.heightIn(min = 44.dp).background(if (selected) DesignTokens.soft else DesignTokens.soft, RoundedCornerShape(percent = 50))
        .border(1.dp, if (selected) DesignTokens.navy else DesignTokens.border, RoundedCornerShape(percent = 50))
        .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp).testTag(tag)) {
        ExpertCopy(label, size = 13, weight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
    }
}

@Composable
private fun ExpertCard(expert: CustomerExpertCard, onOpen: (String, String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp).heightIn(min = 72.dp)
        .border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp))
        .clickable { onOpen(expert.expertId, expert.nickname) }.padding(14.dp).testTag("expert-card-${expert.expertId}")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ExpertCopy(expert.nickname.ifBlank { "고수" }, Modifier.weight(1f), 16, bold = true)
            if (expert.onVacation) VacationBadge()
            expert.fromPrice?.let { ExpertCopy(won(it) + "부터", Modifier.padding(start = 8.dp), size = 13, weight = FontWeight.SemiBold) }
        }
        val meta = listOf(expert.activityRegion, "서비스 ${expert.serviceCount}개").filter { it.isNotBlank() }
        if (meta.isNotEmpty()) ExpertCopy(meta.joinToString(" · "), Modifier.padding(top = 4.dp), 12, color = DesignTokens.muted)
        if (expert.introduction.isNotBlank()) ExpertCopy(expert.introduction, Modifier.padding(top = 6.dp), 13, color = DesignTokens.muted)
    }
}

@Composable
private fun VacationBadge() {
    Box(Modifier.padding(start = 8.dp).background(DesignTokens.lime, RoundedCornerShape(4.dp))
        .padding(horizontal = 7.dp, vertical = 3.dp).testTag("expert-vacation")) {
        ExpertCopy("휴가 중", size = 11, weight = FontWeight.SemiBold)
    }
}

internal fun won(amount: Long): String =
    java.text.NumberFormat.getNumberInstance(java.util.Locale.KOREA).format(amount) + "원"
