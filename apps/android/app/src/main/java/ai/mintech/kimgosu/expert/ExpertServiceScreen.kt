package ai.mintech.kimgosu.expert

import ai.mintech.kimgosu.ui.DesignTokens
import ai.mintech.kimgosu.ui.RemoteImage
import android.app.Application
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthRepository
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * 고수 서비스 목록·등록·수정 (WS-42).
 *
 * 목록은 `GET /v1/me/expert`의 services[]가 정본이며 로컬에 저장하지 않는다.
 * 노출 토글은 서버 PATCH 결과로만 확정하고, 실패하면 이전 값으로 되돌린다.
 * 가격유형이 NEGOTIABLE이면 가격 입력을 비활성화하고 basePrice를 null로 보낸다.
 * 유효하지 않은 조합(가격 없는 FIXED 등)은 클라이언트가 고치지 않고 서버 400을 표시한다.
 */

data class ServiceImage(
    val key: String,
    val url: String?,
    val sortOrder: Int,
)

data class ExpertServiceItem(
    val id: String,
    val category: String,
    val title: String,
    val description: String,
    val priceType: String,
    val basePrice: Int?,
    val visibility: String,
    val images: List<ServiceImage>,
)

data class ServiceDraft(
    val id: String?,
    val category: String,
    val title: String,
    val description: String,
    val priceType: String,
    val price: String,
    val images: List<ServiceImage>,
)

sealed interface ExpertServicesState {
    data object Loading : ExpertServicesState
    data object Empty : ExpertServicesState
    data class Failed(val network: Boolean, val code: String) : ExpertServicesState
    data class Ready(val items: List<ExpertServiceItem>) : ExpertServicesState
}

sealed interface ServiceSaveState {
    data object Idle : ServiceSaveState
    data object Saving : ServiceSaveState
    data class Saved(val message: String) : ServiceSaveState
    data class Failed(val network: Boolean, val code: String) : ServiceSaveState
}

