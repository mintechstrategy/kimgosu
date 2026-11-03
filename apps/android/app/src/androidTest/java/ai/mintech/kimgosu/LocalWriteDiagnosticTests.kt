package ai.mintech.kimgosu

import android.app.Application
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import ai.mintech.kimgosu.auth.*
import ai.mintech.kimgosu.auth.ui.*
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import java.io.File

/** Test-only local provider entry, existing published UI + real shipping model/repository.
 * Neither MainActivity nor real OAuth. Never call a remote endpoint. */
class LocalWriteDiagnosticTests {
    @get:Rule val compose = createComposeRule()
    private val app get() = ApplicationProvider.getApplicationContext<Application>()
    private fun local(path: String): JSONObject {
        require(path.startsWith("/") && !path.startsWith("//"))
        val c = URL("http://127.0.0.1:18980$path").openConnection() as HttpURLConnection
        c.instanceFollowRedirects=false;c.connectTimeout=4000;c.readTimeout=8000
        try { check(c.responseCode==200); return JSONObject(c.inputStream.bufferedReader().readText()) } finally {c.disconnect()}
    }
    private inner class RealTransport(val mode:String): AuthTransport {
        override suspend fun request(method:String,path:String,token:String?,body:JSONObject?):JSONObject = withContext(Dispatchers.IO) {
            require(path.startsWith("/v1/"))
            if (mode=="stale" && path=="/v1/auth/signup") local("/revision")
            val c=URL("http://127.0.0.1:18979$path").openConnection() as HttpURLConnection
            c.requestMethod=method;c.instanceFollowRedirects=false;c.connectTimeout=4000;c.readTimeout=8000;c.useCaches=false
            c.setRequestProperty("Accept","application/json");c.setRequestProperty("Cache-Control","no-store")
            token?.let { c.setRequestProperty("Authorization","Bearer $it") }
            body?.let { c.doOutput=true;c.setRequestProperty("Content-Type","application/json");c.outputStream.use { out->out.write(it.toString().toByteArray()) } }
            try {
                val status=c.responseCode;val text=(if(status in 200..299)c.inputStream else c.errorStream).bufferedReader().readText()
                if(mode=="lost" && path=="/v1/auth/signup" && status==200)throw java.io.IOException("CONTROLLED_RESPONSE_LOSS_AFTER_REAL_COMMIT")
                decodeMembershipResponse(status,text)
            } finally { c.disconnect() }
        }
    }
    private fun capture(name:String){compose.waitForIdle();val b=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot();File(app.filesDir,"android-local-$name.png").outputStream().use{b.compress(Bitmap.CompressFormat.PNG,100,it)};b.recycle()}
    private lateinit var model:AuthModel
    private fun waitReady(){compose.waitUntil(12000){!model.state.busy}}
    private fun start(mode:String){
        local("/reset?mode=$mode"); SecureSession(app).clear();val result=local("/bootstrap")
        compose.runOnIdle{model=AuthModel(app,AuthRepository(RealTransport(mode)));model.acceptRegistrationResult(result)};waitReady()
        compose.setContent{ KGAuthView(model.state, onEvent = { e -> trace("before-${e.action}-${e.key}"); model.handle(e); trace("after-${e.action}-${e.key}") }) }; trace("content-ready")
    }
    private fun trace(stage:String) {
        val row=JSONObject().put("stage",stage).put("at",android.os.SystemClock.elapsedRealtime()).put("screen",model.state.screen.name).put("busy",model.state.busy).put("nameLength",model.state.input("name").length).put("emailLength",model.state.input("email").length).put("canSubmit",model.state.canSubmitMember).put("policyReady",model.state.policyReady)
        File(app.filesDir,"local-diagnostic.jsonl").appendText(row.toString()+"\n")
    }
    private fun member(){
        compose.onAllNodes(hasSetTextAction())[0].performTextInput("로컬회원")
        compose.onAllNodes(hasSetTextAction())[1].performTextInput("local@local.invalid")
        compose.onNodeWithText("정보 확인 후 계속").performClick();waitReady()
    }
    private fun terms(){trace("terms-entry"); compose.onRoot().printToLog("KG-SEMANTICS");compose.onNodeWithContentDescription("약관 전체 동의 (선택 포함)").performClick();compose.onNodeWithText("다음 단계").performClick();waitReady()}
    private fun send(){
        compose.onAllNodes(hasSetTextAction())[0].performTextInput("01012345678")
        compose.onNodeWithText("인증번호 전송").performScrollTo().performClick();waitReady()
        compose.waitUntil(5000){model.state.remainingSeconds>0}
    }
    private fun code(value:String){compose.onAllNodes(hasSetTextAction())[1].performTextReplacement(value)}
    private fun finish(){compose.onNodeWithText("회원가입 완료").performClick();waitReady()}
    private fun report(name:String):JSONObject{val r=local("/report");File(app.filesDir,"local-$name.json").writeText(r.toString(2));return r}
    @Test fun successfulSignupConsentSaveAndMarketingWithdrawal(){
        start("normal");member();terms();send();capture("sms-ready");code(local("/otp").getString("code"));finish()
        compose.onNodeWithText("고객번호 ${model.state.customerNumber}").assertExists();assertNotNull(SecureSession(app).read())
        val r=report("signup");assertEquals(2,r.getJSONObject("rows").getInt("members"));assertEquals(3,r.getJSONObject("rows").getInt("consents"));capture("signup-readback")
        // No published account -> new-grant route exists. Explicit component-host navigation injection,
        // not a claim that shipping MainApp can reach this entry.
        compose.runOnIdle{model.handle(AuthEvent(AuthAction.OPEN,"E2_TERMS"))};waitReady()
        compose.onNodeWithContentDescription("약관 전체 동의 (선택 포함)").performClick()
        compose.onNodeWithText("다음 단계").performClick();waitReady()
        compose.onNodeWithText("동의 저장과 서버 재조회를 확인했습니다.").assertExists();assertEquals(6,report("consent").getJSONObject("rows").getInt("consents"));capture("consent-readback")
        compose.runOnIdle{model.enter()};waitReady()
        compose.onNodeWithText("알림 설정").performScrollTo().performClick();waitReady()
        compose.onNodeWithContentDescription("광고 알림").performScrollTo().performClick();waitReady()
        compose.onNodeWithContentDescription("광고 알림").performScrollTo().performClick();waitReady()
        assertTrue(model.state.marketingConsented);assertEquals(false,model.state.notifications["advertising"])
        compose.onNodeWithText("동의 내역·철회").performScrollTo().performClick();waitReady()
        compose.onNodeWithText("마케팅 동의 철회").performScrollTo().performClick()
        compose.onNodeWithText("동의 철회").performClick();waitReady()
        assertFalse(model.state.marketingConsented);assertEquals(false,model.state.notifications["advertising"]);assertEquals(7,report("withdraw").getJSONObject("rows").getInt("consents"));capture("withdraw-readback")
    }
    @Test fun wrongOtpThenSuccessfulRetry(){start("normal");member();terms();send();val valid=local("/otp").getString("code");code(if(valid=="00000")"99999" else "00000");finish();assertTrue(model.state.error.contains("서버에서 거절"));assertEquals(1,report("wrong-otp").getJSONObject("rows").getInt("members"));capture("wrong-otp");code(valid);finish();assertEquals(2,report("correct-otp").getJSONObject("rows").getInt("members"))}
    @Test fun expiredOtpRefusesNoSignup(){start("normal");member();terms();send();code(local("/otp").getString("code"));local("/expire-otp");finish();assertTrue(model.state.error.contains("서버에서 거절"));assertEquals(1,report("expired-otp").getJSONObject("rows").getInt("members"));capture("expired-otp")}
    @Test fun finalFreshDiscardsChecks(){start("normal");member();terms();send();code(local("/otp").getString("code"));local("/revision");finish();assertEquals(setOf("age14"),model.state.accepted);assertEquals(AuthScreen.E2_TERMS,model.state.screen);assertEquals(1,report("fresh-reset").getJSONObject("rows").getInt("members"));capture("fresh-reset")}
    @Test fun server409RollsBackAndRefreshes(){start("stale");member();terms();send();code(local("/otp").getString("code"));finish();waitReady();assertEquals(setOf("age14"),model.state.accepted);val rows=report("stale").getJSONObject("rows");assertEquals(1,rows.getInt("members"));assertEquals(1,rows.getInt("principals"));assertEquals(1,rows.getInt("sessions"));assertEquals(0,rows.getInt("consents"));assertEquals(0,rows.getInt("consumed"));capture("409-rollback")}
    @Test fun lostResponseUnknownNoRepeatPost(){start("lost");member();terms();send();code(local("/otp").getString("code"));finish();assertTrue(model.state.error.contains("UNKNOWN"));val before=report("lost-before");compose.onNodeWithText("회원가입 완료").performClick();waitReady();val after=report("lost-after");
        fun posts(r:JSONObject):Int { val a=r.getJSONArray("http");return (0 until a.length()).count{a.getJSONObject(it).getString("path")=="/v1/auth/signup"} }
        assertEquals(1,posts(before));assertEquals(posts(before),posts(after));assertEquals(2,after.getJSONObject("rows").getInt("members"));assertNull(SecureSession(app).read());capture("unknown-no-repeat")}
}
