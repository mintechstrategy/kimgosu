package ai.mintech.kimgosu.customer

import ai.mintech.kimgosu.expert.expertFont
import ai.mintech.kimgosu.ui.DesignTokens
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

/**
 * 문구 정본은 design/report-block/screens.md 다. 클라이언트가 새 문구를 만들지 않는다.
 * 서버 계약(길이·허용문자·접수/차단/해제 경로)이 없으므로 REASON_TOO_LONG·REASON_INVALID는
 * 쓰지 않는다(spec.md §7 G2).
 */
internal object ReportBlockStrings {
    const val R_ENTRY = "신고하기"
    const val B_ENTRY = "차단하기"
    const val CLOSE = "닫기"
    const val CANCEL = "취소"
    const val DONE = "확인"
    const val TARGET_LABEL = "대상"
    const val RETRY = "다시 시도"
    const val CHECK_RESULT = "처리 결과 확인"
    const val BACK_CHAT_LIST = "채팅 목록으로"
    const val SUPPORT = "고객센터"
    const val LOAD_ERROR = "불러오지 못했습니다. 다시 시도해 주십시오."
    const val NETWORK_ERROR = "네트워크에 연결할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주십시오."
    const val UNKNOWN = "처리 결과를 확인하지 못했습니다. 다시 실행하기 전에 처리 결과를 확인해 주십시오."
    const val NETWORK_UNKNOWN = "네트워크 연결이 끊겨 처리 결과를 확인하지 못했습니다. 연결 후 처리 결과를 확인해 주십시오."
    const val U_TARGET = "이 대화를 이용할 수 없습니다. 채팅 목록으로 돌아가 주십시오."
    const val PREPARING = "이 기능을 준비 중입니다. 잠시 후 다시 확인해 주십시오."

    const val R_TITLE = "대화 신고"
    const val R_SCOPE = "현재 대화와 상대방을 신고합니다."
    const val REASON_LABEL = "신고 사유 (필수)"
    const val REASON_PLACEHOLDER = "신고 사유를 입력해 주십시오."
    const val R_HELP = "신고 사유를 입력한 뒤 내용을 확인해 주십시오."
    const val REASON_REQUIRED = "신고 사유를 입력해 주십시오. 공백만 입력할 수 없습니다."
    const val R_REVIEW = "신고 내용 확인"
    const val R_REVIEW_TITLE = "신고 내용 확인"
    const val R_FINAL_NOTE = "접수 후에는 이 화면에서 신고를 취소할 수 없습니다. 신고만으로 상대방이 차단되지는 않습니다."
    const val R_SUBMIT = "신고 접수하기"
    const val EDIT_REASON = "사유 수정"
    const val R_LOADING = "신고 대상을 확인하고 있습니다."
    const val R_SENDING = "신고를 접수하고 있습니다."
    const val R_SEND_ERROR = "신고를 접수하지 못했습니다. 입력한 내용을 확인한 뒤 다시 시도해 주십시오."
    const val R_DONE_TITLE = "신고가 접수되었습니다"
    const val R_DONE_BODY = "접수된 내용은 확인 절차에 따라 검토됩니다. 상대방은 차단되지 않았습니다."
    const val DISCARD_TITLE = "신고 작성을 그만두시겠습니까?"
    const val DISCARD_BODY = "입력한 신고 사유는 저장되지 않습니다."
    const val KEEP_EDIT = "계속 작성"
    const val DISCARD = "작성 그만두기"

    const val B_TITLE = "상대방을 차단하시겠습니까?"
    const val B_SCOPE = "차단하면 이 대화에서 서로 메시지를 보낼 수 없습니다."
    const val B_HISTORY = "이전 대화의 열람 범위는 이용 권한에 따라 달라집니다. 차단은 해제할 수 있습니다."
    const val B_CONFIRM = "차단하기"
    const val B_LOADING = "차단 대상을 확인하고 있습니다."
    const val B_SAVING = "차단하고 있습니다."
    const val B_SEND_ERROR = "차단하지 못했습니다. 다시 시도해 주십시오."

    const val BLOCKED_TITLE = "대화가 제한되었습니다"
    const val BLOCKED_SELF = "상대방을 차단하여 메시지를 보낼 수 없습니다."
    const val BLOCKED_OTHER = "현재 이 대화에서 메시지를 보낼 수 없습니다."
    const val BLOCKED_LOADING = "대화 이용 상태를 확인하고 있습니다."
    const val HISTORY_EMPTY = "표시할 이전 대화가 없습니다"
    const val HISTORY_NEXT = "신고하거나 고객센터에 문의할 수 있습니다."
    const val HISTORY_UNAVAILABLE = "이전 대화를 표시할 수 없습니다. 도움이 필요하면 고객센터에 문의해 주십시오."
    const val HISTORY_ERROR = "이전 대화를 불러오지 못했습니다. 다시 시도해 주십시오."
    const val RETRY_HISTORY = "이전 대화 다시 불러오기"
    const val UNBLOCK = "차단 해제"
    const val UNBLOCK_TITLE = "차단을 해제하시겠습니까?"
    const val UNBLOCK_NOTE = "해제 후 이용 권한을 다시 확인합니다. 보내지 않은 메시지는 자동으로 전송되지 않습니다."
    const val UNBLOCK_CONFIRM = "차단 해제하기"
    const val UNBLOCK_SAVING = "차단을 해제하고 있습니다."
    const val UNBLOCK_ERROR = "차단을 해제하지 못했습니다. 다시 시도해 주십시오."