class ExpertServiceModel @JvmOverloads constructor(
    application: Application,
    private val repository: AuthRepository = AuthRepository(MembershipHttp(application)),
) : AndroidViewModel(application) {
    var state by mutableStateOf<ExpertServicesState>(ExpertServicesState.Loading); private set
    var save by mutableStateOf<ServiceSaveState>(ServiceSaveState.Idle); private set
    /** 목록 조작(노출 토글 등) 실패 문구. 폼의 저장 오류와 자리를 구분한다. */
    var notice by mutableStateOf<String?>(null); private set
    private val sessions = SecureSession(application)
    private var job: Job? = null

    fun load() {
        job?.cancel()
        notice = null
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) { state = ExpertServicesState.Failed(network = false, code = "SIGN_IN_REQUIRED"); return }
        state = ExpertServicesState.Loading
        job = viewModelScope.launch {
            state = try {
                read(token)
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                ExpertServicesState.Failed(network = false, code = e.code)
            } catch (_: IOException) {
                ExpertServicesState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
            }
        }
    }

    /**
     * 노출/숨김 토글. 화면은 즉시 새 값으로 바뀌고, 서버 PATCH가 실패하면 이전 목록으로 되돌린다.
     */
    fun setVisibility(item: ExpertServiceItem, visible: Boolean) {
        val current = state as? ExpertServicesState.Ready ?: return
        val token = runCatching { sessions.read() }.getOrNull() ?: return
        val target = if (visible) "VISIBLE" else "HIDDEN"
        notice = null
        state = ExpertServicesState.Ready(current.items.map { if (it.id == item.id) it.copy(visibility = target) else it })
        viewModelScope.launch {
            try {
                repository.patchExpertService(token, item.id, JSONObject().put("visibility", target))
                state = read(token)
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                state = ExpertServicesState.Ready(current.items)
                notice = "노출 상태를 바꾸지 못했습니다. (${e.code})"
            } catch (_: IOException) {
                state = ExpertServicesState.Ready(current.items)
                notice = "네트워크에 연결할 수 없습니다. 노출 상태를 되돌렸습니다."
            }
        }
    }

    fun save(draft: ServiceDraft) {
        val token = runCatching { sessions.read() }.getOrNull() ?: return
        save = ServiceSaveState.Saving
        job?.cancel()
        job = viewModelScope.launch {
            val body = JSONObject()
                .put("category", draft.category)
                .put("title", draft.title)
                .put("description", draft.description)
                .put("priceType", draft.priceType)
                .put("basePrice", if (draft.priceType == "NEGOTIABLE" || draft.price.isBlank()) JSONObject.NULL else draft.price.toIntOrNull() ?: JSONObject.NULL)
                .put("imageKeys", JSONArray(draft.images.map { it.key }))
            try {
                if (draft.id == null) repository.createExpertService(token, body)
                else repository.patchExpertService(token, draft.id, body)
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthFailure) {
                save = ServiceSaveState.Failed(network = e.status == 0, code = e.code)
                return@launch
            } catch (_: IOException) {
                save = ServiceSaveState.Failed(network = true, code = "NETWORK_UNAVAILABLE")
                return@launch
            }
            save = try {
                state = read(token)
                ServiceSaveState.Saved(if (draft.id == null) "서비스를 등록했습니다." else "서비스를 수정했습니다.")
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                ServiceSaveState.Saved("저장했습니다. 최신 목록을 다시 불러오지 못했습니다.")
            }
        }
    }

    fun clearSave() { save = ServiceSaveState.Idle }

    /**
     * 사진은 앱이 R2로 직접 올리고 키만 서버에 넘긴다. 키는 업로드 응답이 발급한
     * `service/<memberId>/…`여야 서버가 소유권을 인정한다.
     */
    suspend fun uploadPhoto(uri: Uri, sortOrder: Int): ServiceImage {
        val token = runCatching { sessions.read() }.getOrNull() ?: throw AuthFailure(401, "SIGN_IN_REQUIRED")
        val resolver = getApplication<Application>().contentResolver
        val contentType = resolver.getType(uri) ?: throw AuthFailure(400, "UNSUPPORTED_IMAGE_TYPE")
        val bytes = withContext(Dispatchers.IO) {
            resolver.openInputStream(uri)?.use { it.readBytes() }
        } ?: throw IOException("사진을 읽을 수 없습니다.")
        val presigned = repository.createUpload(token, contentType)
        val uploadUrl = presigned.optString("uploadUrl")
        withContext(Dispatchers.IO) {
            val connection = URL(uploadUrl).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "PUT"
                connection.connectTimeout = 8000
                connection.readTimeout = 8000
                connection.setRequestProperty("Content-Type", contentType)
                connection.doOutput = true
                connection.outputStream.use { it.write(bytes) }
                if (connection.responseCode !in 200..299) throw IOException("R2 upload rejected")
            } finally {
                connection.disconnect()
            }
        }
        return ServiceImage(
            key = presigned.optString("key"),
            url = presigned.optString("publicUrl").ifBlank { null },
            sortOrder = sortOrder,
        )
    }

    private suspend fun read(token: String): ExpertServicesState {
        val items = decodeServices(repository.expertSelf(token))
        return if (items.isEmpty()) ExpertServicesState.Empty else ExpertServicesState.Ready(items)
    }

    companion object {
        fun decodeServices(json: JSONObject): List<ExpertServiceItem> {
            val array = json.optJSONArray("services") ?: return emptyList()
            return List(array.length()) { index ->
                val item = array.getJSONObject(index)
                val imageKey = if (item.isNull("imageKey")) null else item.optString("imageKey", "")
                ExpertServiceItem(
                    id = item.optString("id", ""),
                    category = item.optString("category", ""),
                    title = item.optString("title", ""),
                    description = item.optString("description", ""),
                    priceType = item.optString("priceType", ""),
                    basePrice = if (item.isNull("basePrice")) null else item.optInt("basePrice"),
                    visibility = item.optString("visibility", ""),
                    // images[]가 없는 구서버 응답은 대표 이미지 한 장으로 본다.
                    images = item.optJSONArray("images")?.let { rows ->
                        List(rows.length()) { position ->
                            val row = rows.getJSONObject(position)
                            ServiceImage(
                                key = row.optString("key", ""),
                                url = if (row.isNull("url")) null else row.optString("url", ""),
                                sortOrder = row.optInt("sortOrder", position),
                            )
                        }
                    } ?: imageKey?.takeIf { it.isNotBlank() }?.let {
                        listOf(ServiceImage(it, if (item.isNull("imageUrl")) null else item.optString("imageUrl"), 0))
                    } ?: emptyList(),
                )
            }
        }
    }
}

