package ai.mintech.kimgosu

import ai.mintech.kimgosu.customer.CustomerChatContent
import ai.mintech.kimgosu.customer.CustomerChatModel
import ai.mintech.kimgosu.customer.CustomerChatState
import ai.mintech.kimgosu.customer.CustomerExpertModel
import ai.mintech.kimgosu.customer.CustomerMessage
import ai.mintech.kimgosu.customer.CustomerQuote
import ai.mintech.kimgosu.customer.CustomerSearchContent
import ai.mintech.kimgosu.customer.CustomerSearchModel
import ai.mintech.kimgosu.customer.CustomerSearchState
import ai.mintech.kimgosu.customer.quoteStatusLabel
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** 고객 거래 흐름의 계약 디코딩과 4상태 표현. 서버 성공을 위조하지 않고 상태값만 주입한다. */
class CustomerFlowTests {
    @get:Rule val compose = createComposeRule()

    private val searchBody = JSONObject(
        """{"experts":[{"expertId":"6c5e6a8f-7cdf-4522-8fe2-8fe0dc1c4eb0","nickname":"테스트11",
        "introduction":"소개","activityRegion":"경기도 양주시","serviceCount":2,"fromPrice":50000,
        "services":[{"id":"s1","category":"배관","title":"서비스","description":"설명","priceType":"FIXED","basePrice":50000,"visibility":"VISIBLE","imageKey":null}]}],
        "nextCursor":null}""")

    @Test fun searchDecodesReadyAndEmpty() {
        val ready = CustomerSearchModel.decode(searchBody) as CustomerSearchState.Ready
        assertEquals(1, ready.experts.size)
        assertEquals("테스트11", ready.experts[0].nickname)
        assertEquals(50000L, ready.experts[0].fromPrice)
        assertEquals(CustomerSearchState.Empty, CustomerSearchModel.decode(JSONObject("""{"experts":[],"nextCursor":null}""")))
    }

    @Test fun detailDecodesServicesAndReviews() {
        val detail = CustomerExpertModel.decodeDetail(JSONObject(
            """{"expert":{"expertId":"e1","nickname":"테스트11","introduction":"소개","career":"경력",
            "activityRegion":"서울","status":"ACTIVE","availability":"AVAILABLE"},
            "services":[{"id":"s1","category":"배관","title":"서비스","priceType":"FIXED","basePrice":50000,"imageUrl":null}]}"""))
        assertEquals("테스트11", detail.nickname)
        assertEquals(1, detail.services.size)
        assertEquals(null, detail.services[0].imageUrl)
        val reviews = CustomerExpertModel.decodeReviews(JSONObject(
            """{"reviews":[{"id":"r1","rating":5,"body":"좋아요","createdAt":"2026-11-04T03:48:37.738Z","authorNickname":"테스트03"}]}"""))
        assertEquals(5, reviews[0].rating)
        assertEquals("테스트03", reviews[0].authorNickname)
    }

    @Test fun messagesAreShownOldestFirst() {
        val messages = CustomerChatModel.decodeMessages(JSONObject(
            """{"messages":[{"id":"m2","senderId":"a","body":"둘","deleted":false,"createdAt":"2026-11-04T07:00:02Z"},
            {"id":"m1","senderId":"b","body":"하나","deleted":false,"createdAt":"2026-11-04T07:00:01Z"}],"total":2,"nextCursor":null}"""))
        assertEquals(listOf("하나", "둘"), messages.map { it.body })
    }

