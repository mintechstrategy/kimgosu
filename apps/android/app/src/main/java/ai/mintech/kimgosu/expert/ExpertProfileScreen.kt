package ai.mintech.kimgosu.expert

import ai.mintech.kimgosu.ui.DesignTokens
import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthRepository
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException

/**
 * 고수 프로필 조회·수정 (WS-42).
 *
 * 저장 값의 정본은 서버다. 저장 후 `GET /v1/me/expert`를 다시 읽어 화면을 갱신하므로
 * 로컬 DB나 낙관적 캐시를 두지 않는다. 값 검증·보정은 서버가 하며 클라이언트는
 * 사용자가 입력한 값을 그대로 보내고 서버가 준 오류 코드를 표시한다.
 */

data class ExpertProfile(val introduction: String, val career: String, val activityRegion: String)

sealed interface ExpertProfileState {
    data object Loading : ExpertProfileState
    data class Empty(val message: String) : ExpertProfileState
    data class Failed(val network: Boolean, val code: String) : ExpertProfileState
    data class Ready(val profile: ExpertProfile) : ExpertProfileState
}

sealed interface ExpertSaveState {
    data object Idle : ExpertSaveState
    data object Saving : ExpertSaveState
    data class Saved(val message: String) : ExpertSaveState
    data class Failed(val network: Boolean, val code: String) : ExpertSaveState
}

class ExpertProfileModel @JvmOverloads constructor(
    application: Application,
    private val repository: AuthRepository = AuthRepository(MembershipHttp(application)),
) : AndroidViewModel(application) {
    var state by mutableStateOf<ExpertProfileState>(ExpertProfileState.Loading); private set
    var save by mutableStateOf<ExpertSaveState>(ExpertSaveState.Idle); private set
    private val sessions = SecureSession(application)
    private var job: Job? = null

    fun load() {
        job?.cancel()
        save = ExpertSaveState.Idle
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) { state = ExpertProfileState.Empty("로그인하면 고수 프로필을 관리할 수 있습니다."); return }
        state = ExpertProfileState.Loading
        job = viewModelScope.launch {
            state = try {
                decode(repository.expertSelf(token))
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                failure(e.status, e.code)
            } catch (_: IOException) {
                ExpertProfileState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
            }
        }
    }

    fun save(introduction: String, career: String, activityRegion: String) {
        val current = state as? ExpertProfileState.Ready ?: return
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) { state = ExpertProfileState.Empty("로그인하면 고수 프로필을 관리할 수 있습니다."); return }
        // 변경된 항목만 보낸다. 빈 문자열도 보정하지 않고 그대로 전송해 서버 판정을 받는다.
        val fields = JSONObject()
        if (introduction != current.profile.introduction) fields.put("introduction", introduction)
        if (career != current.profile.career) fields.put("career", career)
        if (activityRegion != current.profile.activityRegion) fields.put("activityRegion", activityRegion)
        if (fields.length() == 0) { save = ExpertSaveState.Saved("변경된 내용이 없습니다."); return }
        save = ExpertSaveState.Saving
        job?.cancel()
        job = viewModelScope.launch {
            try {
                repository.patchExpertProfile(token, fields)
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                save = saveFailure(e.status, e.code)
                return@launch
            } catch (_: IOException) {
                save = ExpertSaveState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
                return@launch
            }
            save = try {
                state = decode(repository.expertSelf(token))
                ExpertSaveState.Saved("저장했습니다. 서버에서 다시 읽어 확인했습니다.")
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                ExpertSaveState.Saved("저장했습니다. 최신 정보를 다시 불러오지 못했습니다.")
            }
        }
    }

    companion object {
        fun decode(json: JSONObject) = ExpertProfileState.Ready(ExpertProfile(
            introduction = text(json, "introduction"),
            career = text(json, "career"),
            activityRegion = text(json, "activityRegion"),
        ))

        private fun text(json: JSONObject, key: String): String {
            val value = json.opt(key)
            return if (value is String) value else ""
        }

        fun failure(status: Int, code: String): ExpertProfileState = when {
            status == 401 -> ExpertProfileState.Empty("로그인이 필요합니다.")
            code == "EXPERT_ROLE_REQUIRED" -> ExpertProfileState.Empty("고수로 등록된 계정이 아닙니다.")
            code == "EXPERT_PROFILE_REQUIRED" -> ExpertProfileState.Empty("고수 프로필이 아직 없습니다.")
            else -> ExpertProfileState.Failed(network = false, code = code)
        }

        fun saveFailure(status: Int, code: String): ExpertSaveState =
            ExpertSaveState.Failed(network = status == 0, code = code)
    }
}

