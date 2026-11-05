package ai.mintech.kimgosu.admin

import ai.mintech.kimgosu.LocalBrandFont
import ai.mintech.kimgosu.ui.DesignTokens
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 관리자 공지사항 화면 — design/admin-notice-board 스펙의 ADM_NOTICE_LIST / ADM_NOTICE_DETAIL /
 * ADM_NOTICE_EDIT / ADM_NOTICE_EDIT.DISCARD.
 *
 * 화면은 상태를 받아 그리기만 한다. 공지 서버 계약이 아직 없으므로 연결 전 실제 동작은
 * CAPABILITY_LOCK(스펙 §7)이며, 샘플 공지나 가짜 0건으로 대체하지 않는다.
 */

object NoticeText {
    const val LIST_TITLE = "공지사항 관리"
    const val DETAIL_TITLE = "공지사항 상세"
    const val CREATE_TITLE = "공지사항 작성"
    const val EDIT_TITLE = "공지사항 수정"
    const val LIST_BACK = "목록으로"
    const val RETRY = "다시 시도"
    const val REFRESH = "새로고침"
    const val CANCEL = "취소"
    const val CREATE = "공지 작성"
    const val NEXT = "더 불러오기"
    const val EDIT = "초안 수정"
    const val SAVE = "초안 저장"
    const val CHECK_SAVE = "저장 결과 확인"
    const val VIEW_LATEST = "최신 내용 확인"
    const val KEEP_INPUT = "현재 입력 유지"
    const val USE_LATEST = "최신 내용으로 바꾸기"
    const val KEEP_EDITING = "계속 작성"
    const val DISCARD = "내용 버리기"

    const val COL_TITLE = "제목"
    const val COL_STATUS = "상태"
    const val COL_UPDATED = "최종 수정일시"
    const val META_STATUS = "상태"
    const val META_CREATED = "작성일시"
    const val META_UPDATED = "최종 수정일시"
    const val CONTENT_HEADING = "내용"
    const val LABEL_TITLE = "제목"
    const val LABEL_BODY = "내용"
    const val REQUIRED = "필수"
    const val PLACEHOLDER_TITLE = "공지 제목을 입력하십시오"
    const val PLACEHOLDER_BODY = "공지 내용을 입력하십시오"

    const val STATUS_DRAFT = "초안"
    const val STATUS_PUBLISHED = "게시 중"
    const val STATUS_HIDDEN = "비공개"
    const val STATUS_UNKNOWN = "상태 확인 필요"
    const val NO_VALUE = "—"

    const val NETWORK_TITLE = "네트워크에 연결하지 못했습니다"
    const val NETWORK_BODY = "연결 상태를 확인한 후 다시 시도해 주십시오."
    const val DENIED_TITLE = "접근 권한이 없습니다"
    const val DENIED_BODY = "공지사항 관리 권한을 확인해 주십시오."
    const val WRITE_LOCK = "작성 권한 또는 저장 기준을 확인하지 못했습니다. 내용을 저장할 수 없습니다."
    const val CAPABILITY_LOCK = "공지사항 연결 준비 중입니다. 연결이 완료되면 다시 시도해 주십시오."
    const val PUBLISH_LOCK = "게시 기능 준비 중"
    const val PUBLISH_LOCK_BODY = "게시 대상과 운영 승인 기준이 확정되기 전까지 초안만 저장할 수 있습니다. 초안은 이용자에게 공개되지 않습니다."
    const val READONLY_BODY = "게시 중이거나 비공개인 공지는 조회만 가능합니다. 변경하려면 운영 기준을 먼저 확인해 주십시오."
    const val UNSUPPORTED_BODY = "지원하지 않는 공지 상태입니다. 최신 상태를 다시 확인해 주십시오."

    const val LIST_LOADING = "공지사항을 불러오는 중입니다…"
    const val LIST_MORE_LOADING = "공지사항을 더 불러오는 중입니다…"
    const val LIST_EMPTY_TITLE = "등록된 공지사항이 없습니다"
    const val LIST_EMPTY_BODY = "공지 작성에서 제목과 내용을 입력한 후 초안으로 저장하십시오."
    const val LIST_EMPTY_READONLY = "조회할 공지사항이 없습니다. 작성은 권한이 있는 관리자만 가능합니다."
    const val LIST_ERROR_TITLE = "공지사항을 불러오지 못했습니다"
    const val LIST_ERROR_BODY = "잠시 후 다시 시도해 주십시오."
    const val LIST_MORE_ERROR = "추가 공지사항을 불러오지 못했습니다. 다시 시도해 주십시오."
    const val LIST_STALE = "최신 목록을 확인하지 못했습니다. 이전 조회 결과입니다."