    fun targetA11y(subject: String) = "대상: $subject"
}

internal enum class WriteProblem { FAILED, UNKNOWN, NETWORK_UNKNOWN }

internal sealed interface GatewayResult<out T> {
    data class Ok<T>(val value: T) : GatewayResult<T>
    data object Unsupported : GatewayResult<Nothing>
    data object Failed : GatewayResult<Nothing>
    data object Unknown : GatewayResult<Nothing>
    data object Offline : GatewayResult<Nothing>
}

internal data class ConversationTarget(val displayName: String, val alreadyBlockedByMe: Boolean)
internal data class BlockState(val blockedByMe: Boolean, val historyAllowed: Boolean, val history: List<CustomerMessage>)

/**
 * 신고·차단 서버 계약이 아직 확정되지 않았다(spec.md §7 G1/G2). 경로·필드를 이 레인에서
 * 만들지 않고, 서버가 붙으면 이 인터페이스만 구현한다. 구현이 없으면 쓰기는 PREPARING으로 잠근다.
 */
internal interface ReportBlockGateway {
    suspend fun loadTarget(ledgerId: String): GatewayResult<ConversationTarget>
    suspend fun submitReport(ledgerId: String, reason: String): GatewayResult<Unit>
    suspend fun reportReceipt(ledgerId: String): GatewayResult<Boolean>
    suspend fun block(ledgerId: String): GatewayResult<Unit>
    suspend fun blockState(ledgerId: String): GatewayResult<BlockState>
    suspend fun unblock(ledgerId: String): GatewayResult<Unit>
}

internal object UnavailableReportBlockGateway : ReportBlockGateway {
    override suspend fun loadTarget(ledgerId: String) = GatewayResult.Unsupported
    override suspend fun submitReport(ledgerId: String, reason: String) = GatewayResult.Unsupported
    override suspend fun reportReceipt(ledgerId: String) = GatewayResult.Unsupported
    override suspend fun block(ledgerId: String) = GatewayResult.Unsupported
    override suspend fun blockState(ledgerId: String) = GatewayResult.Unsupported
    override suspend fun unblock(ledgerId: String) = GatewayResult.Unsupported
}

internal sealed interface ChatSafetyOverlay {
    data object None : ChatSafetyOverlay
    data class Report(val subject: String) : ChatSafetyOverlay
    data class Block(val subject: String) : ChatSafetyOverlay
    data class Blocked(val subject: String) : ChatSafetyOverlay
}

internal sealed interface ReportSheetState {
    data object Loading : ReportSheetState
    data object TargetUnavailable : ReportSheetState
    data class LoadFailed(val network: Boolean) : ReportSheetState
    data class Form(val subject: String, val reason: String, val showReasonError: Boolean, val preparing: Boolean) : ReportSheetState
    data class Review(val subject: String, val reason: String, val preparing: Boolean) : ReportSheetState
    data class Sending(val subject: String, val reason: String) : ReportSheetState
    data class Done(val subject: String) : ReportSheetState
    data class Discard(val subject: String, val reason: String) : ReportSheetState
    data class SubmitFailed(val subject: String, val reason: String, val problem: WriteProblem) : ReportSheetState
}

internal class ChatReportModel(private val gateway: ReportBlockGateway) {
    var state by mutableStateOf<ReportSheetState>(ReportSheetState.Loading); private set
    private var reason = ""

    suspend fun load(ledgerId: String, subject: String) {
        reason = ""
        state = ReportSheetState.Loading
        when (val result = gateway.loadTarget(ledgerId)) {
            is GatewayResult.Ok -> state = form(result.value.displayName, preparing = false)
            GatewayResult.Unsupported -> state = form(subject, preparing = true)
            GatewayResult.Offline -> state = ReportSheetState.LoadFailed(network = true)
            GatewayResult.Failed, GatewayResult.Unknown -> state = ReportSheetState.LoadFailed(network = false)
        }
    }

    private fun form(subject: String, preparing: Boolean): ReportSheetState =
        if (subject.isBlank()) ReportSheetState.TargetUnavailable
        else ReportSheetState.Form(subject, reason, showReasonError = false, preparing = preparing)

