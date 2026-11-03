package ai.mintech.kimgosu

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import ai.mintech.kimgosu.auth.ui.*
import org.junit.Rule
import org.junit.Test

/** Failed fetches must not render as empty/off data on the auth surface. Compose-only, no network. */
class AuthStateDisplayTests {
    @get:Rule val compose = createComposeRule()

    @Test fun failedConsentHistoryDoesNotReadAsEmpty() {
        val state = AuthState(AuthScreen.CONSENT_HISTORY,
            error = "서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도해주세요.")
        compose.setContent { KGAuthView(state, {}) }
        compose.onNodeWithText("내 동의 내역").assertExists()
        compose.onNodeWithText(state.error).assertExists()
        compose.onAllNodesWithText("표시할 동의 내역이 없습니다.").assertCountEquals(0)
    }

    @Test fun loadedEmptyConsentHistoryKeepsEmptyState() {
        val state = AuthState(AuthScreen.CONSENT_HISTORY)
        compose.setContent { KGAuthView(state, {}) }
        compose.onNodeWithText("표시할 동의 내역이 없습니다.").assertExists()
    }

    @Test fun unloadedNotificationPreferencesAreNotTogglable() {
        val state = AuthState(AuthScreen.F4_NOTI, error = "서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도해주세요.")
        compose.setContent { KGAuthView(state, {}) }
        compose.onNodeWithContentDescription("채팅 알림").assertIsNotEnabled()
        compose.onAllNodesWithText("마케팅 정보 수신 동의: 미동의", substring = true).assertCountEquals(0)
    }

    @Test fun loadedNotificationPreferencesStayTogglable() {
        val state = AuthState(AuthScreen.F4_NOTI, marketingConsented = true,
            notifications = mapOf("advertising" to true, "chat" to false, "comment" to true, "quote" to false, "inquiry" to true))
        compose.setContent { KGAuthView(state, {}) }
        compose.onNodeWithContentDescription("채팅 알림").assertIsEnabled()
        compose.onNodeWithText("마케팅 정보 수신 동의: 동의", substring = true).assertExists()
    }
}