    const val DETAIL_LOADING = "공지사항을 확인하는 중입니다…"
    const val DETAIL_EMPTY_TITLE = "공지사항을 찾을 수 없습니다"
    const val DETAIL_EMPTY_BODY = "목록으로 돌아가 조회 가능한 공지사항을 확인해 주십시오."
    const val DETAIL_ERROR_TITLE = "공지사항을 확인하지 못했습니다"
    const val DETAIL_ERROR_BODY = "잠시 후 다시 시도해 주십시오."
    const val DETAIL_STALE = "최신 공지사항을 확인하지 못했습니다. 다시 확인하기 전까지 수정할 수 없습니다."

    const val DRAFT_HELP = "초안은 관리자만 확인할 수 있으며 이용자에게 공개되지 않습니다."
    const val SAVING = "초안을 저장하는 중입니다…"
    const val SAVED = "초안을 저장했습니다. 이용자에게 공개되지 않습니다."
    const val EDIT_LOADING = "작성 정보를 확인하는 중입니다…"
    const val FORM_EMPTY_HELP = "제목과 내용을 입력한 후 초안 저장을 선택하십시오."
    const val EDIT_MISSING_TITLE = "수정할 초안을 찾을 수 없습니다"
    const val EDIT_MISSING_BODY = "목록으로 돌아가 수정 가능한 초안을 확인해 주십시오."
    const val EDIT_ERROR_TITLE = "작성 정보를 확인하지 못했습니다"
    const val EDIT_ERROR_BODY = "잠시 후 다시 시도해 주십시오. 입력한 내용은 이 화면에서 유지됩니다."
    const val FIELD_TITLE_REQUIRED = "제목을 입력해 주십시오."
    const val FIELD_BODY_REQUIRED = "내용을 입력해 주십시오."
    const val FIELD_TOO_LONG = "허용된 글자 수를 초과했습니다."
    const val SAVE_ERROR = "초안을 저장하지 못했습니다. 입력 내용을 확인한 후 다시 시도해 주십시오."
    const val SAVE_NETWORK = "저장 결과를 확인하지 못했습니다. 연결 후 저장 결과 확인을 선택해 주십시오."
    const val CHECKING_SAVE = "저장 결과를 확인하는 중입니다…"
    const val SAVE_NOT_APPLIED = "초안이 저장되지 않은 것을 확인했습니다. 다시 저장할 수 있습니다."
    const val SAVE_UNCERTAIN = "저장 결과를 아직 확인하지 못했습니다. 다시 저장하지 말고 저장 결과를 확인해 주십시오."
    const val CONFLICT = "다른 관리자가 공지를 변경했습니다. 입력 내용을 보존한 상태로 최신 내용을 확인해 주십시오."
    const val LATEST_HEADING = "최신 저장 내용"
    const val MY_INPUT_HEADING = "현재 입력 내용"
    const val CONFLICT_RESOLVED = "최신 내용과 현재 입력 내용을 확인했습니다. 필요한 내용을 반영한 후 초안 저장을 선택하십시오."

    const val DISCARD_TITLE = "입력한 내용을 버리시겠습니까?"
    const val DISCARD_BODY = "저장하지 않은 내용은 사라집니다."

    const val SEOUL_TIME_NOTE = "한국 표준시 기준입니다."

    fun openNotice(title: String) = "$title 상세 보기"
    fun fieldLimit(max: Int) = "최대 ${max}자"
    fun fieldCount(count: Int, max: Int) = "$count/${max}자"
}

enum class NoticeStatus {
    DRAFT,
    PUBLISHED,
    HIDDEN,
    UNKNOWN;

    val label: String
        get() = when (this) {
            DRAFT -> NoticeText.STATUS_DRAFT
            PUBLISHED -> NoticeText.STATUS_PUBLISHED
            HIDDEN -> NoticeText.STATUS_HIDDEN
            UNKNOWN -> NoticeText.STATUS_UNKNOWN
        }
}

data class NoticeSummary(
    val id: String,
    val title: String,
    val status: NoticeStatus,
    val updatedAt: String?,
)

data class NoticeDetail(
    val id: String,
    val title: String,
    val body: String,
    val status: NoticeStatus,
    val createdAt: String?,
    val updatedAt: String?,
)

/** 실패 원인. CAPABILITY는 서버 계약이 아직 없다는 뜻이며 정상 0건이 아니다. */
enum class NoticeFailure { SERVER, NETWORK, CAPABILITY, DENIED }

enum class NoticeMore { IDLE, LOADING, FAILED }

sealed interface NoticeListState {
    data object Loading : NoticeListState
    data object Empty : NoticeListState
    data class Failed(val failure: NoticeFailure) : NoticeListState
    data class Ready(
        val rows: List<NoticeSummary>,
        val hasNext: Boolean = false,
        val more: NoticeMore = NoticeMore.IDLE,
        val moreFailure: NoticeFailure = NoticeFailure.SERVER,
        val stale: Boolean = false,
    ) : NoticeListState
}

sealed interface NoticeDetailState {
    data object Loading : NoticeDetailState
    data object Empty : NoticeDetailState
    data class Failed(val failure: NoticeFailure) : NoticeDetailState
    data class Ready(
        val notice: NoticeDetail,
        val editable: Boolean,
        val stale: Boolean = false,
    ) : NoticeDetailState
}