    fun onReasonChange(text: String) {
        reason = text
        val current = state as? ReportSheetState.Form ?: return
        state = current.copy(reason = text, showReasonError = text.isBlank())
    }

    fun review() {
        val current = state as? ReportSheetState.Form ?: return
        if (reason.isBlank()) {
            state = current.copy(showReasonError = true)
            return
        }
        state = ReportSheetState.Review(current.subject, reason, current.preparing)
    }

    fun edit() {
        val current = state as? ReportSheetState.Review ?: return
        state = ReportSheetState.Form(current.subject, current.reason, showReasonError = false, preparing = current.preparing)
    }

    fun requestDiscard(): Boolean {
        val current = state as? ReportSheetState.Form ?: return false
        if (current.reason.isBlank()) return false
        state = ReportSheetState.Discard(current.subject, current.reason)
        return true
    }

    fun keepEditing() {
        val current = state as? ReportSheetState.Discard ?: return
        state = ReportSheetState.Form(current.subject, current.reason, showReasonError = false, preparing = false)
    }

    suspend fun submit(ledgerId: String) {
        val current = state as? ReportSheetState.Review ?: return
        if (current.preparing) return
        state = ReportSheetState.Sending(current.subject, current.reason)
        state = when (val result = gateway.submitReport(ledgerId, current.reason)) {
            is GatewayResult.Ok -> ReportSheetState.Done(current.subject)
            GatewayResult.Unsupported -> ReportSheetState.Review(current.subject, current.reason, preparing = true)
            GatewayResult.Failed -> ReportSheetState.SubmitFailed(current.subject, current.reason, WriteProblem.FAILED)
            GatewayResult.Offline -> ReportSheetState.SubmitFailed(current.subject, current.reason, WriteProblem.NETWORK_UNKNOWN)
            GatewayResult.Unknown -> ReportSheetState.SubmitFailed(current.subject, current.reason, WriteProblem.UNKNOWN)
        }
    }

    fun retry() {
        val current = state as? ReportSheetState.SubmitFailed ?: return
        state = ReportSheetState.Review(current.subject, current.reason, preparing = false)
    }

    suspend fun checkResult(ledgerId: String) {
        val current = state as? ReportSheetState.SubmitFailed ?: return
        state = when (val result = gateway.reportReceipt(ledgerId)) {
            is GatewayResult.Ok ->
                if (result.value) ReportSheetState.Done(current.subject)
                else ReportSheetState.Review(current.subject, current.reason, preparing = false)
            else -> current
        }
    }
}

internal sealed interface BlockConfirmState {
    data object Loading : BlockConfirmState
    data object TargetUnavailable : BlockConfirmState
    data class LoadFailed(val network: Boolean) : BlockConfirmState
    data class Ready(
        val subject: String,
        val preparing: Boolean,
        val saving: Boolean,
        val problem: WriteProblem?,
    ) : BlockConfirmState
}

internal class ChatBlockConfirmModel(private val gateway: ReportBlockGateway) {
    var state by mutableStateOf<BlockConfirmState>(BlockConfirmState.Loading); private set
    var blockedConfirmed by mutableStateOf(false); private set

    /** 이미 본인이 차단한 대화면 true를 돌려주고 호출자가 CHAT_BLOCKED로 이동한다. */
    suspend fun load(ledgerId: String, subject: String): Boolean {
        state = BlockConfirmState.Loading
        return when (val result = gateway.loadTarget(ledgerId)) {
            is GatewayResult.Ok -> {
                if (result.value.alreadyBlockedByMe) {
                    true
                } else {
                    state = BlockConfirmState.Ready(result.value.displayName, preparing = false, saving = false, problem = null)
                    false
                }
            }
            GatewayResult.Unsupported ->
                if (subject.isBlank()) {
                    state = BlockConfirmState.TargetUnavailable
                    false
                } else {
                    state = BlockConfirmState.Ready(subject, preparing = true, saving = false, problem = null)
                    false
                }
            GatewayResult.Offline -> { state = BlockConfirmState.LoadFailed(network = true); false }
            GatewayResult.Failed, GatewayResult.Unknown -> { state = BlockConfirmState.LoadFailed(network = false); false }
        }
    }

    suspend fun confirm(ledgerId: String) {
        val current = state as? BlockConfirmState.Ready ?: return
        if (current.preparing || current.saving) return
        state = current.copy(saving = true, problem = null)
        val result = gateway.block(ledgerId)
        state = when (result) {
            is GatewayResult.Ok -> { blockedConfirmed = true; current.copy(saving = false) }
            GatewayResult.Unsupported -> current.copy(preparing = true, saving = false)
            GatewayResult.Failed -> current.copy(saving = false, problem = WriteProblem.FAILED)
            GatewayResult.Offline -> current.copy(saving = false, problem = WriteProblem.NETWORK_UNKNOWN)
            GatewayResult.Unknown -> current.copy(saving = false, problem = WriteProblem.UNKNOWN)
        }
    }

