package ai.mintech.kimgosu.chat

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import ai.mintech.kimgosu.expert.ExpertCopy
import ai.mintech.kimgosu.ui.DesignTokens
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** design/chat-media-gallery/screens.md 의 문구. 여기 없는 문장을 화면에 만들지 않는다. */
internal object GalleryCopy {
    const val ENTRY = "사진·동영상·파일 모아보기"
    const val G_TITLE = "사진·동영상·파일"
    const val TAB_MEDIA = "사진·동영상"
    const val TAB_FILES = "파일"
    const val BACK = "뒤로"
    const val RETURN_CHAT = "대화로 돌아가기"
    const val RETURN_GALLERY = "모아보기로 돌아가기"
    const val RETRY = "다시 시도"
    const val NET = "네트워크에 연결하지 못했습니다. 연결 상태를 확인한 후 다시 시도해 주십시오."
    const val ROOM_DENIED = "이 대화를 이용할 수 없습니다. 채팅 목록으로 돌아가 주십시오."
    const val PREPARING = "모아보기 기능을 준비 중입니다. 대화에서 첨부파일을 확인해 주십시오."
    const val THUMB_ERROR = "미리보기 불가"
    const val THUMB_LOADING = "미리보기 불러오는 중"
    const val PHOTO_KIND = "사진"
    const val P_TITLE = "사진 보기"
    const val PREVIOUS = "이전 첨부파일"
    const val NEXT = "다음 첨부파일"
    const val READY_A11Y = "열기"

    // CHAT_MEDIA_GALLERY 상태 4종
    const val G_LOADING = "첨부파일을 불러오는 중입니다."
    const val G_EMPTY_MEDIA = "아직 주고받은 사진과 동영상이 없습니다."
    const val G_EMPTY_FILES = "아직 주고받은 파일이 없습니다."
    const val G_ERROR = "첨부파일을 불러오지 못했습니다. 다시 시도해 주십시오."
    const val G_EMPTY_HELP = "대화로 돌아가 첨부파일을 주고받으십시오."

    // PHOTO_VIEWER 상태 4종
    const val P_LOADING = "사진을 불러오는 중입니다."
    const val P_EMPTY = "표시할 사진이 없습니다."
    const val P_ERROR = "사진을 불러오지 못했습니다. 다시 시도해 주십시오."
    const val V_EMPTY_HELP = "이전 화면으로 돌아가 다른 첨부파일을 선택해 주십시오."
}

internal data class GalleryPhoto(
    val id: String,
    val url: String,
    /** 서버 메시지 전송시각. 정렬·표시 모두 이 값을 쓴다. */
    val sentAt: String,
)

internal sealed interface GalleryState {
    /** 로딩: 첫 페이지 성공 전에는 빈 상태를 보이지 않는다. */
    data object Loading : GalleryState

    /** 빈: 서버 조회 성공 결과가 0건. */
    data object Empty : GalleryState

    data class Ready(val photos: List<GalleryPhoto>) : GalleryState

    /** 오류(denied=true 는 방 접근 거부) / 네트워크 실패. */
    data class Failed(val network: Boolean, val denied: Boolean = false) : GalleryState
}

internal class ChatGalleryModel(
    private val transport: AuthTransport,
    private val sessions: SecureSession,
) {
    var state by mutableStateOf<GalleryState>(GalleryState.Loading); private set
    var photos by mutableStateOf<List<GalleryPhoto>>(emptyList()); private set

    /** 방 전체 첨부 전용 API 가 아직 없어, 서버가 허용한 메시지 첨부를 그대로 모아 보여준다. */
    suspend fun load(ledgerId: String) {
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) {
            state = GalleryState.Failed(network = false)
            return
        }
        if (state !is GalleryState.Ready) state = GalleryState.Loading
        try {
            val page = ChatApi(transport).list(token, ledgerId)
            photos = page.messages
                .filter { !it.deleted && it.imageUrl != null }
                .sortedByDescending { it.createdAt }
                .mapNotNull { message -> message.imageUrl?.let { GalleryPhoto(message.id, it, message.createdAt) } }
            state = if (photos.isEmpty()) GalleryState.Empty else GalleryState.Ready(photos)
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthFailure) {
            state = GalleryState.Failed(network = false, denied = e.status == 403 || e.status == 404)
        } catch (_: IOException) {
            state = GalleryState.Failed(network = true)
        } catch (_: Exception) {
            state = GalleryState.Failed(network = false)
        }
    }
}

