package ai.mintech.kimgosu

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import ai.mintech.kimgosu.auth.*
import ai.mintech.kimgosu.auth.ui.*
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * WS-29 — offline cold start with a stored session.
 *
 * The defect: `AuthModel.start()` switched to A1 only after `loadAccount()` succeeded, so an
 * offline cold start with a valid stored session fell back to the auth entry screen.
 * These checks are model-level evidence only; the on-device screen evidence is the emulator run
 * recorded in records/parallel-10/WS-29/RESULT.json. No local profile data is written: the
 * account is only ever read from the (fake) server.
 */
class OfflineColdStartTests {
    private fun main(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(block)
    private fun waitFor(predicate: () -> Boolean) {
        repeat(240) { var done = false; main { done = predicate() }; if (done) return; Thread.sleep(25) }
        error("MODEL_TIMEOUT")
    }

    /**
     * `/v1/me` suspends on [gate] until the test releases it, so the A1 entry can be observed
     * *while the account request is still in flight*. Other routes answer the draft fixture.
     */
    private class Gated : AuthTransport {
        val gate = CompletableDeferred<Unit>()
        @Volatile var offline = true
        @Volatile var expired = false
        @Volatile var meCalls = 0
        @Volatile var releaseBeforeMe = false
        override suspend fun request(method: String, wirePath: String, token: String?, body: JSONObject?): JSONObject {
            val path = wirePath.substringBefore('?')
            if (path == "/v1/me") {
                meCalls++
                if (!releaseBeforeMe) gate.await()
                if (expired) throw AuthFailure(401, "SESSION_INVALID")
                if (offline) throw java.io.IOException("QA_OFFLINE")
                return JSONObject("""{"status":"ACTIVE","nickname":"오프라인복구","email":"offline@example.invalid","customerNumber":"qa-29"}""")
            }
            if (path == "/v1/auth/config" || path == "/v1/policies" || path.startsWith("/v1/policies/")) {
                if (offline) throw java.io.IOException("QA_OFFLINE")
                return PolicyTestFixture.draft()
            }
            error("UNEXPECTED_ROUTE $path")
        }
    }

    private fun app() = ApplicationProvider.getApplicationContext<Application>()

    @Test fun storedSessionEntersA1BeforeAccountResponse() {
        val application = app()
        SecureSession(application).write("ws29-offline-token")
        val gated = Gated()
        lateinit var model: AuthModel
        main { model = AuthModel(application, AuthRepository(gated)); model.start() }
        // The account request has already been issued and is suspended at the gate.
        waitFor { gated.meCalls > 0 }
        main {
            assertTrue("A1 must be entered before the account response", model.browsing)
            assertTrue("no auth page may cover A1 during cold start", model.stack.isEmpty())
        }
        gated.gate.complete(Unit)          // account load now fails: offline
        waitFor { !model.state.busy }
        main {
            assertTrue("offline account failure must keep A1 mounted", model.browsing)
            assertTrue("offline account failure must not push a login screen", model.stack.isEmpty())
            assertTrue(model.state.error.contains("연결"))
        }
        // Network restored: the A1 retry path re-reads /v1/me and shows the real account values.
        gated.offline = false; gated.releaseBeforeMe = true
        main { model.handle(AuthEvent(AuthAction.REFRESH_ACCOUNT)) }
        waitFor { !model.state.busy }
        main {
            assertEquals("오프라인복구", model.state.nickname)
            assertEquals("qa-29", model.state.customerNumber)
            assertTrue(model.browsing)
        }
        SecureSession(application).clear()
    }

    @Test fun noSessionStaysOnAuthEntry() {
        val application = app()
        SecureSession(application).clear()
        val gated = Gated(); gated.releaseBeforeMe = true
        lateinit var model: AuthModel
        main { model = AuthModel(application, AuthRepository(gated)); model.start() }
        waitFor { !model.state.busy }
        main {
            assertFalse("without a stored session the auth entry stays", model.browsing)
            assertEquals(AuthScreen.E1, model.state.screen)
            assertEquals(0, gated.meCalls)
            assertTrue(model.state.error.isNotEmpty())
        }
    }

    @Test fun rejectedStoredSessionReturnsToLogin() {
        val application = app()
        SecureSession(application).write("ws29-revoked-token")
        val gated = Gated(); gated.releaseBeforeMe = true; gated.expired = true
        lateinit var model: AuthModel
        main { model = AuthModel(application, AuthRepository(gated)); model.start() }
        waitFor { !model.state.busy }
        main {
            assertFalse("a server-rejected session must leave A1", model.browsing)
            assertEquals(AuthScreen.SESSION_EXPIRED, model.state.screen)
            assertNull(SecureSession(application).read())
        }
    }
}