    suspend fun checkResult(ledgerId: String) {
        val current = state as? BlockConfirmState.Ready ?: return
        state = when (val result = gateway.blockState(ledgerId)) {
            is GatewayResult.Ok ->
                if (result.value.blockedByMe) { blockedConfirmed = true; current.copy(saving = false) }
                else current.copy(problem = null)
            else -> current
        }
    }
}

internal sealed interface BlockedState {
    data object Loading : BlockedState
    data class LoadFailed(val network: Boolean) : BlockedState
    data class Ready(
        val subject: String,
        val blockedByMe: Boolean,
        val history: List<CustomerMessage>?,
        val historyError: Boolean,
        val unblockConfirm: Boolean,
        val unblockSaving: Boolean,
        val unblockProblem: WriteProblem?,
    ) : BlockedState
}

internal class ChatBlockedModel(private val gateway: ReportBlockGateway) {
    var state by mutableStateOf<BlockedState>(BlockedState.Loading); private set
    var restored by mutableStateOf(false); private set
    private var ledgerId = ""
    private var subject = ""
    private var blockedByMe = true

    suspend fun load(ledgerId: String, subject: String, blockedByMe: Boolean) {
        this.ledgerId = ledgerId
        this.subject = subject
        this.blockedByMe = blockedByMe
        state = BlockedState.Loading
        when (val result = gateway.blockState(ledgerId)) {
            is GatewayResult.Ok -> state = ready(
                blockedByMe = result.value.blockedByMe,
                history = if (result.value.historyAllowed) result.value.history else null,
                historyError = false,
            )
            // 차단 확정 자체가 서버 응답이므로 게이트웨이가 없으면 기록 열람은 확인할 수 없다.
            GatewayResult.Unsupported -> state = ready(blockedByMe, history = null, historyError = false)
            GatewayResult.Offline -> state = BlockedState.LoadFailed(network = true)
            GatewayResult.Failed, GatewayResult.Unknown -> state = BlockedState.LoadFailed(network = false)
        }
    }

    private fun ready(blockedByMe: Boolean, history: List<CustomerMessage>?, historyError: Boolean) =
        BlockedState.Ready(
            subject = subject,
            blockedByMe = blockedByMe,
            history = history,
            historyError = historyError,
            unblockConfirm = false,
            unblockSaving = false,
            unblockProblem = null,
        )

    suspend fun retryHistory() {
        val current = state as? BlockedState.Ready ?: return
        when (val result = gateway.blockState(ledgerId)) {
            is GatewayResult.Ok -> state = current.copy(
                history = if (result.value.historyAllowed) result.value.history else null,
                historyError = false,
            )
            GatewayResult.Failed, GatewayResult.Unknown -> state = current.copy(historyError = true)
            GatewayResult.Offline -> state = BlockedState.LoadFailed(network = true)
            GatewayResult.Unsupported -> state = current.copy(history = null, historyError = false)
        }
    }

    fun askUnblock() {
        val current = state as? BlockedState.Ready ?: return
        state = current.copy(unblockConfirm = true, unblockProblem = null)
    }

    fun cancelUnblock() {
        val current = state as? BlockedState.Ready ?: return
        state = current.copy(unblockConfirm = false, unblockProblem = null)
    }

    suspend fun unblock() {
        val current = state as? BlockedState.Ready ?: return
        if (current.unblockSaving) return
        state = current.copy(unblockSaving = true, unblockProblem = null)
        val result = gateway.unblock(ledgerId)
        state = when (result) {
            is GatewayResult.Ok -> { restored = true; current.copy(unblockConfirm = false, unblockSaving = false) }
            GatewayResult.Unsupported -> current.copy(unblockSaving = false, unblockProblem = WriteProblem.FAILED)
            GatewayResult.Failed -> current.copy(unblockSaving = false, unblockProblem = WriteProblem.FAILED)
            GatewayResult.Offline -> current.copy(unblockSaving = false, unblockProblem = WriteProblem.NETWORK_UNKNOWN)
            GatewayResult.Unknown -> current.copy(unblockSaving = false, unblockProblem = WriteProblem.UNKNOWN)
        }
    }

    suspend fun checkResult() {
        val current = state as? BlockedState.Ready ?: return
        state = when (val result = gateway.blockState(ledgerId)) {
            is GatewayResult.Ok ->
                if (result.value.blockedByMe) current.copy(unblockSaving = false, unblockProblem = null)
                else { restored = true; current.copy(unblockConfirm = false, unblockProblem = null) }
            else -> current
        }
    }

    suspend fun retryLoad() = load(ledgerId, subject, blockedByMe)
}

