package ai.mintech.kimgosu.auth

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException

/**
 * Session summary for the A1 main screen.
 *
 * The server is the only authority: the token comes from SecureSession (Keystore
 * backed) and every display value comes from `GET /v1/me`. Nothing is cached in a
 * local database and no profile is invented when the request fails.
 *
 * The four states below are the A1 states the paired iOS card also renders:
 * Loading, Ready, Empty (no member to show), Failed (server error or transport).
 */
sealed interface ProfileState {
    data object Loading : ProfileState
    data class Ready(
        val nickname: String,
        val customerNumber: String,
        val email: String,
        val status: String,
        val expert: Boolean,
    ) : ProfileState
    data object Empty : ProfileState
    data class Failed(val network: Boolean, val code: String) : ProfileState
}

class ProfileModel @JvmOverloads constructor(
    application: Application,
    private val repository: AuthRepository = AuthRepository(MembershipHttp(application)),
) : AndroidViewModel(application) {
    var state by mutableStateOf<ProfileState>(ProfileState.Loading); private set
    /** True once the server rejected the stored session (401); the caller returns to login. */
    var sessionExpired by mutableStateOf(false); private set

    // Debug-only QA switches, set from intent extras before refresh(). Never read in release:
    // MainActivity only assigns them under BuildConfig.DEBUG.
    @Volatile var qaLoadingHoldMillis: Long = 0
    @Volatile var qaServerError: Boolean = false

    private val sessions = SecureSession(application)
    private var job: Job? = null

    fun refresh() {
        job?.cancel()
        val token = try { sessions.read() } catch (_: Exception) { null }
        if (token == null) { state = ProfileState.Empty; return }
        state = ProfileState.Loading
        job = viewModelScope.launch {
            try {
                if (qaLoadingHoldMillis > 0) delay(qaLoadingHoldMillis)
                if (qaServerError) throw AuthFailure(500, "QA_INJECTED_SERVER_ERROR", AuthRequestContext.PRIVATE)
                state = decode(repository.me(token))
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                if (e.status == 401) {
                    runCatching { sessions.clear() }
                    state = ProfileState.Empty
                    sessionExpired = true
                } else {
                    state = ProfileState.Failed(network = false, code = e.code)
                }
            } catch (_: IOException) {
                state = ProfileState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
            } catch (_: Exception) {
                state = ProfileState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
            }
        }
    }

    fun acknowledgeExpiry() { sessionExpired = false }

    companion object {
        /** The server response is the truth; an absent member is Empty, not a fabricated profile. */
        fun decode(me: JSONObject): ProfileState {
            val nickname = me.optString("nickname", "")
            val customerNumber = me.optString("customerNumber", "")
            if (nickname.isBlank() && customerNumber.isBlank()) return ProfileState.Empty
            return ProfileState.Ready(
                nickname = nickname,
                customerNumber = customerNumber,
                email = me.optString("email", ""),
                status = me.optString("status", ""),
                expert = me.optBoolean("expertActive", false),
            )
        }
    }
}