@Composable
fun ChatMediaGalleryScreen(ledgerId: String, onClose: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val model = remember(ledgerId) { ChatGalleryModel(MembershipHttp(context), SecureSession(context)) }
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var viewing by remember { mutableStateOf<GalleryPhoto?>(null) }
    LaunchedEffect(ledgerId) { model.load(ledgerId) }
    val photo = viewing
    if (photo != null) {
        BackHandler { viewing = null }
        PhotoViewerScreen(photo = photo, photos = model.photos, onBack = { viewing = null })
    } else {
        BackHandler { onClose() }
        GalleryFrame(
            tab = tab,
            onTab = { tab = it },
            state = model.state,
            onRetry = { scope.launch { model.load(ledgerId) } },
            onOpen = { viewing = it },
            onClose = onClose,
        )
    }
}

@Composable
private fun GalleryFrame(
    tab: Int,
    onTab: (Int) -> Unit,
    state: GalleryState,
    onRetry: () -> Unit,
    onOpen: (GalleryPhoto) -> Unit,
    onClose: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).safeDrawingPadding().testTag("chat-gallery")) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = ChatGalleryTokens.screenInset, vertical = ChatGalleryTokens.headerVertical),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onClose, modifier = Modifier.heightIn(min = ChatGalleryTokens.minTouch).testTag("chat-gallery-back")) {
                ExpertCopy(GalleryCopy.BACK)
            }
            Spacer(Modifier.width(ChatGalleryTokens.headerGap))
            ExpertCopy(GalleryCopy.G_TITLE, Modifier.weight(1f), size = ChatGalleryTokens.screenTitle, bold = true)
        }
        Row(Modifier.fillMaxWidth().selectableGroup().padding(horizontal = ChatGalleryTokens.screenInset)) {
            GalleryTab(GalleryCopy.TAB_MEDIA, selected = tab == 0, Modifier.weight(1f)) { onTab(0) }
            GalleryTab(GalleryCopy.TAB_FILES, selected = tab == 1, Modifier.weight(1f)) { onTab(1) }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (state) {
                GalleryState.Loading -> GalleryLoading()
                is GalleryState.Failed -> GalleryFailure(state, onRetry)
                GalleryState.Empty -> GalleryNotice(
                    title = if (tab == 0) GalleryCopy.G_EMPTY_MEDIA else GalleryCopy.G_EMPTY_FILES,
                    help = if (tab == 0) GalleryCopy.G_EMPTY_HELP else GalleryCopy.PREPARING,
                )
                is GalleryState.Ready -> if (tab == 0) MediaGrid(state.photos, onOpen) else GalleryNotice(GalleryCopy.G_EMPTY_FILES, GalleryCopy.PREPARING)
            }
        }
        Button(
            onClick = onClose,
            modifier = Modifier.fillMaxWidth()
                .padding(horizontal = ChatGalleryTokens.screenInset, vertical = ChatGalleryTokens.footerInset)
                .heightIn(min = ChatGalleryTokens.minTouch).testTag("chat-gallery-return-chat"),
            shape = RoundedCornerShape(ChatGalleryTokens.radiusButton),
            colors = ButtonDefaults.buttonColors(
                containerColor = DesignTokens.navy,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
        ) {
            ExpertCopy(GalleryCopy.RETURN_CHAT, size = ChatGalleryTokens.action, weight = FontWeight.Bold)
        }
    }
}