@Composable
internal fun ReportBlockText(
    text: String,
    modifier: Modifier = Modifier,
    size: TextUnit = DesignTokens.typeBodySize,
    weight: FontWeight = FontWeight.Normal,
    color: Color = DesignTokens.navy,
) {
    Text(text, modifier, color = color, fontSize = size, fontFamily = expertFont(), fontWeight = weight)
}

@Composable
private fun PrimaryAction(label: String, tag: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = DesignTokens.touchAndroidMinDp.dp).testTag(tag),
        enabled = enabled,
        shape = RoundedCornerShape(DesignTokens.radiusSm),
        colors = ButtonDefaults.buttonColors(
            containerColor = DesignTokens.navy,
            contentColor = DesignTokens.canvas,
            disabledContainerColor = DesignTokens.track,
            disabledContentColor = DesignTokens.muted,
        ),
    ) {
        ReportBlockText(label, size = DesignTokens.typeBodyStrongSize, weight = FontWeight.Bold, color = DesignTokens.canvas)
    }
}

@Composable
private fun SecondaryAction(label: String, tag: String, enabled: Boolean = true, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = DesignTokens.touchAndroidMinDp.dp).testTag(tag),
        enabled = enabled,
        shape = RoundedCornerShape(DesignTokens.radiusSm),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = DesignTokens.canvas,
            contentColor = DesignTokens.navy,
            disabledContentColor = DesignTokens.muted,
        ),
    ) {
        ReportBlockText(label, size = DesignTokens.typeBodyStrongSize, weight = FontWeight.Bold)
    }
}

@Composable
private fun StatusText(text: String, tag: String, error: Boolean = false) {
    ReportBlockText(
        text,
        Modifier.fillMaxWidth()
            .background(if (error) DesignTokens.dangerBg else Color.Transparent, RoundedCornerShape(DesignTokens.radiusSm))
            .padding(DesignTokens.spaceSm)
            .testTag(tag)
            .semantics { liveRegion = LiveRegionMode.Polite },
        color = if (error) DesignTokens.danger else DesignTokens.navy,
    )
}

@Composable
private fun ProgressLine(text: String, tag: String) {
    Row(Modifier.fillMaxWidth().padding(DesignTokens.spaceSm), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(DesignTokens.spaceXl), color = DesignTokens.navy)
        ReportBlockText(text, Modifier.padding(start = DesignTokens.spaceSm).testTag(tag), color = DesignTokens.muted)
    }
}

@Composable
private fun ProblemAction(problem: WriteProblem, errorText: String, onRetry: () -> Unit, onCheckResult: () -> Unit, tagPrefix: String) {
    when (problem) {
        WriteProblem.FAILED -> {
            StatusText(errorText, "$tagPrefix-failed", error = true)
            PrimaryAction(ReportBlockStrings.RETRY, "$tagPrefix-retry", onClick = onRetry)
        }
        WriteProblem.UNKNOWN -> {
            StatusText(ReportBlockStrings.UNKNOWN, "$tagPrefix-unknown", error = true)
            PrimaryAction(ReportBlockStrings.CHECK_RESULT, "$tagPrefix-check", onClick = onCheckResult)
        }
        WriteProblem.NETWORK_UNKNOWN -> {
            StatusText(ReportBlockStrings.NETWORK_UNKNOWN, "$tagPrefix-network-unknown", error = true)
            PrimaryAction(ReportBlockStrings.CHECK_RESULT, "$tagPrefix-check", onClick = onCheckResult)
        }
    }
}