sealed interface NoticeEditState {
    data object Loading : NoticeEditState
    data object CapabilityLocked : NoticeEditState
    data object Missing : NoticeEditState
    data class Failed(val failure: NoticeFailure) : NoticeEditState
    data class Editing(
        val title: String = "",
        val body: String = "",
        val titleError: String? = null,
        val bodyError: String? = null,
        /** 서버가 내려준 승인 한도. 없으면 저장을 잠근다(§6). */
        val titleMax: Int? = null,
        val bodyMax: Int? = null,
        val changed: Boolean = false,
        val save: NoticeSave = NoticeSave.Idle,
    ) : NoticeEditState
}

sealed interface NoticeSave {
    data object Idle : NoticeSave
    data object Saving : NoticeSave
    data object Saved : NoticeSave
    data object Error : NoticeSave
    data object Network : NoticeSave
    data object Checking : NoticeSave
    data object NotApplied : NoticeSave
    data object Uncertain : NoticeSave
    data class Conflict(val latest: NoticeDetail, val latestVisible: Boolean) : NoticeSave
}

data class NoticeFormInput(val title: String, val body: String)

private val seoulZone: ZoneId = ZoneId.of("Asia/Seoul")
private val noticeTimeFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy.MM.dd HH:mm").withZone(seoulZone)

/** 서버 시각을 Asia/Seoul "YYYY.MM.DD HH:mm"으로 표시한다. 없는 시각은 채우지 않고 NO_VALUE다(§7). */
fun noticeTimeText(iso: String?): String {
    if (iso.isNullOrBlank()) return NoticeText.NO_VALUE
    return runCatching { noticeTimeFormat.format(Instant.parse(iso)) }.getOrDefault(NoticeText.NO_VALUE)
}

@Composable
fun NoticeCopy(
    text: String,
    modifier: Modifier = Modifier,
    size: Int = DesignTokens.type_body,
    bold: Boolean = false,
    color: Color = DesignTokens.navy,
    align: TextAlign = TextAlign.Start,
) {
    Text(
        text,
        modifier,
        color,
        fontSize = size.sp,
        fontFamily = LocalBrandFont.current,
        fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
        textAlign = align,
    )
}

@Composable
private fun NoticeProgress(text: String, tag: String) {
    Row(
        Modifier.fillMaxWidth().padding(DesignTokens.space_xl.dp).testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(Modifier.size(DesignTokens.space_lg.dp), color = DesignTokens.navy)
        NoticeCopy(text, Modifier.padding(start = DesignTokens.space_md.dp), color = DesignTokens.muted)
    }
}

/** 안내·실패 묶음: 제목 → 설명 → (보조 설명) → 행동. 실패를 색만으로 전달하지 않는다. */
@Composable
private fun NoticeMessage(
    title: String? = null,
    body: String,
    danger: Boolean = false,
    note: String? = null,
    tag: String,
    actions: @Composable () -> Unit = {},
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space_xl.dp, vertical = DesignTokens.space_2xl.dp).testTag(tag)) {
        if (title != null) {
            NoticeCopy(title, Modifier.semantics { heading() }, size = DesignTokens.type_subtitle, bold = true)
        }
        Box(
            Modifier.fillMaxWidth()
                .padding(top = if (title != null) DesignTokens.space_md.dp else 0.dp)
                .then(
                    if (danger) Modifier
                        .background(DesignTokens.dangerBg, RoundedCornerShape(DesignTokens.radius_md.dp))
                        .padding(DesignTokens.space_lg.dp)
                    else Modifier,
                ),
        ) {
            NoticeCopy(body, color = if (danger) DesignTokens.danger else DesignTokens.navy)
        }
        if (note != null) {
            NoticeCopy(note, Modifier.padding(top = DesignTokens.space_sm.dp), size = DesignTokens.type_caption, color = DesignTokens.muted)
        }
        Row(Modifier.padding(top = DesignTokens.space_lg.dp), horizontalArrangement = Arrangement.spacedBy(DesignTokens.space_sm.dp)) {
            actions()
        }
    }
}

/** 주요 버튼: navy 배경 / canvas 글자. 한 화면 한 개만 쓴다. */
@Composable
private fun NoticePrimaryButton(text: String, enabled: Boolean = true, tag: String, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.textButtonColors(
            containerColor = if (enabled) DesignTokens.navy else DesignTokens.track,
            contentColor = if (enabled) DesignTokens.canvas else DesignTokens.muted,
        ),
        shape = RoundedCornerShape(DesignTokens.radius_sm.dp),
        modifier = Modifier.heightIn(min = DesignTokens.touchAndroidMinDp.dp).testTag(tag),
    ) {
        NoticeCopy(text, size = DesignTokens.type_bodyStrong, bold = true, color = if (enabled) DesignTokens.canvas else DesignTokens.muted)
    }
}