@Composable
fun ExpertProfileScreen(model: ExpertProfileModel) {
    LaunchedEffect(Unit) { model.load() }
    Column(Modifier.fillMaxSize().background(Color.White).testTag("expert-profile")) {
        ExpertScreenTitle("프로필")
        when (val state = model.state) {
            ExpertProfileState.Loading -> ExpertLoading()
            is ExpertProfileState.Empty -> ExpertEmpty(state.message, model::load)
            is ExpertProfileState.Failed -> ExpertFailure(state.network, state.code, model::load)
            is ExpertProfileState.Ready -> ExpertProfileForm(state.profile, model::save, model.save)
        }
    }
}

@Composable
private fun ExpertProfileForm(profile: ExpertProfile, onSave: (String, String, String) -> Unit, save: ExpertSaveState) {
    var introduction by remember(profile) { mutableStateOf(profile.introduction) }
    var career by remember(profile) { mutableStateOf(profile.career) }
    var activityRegion by remember(profile) { mutableStateOf(profile.activityRegion) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ExpertField("소개", introduction, { introduction = it }, "profile-field-introduction", minLines = 4, limit = 1000)
        ExpertField("경력", career, { career = it }, "profile-field-career", minLines = 6, limit = 2000)
        ExpertField("활동지역", activityRegion, { activityRegion = it }, "profile-field-activity-region", minLines = 1, limit = 100)
        Button(
            onClick = { onSave(introduction, career, activityRegion) },
            enabled = save != ExpertSaveState.Saving,
            colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy, contentColor = Color.White),
            shape = RoundedCornerShape(6.dp),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("profile-save"),
        ) { ExpertCopy(if (save == ExpertSaveState.Saving) "저장 중…" else "저장", size = 15, weight = FontWeight.SemiBold, color = Color.White) }
        when (save) {
            ExpertSaveState.Idle, ExpertSaveState.Saving -> Unit
            is ExpertSaveState.Saved -> ExpertCopy(save.message, Modifier.testTag("profile-save-saved"), 13, color = DesignTokens.muted)
            is ExpertSaveState.Failed -> ExpertCopy(
                if (save.network) "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
                else "저장하지 못했습니다. (${save.code})",
                Modifier.testTag(if (save.network) "profile-save-network" else "profile-save-error"), 13,
            )
        }
    }
}

@Composable
internal fun ExpertScreenTitle(title: String) {
    ExpertCopy(title, Modifier.padding(start = 20.dp, top = 16.dp, bottom = 8.dp).semantics { heading() }, 20, bold = true)
}

@Composable
internal fun ExpertLoading() {
    Row(Modifier.fillMaxWidth().padding(20.dp).testTag("expert-loading"), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(18.dp), color = DesignTokens.navy, strokeWidth = 2.dp)
        ExpertCopy("불러오는 중입니다…", Modifier.padding(start = 10.dp), 14, color = DesignTokens.muted)
    }
}

@Composable
internal fun ExpertEmpty(message: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(20.dp).border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(20.dp).testTag("expert-empty")) {
        ExpertCopy(message, color = DesignTokens.muted)
        TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp).testTag("expert-retry")) { ExpertCopy("새로고침", weight = FontWeight.SemiBold) }
    }
}

@Composable
internal fun ExpertFailure(network: Boolean, code: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(20.dp).border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(20.dp)
        .testTag(if (network) "expert-network-failure" else "expert-error")) {
        ExpertCopy(if (network) "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
        else "정보를 불러오지 못했습니다. ($code)")
        TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp).testTag("expert-retry")) { ExpertCopy("다시 시도", weight = FontWeight.SemiBold) }
    }
}

@Composable
internal fun ExpertField(label: String, value: String, onChange: (String) -> Unit, tag: String, minLines: Int, limit: Int) {
    Column(Modifier.fillMaxWidth()) {
        ExpertCopy(label, size = 13, color = DesignTokens.muted)
        OutlinedTextField(
            value = value,
            onValueChange = { if (it.length <= limit) onChange(it) },
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp).testTag(tag),
            textStyle = TextStyle(fontFamily = expertFont(), fontSize = 14.sp, color = DesignTokens.navy),
            minLines = minLines,
            shape = RoundedCornerShape(6.dp),
        )
    }
}

@Composable
internal fun ExpertCopy(text: String, modifier: Modifier = Modifier, size: Int = 14, bold: Boolean = false,
                        color: Color = DesignTokens.navy, align: TextAlign = TextAlign.Start, weight: FontWeight? = null) {
    Text(text, modifier, color, fontSize = size.sp, fontFamily = expertFont(), fontWeight = weight ?: if (bold) FontWeight.Bold else FontWeight.Normal, textAlign = align)
}

@Composable
internal fun expertFont(): FontFamily {
    val assets = LocalContext.current.assets
    return remember { FontFamily(Font("regular.otf", assets), Font("semibold.otf", assets, FontWeight.SemiBold), Font("bold.otf", assets, FontWeight.Bold)) }
}