@Composable
private fun TargetLine(subject: String) {
    ReportBlockText(
        ReportBlockStrings.TARGET_LABEL + "  " + subject,
        Modifier.fillMaxWidth().testTag("report-block-target").semantics {
            contentDescription = ReportBlockStrings.targetA11y(subject)
        },
        color = DesignTokens.navy,
        weight = FontWeight.Bold,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatReportSheet(
    model: ChatReportModel,
    ledgerId: String,
    onReasonChange: (String) -> Unit,
    onReview: () -> Unit,
    onEdit: () -> Unit,
    onSubmit: () -> Unit,
    onRetry: () -> Unit,
    onCheckResult: () -> Unit,
    onClose: () -> Unit,
    onDone: () -> Unit,
    onDiscard: () -> Unit,
    onKeepEdit: () -> Unit,
    onBackToList: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = sheetState,
        containerColor = DesignTokens.canvas,
        contentColor = DesignTokens.navy,
    ) {
        Column(Modifier.fillMaxWidth().safeDrawingPadding().padding(horizontal = DesignTokens.spaceXl)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                ReportBlockText(
                    when (val state = model.state) {
                        is ReportSheetState.Review, is ReportSheetState.Sending, is ReportSheetState.SubmitFailed -> ReportBlockStrings.R_REVIEW_TITLE
                        is ReportSheetState.Done -> ReportBlockStrings.R_DONE_TITLE
                        is ReportSheetState.Discard -> ReportBlockStrings.DISCARD_TITLE
                        else -> ReportBlockStrings.R_TITLE
                    },
                    Modifier.weight(1f).semantics { heading() },
                    size = DesignTokens.typeTitleSize,
                    weight = FontWeight.Bold,
                )
                TextButton(
                    onClick = { if (!model.requestDiscard()) onClose() },
                    modifier = Modifier.heightIn(min = DesignTokens.touchAndroidMinDp.dp).testTag("report-close"),
                ) { ReportBlockText(ReportBlockStrings.CLOSE, weight = FontWeight.Bold) }
            }
            Column(
                Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState())
                    .padding(vertical = DesignTokens.spaceMd),
                verticalArrangement = Arrangement.spacedBy(DesignTokens.spaceMd),
            ) {
                when (val state = model.state) {
                    ReportSheetState.Loading -> ProgressLine(ReportBlockStrings.R_LOADING, "report-loading")
                    ReportSheetState.TargetUnavailable -> {
                        StatusText(ReportBlockStrings.U_TARGET, "report-target-unavailable", error = true)
                        PrimaryAction(ReportBlockStrings.BACK_CHAT_LIST, "report-back-to-list", onClick = onBackToList)
                    }
                    is ReportSheetState.LoadFailed -> {
                        StatusText(
                            if (state.network) ReportBlockStrings.NETWORK_ERROR else ReportBlockStrings.LOAD_ERROR,
                            if (state.network) "report-network-error" else "report-load-error",
                            error = true,
                        )
                        PrimaryAction(ReportBlockStrings.RETRY, "report-load-retry", onClick = onRetry)
                        SecondaryAction(ReportBlockStrings.CLOSE, "report-load-close", onClick = onClose)
                    }
                    is ReportSheetState.Form -> {
                        TargetLine(state.subject)
                        ReportBlockText(ReportBlockStrings.R_SCOPE, color = DesignTokens.muted)
                        OutlinedTextField(
                            value = state.reason,
                            onValueChange = onReasonChange,
                            modifier = Modifier.fillMaxWidth().testTag("report-reason"),
                            label = { ReportBlockText(ReportBlockStrings.REASON_LABEL, color = DesignTokens.muted) },
                            placeholder = { ReportBlockText(ReportBlockStrings.REASON_PLACEHOLDER, color = DesignTokens.muted) },
                            textStyle = TextStyle(fontFamily = expertFont(), fontSize = DesignTokens.typeBodySize, color = DesignTokens.navy),
                            shape = RoundedCornerShape(DesignTokens.radiusSm),
                            isError = state.showReasonError,
                        )
                        if (state.showReasonError) StatusText(ReportBlockStrings.REASON_REQUIRED, "report-reason-required", error = true)
                        else ReportBlockText(ReportBlockStrings.R_HELP, Modifier.testTag("report-help"), size = DesignTokens.typeCaptionSize, color = DesignTokens.muted)
                        PrimaryAction(ReportBlockStrings.R_REVIEW, "report-review", enabled = state.reason.isNotBlank() && !state.preparing, onClick = onReview)
                        if (state.preparing) StatusText(ReportBlockStrings.PREPARING, "report-preparing", error = true)
                        SecondaryAction(ReportBlockStrings.CANCEL, "report-cancel", onClick = onClose)
                    }
                    is ReportSheetState.Review -> {
                        TargetLine(state.subject)
                        ReportBlockText(state.reason, Modifier.testTag("report-review-reason"))
                        ReportBlockText(ReportBlockStrings.R_FINAL_NOTE, Modifier.testTag("report-final-note"), size = DesignTokens.typeCaptionSize, color = DesignTokens.muted)
                        PrimaryAction(ReportBlockStrings.R_SUBMIT, "report-submit", enabled = !state.preparing, onClick = onSubmit)
                        if (state.preparing) StatusText(ReportBlockStrings.PREPARING, "report-preparing", error = true)
                        SecondaryAction(ReportBlockStrings.EDIT_REASON, "report-edit", onClick = onEdit)
                    }
                    is ReportSheetState.Sending -> ProgressLine(ReportBlockStrings.R_SENDING, "report-sending")
                    is ReportSheetState.Done -> {
                        StatusText(ReportBlockStrings.R_DONE_TITLE, "report-done-title")
                        ReportBlockText(ReportBlockStrings.R_DONE_BODY, Modifier.testTag("report-done-body"))
                        PrimaryAction(ReportBlockStrings.DONE, "report-done", onClick = onDone)
                    }
                    is ReportSheetState.Discard -> {
                        ReportBlockText(ReportBlockStrings.DISCARD_BODY, Modifier.testTag("report-discard-body"))
                        PrimaryAction(ReportBlockStrings.KEEP_EDIT, "report-keep-edit", onClick = onKeepEdit)
                        SecondaryAction(ReportBlockStrings.DISCARD, "report-discard", onClick = onDiscard)
                    }
                    is ReportSheetState.SubmitFailed -> {
                        TargetLine(state.subject)
                        ReportBlockText(state.reason, color = DesignTokens.muted)
                        ProblemAction(state.problem, ReportBlockStrings.R_SEND_ERROR, onRetry, onCheckResult, "report-send")
                        SecondaryAction(ReportBlockStrings.CANCEL, "report-submit-cancel", onClick = onClose)
                    }
                }
            }
        }
    }
}