/** 보조 버튼: canvas 배경 / navy 글자·경계. 경계는 기존 컴포넌트 기본을 상속한다. */
@Composable
private fun NoticeSecondaryButton(text: String, tag: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(DesignTokens.radius_sm.dp),
        modifier = Modifier.heightIn(min = DesignTokens.touchAndroidMinDp.dp).testTag(tag),
    ) {
        NoticeCopy(text, size = DesignTokens.type_bodyStrong, bold = true)
    }
}

@Composable
private fun NoticePageHeader(title: String, tag: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space_xl.dp, vertical = DesignTokens.space_md.dp)) {
        NoticeCopy(title, Modifier.semantics { heading() }.testTag(tag + "-title"), size = DesignTokens.type_title, bold = true)
    }
}

@Composable
private fun NoticeMetaLine(label: String, value: String, tag: String) {
    Column(Modifier.fillMaxWidth().padding(bottom = DesignTokens.space_md.dp).testTag(tag)) {
        NoticeCopy(label, size = DesignTokens.type_caption, color = DesignTokens.muted)
        NoticeCopy(value, Modifier.padding(top = DesignTokens.space_xs.dp), size = DesignTokens.type_body)
    }
}

// ── ADM_NOTICE_LIST ────────────────────────────────────────────────────────────

@Composable
fun AdminNoticeListScreen(
    state: NoticeListState,
    canCreate: Boolean,
    onBack: () -> Unit,
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
    onLoadMore: () -> Unit = {},
    onOpen: (String) -> Unit = {},
    onCreate: () -> Unit = {},
) {
    Column(Modifier.fillMaxSize().background(DesignTokens.canvas).testTag("notice-list")) {
        NoticePageHeader(NoticeText.LIST_TITLE, "notice-list")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            when (state) {
                NoticeListState.Loading -> NoticeProgress(NoticeText.LIST_LOADING, "notice-list-loading")

                NoticeListState.Empty -> NoticeMessage(
                    title = NoticeText.LIST_EMPTY_TITLE,
                    body = if (canCreate) NoticeText.LIST_EMPTY_BODY else NoticeText.LIST_EMPTY_READONLY,
                    tag = "notice-list-empty",
                ) {
                    if (canCreate) NoticePrimaryButton(NoticeText.CREATE, tag = "notice-list-create") { onCreate() }
                }

                is NoticeListState.Failed -> when (state.failure) {
                    NoticeFailure.NETWORK -> NoticeMessage(
                        title = NoticeText.NETWORK_TITLE, body = NoticeText.NETWORK_BODY, danger = true,
                        tag = "notice-list-network",
                    ) { NoticeSecondaryButton(NoticeText.RETRY, "notice-list-retry", onRetry) }

                    NoticeFailure.CAPABILITY -> NoticeMessage(
                        body = NoticeText.CAPABILITY_LOCK, tag = "notice-list-capability",
                    ) { NoticeSecondaryButton(NoticeText.RETRY, "notice-list-retry", onRetry) }

                    NoticeFailure.DENIED -> NoticeMessage(
                        title = NoticeText.DENIED_TITLE, body = NoticeText.DENIED_BODY, danger = true,
                        tag = "notice-list-denied",
                    ) { NoticeSecondaryButton(NoticeText.LIST_BACK, "notice-list-close", onBack) }

                    NoticeFailure.SERVER -> NoticeMessage(
                        title = NoticeText.LIST_ERROR_TITLE, body = NoticeText.LIST_ERROR_BODY, danger = true,
                        tag = "notice-list-error",
                    ) { NoticeSecondaryButton(NoticeText.RETRY, "notice-list-retry", onRetry) }
                }

                is NoticeListState.Ready -> {
                    if (state.stale) {
                        NoticeCopy(
                            NoticeText.LIST_STALE,
                            Modifier.padding(horizontal = DesignTokens.space_xl.dp, vertical = DesignTokens.space_sm.dp),
                            size = DesignTokens.type_caption, color = DesignTokens.muted,
                        )
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space_xl.dp, vertical = DesignTokens.space_sm.dp),
                        horizontalArrangement = Arrangement.spacedBy(DesignTokens.space_lg.dp),
                    ) {
                        NoticeCopy(NoticeText.COL_TITLE, Modifier.weight(1f), size = DesignTokens.type_caption, color = DesignTokens.muted)
                        NoticeCopy(NoticeText.COL_STATUS, size = DesignTokens.type_caption, color = DesignTokens.muted)
                        NoticeCopy(NoticeText.COL_UPDATED, size = DesignTokens.type_caption, color = DesignTokens.muted)
                    }
                    state.rows.forEach { row ->
                        Column(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space_xl.dp, vertical = DesignTokens.space_lg.dp)) {
                            NoticeCopy(
                                row.title,
                                Modifier.fillMaxWidth()
                                    .heightIn(min = DesignTokens.touchAndroidMinDp.dp)
                                    .clickable { onOpen(row.id) }
                                    .semantics { contentDescription = NoticeText.openNotice(row.title) }
                                    .testTag("notice-open-" + row.id),
                                size = DesignTokens.type_bodyStrong, bold = true,
                            )
                            // 좁은 폭에서는 표 한 행을 제목 → 상태 → 최종 수정일시의 선형 목록으로 보여준다(§3).
                            Row(Modifier.padding(top = DesignTokens.space_xs.dp), horizontalArrangement = Arrangement.spacedBy(DesignTokens.space_lg.dp)) {
                                NoticeCopy(row.status.label, size = DesignTokens.type_body)
                                NoticeCopy(noticeTimeText(row.updatedAt), size = DesignTokens.type_caption, color = DesignTokens.muted)
                            }
                        }
                        HorizontalDivider(color = DesignTokens.border)
                    }
                    when (state.more) {
                        NoticeMore.LOADING -> NoticeProgress(NoticeText.LIST_MORE_LOADING, "notice-list-more-loading")
                        NoticeMore.FAILED -> NoticeMessage(
                            body = if (state.moreFailure == NoticeFailure.NETWORK) NoticeText.NETWORK_BODY else NoticeText.LIST_MORE_ERROR,
                            danger = state.moreFailure != NoticeFailure.CAPABILITY,
                            tag = "notice-list-more-error",
                        ) { NoticeSecondaryButton(NoticeText.RETRY, "notice-list-more-retry", onLoadMore) }
                        NoticeMore.IDLE -> if (state.hasNext) {
                            Box(Modifier.padding(horizontal = DesignTokens.space_xl.dp)) {
                                NoticeSecondaryButton(NoticeText.NEXT, "notice-list-next", onLoadMore)
                            }
                        }
                    }
                    Column(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space_xl.dp, vertical = DesignTokens.space_2xl.dp)) {
                        NoticeCopy(NoticeText.PUBLISH_LOCK, size = DesignTokens.type_bodyStrong, bold = true)
                        NoticeCopy(NoticeText.PUBLISH_LOCK_BODY, Modifier.padding(top = DesignTokens.space_xs.dp), color = DesignTokens.muted)
                        if (canCreate) {
                            Box(Modifier.padding(top = DesignTokens.space_lg.dp)) {
                                NoticePrimaryButton(NoticeText.CREATE, tag = "notice-list-create") { onCreate() }
                            }
                        }
                    }
                }
            }
        }
        HorizontalDivider(color = DesignTokens.border)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space_xl.dp, vertical = DesignTokens.space_lg.dp),
            horizontalArrangement = Arrangement.spacedBy(DesignTokens.space_sm.dp),
        ) {
            NoticeSecondaryButton(NoticeText.LIST_BACK, "notice-list-close", onBack)
            NoticeSecondaryButton(NoticeText.REFRESH, "notice-list-refresh", onRefresh)
        }
    }
}