@Composable
private fun GalleryTab(text: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.heightIn(min = ChatGalleryTokens.minTouch)
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(vertical = ChatGalleryTokens.headerVertical),
        contentAlignment = Alignment.Center,
    ) {
        ExpertCopy(
            text,
            size = ChatGalleryTokens.body,
            weight = if (selected) FontWeight.Bold else FontWeight.Normal,
            color = if (selected) DesignTokens.navy else DesignTokens.muted,
        )
    }
}

@Composable
private fun GalleryLoading() {
    Column(
        Modifier.fillMaxSize().padding(horizontal = ChatGalleryTokens.screenInset, vertical = ChatGalleryTokens.sectionGap),
        verticalArrangement = Arrangement.spacedBy(ChatGalleryTokens.stateGap),
    ) {
        CircularProgressIndicator(color = DesignTokens.navy)
        ExpertCopy(GalleryCopy.G_LOADING, size = ChatGalleryTokens.body, color = DesignTokens.muted)
    }
}

@Composable
private fun GalleryFailure(state: GalleryState.Failed, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = ChatGalleryTokens.screenInset, vertical = ChatGalleryTokens.sectionGap)
            .testTag("chat-gallery-error"),
        verticalArrangement = Arrangement.spacedBy(ChatGalleryTokens.stateGap),
    ) {
        ExpertCopy(
            text = when {
                state.denied -> GalleryCopy.ROOM_DENIED
                state.network -> GalleryCopy.NET
                else -> GalleryCopy.G_ERROR
            },
            size = ChatGalleryTokens.body,
            color = ChatGalleryTokens.errorText,
            modifier = Modifier.background(ChatGalleryTokens.errorSurface, RoundedCornerShape(ChatGalleryTokens.radiusButton))
                .padding(horizontal = ChatGalleryTokens.buttonHorizontal, vertical = ChatGalleryTokens.buttonVertical),
        )
        if (!state.denied) {
            Button(
                onClick = onRetry,
                modifier = Modifier.heightIn(min = ChatGalleryTokens.minTouch),
                shape = RoundedCornerShape(ChatGalleryTokens.radiusButton),
            ) { ExpertCopy(GalleryCopy.RETRY, size = ChatGalleryTokens.action, weight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun GalleryNotice(title: String, help: String) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = ChatGalleryTokens.screenInset, vertical = ChatGalleryTokens.sectionGap),
        verticalArrangement = Arrangement.spacedBy(ChatGalleryTokens.stateGap),
    ) {
        ExpertCopy(title, size = ChatGalleryTokens.stateTitle, bold = true)
        ExpertCopy(help, size = ChatGalleryTokens.body, color = DesignTokens.muted)
    }
}

@Composable
private fun MediaGrid(photos: List<GalleryPhoto>, onOpen: (GalleryPhoto) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val inner = maxWidth - ChatGalleryTokens.screenInset * 2
        // 슬롯이 최소 터치 폭보다 작아지면 3 → 2 → 1열로 줄인다.
        val columns = when {
            (inner - ChatGalleryTokens.itemGap * 2) / 3 >= ChatGalleryTokens.minTouch -> 3
            (inner - ChatGalleryTokens.itemGap) / 2 >= ChatGalleryTokens.minTouch -> 2
            else -> 1
        }
        val groups = photos.groupBy { kstDate(it.sentAt) }
        LazyColumn(
            Modifier.fillMaxSize().testTag("chat-gallery-media"),
            contentPadding = PaddingValues(horizontal = ChatGalleryTokens.screenInset),
        ) {
            groups.forEach { (date, items) ->
                item(key = "date-" + date) {
                    ExpertCopy(
                        date,
                        Modifier.padding(top = ChatGalleryTokens.sectionGap, bottom = ChatGalleryTokens.itemGap),
                        size = ChatGalleryTokens.sectionTitle,
                        weight = FontWeight.Bold,
                    )
                }
                items(items.chunked(columns), key = { row -> row.first().id }) { row ->
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = ChatGalleryTokens.itemGap),
                        horizontalArrangement = Arrangement.spacedBy(ChatGalleryTokens.itemGap),
                    ) {
                        row.forEach { photo -> GallerySlot(photo, Modifier.weight(1f), onOpen) }
                        repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

private sealed interface Thumb {
    data object Loading : Thumb

    data object Failed : Thumb

    data class Ready(val bitmap: Bitmap) : Thumb
}

@Composable
private fun GallerySlot(photo: GalleryPhoto, modifier: Modifier, onOpen: (GalleryPhoto) -> Unit) {
    var thumb by remember(photo.id) { mutableStateOf<Thumb>(Thumb.Loading) }
    var attempt by remember(photo.id) { mutableIntStateOf(0) }
    LaunchedEffect(photo.url, attempt) {
        thumb = Thumb.Loading
        thumb = try {
            Thumb.Ready(fetchBitmap(photo.url))
        } catch (_: Exception) {
            Thumb.Failed
        }
    }
    val ready = thumb as? Thumb.Ready
    Column(modifier) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(1f).background(DesignTokens.track)
                .clickable(enabled = ready != null, onClickLabel = GalleryCopy.READY_A11Y) { onOpen(photo) }
                .testTag("chat-gallery-slot"),
            contentAlignment = Alignment.Center,
        ) {
            when (val current = thumb) {
                is Thumb.Ready -> Image(
                    current.bitmap.asImageBitmap(),
                    contentDescription = mediaLabel(photo),
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit,
                )
                Thumb.Loading -> ExpertCopy(
                    GalleryCopy.THUMB_LOADING,
                    size = ChatGalleryTokens.metadata,
                    color = DesignTokens.muted,
                    align = TextAlign.Center,
                )
                Thumb.Failed -> TextButton(
                    onClick = { attempt++ },
                    modifier = Modifier.heightIn(min = ChatGalleryTokens.minTouch),
                ) { ExpertCopy(GalleryCopy.THUMB_ERROR, size = ChatGalleryTokens.metadata, color = DesignTokens.muted) }
            }
        }
        ExpertCopy(
            GalleryCopy.PHOTO_KIND,
            Modifier.padding(top = ChatGalleryTokens.metadataGap),
            size = ChatGalleryTokens.metadata,
            color = DesignTokens.muted,
        )
    }
}

@Composable
private fun PhotoViewerScreen(photo: GalleryPhoto, photos: List<GalleryPhoto>, onBack: () -> Unit) {
    val start = photos.indexOfFirst { it.id == photo.id }.coerceAtLeast(0)
    var index by remember(photo.id) { mutableIntStateOf(start) }
    val current = photos.getOrNull(index)
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).safeDrawingPadding().testTag("chat-photo-viewer"),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = ChatGalleryTokens.screenInset, vertical = ChatGalleryTokens.headerVertical),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack, modifier = Modifier.heightIn(min = ChatGalleryTokens.minTouch)) {
                ExpertCopy(GalleryCopy.BACK)
            }
            Spacer(Modifier.width(ChatGalleryTokens.headerGap))
            ExpertCopy(GalleryCopy.P_TITLE, Modifier.weight(1f), size = ChatGalleryTokens.screenTitle, bold = true)
        }
        Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = ChatGalleryTokens.screenInset)) {
            if (current == null) {
                Column(verticalArrangement = Arrangement.spacedBy(ChatGalleryTokens.stateGap)) {
                    ExpertCopy(GalleryCopy.P_EMPTY, size = ChatGalleryTokens.stateTitle, bold = true)
                    ExpertCopy(GalleryCopy.V_EMPTY_HELP, size = ChatGalleryTokens.body, color = DesignTokens.muted)
                }
            } else {
                ViewerImage(current)
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = ChatGalleryTokens.screenInset, vertical = ChatGalleryTokens.itemGap),
            horizontalArrangement = Arrangement.spacedBy(ChatGalleryTokens.actionGap),
        ) {
            TextButton(
                onClick = { index = (index - 1).coerceAtLeast(0) },
                enabled = index > 0,
                modifier = Modifier.weight(1f).heightIn(min = ChatGalleryTokens.minTouch),
            ) { ExpertCopy(GalleryCopy.PREVIOUS) }
            TextButton(
                onClick = { index = (index + 1).coerceAtMost(photos.lastIndex) },
                enabled = index < photos.lastIndex,
                modifier = Modifier.weight(1f).heightIn(min = ChatGalleryTokens.minTouch),
            ) { ExpertCopy(GalleryCopy.NEXT) }
        }
        Button(
            onClick = onBack,
            modifier = Modifier.fillMaxWidth()
                .padding(horizontal = ChatGalleryTokens.screenInset, vertical = ChatGalleryTokens.footerInset)
                .heightIn(min = ChatGalleryTokens.minTouch),
            shape = RoundedCornerShape(ChatGalleryTokens.radiusButton),
            colors = ButtonDefaults.buttonColors(
                containerColor = DesignTokens.navy,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
        ) { ExpertCopy(GalleryCopy.RETURN_GALLERY, size = ChatGalleryTokens.action, weight = FontWeight.Bold) }
    }
}

