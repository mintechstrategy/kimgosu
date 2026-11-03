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
import java.io.File

/** Controlled transport + actual production decoder/repository/model, not real identity/API/DB. */
class CoreRepairTests {
    private val app get() = ApplicationProvider.getApplicationContext<Application>()
    private fun main(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(block)
    private fun waitFor(model: AuthModel) {
        repeat(200) { var done=false; main { done = !model.state.busy }; if(done) return; Thread.sleep(10) }
        error("MODEL_TIMEOUT")
    }
    private val scenarios = listOf(
        401 to "{\"error\":{\"code\":\"SESSION_INVALID\"}}",
        401 to "{\"error\":{\"code\":\"AUTH_REQUIRED\"}}",
        403 to "{\"error\":{\"code\":\"ACCOUNT_RESTRICTED\"}}",
        403 to "{\"error\":{\"code\":\"CONSENT_RENEWAL_REQUIRED\"}}",
        401 to "<html>edge</html>", 403 to "<html>edge</html>",
        401 to "{\"message\":\"edge\"}", 403 to "{\"message\":\"edge\"}",
        401 to "{\"error\":{\"code\":\"EDGE_DENIED\"}}", 403 to "{\"error\":{\"code\":\"EDGE_DENIED\"}}",
        401 to "{\"error\":{\"code\":42}}", 403 to "{\"error\":{\"code\":\"invalid code\"}}"
    )
    private class Fixture : AuthTransport {
        var response: Pair<Int,String>? = null
        var failingPath = ""
        var revoked = false
        var slow = false
        val calls = mutableListOf<String>()
        override suspend fun request(method:String,wirePath:String,token:String?,body:JSONObject?):JSONObject {
                if(wirePath.startsWith("/v1/policies") || wirePath.startsWith("/v1/auth/config")) require(wirePath.contains("metadata=policy-v0.3"))
                val path=wirePath.replace("?metadata=policy-v0.3&","?").replace("?metadata=policy-v0.3", "")
            calls += "$method $path"
            if (path.startsWith("/v1/policies") || path=="/v1/auth/config") assertNull(token)
            if (path == failingPath) {
                if(slow) withContext(NonCancellable) { delay(250) }
                response?.let { return decodeMembershipResponse(it.first,it.second) }
            }
            if(path=="/v1/auth/config") return PolicyTestFixture.draft()
            if(path=="/v1/policies") return PolicyTestFixture.draft()
            if(path.startsWith("/v1/policies/")) return PolicyTestFixture.draft()
            if(path=="/v1/me") {
                if(revoked) throw AuthFailure(401,"SESSION_INVALID")
                return JSONObject("{\"status\":\"ACTIVE\",\"nickname\":\"회귀시험\",\"email\":\"fixture@example.invalid\",\"customerNumber\":\"fixture-only\"}")
            }
            if(path=="/v1/me/consents") return JSONObject("{\"records\":[]}")
            if(path=="/v1/me/notifications") return JSONObject("{\"version\":1,\"advertising\":false,\"chat\":false,\"comment\":false,\"quote\":false,\"inquiry\":false}")
            if(path=="/v1/auth/logout") { revoked=true; return JSONObject("{\"loggedOut\":true}") }
            error("UNEXPECTED_ROUTE")
        }
    }
    private fun make(f:Fixture,signedIn:Boolean): AuthModel {
        SecureSession(app).clear()
        lateinit var model:AuthModel
        main { model=AuthModel(app,AuthRepository(f)); if(signedIn) model.establishVerifiedSession(java.util.UUID.randomUUID().toString()) else model.start() }
        waitFor(model)
        main { model.handle(AuthEvent(AuthAction.OPEN,"E2_TERMS")) }; waitFor(model)
        main { model.handle(AuthEvent(AuthAction.CHANGE_INPUT,"name","보존 입력")); model.handle(AuthEvent(AuthAction.CHANGE_ALL_CONSENTS,value="true")) }
        return model
    }
    private fun receipt(id:String) { File(app.filesDir,"core-repair-cases.jsonl").appendText(JSONObject().put("id",id).put("status","PASS").put("transport","controlled").toString()+"\n") }
    @Test fun publicRequestContextMatrix() = runBlocking {
        for(signedIn in listOf(false,true)) for(route in listOf("config","list","detail","version")) for((index,response) in scenarios.withIndex()) {
            val f=Fixture(); val model=make(f,signedIn); val before=SecureSession(app).read()
            f.response=response; f.failingPath=when(route) { "config"->"/v1/auth/config"; "list"->"/v1/policies"; "detail"->"/v1/policies/TERMS"; else->"/v1/policies/TERMS?version=old%2Fv1" }
            val repo=AuthRepository(f)
            val failure=try {
                when(route) { "config"->repo.config(); "list"->repo.policies(); "detail"->repo.policy("TERMS"); else->repo.policy("TERMS","old/v1") }
                error("EXPECTED_FAILURE")
            } catch(e:AuthFailure) { e }
            assertEquals(AuthRequestContext.PUBLIC,failure.requestContext); assertEquals(response.first,failure.status)
            main {
                // Direct failure sink covers list/version (no current signed-in UI action exposes them).
                val stack=model.stack; model.failure(failure)
                assertEquals(stack,model.stack); assertEquals(AuthScreen.E2_TERMS,model.state.screen)
                assertEquals(if(signedIn) "fixture-only" else "",model.state.customerNumber)
                assertEquals("보존 입력",model.state.input("name")); assertEquals(setOf("age14"),model.state.accepted)
                assertFalse(model.state.canContinue); assertTrue(model.state.error.contains("다시 시도"))
            }
            assertEquals(before,SecureSession(app).read())
            receipt("public-$signedIn-$route-$index")
        }
        SecureSession(app).clear()
    }
    @Test fun actualPublicActionsRetryCloseAndDraft() {
        for(signedIn in listOf(false,true)) for((index,response) in scenarios.withIndex()) {
            val f=Fixture(); val model=make(f,signedIn); val before=SecureSession(app).read()
            f.response=response; f.failingPath="/v1/policies/TERMS"
            main { model.handle(AuthEvent(AuthAction.OPEN_DOCUMENT,"TERMS")) }; waitFor(model)
            main {
                assertEquals(AuthScreen.TERMS_DOC,model.state.screen); assertEquals(AuthDocumentStatus.ERROR,model.state.documents[AuthDocumentKind.TERMS]?.status)
                assertFalse(model.state.documents[AuthDocumentKind.TERMS]!!.canConsent)
                model.handle(AuthEvent(AuthAction.RETRY_DOCUMENT,"TERMS"))
            }; waitFor(model)
            main { assertEquals(AuthScreen.TERMS_DOC,model.state.screen) }
            f.response=null
            main { model.handle(AuthEvent(AuthAction.RETRY_DOCUMENT,"TERMS")) }; waitFor(model)
            main {
                assertEquals(AuthDocumentStatus.DRAFT,model.state.documents[AuthDocumentKind.TERMS]?.status)
                model.back(); assertEquals(AuthScreen.E2_TERMS,model.state.screen); assertEquals("보존 입력",model.state.input("name")); assertFalse(model.state.canContinue)
            }
            assertEquals(before,SecureSession(app).read())
            f.response=response; f.failingPath="/v1/auth/config"
            main { model.handle(AuthEvent(AuthAction.START_SOCIAL,"google")) }; waitFor(model)
            main { assertEquals(AuthScreen.E2_TERMS,model.state.screen) }; assertEquals(before,SecureSession(app).read())
            receipt("public-actions-$signedIn-$index")
        }
        SecureSession(app).clear()
    }
    @Test fun privateReasonMatrixAndNoMutationReplay() {
        for(route in listOf("me","mutation")) for((index,response) in scenarios.withIndex()) {
            val f=Fixture(); val model=make(f,true)
            main { model.handle(AuthEvent(AuthAction.OPEN,"F4_NOTI")) };waitFor(model)
            f.response=response;f.failingPath=if(route=="me") "/v1/me" else "/v1/me/notifications"
            main { model.handle(AuthEvent(if(route=="me") AuthAction.REFRESH_ACCOUNT else AuthAction.CHANGE_NOTIFICATION,"chat","true")) };waitFor(model)
            val expected=when(index) { 0,1->AuthScreen.SESSION_EXPIRED;2->AuthScreen.ACCOUNT_RESTRICTED;3->AuthScreen.RECONSENT;else->AuthScreen.F4_NOTI }
            main { assertEquals(expected,model.state.screen);assertEquals(if(index<2) "" else "fixture-only",model.state.customerNumber); if(index>=4) assertTrue(model.state.error.isNotEmpty()) }
            assertEquals(index<2,SecureSession(app).read()==null)
            val mutations=f.calls.count{it.startsWith("PATCH")}
            f.response=null
            main { model.establishVerifiedSession(java.util.UUID.randomUUID().toString()) };waitFor(model)
            assertEquals(mutations,f.calls.count{it.startsWith("PATCH")})
            receipt("private-$route-$index")
        }
        SecureSession(app).clear()
    }
    @Test fun cancellationLateContractFailureAndInvalidSuccess() {
        val f=Fixture();val model=make(f,true);val before=SecureSession(app).read()
        f.response=scenarios[0];f.failingPath="/v1/policies/TERMS";f.slow=true
        main { model.handle(AuthEvent(AuthAction.OPEN_DOCUMENT,"TERMS")) }
        Thread.sleep(40);main { model.back() };Thread.sleep(400)
        main { assertEquals(AuthScreen.E2_TERMS,model.state.screen);assertEquals("",model.state.error);assertFalse(model.state.busy);assertFalse(model.state.documents[AuthDocumentKind.TERMS]!!.canConsent) }
        assertEquals(before,SecureSession(app).read())
        f.slow=false;f.response=200 to "{}"
        main { model.handle(AuthEvent(AuthAction.OPEN_DOCUMENT,"TERMS")) };waitFor(model)
        main { assertEquals(AuthScreen.TERMS_DOC,model.state.screen);assertEquals(AuthDocumentStatus.ERROR,model.state.documents[AuthDocumentKind.TERMS]?.status) }
        assertEquals(before,SecureSession(app).read());receipt("cancel-late-invalid-success")
        SecureSession(app).clear()
    }
}

object PolicyTestFixture { fun draft():JSONObject = JSONObject("""{"id":"9223372036854775800","kind":"TERMS","version":"opaque/z-0000","status":"DRAFT","title":"통제 시험 TERMS","body":"LOCAL TEST ONLY — TERMS\r\n가😀 é é\r\n  끝  ","bodySha256":"cb8c1ef72c5c00bbf9063a7125ec0c20e0c36d69db69d2d4ba261db580a0c762","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true,"providers":[],"signupReady":false,"documents":[{"id":"9223372036854775800","kind":"TERMS","version":"opaque/z-0000","status":"DRAFT","title":"통제 시험 TERMS","body":"LOCAL TEST ONLY — TERMS\r\n가😀 é é\r\n  끝  ","bodySha256":"cb8c1ef72c5c00bbf9063a7125ec0c20e0c36d69db69d2d4ba261db580a0c762","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775801","kind":"PRIVACY_CONSENT","version":"opaque/z-0001","status":"DRAFT","title":"통제 시험 PRIVACY_CONSENT","body":"LOCAL TEST ONLY — PRIVACY_CONSENT\r\n가😀 é é\r\n  끝  ","bodySha256":"71d9a23e36d5b85c8ffb136b497cdd1386e324e6996a8d68fd8eacf27082b2f6","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775802","kind":"PRIVACY_POLICY","version":"opaque/z-0002","status":"DRAFT","title":"통제 시험 PRIVACY_POLICY","body":"LOCAL TEST ONLY — PRIVACY_POLICY\r\n가😀 é é\r\n  끝  ","bodySha256":"40d61bdcc1dfe868559afdc34ad1da6e23a683ec90e1c05ba59d3b89ccbf207d","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775803","kind":"MARKETING","version":"opaque/z-0003","status":"DRAFT","title":"통제 시험 MARKETING","body":"LOCAL TEST ONLY — MARKETING\r\n가😀 é é\r\n  끝  ","bodySha256":"43988519d7628b3cb5201e68b1f66f1d5c45010b7aef1f2d0953315fd26fc52c","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775804","kind":"OPERATIONS","version":"opaque/z-0004","status":"DRAFT","title":"통제 시험 OPERATIONS","body":"LOCAL TEST ONLY — OPERATIONS\r\n가😀 é é\r\n  끝  ","bodySha256":"31968db90e31dfc7c25cfcd064d2f678d3440cb2da751a22c75f9389964eac71","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true}],"policySnapshot":{"cache":{"control":"no-store","ttlSeconds":0,"revalidateBeforeConsent":true},"requirements":{"requiredGrantKinds":["TERMS","PRIVACY_CONSENT"],"requiredReadyKindsForGrant":["TERMS","PRIVACY_CONSENT","PRIVACY_POLICY"],"optionalGrantKinds":["MARKETING"],"operationsConsentRequired":false},"constraints":{"consentInputs":{"type":"array","minItems":2,"maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["kind","version"],"properties":{"kind":{"type":"string","enum":["TERMS","PRIVACY_CONSENT","MARKETING"]},"version":{"type":"string","minLength":1,"maxLength":100}}}},"nickname":{"type":"string","pattern":"^[\\p{L}\\p{N}]{1,10}$","maxLength":10}},"limitations":{"commitFence":false,"allowedActions":"NOT_IMPLEMENTED","materialChangeClassification":"NOT_IMPLEMENTED"},"schemaVersion":"policy-v0.3","policyRevision":"ps3-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","serverTime":"2040-01-01T00:00:00.000Z","timeAuthority":"POSTGRES_TRANSACTION_NOW","missingReadyKinds":["TERMS","PRIVACY_CONSENT","PRIVACY_POLICY"],"currentDocuments":[{"kind":"TERMS","currentDocument":null},{"kind":"PRIVACY_CONSENT","currentDocument":null},{"kind":"PRIVACY_POLICY","currentDocument":null},{"kind":"MARKETING","currentDocument":null},{"kind":"OPERATIONS","currentDocument":null}],"documents":[{"id":"9223372036854775800","kind":"TERMS","version":"opaque/z-0000","status":"DRAFT","title":"통제 시험 TERMS","body":"LOCAL TEST ONLY — TERMS\r\n가😀 é é\r\n  끝  ","bodySha256":"cb8c1ef72c5c00bbf9063a7125ec0c20e0c36d69db69d2d4ba261db580a0c762","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775801","kind":"PRIVACY_CONSENT","version":"opaque/z-0001","status":"DRAFT","title":"통제 시험 PRIVACY_CONSENT","body":"LOCAL TEST ONLY — PRIVACY_CONSENT\r\n가😀 é é\r\n  끝  ","bodySha256":"71d9a23e36d5b85c8ffb136b497cdd1386e324e6996a8d68fd8eacf27082b2f6","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775802","kind":"PRIVACY_POLICY","version":"opaque/z-0002","status":"DRAFT","title":"통제 시험 PRIVACY_POLICY","body":"LOCAL TEST ONLY — PRIVACY_POLICY\r\n가😀 é é\r\n  끝  ","bodySha256":"40d61bdcc1dfe868559afdc34ad1da6e23a683ec90e1c05ba59d3b89ccbf207d","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775803","kind":"MARKETING","version":"opaque/z-0003","status":"DRAFT","title":"통제 시험 MARKETING","body":"LOCAL TEST ONLY — MARKETING\r\n가😀 é é\r\n  끝  ","bodySha256":"43988519d7628b3cb5201e68b1f66f1d5c45010b7aef1f2d0953315fd26fc52c","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true},{"id":"9223372036854775804","kind":"OPERATIONS","version":"opaque/z-0004","status":"DRAFT","title":"통제 시험 OPERATIONS","body":"LOCAL TEST ONLY — OPERATIONS\r\n가😀 é é\r\n  끝  ","bodySha256":"31968db90e31dfc7c25cfcd064d2f678d3440cb2da751a22c75f9389964eac71","operator":null,"effectiveAt":null,"approvedAt":null,"createdAt":"2038-01-01T00:00:00.000Z","canConsent":false,"isCurrent":false,"isDisplay":true}]}}""") }