@Composable
fun ExpertServiceScreen(model: ExpertServiceModel) {
    var draft by remember { mutableStateOf<ServiceDraft?>(null) }
    LaunchedEffect(Unit) { model.load() }
    Column(Modifier.fillMaxSize().background(Color.White).testTag("expert-services")) {
        // 저장이 끝나면 목록으로 돌아가 방금 등록·수정한 항목을 바로 보여준다.
        LaunchedEffect(model.save) { if (model.save is ServiceSaveState.Saved) draft = null }
        if (draft != null) {
            ServiceForm(draft!!, model::save, model.save, model::uploadPhoto, onBack = { draft = null; model.clearSave() })
            return@Column
        }
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            ExpertCopy("서비스", Modifier.weight(1f), 20, bold = true)
            TextButton(onClick = {
                model.clearSave()
                draft = ServiceDraft(null, "", "", "", "FIXED", "", emptyList())
            }, modifier = Modifier.heightIn(min = 48.dp).testTag("service-add")) { ExpertCopy("+ 등록", weight = FontWeight.SemiBold) }
        }
        model.notice?.let { ExpertCopy(it, Modifier.padding(horizontal = 20.dp, vertical = 4.dp).testTag("service-notice"), 13, color = DesignTokens.muted) }
        (model.save as? ServiceSaveState.Saved)?.let {
            ExpertCopy(it.message, Modifier.padding(horizontal = 20.dp, vertical = 4.dp).testTag("service-save-saved"), 13, color = DesignTokens.muted)
        }
        when (val state = model.state) {
            ExpertServicesState.Loading -> ExpertLoading()
            ExpertServicesState.Empty -> Column(Modifier.fillMaxWidth().padding(20.dp)) {
                ExpertEmpty("등록된 서비스가 없습니다. 서비스를 등록하면 고객 검색에 노출됩니다.", model::load)
            }
            is ExpertServicesState.Failed -> ExpertFailure(state.network, state.code, model::load)
            is ExpertServicesState.Ready -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp)) {
                state.items.forEachIndexed { index, item -> ServiceRow(item, index, onToggle = { model.setVisibility(item, it) }, onEdit = {
                    model.clearSave()
                    draft = ServiceDraft(item.id, item.category, item.title, item.description, item.priceType,
                        item.basePrice?.toString() ?: "", item.images)
                }) }
            }
        }
    }
}

@Composable
private fun ServiceRow(item: ExpertServiceItem, index: Int, onToggle: (Boolean) -> Unit, onEdit: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp).clickable(onClick = onEdit).testTag("service-row-$index"),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            ExpertCopy(item.title, size = 15, weight = FontWeight.SemiBold)
            ExpertCopy(item.category + " · " + priceLabel(item), Modifier.padding(top = 2.dp), 13, color = DesignTokens.muted)
        }
        Switch(checked = item.visibility == "VISIBLE", onCheckedChange = onToggle,
            modifier = Modifier.testTag("service-visibility-$index"))
    }
}

private fun priceLabel(item: ExpertServiceItem): String = when (item.priceType) {
    "NEGOTIABLE" -> "가격 협의"
    "HOURLY" -> "시간당 " + (item.basePrice?.let { "${it}원" } ?: "가격 없음")
    "FIXED" -> item.basePrice?.let { "${it}원" } ?: "가격 없음"
    else -> item.priceType
}