@Composable
private fun ViewerImage(photo: GalleryPhoto) {
    var thumb by remember(photo.id) { mutableStateOf<Thumb>(Thumb.Loading) }
    var attempt by remember(photo.id) { mutableIntStateOf(0) }
    LaunchedEffect(photo.url, attempt) {
        thumb = Thumb.Loading
        thumb = try {
            Thumb.Ready(fetchBitmap(photo.url))
        } catch (_: Exception) {
            Thumb.Failed
        }
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when (val current = thumb) {
            is Thumb.Ready -> Image(
                current.bitmap.asImageBitmap(),
                contentDescription = mediaLabel(photo),
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
            )
            Thumb.Loading -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(ChatGalleryTokens.stateGap),
            ) {
                CircularProgressIndicator(color = DesignTokens.navy)
                ExpertCopy(GalleryCopy.P_LOADING, size = ChatGalleryTokens.body, color = DesignTokens.muted)
            }
            Thumb.Failed -> Column(
                verticalArrangement = Arrangement.spacedBy(ChatGalleryTokens.stateGap),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                ExpertCopy(GalleryCopy.P_ERROR, size = ChatGalleryTokens.body, color = ChatGalleryTokens.errorText)
                TextButton(onClick = { attempt++ }, modifier = Modifier.heightIn(min = ChatGalleryTokens.minTouch)) {
                    ExpertCopy(GalleryCopy.RETRY, weight = FontWeight.Bold)
                }
            }
        }
    }
}