// ── ADM_NOTICE_DETAIL ──────────────────────────────────────────────────────────

@Composable
fun AdminNoticeDetailScreen(
    state: NoticeDetailState,
    onBack: () -> Unit,
    onRetry: () -> Unit = {},
    onEdit: () -> Unit = {},
) {
    Column(Modifier.fillMaxSize().background(DesignTokens.canvas).testTag("notice-detail")) {
        NoticePageHeader(NoticeText.DETAIL_TITLE, "notice-detail")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            when (state) {
                NoticeDetailState.Loading -> NoticeProgress(NoticeText.DETAIL_LOADING, "notice-detail-loading")

                NoticeDetailState.Empty -> NoticeMessage(
                    title = NoticeText.DETAIL_EMPTY_TITLE, body = NoticeText.DETAIL_EMPTY_BODY, tag = "notice-detail-empty",
                )

                is NoticeDetailState.Failed -> when (state.failure) {
                    NoticeFailure.DENIED -> NoticeMessage(
                        title = NoticeText.DENIED_TITLE, body = NoticeText.DENIED_BODY, danger = true,
                        tag = "notice-detail-denied",
                    ) { NoticeSecondaryButton(NoticeText.LIST_BACK, "notice-detail-close", onBack) }

                    else -> NoticeMessage(
                        title = if (state.failure == NoticeFailure.NETWORK) NoticeText.NETWORK_TITLE else NoticeText.DETAIL_ERROR_TITLE,
                        body = if (state.failure == NoticeFailure.NETWORK) NoticeText.NETWORK_BODY else NoticeText.DETAIL_ERROR_BODY,
                        danger = true,
                        tag = "notice-detail-error",
                    ) { NoticeSecondaryButton(NoticeText.RETRY, "notice-detail-retry", onRetry) }
                }

                is NoticeDetailState.Ready -> {
                    val notice = state.notice
                    if (state.stale) {
                        NoticeMessage(
                            body = NoticeText.DETAIL_STALE, danger = true, tag = "notice-detail-stale",
                        ) { NoticeSecondaryButton(NoticeText.RETRY, "notice-detail-retry", onRetry) }
                    }
                    Column(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space_xl.dp)) {
                        NoticeCopy(notice.title, Modifier.testTag("notice-detail-heading"), size = DesignTokens.type_subtitle, bold = true)
                        Column(Modifier.padding(top = DesignTokens.space_lg.dp)) {
                            NoticeMetaLine(NoticeText.META_STATUS, notice.status.label, "notice-detail-status")
                            NoticeMetaLine(NoticeText.META_CREATED, noticeTimeText(notice.createdAt), "notice-detail-created")
                            NoticeMetaLine(NoticeText.META_UPDATED, noticeTimeText(notice.updatedAt), "notice-detail-updated")
                            NoticeCopy(NoticeText.SEOUL_TIME_NOTE, Modifier.padding(top = DesignTokens.space_sm.dp), size = DesignTokens.type_caption, color = DesignTokens.muted)
                        }
                        NoticeCopy(NoticeText.CONTENT_HEADING, Modifier.padding(top = DesignTokens.space_2xl.dp).semantics { heading() }, size = DesignTokens.type_subtitle, bold = true)
                        // 본문은 서버 원문 그대로다. HTML 해석·자동 링크·말줄임을 하지 않는다.
                        NoticeCopy(notice.body, Modifier.fillMaxWidth().padding(top = DesignTokens.space_sm.dp), size = DesignTokens.type_body)
                        when (notice.status) {
                            NoticeStatus.DRAFT -> Unit
                            NoticeStatus.UNKNOWN -> NoticeCopy(NoticeText.UNSUPPORTED_BODY, Modifier.padding(top = DesignTokens.space_2xl.dp), color = DesignTokens.muted)
                            else -> NoticeCopy(NoticeText.READONLY_BODY, Modifier.padding(top = DesignTokens.space_2xl.dp), color = DesignTokens.muted)
                        }
                    }
                }
            }
        }
        HorizontalDivider(color = DesignTokens.border)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space_xl.dp, vertical = DesignTokens.space_lg.dp),
            horizontalArrangement = Arrangement.spacedBy(DesignTokens.space_sm.dp),
        ) {
            NoticeSecondaryButton(NoticeText.LIST_BACK, "notice-detail-close", onBack)
            val ready = state as? NoticeDetailState.Ready
            if (ready != null && ready.editable && !ready.stale && ready.notice.status == NoticeStatus.DRAFT) {
                NoticePrimaryButton(NoticeText.EDIT, tag = "notice-detail-edit") { onEdit() }
            }
        }
    }
}

