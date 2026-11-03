package ai.mintech.kimgosu

import android.app.Application
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import ai.mintech.kimgosu.auth.*
import ai.mintech.kimgosu.auth.ui.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Real Compose touch/rendering with an isolated controlled transport. No OAuth/API/DB claim. */
class CoreRepairUiTests {
    @get:Rule val compose=createComposeRule()
    private fun scenario(signedIn:Boolean,status:Int) {
        val app=ApplicationProvider.getApplicationContext<Application>();SecureSession(app).clear()
        var failed=true
        val fake=object:AuthTransport {
            override suspend fun request(method:String,wirePath:String,token:String?,body:JSONObject?):JSONObject {
                if(wirePath.startsWith("/v1/policies") || wirePath.startsWith("/v1/auth/config")) require(wirePath.contains("metadata=policy-v0.3"))
                val path=wirePath.replace("?metadata=policy-v0.3&","?").replace("?metadata=policy-v0.3", "")
                if(path=="/v1/me") return JSONObject("{\"status\":\"ACTIVE\",\"nickname\":\"회귀시험\",\"email\":\"fixture@example.invalid\",\"customerNumber\":\"fixture-only\"}")
                if(path=="/v1/auth/config") return PolicyTestFixture.draft()
                if(path=="/v1/policies") return PolicyTestFixture.draft()
                if(path=="/v1/policies/TERMS") {
                    assertNull(token)
                    if(failed) return decodeMembershipResponse(status,"{\"error\":{\"code\":\"${if(status==401) "SESSION_INVALID" else "ACCOUNT_RESTRICTED"}\"}}")
                    return PolicyTestFixture.draft()
                }
                error("UNEXPECTED_ROUTE")
            }
        }
        lateinit var model:AuthModel
        compose.runOnIdle { model=AuthModel(app,AuthRepository(fake));if(signedIn)model.establishVerifiedSession(java.util.UUID.randomUUID().toString()) else model.start() }
        compose.waitUntil(5000){!model.state.busy}
        compose.runOnIdle {model.handle(AuthEvent(AuthAction.OPEN,"E2_TERMS"));model.handle(AuthEvent(AuthAction.OPEN_DOCUMENT,"TERMS"))}
        compose.waitUntil(5000){!model.state.busy}
        compose.setContent { KGAuthView(model.state,model::handle) }
        compose.onNodeWithText("문서를 확인할 수 없습니다. 동의는 진행되지 않습니다.").assertExists()
        compose.onNodeWithText("다시 시도").performClick();compose.waitUntil(5000){!model.state.busy}
        compose.runOnIdle { assertEquals(AuthScreen.TERMS_DOC,model.state.screen);assertEquals(if(signedIn)"fixture-only" else "",model.state.customerNumber) }
        capture(app,"android-controlled-$signedIn-$status-error")
        compose.runOnIdle {failed=false}
        compose.onNodeWithText("다시 시도").performClick();compose.waitUntil(5000){!model.state.busy}
        compose.onNodeWithText("사용자 검토용 초안 · 법률 확정·실제 동의용 아님").assertExists()
        compose.onNodeWithText("닫기").performClick()
        compose.runOnIdle {assertEquals(AuthScreen.E2_TERMS,model.state.screen);assertFalse(model.state.canContinue);assertEquals(signedIn,SecureSession(app).read()!=null)}
        capture(app,"android-controlled-$signedIn-$status-return")
        SecureSession(app).clear()
    }
    private fun capture(app:Application,name:String) {
        compose.waitForIdle();Thread.sleep(400)
        val bitmap=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        File(app.filesDir,"$name.png").outputStream().use {bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
    }
    @Test fun signedInPublic401RetainsMemberAndRetryClose()=scenario(true,401)
    @Test fun signedOutPublic403StaysDocumentAndRetryClose()=scenario(false,403)
}