@Composable
internal fun ChatBlockConfirmDialog(
    model: ChatBlockConfirmModel,
    onConfirm: () -> Unit,
    onRetry: () -> Unit,
    onCheckResult: () -> Unit,
    onCancel: () -> Unit,
    onBackToList: () -> Unit,
) {
    Dialog(onDismissRequest = onCancel) {
        Surface(shape = RoundedCornerShape(DesignTokens.radiusMd), color = DesignTokens.canvas, contentColor = DesignTokens.navy) {
            Column(
                Modifier.fillMaxWidth().padding(DesignTokens.spaceXl),
                verticalArrangement = Arrangement.spacedBy(DesignTokens.spaceMd),
            ) {
                ReportBlockText(
                    ReportBlockStrings.B_TITLE,
                    Modifier.semantics { heading() },
                    size = DesignTokens.typeTitleSize,
                    weight = FontWeight.Bold,
                )
                when (val state = model.state) {
                    BlockConfirmState.Loading -> ProgressLine(ReportBlockStrings.B_LOADING, "block-loading")
                    BlockConfirmState.TargetUnavailable -> {
                        StatusText(ReportBlockStrings.U_TARGET, "block-target-unavailable", error = true)
                        PrimaryAction(ReportBlockStrings.BACK_CHAT_LIST, "block-back-to-list", onClick = onBackToList)
                    }
                    is BlockConfirmState.LoadFailed -> {
                        StatusText(
                            if (state.network) ReportBlockStrings.NETWORK_ERROR else ReportBlockStrings.LOAD_ERROR,
                            if (state.network) "block-network-error" else "block-load-error",
                            error = true,
                        )
                        PrimaryAction(ReportBlockStrings.RETRY, "block-load-retry", onClick = onRetry)
                        SecondaryAction(ReportBlockStrings.CANCEL, "block-load-cancel", onClick = onCancel)
                    }
                    is BlockConfirmState.Ready -> {
                        TargetLine(state.subject)
                        if (state.preparing) {
                            StatusText(ReportBlockStrings.PREPARING, "block-preparing", error = true)
                        } else {
                            ReportBlockText(ReportBlockStrings.B_SCOPE, Modifier.testTag("block-scope"), color = DesignTokens.muted)
                            ReportBlockText(ReportBlockStrings.B_HISTORY, Modifier.testTag("block-history"), size = DesignTokens.typeCaptionSize, color = DesignTokens.muted)
                        }
                        if (state.problem == null) PrimaryAction(ReportBlockStrings.B_CONFIRM, "block-confirm", enabled = !state.preparing && !state.saving, onClick = onConfirm)
                        if (state.saving) ProgressLine(ReportBlockStrings.B_SAVING, "block-saving")
                        state.problem?.let { ProblemAction(it, ReportBlockStrings.B_SEND_ERROR, onRetry, onCheckResult, "block-send") }
                        SecondaryAction(ReportBlockStrings.CANCEL, "block-cancel", onClick = onCancel)
                    }
                }
            }
        }
    }
}