// ── ADM_NOTICE_EDIT ────────────────────────────────────────────────────────────

@Composable
fun AdminNoticeEditScreen(
    state: NoticeEditState,
    createMode: Boolean,
    onBack: () -> Unit,
    onRetry: () -> Unit = {},
    onChange: (NoticeFormInput) -> Unit = {},
    onSave: () -> Unit = {},
    onCheckSave: () -> Unit = {},
    onViewLatest: () -> Unit = {},
    onKeepInput: () -> Unit = {},
    onUseLatest: () -> Unit = {},
) {
    var confirmingDiscard by remember { mutableStateOf(false) }
    val editing = state as? NoticeEditState.Editing
    val changed = editing?.changed == true

    BackHandler(enabled = changed) { confirmingDiscard = true }

    Column(Modifier.fillMaxSize().background(DesignTokens.canvas).testTag("notice-edit")) {
        NoticePageHeader(if (createMode) NoticeText.CREATE_TITLE else NoticeText.EDIT_TITLE, "notice-edit")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            when (state) {
                NoticeEditState.Loading -> NoticeProgress(NoticeText.EDIT_LOADING, "notice-edit-loading")

                NoticeEditState.CapabilityLocked -> NoticeMessage(
                    body = NoticeText.CAPABILITY_LOCK, tag = "notice-edit-capability",
                ) { NoticeSecondaryButton(NoticeText.RETRY, "notice-edit-retry", onRetry) }

                NoticeEditState.Missing -> NoticeMessage(
                    title = NoticeText.EDIT_MISSING_TITLE, body = NoticeText.EDIT_MISSING_BODY, tag = "notice-edit-missing",
                )

                is NoticeEditState.Failed -> NoticeMessage(
                    title = if (state.failure == NoticeFailure.NETWORK) NoticeText.NETWORK_TITLE else NoticeText.EDIT_ERROR_TITLE,
                    body = if (state.failure == NoticeFailure.NETWORK) NoticeText.NETWORK_BODY else NoticeText.EDIT_ERROR_BODY,
                    danger = true,
                    tag = "notice-edit-error",
                ) { NoticeSecondaryButton(NoticeText.RETRY, "notice-edit-retry", onRetry) }

                is NoticeEditState.Editing -> NoticeEditForm(
                    form = state,
                    onSave = onSave,
                    onCheckSave = onCheckSave,
                    onViewLatest = onViewLatest,
                    onKeepInput = onKeepInput,
                    onUseLatest = onUseLatest,
                    onChange = onChange,
                )
            }
        }
        HorizontalDivider(color = DesignTokens.border)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space_xl.dp, vertical = DesignTokens.space_lg.dp),
            horizontalArrangement = Arrangement.spacedBy(DesignTokens.space_sm.dp),
        ) {
            NoticeSecondaryButton(NoticeText.CANCEL, "notice-edit-cancel") {
                if (changed) confirmingDiscard = true else onBack()
            }
            val save = editing?.save ?: NoticeSave.Idle
            when {
                editing == null -> Unit
                save == NoticeSave.Network || save == NoticeSave.Uncertain -> NoticePrimaryButton(
                    NoticeText.CHECK_SAVE, tag = "notice-edit-check-save", onClick = onCheckSave,
                )
                save is NoticeSave.Conflict -> Unit
                else -> {
                    val valid = editing.title.isNotBlank() && editing.body.isNotBlank() &&
                        editing.titleError == null && editing.bodyError == null &&
                        editing.changed && editing.titleMax != null && editing.bodyMax != null
                    NoticePrimaryButton(
                        NoticeText.SAVE,
                        enabled = valid && (save == NoticeSave.Idle || save == NoticeSave.NotApplied),
                        tag = "notice-edit-save",
                        onClick = onSave,
                    )
                }
            }
        }
    }

    if (confirmingDiscard) {
        AlertDialog(
            onDismissRequest = { confirmingDiscard = false },
            containerColor = DesignTokens.canvas,
            shape = RoundedCornerShape(DesignTokens.radius_md.dp),
            title = { NoticeCopy(NoticeText.DISCARD_TITLE, size = DesignTokens.type_subtitle, bold = true) },
            text = { NoticeCopy(NoticeText.DISCARD_BODY) },
            confirmButton = {
                TextButton(onClick = { confirmingDiscard = false }, modifier = Modifier.heightIn(min = DesignTokens.touchAndroidMinDp.dp)) {
                    NoticeCopy(NoticeText.KEEP_EDITING, size = DesignTokens.type_bodyStrong, bold = true)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { confirmingDiscard = false; onBack() },
                    modifier = Modifier.heightIn(min = DesignTokens.touchAndroidMinDp.dp).testTag("notice-edit-discard"),
                ) {
                    NoticeCopy(NoticeText.DISCARD, size = DesignTokens.type_bodyStrong, bold = true)
                }
            },
        )
    }
}

