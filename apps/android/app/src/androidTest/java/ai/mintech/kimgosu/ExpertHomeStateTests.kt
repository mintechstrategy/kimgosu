package ai.mintech.kimgosu

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** 서버 상태에 대응하는 고수 홈의 4상태 표현. 실제 응답 대신 상태값만 주입한다. */
class ExpertHomeStateTests {
    @get:Rule val compose = createComposeRule()

    private fun show(state: ExpertHomeState, onToggle: (ExpertAvailability) -> Unit = {},
                     onRetry: () -> Unit = {}, onOpenQuotes: () -> Unit = {}) {
        compose.setContent {
            ExpertHomeContent(state, "테스트11", toggleBusy = false, toggleError = null,
                onToggle, onRetry, onBack = {}, onOpenQuotes = onOpenQuotes)
        }
    }

    @Test fun loadingShowsProgressCopy() {
        show(ExpertHomeState.Loading)
        compose.onNodeWithTag("expert-loading").assertExists()
        compose.onNodeWithText("고수 정보를 불러오는 중…").assertExists()
    }

    @Test fun emptyShowsProfileMissingCopy() {
        show(ExpertHomeState.Empty)
        compose.onNodeWithTag("expert-empty").assertExists()
        compose.onNodeWithText("고수 프로필이 없습니다").assertExists()
    }

    @Test fun serverErrorAndNetworkFailureAreDistinct() {
        show(ExpertHomeState.Failed(network = false, code = "INTERNAL_ERROR"))
        compose.onNodeWithTag("expert-error").assertExists()
        compose.onNodeWithText("잠시 후 다시 시도해주세요. (INTERNAL_ERROR)").assertExists()
        compose.onNodeWithTag("expert-retry").assertExists()
    }

    @Test fun networkFailureSaysCheckConnection() {
        show(ExpertHomeState.Failed(network = true, code = "NETWORK_UNAVAILABLE"))
        compose.onNodeWithTag("expert-network").assertExists()
        compose.onNodeWithText("연결을 확인하고 다시 시도해주세요.").assertExists()
    }

    @Test fun readyShowsBadgeSummaryAndRequests() {
        var opened = 0
        val requests = listOf(
            ExpertRequest("q1", "테스트01", 1_000_000, vatIncluded = false),
            ExpertRequest("q2", "테스트02", 550_000, vatIncluded = true),
        )
        show(ExpertHomeState.Ready(ExpertAvailability.PAUSED, 6, 5, requests), onOpenQuotes = { opened++ })
        compose.onNodeWithTag("availability-badge").assertExists()
        // 배지와 선택된 토글 버튼 두 곳에 같은 라벨이 보인다.
        compose.onAllNodesWithText("일시중지").assertCountEquals(2)
        compose.onNodeWithTag("summary-received").assertExists()
        compose.onNodeWithTag("summary-completed").assertExists()
        compose.onNodeWithTag("request-q1").assertExists()
        compose.onNodeWithText("1,000,000원").assertExists()
        compose.onNodeWithText("부가세 포함").assertExists()
        compose.onNodeWithTag("request-q2").performClick()
        compose.waitForIdle()
        assertEquals(1, opened)
    }

    @Test fun readyWithoutProposedQuotesShowsEmptyPreview() {
        show(ExpertHomeState.Ready(ExpertAvailability.AVAILABLE, 0, 0, emptyList()))
        compose.onNodeWithTag("request-empty").assertExists()
        compose.onAllNodesWithTag("request-q1").assertCountEquals(0)
    }
}