@Composable
private fun ServiceForm(
    draft: ServiceDraft,
    onSave: (ServiceDraft) -> Unit,
    save: ServiceSaveState,
    uploadPhoto: suspend (Uri, Int) -> ServiceImage,
    onBack: () -> Unit,
) {
    var category by remember(draft.id) { mutableStateOf(draft.category) }
    var title by remember(draft.id) { mutableStateOf(draft.title) }
    var description by remember(draft.id) { mutableStateOf(draft.description) }
    var priceType by remember(draft.id) { mutableStateOf(draft.priceType) }
    var price by remember(draft.id) { mutableStateOf(draft.price) }
    var images by remember(draft.id) { mutableStateOf(draft.images) }
    var uploading by remember(draft.id) { mutableStateOf(false) }
    var photoError by remember(draft.id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // 서버가 5장을 넘으면 400 TOO_MANY_IMAGES로 거절한다. 선택 단계에서 잘라내면
    // 사용자는 왜 5장만 등록됐는지 알 수 없으므로 장수를 제한하지 않고 그대로 보낸다.
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { picked ->
        if (picked.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            uploading = true
            photoError = null
            val added = mutableListOf<ServiceImage>()
            var failure: String? = null
            for (uri in picked) {
                try {
                    added += uploadPhoto(uri, images.size + added.size)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: AuthFailure) {
                    failure = if (e.status == 0) "네트워크에 연결할 수 없습니다. 사진을 올리지 못했습니다. (${e.code})"
                    else "사진을 올리지 못했습니다. (${e.code})"
                    break
                } catch (_: IOException) {
                    failure = "네트워크에 연결할 수 없습니다. 사진을 올리지 못했습니다."
                    break
                }
            }
            images = images + added
            uploading = false
            photoError = failure
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp).testTag("service-form"),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ExpertCopy(if (draft.id == null) "서비스 등록" else "서비스 수정", Modifier.weight(1f), 18, bold = true)
            TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp).testTag("service-cancel")) { ExpertCopy("취소") }
        }
        ExpertField("카테고리", category, { category = it }, "service-field-category", 1, 50)
        ExpertField("제목", title, { title = it }, "service-field-title", 1, 100)
        ExpertField("설명", description, { description = it }, "service-field-description", 4, 2000)
        ExpertCopy("가격유형", size = 13, color = DesignTokens.muted)
        Row(Modifier.horizontalScroll(rememberScrollState()).testTag("service-price-type"), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("FIXED" to "고정가", "HOURLY" to "시간당", "NEGOTIABLE" to "협의").forEach { (value, label) ->
                FilterChip(selected = priceType == value, onClick = {
                    priceType = value
                    // 협의는 서버가 basePrice를 받지 않는다. 다른 유형으로 돌아오면 사용자가 다시 입력한다.
                    if (value == "NEGOTIABLE") price = ""
                }, label = { ExpertCopy(label) }, shape = RoundedCornerShape(percent = 50),
                    colors = FilterChipDefaults.filterChipColors(selectedContainerColor = DesignTokens.soft),
                    modifier = Modifier.testTag("service-price-type-$value"))
            }
        }
        OutlinedTextField(
            value = price,
            onValueChange = { if (it.length <= 9 && it.all(Char::isDigit)) price = it },
            enabled = priceType != "NEGOTIABLE",
            label = { ExpertCopy("기본가(원)", size = 13) },
            supportingText = { if (priceType == "NEGOTIABLE") ExpertCopy("협의 유형은 가격을 입력하지 않습니다.", size = 12, color = DesignTokens.muted) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth().testTag("service-field-price"),
            textStyle = TextStyle(fontFamily = expertFont(), fontSize = 14.sp, color = DesignTokens.navy),
            shape = RoundedCornerShape(6.dp),
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            ExpertCopy("사진 (" + images.size + "/5)", Modifier.weight(1f), 13, color = DesignTokens.muted)
            TextButton(
                onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                enabled = !uploading,
                modifier = Modifier.heightIn(min = 48.dp).testTag("service-photo-add"),
            ) { ExpertCopy("+ 사진 추가", weight = FontWeight.SemiBold) }
        }
        images.forEachIndexed { index, image ->
            Row(Modifier.fillMaxWidth().testTag("service-photo-$index"), verticalAlignment = Alignment.CenterVertically) {
                RemoteImage(image.url, Modifier.size(64.dp))
                ExpertCopy(
                    if (index == 0) "대표 사진" else "사진 " + (index + 1),
                    Modifier.weight(1f).padding(start = 12.dp), 13, color = DesignTokens.muted,
                )
                TextButton(
                    onClick = { images = images.filterIndexed { position, _ -> position != index } },
                    modifier = Modifier.heightIn(min = 48.dp).testTag("service-photo-remove-$index"),
                ) { ExpertCopy("삭제") }
            }
        }
        if (uploading) ExpertCopy("사진 업로드 중…", Modifier.testTag("service-photo-uploading"), 13, color = DesignTokens.muted)
        photoError?.let { ExpertCopy(it, Modifier.testTag("service-photo-error"), 13, color = DesignTokens.muted) }
        Button(
            onClick = { onSave(ServiceDraft(draft.id, category, title, description, priceType, price, images)) },
            enabled = save != ServiceSaveState.Saving,
            colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy, contentColor = Color.White),
            shape = RoundedCornerShape(6.dp),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("service-save"),
        ) { ExpertCopy(if (save == ServiceSaveState.Saving) "저장 중…" else "저장", size = 15, weight = FontWeight.SemiBold, color = Color.White) }
        (save as? ServiceSaveState.Failed)?.let {
            ExpertCopy(
                if (it.network) "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
                else if (it.code == "TOO_MANY_IMAGES") "사진은 최대 5장까지 등록할 수 있습니다. (TOO_MANY_IMAGES)"
                else "저장하지 못했습니다. (${it.code})",
                Modifier.testTag(if (it.network) "service-save-network" else "service-save-error"), 13,
            )
        }
    }
}