@Composable
private fun NoticeEditForm(
    form: NoticeEditState.Editing,
    onChange: (NoticeFormInput) -> Unit,
    onSave: () -> Unit,
    onCheckSave: () -> Unit,
    onViewLatest: () -> Unit,
    onKeepInput: () -> Unit,
    onUseLatest: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.space_xl.dp, vertical = DesignTokens.space_lg.dp)) {
        NoticeCopy(NoticeText.DRAFT_HELP, color = DesignTokens.muted)

        // 승인된 필드 한도를 아직 받지 못하면 값을 지어내지 않고 저장을 잠근다(§6).
        if (form.titleMax == null || form.bodyMax == null) {
            NoticeMessage(body = NoticeText.WRITE_LOCK, danger = true, tag = "notice-edit-write-lock")
        }

        when (val save = form.save) {
            NoticeSave.Saving -> NoticeProgress(NoticeText.SAVING, "notice-edit-saving")
            NoticeSave.Saved -> NoticeCopy(NoticeText.SAVED, Modifier.padding(top = DesignTokens.space_md.dp), color = DesignTokens.navy)
            NoticeSave.Error -> NoticeMessage(body = NoticeText.SAVE_ERROR, danger = true, tag = "notice-edit-save-error")
            NoticeSave.Network -> NoticeMessage(body = NoticeText.SAVE_NETWORK, danger = true, tag = "notice-edit-save-network")
            NoticeSave.Checking -> NoticeProgress(NoticeText.CHECKING_SAVE, "notice-edit-checking")
            NoticeSave.NotApplied -> NoticeMessage(body = NoticeText.SAVE_NOT_APPLIED, tag = "notice-edit-not-applied")
            NoticeSave.Uncertain -> NoticeMessage(body = NoticeText.SAVE_UNCERTAIN, danger = true, tag = "notice-edit-uncertain")
            is NoticeSave.Conflict -> {
                NoticeMessage(body = NoticeText.CONFLICT, danger = true, tag = "notice-edit-conflict")
                if (!save.latestVisible) {
                    Box(Modifier.padding(horizontal = DesignTokens.space_xl.dp)) {
                        NoticeSecondaryButton(NoticeText.VIEW_LATEST, "notice-edit-view-latest", onViewLatest)
                    }
                } else {
                    NoticeCopy(NoticeText.LATEST_HEADING, Modifier.padding(top = DesignTokens.space_lg.dp), size = DesignTokens.type_subtitle, bold = true)
                    NoticeCopy(save.latest.title, Modifier.padding(top = DesignTokens.space_sm.dp), size = DesignTokens.type_bodyStrong, bold = true)
                    NoticeCopy(save.latest.body, Modifier.padding(top = DesignTokens.space_xs.dp))
                    NoticeCopy(NoticeText.MY_INPUT_HEADING, Modifier.padding(top = DesignTokens.space_2xl.dp), size = DesignTokens.type_subtitle, bold = true)
                    NoticeCopy(form.title, Modifier.padding(top = DesignTokens.space_sm.dp), size = DesignTokens.type_bodyStrong, bold = true)
                    NoticeCopy(form.body, Modifier.padding(top = DesignTokens.space_xs.dp))
                    NoticeCopy(NoticeText.CONFLICT_RESOLVED, Modifier.padding(top = DesignTokens.space_lg.dp), color = DesignTokens.muted)
                    Row(Modifier.padding(top = DesignTokens.space_md.dp), horizontalArrangement = Arrangement.spacedBy(DesignTokens.space_sm.dp)) {
                        NoticeSecondaryButton(NoticeText.KEEP_INPUT, "notice-edit-keep-input", onKeepInput)
                        NoticeSecondaryButton(NoticeText.USE_LATEST, "notice-edit-use-latest", onUseLatest)
                    }
                }
            }
            NoticeSave.Idle -> Unit
        }

        if (form.title.isBlank() && form.body.isBlank() && form.titleError == null && form.bodyError == null) {
            NoticeCopy(NoticeText.FORM_EMPTY_HELP, Modifier.padding(top = DesignTokens.space_md.dp), color = DesignTokens.muted)
        }

        NoticeField(
            label = NoticeText.LABEL_TITLE,
            value = form.title,
            placeholder = NoticeText.PLACEHOLDER_TITLE,
            error = form.titleError,
            limit = form.titleMax,
            singleLine = true,
            tag = "notice-edit-title",
            onChange = { onChange(NoticeFormInput(it, form.body)) },
        )
        NoticeField(
            label = NoticeText.LABEL_BODY,
            value = form.body,
            placeholder = NoticeText.PLACEHOLDER_BODY,
            error = form.bodyError,
            limit = form.bodyMax,
            singleLine = false,
            tag = "notice-edit-body",
            onChange = { onChange(NoticeFormInput(form.title, it)) },
        )
        Column(Modifier.padding(top = DesignTokens.space_2xl.dp)) {
            NoticeCopy(NoticeText.PUBLISH_LOCK, size = DesignTokens.type_bodyStrong, bold = true)
            NoticeCopy(NoticeText.PUBLISH_LOCK_BODY, Modifier.padding(top = DesignTokens.space_xs.dp), color = DesignTokens.muted)
        }
    }
}

