package ai.mintech.kimgosu

import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Real integrated app UI checks. No mocked OAuth or injected successful session. */
@RunWith(AndroidJUnit4::class)
class LaunchTests {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private fun launch(hold: Boolean = false) = ActivityScenario.launch<MainActivity>(Intent(context,MainActivity::class.java).putExtra("hold_splash",hold))
    private fun capture(name: String) {
        compose.waitForIdle(); instrumentation.waitForIdleSync(); SystemClock.sleep(400)
        instrumentation.uiAutomation.takeScreenshot().let { bitmap ->
            File(context.filesDir,"$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }; bitmap.recycle()
        }
    }
    private fun waitText(text: String) = compose.waitUntil(15000) { compose.onAllNodesWithText(text).fetchSemanticsNodes(atLeastOneRootRequired=false).isNotEmpty() }
    @Test fun splashThreeSecondsThenFormalE1() {
        val start = SystemClock.elapsedRealtime()
        launch().use {
            compose.onNodeWithTag("splash-image").assertExists()
            Thread.sleep(1000); compose.onNodeWithTag("splash-image").assertExists()
            waitText("로그인/가입"); assertTrue(SystemClock.elapsedRealtime()-start>=3000)
            compose.onNodeWithTag("splash").assertDoesNotExist()
            compose.onNodeWithText("둘러보기").assertIsEnabled()
            compose.waitUntil(15000) { compose.onAllNodesWithContentDescription("처리 중").fetchSemanticsNodes().isEmpty() }
            capture("android-E1")
            // Server failure must not turn into a member session. Public browse remains possible.
            compose.onNodeWithText("둘러보기").performClick()
            compose.onNodeWithTag("main-introduction").assertIsDisplayed(); capture("android-A1")
        }
    }
    @Test fun protectedCancelAndRecreationPreserveHome() {
        launch().use { scenario ->
            waitText("로그인/가입"); compose.onNodeWithText("둘러보기").performClick()
            compose.onNodeWithTag("nav-4").performClick(); waitText("로그인/가입")
            compose.onNodeWithContentDescription("닫기 또는 이전 화면").performClick()
            compose.onNodeWithTag("main-introduction").assertIsDisplayed()
            scenario.recreate(); compose.onNodeWithTag("main-introduction").assertIsDisplayed()
            compose.onNodeWithTag("splash").assertDoesNotExist(); capture("android-protected-cancel")
        }
    }
    @Test fun publicPolicyAndRealApiUnavailableIsVisible() {
        launch().use {
            waitText("로그인/가입"); compose.onNodeWithText("둘러보기").performClick()
            compose.onNodeWithText("서비스 운영정책").performScrollTo().performClick()
            compose.waitUntil(15000) { compose.onAllNodesWithText("문서 준비 중입니다. 운영자 정보·시행일·법률 검토를 확인한 후 제공됩니다.").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithText("문서를 확인할 수 없습니다. 동의는 진행되지 않습니다.").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithText("사용자 검토용 초안 · 법률 확정·실제 동의용 아님").fetchSemanticsNodes().isNotEmpty() }
            capture("android-policy-server-result")
            compose.onNodeWithText("닫기",useUnmergedTree=false).performClick()
            compose.onNodeWithText("로그인/가입 · 회원관리").assertIsDisplayed()
        }
    }
}