private fun mediaLabel(photo: GalleryPhoto): String =
    GalleryCopy.PHOTO_KIND + ", " + kstDateTime(photo.sentAt) + ", " + GalleryCopy.READY_A11Y

private suspend fun fetchBitmap(url: String): Bitmap = withContext(Dispatchers.IO) {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
        connection.connectTimeout = 8000
        connection.readTimeout = 8000
        if (connection.responseCode !in 200..299) throw IOException("image http " + connection.responseCode)
        connection.inputStream.use { BitmapFactory.decodeStream(it) } ?: throw IOException("image decode")
    } finally {
        connection.disconnect()
    }
}

private fun kst(iso: String): ZonedDateTime? = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.of("Asia/Seoul"))
}.recoverCatching {
    Instant.parse(iso).atZone(ZoneId.of("Asia/Seoul"))
}.getOrNull()

/** DATE_GROUP: KST 날짜. 연도 네 자리, 월·일 앞 0 없음. */
internal fun kstDate(iso: String): String {
    val time = kst(iso) ?: return ""
    return "%d년 %d월 %d일".format(time.year, time.monthValue, time.dayOfMonth)
}

/** SENT_AT: KST 날짜 + 24시간제 두 자리 시·분. */
internal fun kstDateTime(iso: String): String {
    val time = kst(iso) ?: return ""
    return "%d년 %d월 %d일 %02d:%02d".format(time.year, time.monthValue, time.dayOfMonth, time.hour, time.minute)
}