/** 레이블 → 필수/한도 → 입력 → (오류). 오류는 해당 입력 바로 아래에 둔다(§6). */
@Composable
private fun NoticeField(
    label: String,
    value: String,
    placeholder: String,
    error: String?,
    limit: Int?,
    singleLine: Boolean,
    tag: String,
    onChange: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(top = DesignTokens.space_2xl.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DesignTokens.space_sm.dp)) {
            NoticeCopy(label, size = DesignTokens.type_bodyStrong, bold = true)
            NoticeCopy(NoticeText.REQUIRED, size = DesignTokens.type_caption, color = DesignTokens.muted)
        }
        if (limit != null) {
            NoticeCopy(NoticeText.fieldLimit(limit), Modifier.padding(top = DesignTokens.space_xs.dp), size = DesignTokens.type_caption, color = DesignTokens.muted)
        }
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            modifier = Modifier.fillMaxWidth().padding(top = DesignTokens.space_sm.dp).testTag(tag),
            placeholder = { NoticeCopy(placeholder, color = DesignTokens.muted) },
            singleLine = singleLine,
            minLines = if (singleLine) 1 else 6,
            isError = error != null,
            keyboardOptions = KeyboardOptions(imeAction = if (singleLine) ImeAction.Next else ImeAction.Default),
            shape = RoundedCornerShape(DesignTokens.radius_sm.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = DesignTokens.canvas,
                unfocusedContainerColor = DesignTokens.canvas,
                focusedBorderColor = DesignTokens.navy,
                unfocusedBorderColor = DesignTokens.border,
                errorBorderColor = DesignTokens.danger,
                focusedTextColor = DesignTokens.navy,
                unfocusedTextColor = DesignTokens.navy,
            ),
        )
        if (limit != null) {
            NoticeCopy(
                NoticeText.fieldCount(value.length, limit),
                Modifier.fillMaxWidth().padding(top = DesignTokens.space_xs.dp),
                size = DesignTokens.type_caption, color = DesignTokens.muted, align = TextAlign.End,
            )
        }
        if (error != null) {
            NoticeCopy(error, Modifier.padding(top = DesignTokens.space_xs.dp), size = DesignTokens.type_caption, color = DesignTokens.danger)
        }
    }
}