    @Test fun activeQuotePrefersInProgressOverOlderCompletion() {
        val quotes = CustomerChatModel.decodeQuotes(JSONObject(
            """{"quotes":[
            {"id":"q1","amount":100000,"totalAmount":110000,"status":"COMPLETED","effectiveStatus":"COMPLETED","message":"old","version":5,"customerConfirmedAt":"2026-11-03T00:00:00Z","expertConfirmedAt":"2026-11-03T00:00:00Z","createdAt":"2026-11-03T00:00:00Z"},
            {"id":"q2","amount":200000,"totalAmount":220000,"status":"PROPOSED","effectiveStatus":"PROPOSED","message":"new","version":1,"customerConfirmedAt":null,"expertConfirmedAt":null,"createdAt":"2026-11-04T00:00:00Z"}]}"""))
        assertEquals("q2", CustomerChatModel.activeQuote(quotes)?.id)
    }

    @Test fun searchShowsNetworkFailureWithRetry() {
        compose.setContent {
            CustomerSearchContent(category = null,
                state = CustomerSearchState.Failed(network = true, code = "NETWORK_UNAVAILABLE"),
                onRetry = {}, onClearCategory = {}, onOpenExpert = { _, _ -> }, onBack = {})
        }
        compose.onNodeWithTag("customer-search").assertExists()
        compose.onNodeWithTag("expert-network-failure").assertExists()
        compose.onNodeWithTag("expert-retry").assertExists()
        compose.onNodeWithTag("customer-search-empty").assertDoesNotExist()
    }

    private fun showChat(state: CustomerChatState, onWriteReview: () -> Unit = {}) {
        compose.setContent {
            CustomerChatContent(expertNickname = "테스트11", state = state, sending = false, actionBusy = false,
                actionError = null, onRetry = {}, onSend = {}, onAccept = {}, onComplete = {},
                onWriteReview = onWriteReview, onBack = {})
        }
    }

    @Test fun chatEmptyStateStillOffersComposer() {
        showChat(CustomerChatState.Empty(ownId = "me"))
        compose.onNodeWithTag("customer-chat-empty").assertExists()
        compose.onNodeWithTag("customer-message-input").assertExists()
    }

    @Test fun oneSidedCompletionShowsWaitingForCounterpart() {
        val quote = CustomerQuote("q1", 200000, 220000, "ACCEPTED", "ACCEPTED", "견적", 3,
            customerConfirmedAt = "2026-11-04T07:48:22Z", expertConfirmedAt = null,
            createdAt = "2026-11-04T07:48:14Z")
        showChat(CustomerChatState.Ready("me", emptyList(), listOf(quote)))
        compose.onNodeWithTag("customer-waiting-counterpart").assertIsDisplayed()
        compose.onNodeWithText("상대 확인 대기 중입니다. 고수가 완료를 확인하면 거래가 종료됩니다.").assertExists()
        compose.onNodeWithTag("customer-complete").assertDoesNotExist()
    }

    @Test fun completedDealOffersReview() {
        var reviewed = 0
        val quote = CustomerQuote("q1", 200000, 220000, "COMPLETED", "COMPLETED", "견적", 5,
            customerConfirmedAt = "2026-11-04T07:48:22Z", expertConfirmedAt = "2026-11-04T07:48:23Z",
            createdAt = "2026-11-04T07:48:14Z")
        showChat(CustomerChatState.Ready("me", emptyList(), listOf(quote)), onWriteReview = { reviewed++ })
        compose.onNodeWithTag("customer-write-review").performClick()
        compose.waitForIdle()
        assertEquals(1, reviewed)
        assertEquals("거래 완료", quoteStatusLabel(quote))
    }

    @Test fun messagesRenderWithMineAlignedLast() {
        val messages = listOf(
            CustomerMessage("m1", "other", "안녕하세요", "2026-11-04T07:00:01Z"),
            CustomerMessage("m2", "me", "견적 요청드립니다", "2026-11-04T07:00:02Z"),
        )
        showChat(CustomerChatState.Ready("me", messages, emptyList()))
        compose.onNodeWithTag("customer-messages").assertExists()
        compose.onNodeWithText("안녕하세요").assertExists()
        compose.onNodeWithText("견적 요청드립니다").assertExists()
        assertTrue(messages.first { it.id == "m2" }.senderId == "me")
    }
}
