package ai.mintech.kimgosu

import android.app.Application
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import ai.mintech.kimgosu.auth.*
import ai.mintech.kimgosu.auth.ui.*
import org.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Actual Compose component touch + shipping model, explicit local transport only. */
class PolicySnapshotUiTests {
    @get:Rule val compose=createComposeRule()
    private val app get()=ApplicationProvider.getApplicationContext<Application>()
    private fun input(name:String)=JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open(name+".json").bufferedReader().use{it.readText()})
    private fun capture(name:String){compose.waitForIdle();Thread.sleep(250);val b=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot();File(app.filesDir,"$name.png").outputStream().use{b.compress(Bitmap.CompressFormat.PNG,100,it)};b.recycle()}
    private fun scenario(mode:String){
        SecureSession(app).clear();var lists=0;var details=0
        val t=object:AuthTransport{
            override suspend fun request(method:String,path:String,token:String?,body:JSONObject?):JSONObject{
                check(method=="GET" && token==null && path.contains("metadata=policy-v0.3"))
                if(path.startsWith("/v1/policies/")){details++;if(mode=="retry" && details==1)throw AuthFailure(503,"POLICY_METADATA_UNAVAILABLE");return input(if(mode=="retry")"draft" else "ready")}
                if(path.startsWith("/v1/policies?"))lists++
                val value=input(if(mode=="retry")"draft" else "ready");if(mode=="revision" && lists>=3)value.getJSONObject("policySnapshot").put("policyRevision","ps3-"+"b".repeat(64));return value
            }
        }
        lateinit var model:AuthModel
        compose.runOnIdle{model=AuthModel(app,AuthRepository(t));model.start()};compose.waitUntil(5000){!model.state.busy}
        compose.runOnIdle{model.handle(AuthEvent(AuthAction.OPEN,"E2_TERMS"))};compose.waitUntil(5000){!model.state.busy}
        compose.setContent{KGAuthView(model.state,model::handle)}
        if(mode!="retry"){
            compose.onNodeWithContentDescription("약관 전체 동의 (선택 포함)").performClick();compose.onNodeWithText("다음 단계").assertIsEnabled()
            if(mode=="revision"){
                compose.onNodeWithText("다음 단계").performClick();compose.waitUntil(5000){!model.state.busy};compose.onNodeWithText("정책이 변경되었습니다. 전문을 다시 확인하고 동의를 선택해주세요.").assertExists();compose.onNodeWithText("다음 단계").assertIsNotEnabled();capture("android-v03-revision-reset");return
            }
        }
        compose.onAllNodesWithText("전문 보기  ›")[0].performClick();compose.waitUntil(5000){!model.state.busy}
        if(mode=="retry"){
            compose.onNodeWithText("문서를 확인할 수 없습니다. 동의는 진행되지 않습니다.").assertExists();capture("android-v03-503-error")
            compose.onNodeWithText("다시 시도").performClick();compose.waitUntil(5000){!model.state.busy};compose.onNodeWithText("사용자 검토용 초안 · 법률 확정·실제 동의용 아님").assertExists();capture("android-v03-retry-draft")
        } else {compose.onNodeWithText("통제 시험 TERMS").assertExists();capture("android-v03-ready-document")}
        compose.onNodeWithText("닫기").performClick();compose.waitUntil(5000){!model.state.busy}
        if(mode=="retry")compose.onNodeWithText("다음 단계").assertIsNotEnabled() else compose.onNodeWithText("다음 단계").assertIsEnabled()
        capture(if(mode=="retry")"android-v03-draft-return" else "android-v03-ready-return")
    }
    @Test fun readyDocumentAndReturn()=scenario("ready")
    @Test fun finalFreshRevisionDiscardsChecks()=scenario("revision")
    @Test fun public503RetryDraftClose()=scenario("retry")
}