@Composable
internal fun ChatBlockedScreen(
    model: ChatBlockedModel,
    onReport: () -> Unit,
    onSupport: (() -> Unit)?,
    onBackToList: () -> Unit,
    onRetry: () -> Unit,
    onRetryHistory: () -> Unit,
    onUnblock: () -> Unit,
    onUnblockConfirm: () -> Unit,
    onUnblockCancel: () -> Unit,
    onCheckResult: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(DesignTokens.canvas).safeDrawingPadding().testTag("chat-blocked")) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = DesignTokens.spaceXl),
            verticalArrangement = Arrangement.spacedBy(DesignTokens.spaceMd),
        ) {
            ReportBlockText(
                ReportBlockStrings.BLOCKED_TITLE,
                Modifier.semantics { heading() },
                size = DesignTokens.typeTitleSize,
                weight = FontWeight.Bold,
            )
            when (val state = model.state) {
                BlockedState.Loading -> ProgressLine(ReportBlockStrings.BLOCKED_LOADING, "blocked-loading")
                is BlockedState.LoadFailed -> {
                    StatusText(
                        if (state.network) ReportBlockStrings.NETWORK_ERROR else ReportBlockStrings.LOAD_ERROR,
                        if (state.network) "blocked-network-error" else "blocked-load-error",
                        error = true,
                    )
                    PrimaryAction(ReportBlockStrings.RETRY, "blocked-load-retry", onClick = onRetry)
                }
                is BlockedState.Ready -> {
                    ReportBlockText(
                        if (state.blockedByMe) ReportBlockStrings.BLOCKED_SELF else ReportBlockStrings.BLOCKED_OTHER,
                        Modifier.testTag("blocked-reason"),
                        color = DesignTokens.muted,
                    )
                    if (state.historyError) {
                        StatusText(ReportBlockStrings.HISTORY_ERROR, "blocked-history-error", error = true)
                        PrimaryAction(ReportBlockStrings.RETRY_HISTORY, "blocked-history-retry", onClick = onRetryHistory)
                    } else {
                        val history = state.history
                        if (history == null) {
                            ReportBlockText(ReportBlockStrings.HISTORY_UNAVAILABLE, Modifier.testTag("blocked-history-unavailable"), color = DesignTokens.muted)
                        } else if (history.isEmpty()) {
                            ReportBlockText(ReportBlockStrings.HISTORY_EMPTY, Modifier.testTag("blocked-history-empty"), weight = FontWeight.Bold)
                            ReportBlockText(ReportBlockStrings.HISTORY_NEXT, color = DesignTokens.muted)
                        } else {
                            history.forEach { message -> BlockedMessage(message) }
                        }
                    }
                    state.unblockProblem?.let {
                        ProblemAction(it, ReportBlockStrings.UNBLOCK_ERROR, onUnblock, onCheckResult, "unblock")
                    }
                }
            }
        }
        Column(
            Modifier.fillMaxWidth().padding(DesignTokens.spaceXl),
            verticalArrangement = Arrangement.spacedBy(DesignTokens.spaceSm),
        ) {
            PrimaryAction(ReportBlockStrings.BACK_CHAT_LIST, "blocked-back-to-list", onClick = onBackToList)
            val ready = model.state as? BlockedState.Ready
            TextButton(
                onClick = onReport,
                modifier = Modifier.fillMaxWidth().heightIn(min = DesignTokens.touchAndroidMinDp.dp).testTag("blocked-report"),
            ) { ReportBlockText(ReportBlockStrings.R_ENTRY, weight = FontWeight.Bold) }
            if (onSupport != null) {
                TextButton(
                    onClick = onSupport,
                    modifier = Modifier.fillMaxWidth().heightIn(min = DesignTokens.touchAndroidMinDp.dp).testTag("blocked-support"),
                ) { ReportBlockText(ReportBlockStrings.SUPPORT, weight = FontWeight.Bold) }
            }
            if (ready != null && ready.blockedByMe) {
                TextButton(
                    onClick = onUnblock,
                    modifier = Modifier.fillMaxWidth().heightIn(min = DesignTokens.touchAndroidMinDp.dp).testTag("blocked-unblock"),
                    enabled = !ready.unblockSaving,
                ) { ReportBlockText(ReportBlockStrings.UNBLOCK, weight = FontWeight.Bold) }
            }
            if (ready != null && ready.unblockSaving) ProgressLine(ReportBlockStrings.UNBLOCK_SAVING, "blocked-unblock-saving")
        }
    }
    val current = model.state as? BlockedState.Ready
    if (current != null && current.unblockConfirm) {
        Dialog(onDismissRequest = onUnblockCancel) {
            Surface(shape = RoundedCornerShape(DesignTokens.radiusMd), color = DesignTokens.canvas, contentColor = DesignTokens.navy) {
                Column(
                    Modifier.fillMaxWidth().padding(DesignTokens.spaceXl),
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.spaceMd),
                ) {
                    ReportBlockText(ReportBlockStrings.UNBLOCK_TITLE, Modifier.semantics { heading() }, size = DesignTokens.typeTitleSize, weight = FontWeight.Bold)
                    ReportBlockText(ReportBlockStrings.UNBLOCK_NOTE, Modifier.testTag("unblock-note"), color = DesignTokens.muted)
                    PrimaryAction(ReportBlockStrings.UNBLOCK_CONFIRM, "unblock-confirm", enabled = !current.unblockSaving, onClick = onUnblockConfirm)
                    SecondaryAction(ReportBlockStrings.CANCEL, "unblock-cancel", onClick = onUnblockCancel)
                }
            }
        }
    }
}

@Composable
private fun BlockedMessage(message: CustomerMessage) {
    Column(
        Modifier.fillMaxWidth()
            .background(DesignTokens.track, RoundedCornerShape(DesignTokens.radiusSm))
            .padding(DesignTokens.spaceMd)
            .testTag("blocked-history-message"),
    ) {
        ReportBlockText(message.body.ifBlank { "삭제된 메시지" })
    }
}
