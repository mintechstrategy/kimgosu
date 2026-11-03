package ai.mintech.kimgosu

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import ai.mintech.kimgosu.auth.*
import ai.mintech.kimgosu.auth.ui.*
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Isolated model/repository/Keystore checks; never provider/SMS or real API success evidence. */
class AuthModelTests {
    private fun main(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(block)
    private fun waitFor(predicate: () -> Boolean) {
        repeat(120) { var done = false; main { done = predicate() }; if (done) return; Thread.sleep(25) }
        error("MODEL_TIMEOUT")
    }
    private class Fake : AuthTransport {
        val calls = mutableListOf<String>(); var revoked = false; var expire = false; var conflict = false; var delayPolicy = false
        var prefs = JSONObject("{\"advertising\":true,\"chat\":false,\"comment\":false,\"quote\":false,\"inquiry\":false,\"version\":2}")
        override suspend fun request(method: String, wirePath: String, token: String?, body: JSONObject?): JSONObject {
                if(wirePath.startsWith("/v1/policies") || wirePath.startsWith("/v1/auth/config")) require(wirePath.contains("metadata=policy-v0.3"))
                val path=wirePath.replace("?metadata=policy-v0.3&","?").replace("?metadata=policy-v0.3", "")
            calls += "$method $path"
            if (path == "/v1/auth/config") return PolicyTestFixture.draft()
            if (path == "/v1/policies") return PolicyTestFixture.draft()
            if (path.startsWith("/v1/policies/")) {
                if (delayPolicy) delay(500)
                return PolicyTestFixture.draft()
            }
            if (path == "/v1/me") {
                if (revoked || expire) throw AuthFailure(401,"SESSION_INVALID")
                return JSONObject("{\"status\":\"ACTIVE\",\"nickname\":\"모델시험\",\"email\":\"unit@example.invalid\",\"customerNumber\":\"unit-only\"}")
            }
            if (path == "/v1/me/consents") return JSONObject("{\"records\":[{\"kind\":\"MARKETING\",\"title\":\"시험\",\"version\":\"unit\",\"status\":\"GRANTED\",\"recordedAt\":\"2026-10-31T00:00:00Z\"}]}")
            if (path == "/v1/me/notifications") {
                if (method == "PATCH") {
                    assertEquals(2, body!!.getInt("expectedVersion")); assertFalse(body.has("memberId"))
                    if (conflict) { prefs.put("version",3); throw AuthFailure(409,"VERSION_CONFLICT") }
                    listOf("advertising","chat","comment","quote","inquiry").forEach { if (body.has(it)) prefs.put(it,body.getBoolean(it)) }
                    prefs.put("version",3)
                }
                return JSONObject(prefs.toString())
            }
            if (path == "/v1/auth/logout") { revoked = true; return JSONObject("{\"loggedOut\":true}") }
            error("UNEXPECTED_ROUTE")
        }
    }
    @Test fun draftInputsAndNavigationCancel() {
        val application = ApplicationProvider.getApplicationContext<Application>()
        val fake = Fake(); lateinit var model: AuthModel
        main { model = AuthModel(application, AuthRepository(fake)); model.start() }; waitFor { !model.state.busy }
        main {
            model.handle(AuthEvent(AuthAction.OPEN,"E2_TERMS"))
        }; waitFor { !model.state.busy }; main {
            model.handle(AuthEvent(AuthAction.CHANGE_ALL_CONSENTS,value="true"))
            assertEquals(setOf("age14"),model.state.accepted); assertFalse(model.state.canContinue)
            model.handle(AuthEvent(AuthAction.CHANGE_INPUT,"name","보존할 입력"))
            model.handle(AuthEvent(AuthAction.OPEN_DOCUMENT,"TERMS"))
        }; waitFor { !model.state.busy }
        main {
            assertFalse(model.state.documents[AuthDocumentKind.TERMS]!!.canConsent)
            model.back(); assertEquals(AuthScreen.E2_TERMS,model.state.screen)
            assertEquals("보존할 입력",model.state.input("name")); assertEquals(setOf("age14"),model.state.accepted)
            val target = ReturnTarget("A1","draft-item","nearby",120,"draft-unit")
            model.enter(target); model.handle(AuthEvent(AuthAction.BACK)); assertTrue(model.browsing); assertEquals(target,model.returnTarget)
            model.handle(AuthEvent(AuthAction.CHANGE_INPUT,"phone","０10-123456789")); assertFalse(AuthInput.validPhone(model.state.input("phone")))
            model.handle(AuthEvent(AuthAction.CHANGE_INPUT,"code","123456")); assertEquals("12345",model.state.input("code"))
            model.handle(AuthEvent(AuthAction.CHANGE_INPUT,"phone","01012345678")); assertEquals("",model.state.input("code")); assertFalse(model.state.canVerify)
            assertFalse(AuthInput.validNickname("공백 닉")); assertTrue(AuthInput.validNickname("고수123"))
            assertEquals(500, AuthInput.withdrawalDetail("가".repeat(501)).length)
        }
    }
    @Test fun versionReadbackAndLogoutRevocation() {
        val app = ApplicationProvider.getApplicationContext<Application>(); val fake = Fake(); lateinit var model: AuthModel
        main { model = AuthModel(app,AuthRepository(fake)); model.establishVerifiedSession(java.util.UUID.randomUUID().toString()) }
        waitFor { !model.state.busy }
        main { model.enter(); model.handle(AuthEvent(AuthAction.OPEN,"F4_NOTI")) }; waitFor { !model.state.busy }
        main { assertTrue(model.state.marketingConsented); model.handle(AuthEvent(AuthAction.CHANGE_NOTIFICATION,"advertising","false")) }; waitFor { !model.state.busy }
        main {
            assertEquals(false,model.state.notifications["advertising"]); assertTrue(model.state.marketingConsented)
            assertEquals("GET /v1/me/notifications", fake.calls.last())
            model.handle(AuthEvent(AuthAction.OPEN,"LOGOUT_CONFIRM")); model.handle(AuthEvent(AuthAction.CANCEL)); assertFalse(fake.revoked)
            model.handle(AuthEvent(AuthAction.OPEN,"LOGOUT_CONFIRM")); model.handle(AuthEvent(AuthAction.CONFIRM_LOGOUT))
        }; waitFor { !model.state.busy }
        main { assertTrue(fake.revoked); assertTrue(model.browsing); assertNull(SecureSession(app).read()); assertEquals("GET /v1/me",fake.calls.last()) }
    }
    @Test fun staleVersionThenExpiry() {
        val app = ApplicationProvider.getApplicationContext<Application>(); val fake = Fake(); fake.conflict=true; lateinit var model: AuthModel
        main { model = AuthModel(app,AuthRepository(fake)); model.establishVerifiedSession(java.util.UUID.randomUUID().toString()) }; waitFor { !model.state.busy }
        main { model.enter(); model.handle(AuthEvent(AuthAction.OPEN,"F4_NOTI")) }; waitFor { !model.state.busy }
        main { model.handle(AuthEvent(AuthAction.CHANGE_NOTIFICATION,"advertising","false")) }; waitFor { !model.state.busy }
        main {
            assertEquals(true,model.state.notifications["advertising"]); assertTrue(model.state.marketingConsented); assertTrue(model.state.error.contains("최신 버전"))
            fake.expire=true; model.handle(AuthEvent(AuthAction.REFRESH_ACCOUNT))
        }; waitFor { !model.state.busy }
        main { assertEquals(AuthScreen.SESSION_EXPIRED,model.state.screen); assertEquals("",model.state.customerNumber); assertNull(SecureSession(app).read()) }
    }
    @Test fun cancellationPreventsLateNavigation() {
        val app=ApplicationProvider.getApplicationContext<Application>(); val fake=Fake(); fake.delayPolicy=true; lateinit var model:AuthModel
        main { model=AuthModel(app,AuthRepository(fake)); model.handle(AuthEvent(AuthAction.OPEN_DOCUMENT,"TERMS")); model.back() }
        Thread.sleep(650)
        main { assertEquals(AuthScreen.E1,model.state.screen); assertFalse(model.state.busy); assertFalse(model.state.documents[AuthDocumentKind.TERMS]?.canConsent == true) }
    }
}
