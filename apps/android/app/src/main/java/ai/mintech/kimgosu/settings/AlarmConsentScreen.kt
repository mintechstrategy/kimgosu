package ai.mintech.kimgosu.settings

import ai.mintech.kimgosu.ui.DesignTokens
import android.app.Application
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner

/** F4_NOTI·CONSENT_HISTORY·MARKETING_DOC와 두 모달. 진입 화면만 바깥에서 정한다. */
enum class ConsentStart { NOTIFICATIONS, HISTORY }

private enum class ConsentRoute { NOTIFICATIONS, HISTORY, DOCUMENT }

@Composable
fun AlarmConsentScreen(start: ConsentStart, onExit: () -> Unit) {
    val context = LocalContext.current
    val owner = context as? ViewModelStoreOwner
    val model = remember(owner, context) {
        if (owner != null) ViewModelProvider(owner)[AlarmConsentModel::class.java]
        else AlarmConsentModel(context.applicationContext as Application)
    }
    val font = brandFont()
    val view = LocalView.current
    var route by remember { mutableStateOf(if (start == ConsentStart.HISTORY) ConsentRoute.HISTORY else ConsentRoute.NOTIFICATIONS) }
    var documentReturn by remember { mutableStateOf(ConsentRoute.HISTORY) }

    // OS 설정에서 돌아오면 로컬 권한만 다시 읽는다. 선호·동의는 바꾸지 않는다.
    DisposableEffect(context) {
        val lifecycle = (context as? LifecycleOwner)?.lifecycle
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) model.refreshOsPermission()
        }
        lifecycle?.addObserver(observer)
        onDispose { lifecycle?.removeObserver(observer) }
    }
    LaunchedEffect(Unit) {
        model.refreshOsPermission()
        // 진입·복귀 시 최신 선호·동의를 다시 읽는다. 쓰기 처리 중에는 조회로 취소하지 않는다.
        if (!model.writesLocked) model.load()
    }
    // 저장 확정·철회 완료는 화면 요소를 늘리지 않고 한 번만 읽어 준다.
    LaunchedEffect(model.edit) {
        val saved = model.edit as? Edit.Saved ?: return@LaunchedEffect
        view.announceForAccessibility(AlarmConsentStrings.S_SAVED)
    }

    val back: () -> Unit = {
        when (route) {
            ConsentRoute.DOCUMENT -> route = documentReturn
            ConsentRoute.HISTORY -> if (start == ConsentStart.HISTORY) onExit() else route = ConsentRoute.NOTIFICATIONS
            ConsentRoute.NOTIFICATIONS -> onExit()
        }
    }
    BackHandler(enabled = model.permission != null) { model.dismissPermission() }
    BackHandler(enabled = model.withdraw != Withdraw.Closed) { model.dismissWithdraw() }
    BackHandler(enabled = model.permission == null && model.withdraw == Withdraw.Closed) { back() }

    Column(Modifier.fillMaxSize().background(ConsentTokens.background)) {
        when (route) {
            ConsentRoute.NOTIFICATIONS -> NotificationsScreen(model, font, back,
                onOpenHistory = { route = ConsentRoute.HISTORY })
            ConsentRoute.HISTORY -> HistoryScreen(model, font, back,
                onOpenDocument = { documentReturn = ConsentRoute.HISTORY; route = ConsentRoute.DOCUMENT; model.openDocument() })
            ConsentRoute.DOCUMENT -> DocumentScreen(model, font) { route = documentReturn }
        }
    }
    if (model.withdraw != Withdraw.Closed) WithdrawDialog(model, font)
    model.permission?.let { PermissionDialog(model, font, it) }
}

@Composable
private fun Header(title: String, font: FontFamily, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = ConsentTokens.screenHorizontal, vertical = ConsentTokens.headerVertical),
        verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack, modifier = Modifier.sizeIn(minWidth = ConsentTokens.touchMinimum, minHeight = ConsentTokens.touchMinimum)
            .semantics { contentDescription = AlarmConsentStrings.BACK }) {
            Txt("‹", font, ConsentTokens.stateTitle)
        }
        Spacer(Modifier.width(ConsentTokens.headerItemGap))
        Txt(title, font, ConsentTokens.screenTitle, bold = true, modifier = Modifier.semantics { heading() }.testTag("consent-title"))
        Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun ColumnScope.NotificationsScreen(model: AlarmConsentModel, font: FontFamily, onBack: () -> Unit,
                                            onOpenHistory: () -> Unit) {
    Header(AlarmConsentStrings.S_TITLE, font, onBack)
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())
        .padding(horizontal = ConsentTokens.screenHorizontal).padding(bottom = ConsentTokens.bodyVertical)) {
        Txt(AlarmConsentStrings.S_SECTION, font, ConsentTokens.stateTitle, bold = true, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(ConsentTokens.textGap))
        Txt(AlarmConsentStrings.S_DESCRIPTION, font, ConsentTokens.bodySize)
        Spacer(Modifier.height(ConsentTokens.stateTextGap))
        Txt(osLabel(model.os), font, ConsentTokens.metadata, color = ConsentTokens.secondaryText,
            modifier = Modifier.testTag("os-permission"))
        SecondaryButton(AlarmConsentStrings.S_OS_SETTINGS, font, model::openOsSettings)
        if (model.osError) {
            Txt(AlarmConsentStrings.S_OS_ERROR, font, ConsentTokens.bodySize, color = ConsentTokens.errorText,
                modifier = Modifier.padding(top = ConsentTokens.textGap))
            SecondaryButton(AlarmConsentStrings.RETRY, font, model::openOsSettings)
        }
        Spacer(Modifier.height(ConsentTokens.sectionGap))

        when (model.fetch) {
            Fetch.LOADING -> if (model.hasValues) PreferenceRows(model, font, locked = true)
                else StateBlock(AlarmConsentStrings.S_LOADING, font, progress = true)
            Fetch.EMPTY -> {
                StateBlock(AlarmConsentStrings.S_EMPTY, font)
                SecondaryButton(AlarmConsentStrings.RETRY, font, model::load)
            }
            Fetch.ERROR -> {
                StateBlock(AlarmConsentStrings.S_ERROR, font)
                SecondaryButton(AlarmConsentStrings.RETRY, font, model::load)
                if (model.hasValues) PreferenceRows(model, font, locked = true)
            }
            Fetch.OFFLINE -> {
                StateBlock(AlarmConsentStrings.S_OFFLINE, font)
                SecondaryButton(AlarmConsentStrings.RETRY, font, model::load)
                if (model.hasValues) PreferenceRows(model, font, locked = true)
            }
            Fetch.READY -> PreferenceRows(model, font, locked = false)
        }

        Spacer(Modifier.height(ConsentTokens.sectionGap))
        Txt(marketingLabel(model.marketing), font, ConsentTokens.rowTitle, bold = true,
            modifier = Modifier.testTag("marketing-status"))
        Spacer(Modifier.height(ConsentTokens.textGap))
        Txt(AlarmConsentStrings.S_MARKETING_DESCRIPTION, font, ConsentTokens.bodySize, color = ConsentTokens.secondaryText)
        Spacer(Modifier.height(ConsentTokens.stateTextGap))
        SecondaryButton(AlarmConsentStrings.S_CONSENT_HISTORY, font, onOpenHistory)
    }
}

private fun osLabel(permission: OsPermission) = when (permission) {
    OsPermission.ALLOWED -> AlarmConsentStrings.S_OS_ALLOWED
    OsPermission.DENIED -> AlarmConsentStrings.S_OS_DENIED
    OsPermission.UNDECIDED -> AlarmConsentStrings.S_OS_UNDECIDED
    OsPermission.UNKNOWN -> AlarmConsentStrings.S_OS_UNKNOWN
}

@Composable
private fun PreferenceRows(model: AlarmConsentModel, font: FontFamily, locked: Boolean) {
    val rows = listOf(
        "advertising" to AlarmConsentStrings.S_ADVERTISING,
        "chat" to AlarmConsentStrings.S_CHAT,
        "comment" to AlarmConsentStrings.S_COMMENT,
        "quote" to AlarmConsentStrings.S_QUOTE,
        "inquiry" to AlarmConsentStrings.S_INQUIRY,
    )
    rows.forEach { (key, label) ->
        val checked = model.values[key] == true
        val saving = (model.edit as? Edit.Saving)?.key == key
        val marketingBlocked = key == "advertising" && model.marketing != MarketingStatus.CONSENTED
        val disabled = locked || model.writesLocked || marketingBlocked
        Row(Modifier.fillMaxWidth().heightIn(min = ConsentTokens.touchMinimum)
            .padding(vertical = ConsentTokens.rowVertical), verticalAlignment = Alignment.CenterVertically) {
            Txt(label, font, ConsentTokens.rowTitle, modifier = Modifier.weight(1f))
            Switch(checked = checked, onCheckedChange = { model.toggle(key, it) }, enabled = !disabled,
                colors = SwitchDefaults.colors(
                    checkedThumbColor = ConsentTokens.switchThumb, checkedTrackColor = ConsentTokens.switchOnTrack,
                    uncheckedThumbColor = ConsentTokens.switchThumb, uncheckedTrackColor = ConsentTokens.switchOffTrack,
                    uncheckedBorderColor = ConsentTokens.secondaryText),
                modifier = Modifier.semantics {
                    contentDescription = label
                    stateDescription = when {
                        saving -> AlarmConsentStrings.STATE_BUSY
                        disabled -> AlarmConsentStrings.STATE_DISABLED
                        checked -> AlarmConsentStrings.STATE_ON
                        else -> AlarmConsentStrings.STATE_OFF
                    }
                }.testTag("switch-$key"))
        }
        if (marketingBlocked) {
            Txt(AlarmConsentStrings.S_MARKETING_REQUIRED, font, ConsentTokens.metadata, color = ConsentTokens.secondaryText,
                modifier = Modifier.padding(bottom = ConsentTokens.textGap).testTag("marketing-required"))
        }
        when (val edit = model.edit) {
            is Edit.Saving -> if (edit.key == key) RowStatus(AlarmConsentStrings.S_SAVING, font, error = false)
            is Edit.Error -> if (edit.key == key) {
                RowStatus(if (edit.network) AlarmConsentStrings.S_SAVE_OFFLINE else AlarmConsentStrings.S_SAVE_ERROR, font, error = true)
                SecondaryButton(AlarmConsentStrings.RETRY, font, model::retryEdit)
            }
            Edit.Uncertain -> {
                RowStatus(AlarmConsentStrings.S_UNCERTAIN, font, error = true)
                SecondaryButton(AlarmConsentStrings.RETRY, font, model::retryEdit)
            }
            else -> Unit
        }
        HorizontalDivider(color = ConsentTokens.separator)
    }
}

@Composable
private fun RowStatus(text: String, font: FontFamily, error: Boolean) {
    Txt(text, font, ConsentTokens.metadata, color = if (error) ConsentTokens.errorText else ConsentTokens.secondaryText,
        modifier = Modifier.padding(bottom = ConsentTokens.textGap).semantics { liveRegion = LiveRegionMode.Polite })
}

@Composable
private fun ColumnScope.HistoryScreen(model: AlarmConsentModel, font: FontFamily, onBack: () -> Unit, onOpenDocument: () -> Unit) {
    Header(AlarmConsentStrings.H_TITLE, font, onBack)
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())
        .padding(horizontal = ConsentTokens.screenHorizontal).padding(bottom = ConsentTokens.bodyVertical)) {
        if (model.withdrawDone) {
            Txt(AlarmConsentStrings.H_WITHDRAW_DONE, font, ConsentTokens.rowTitle, bold = true, modifier = Modifier.testTag("withdraw-done"))
            Spacer(Modifier.height(ConsentTokens.textGap))
            Txt(AlarmConsentStrings.H_WITHDRAW_EFFECT, font, ConsentTokens.bodySize, color = ConsentTokens.secondaryText)
            Spacer(Modifier.height(ConsentTokens.sectionGap))
        }
        Txt(AlarmConsentStrings.H_HEADING, font, ConsentTokens.stateTitle, bold = true, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(ConsentTokens.textGap))
        Txt(AlarmConsentStrings.H_DESCRIPTION, font, ConsentTokens.bodySize, color = ConsentTokens.secondaryText)
        Spacer(Modifier.height(ConsentTokens.stateTextGap))
        Txt(marketingLabel(model.marketing), font, ConsentTokens.rowTitle, bold = true, modifier = Modifier.testTag("history-marketing"))
        Spacer(Modifier.height(ConsentTokens.sectionGap))

        val records = model.records
        when (model.fetch) {
            Fetch.LOADING -> if (records == null) StateBlock(AlarmConsentStrings.H_LOADING, font, progress = true)
            Fetch.ERROR -> {
                StateBlock(AlarmConsentStrings.H_ERROR, font)
                SecondaryButton(AlarmConsentStrings.RETRY, font, model::load)
            }
            Fetch.OFFLINE -> {
                StateBlock(AlarmConsentStrings.H_OFFLINE, font)
                SecondaryButton(AlarmConsentStrings.RETRY, font, model::load)
            }
            else -> Unit
        }
        if (records != null && records.isEmpty()) {
            Txt(AlarmConsentStrings.H_EMPTY, font, ConsentTokens.rowTitle, bold = true, modifier = Modifier.testTag("history-empty"))
            Spacer(Modifier.height(ConsentTokens.textGap))
            Txt(AlarmConsentStrings.H_EMPTY_GUIDE, font, ConsentTokens.bodySize, color = ConsentTokens.secondaryText)
        }
        records?.forEach { record ->
            Column(Modifier.fillMaxWidth().padding(vertical = ConsentTokens.rowVertical).testTag("history-row")) {
                Txt(recordTitleLabel(record), font, ConsentTokens.rowTitle, bold = true)
                Spacer(Modifier.height(ConsentTokens.textGap))
                Txt(recordVersionLabel(record), font, ConsentTokens.metadata, color = ConsentTokens.secondaryText)
                Spacer(Modifier.height(ConsentTokens.textGap))
                Txt(recordStatusLabel(record.status), font, ConsentTokens.bodySize)
                Spacer(Modifier.height(ConsentTokens.textGap))
                Txt(recordTimeLabel(record), font, ConsentTokens.metadata, color = ConsentTokens.secondaryText)
            }
            HorizontalDivider(color = ConsentTokens.separator)
        }
        if (model.marketing == MarketingStatus.NOT_CONSENTED) {
            Spacer(Modifier.height(ConsentTokens.stateTextGap))
            Txt(AlarmConsentStrings.H_NOT_CONSENTED, font, ConsentTokens.metadata, color = ConsentTokens.secondaryText)
        }
        if (model.marketing == MarketingStatus.UNKNOWN) {
            Spacer(Modifier.height(ConsentTokens.stateTextGap))
            Txt(AlarmConsentStrings.H_STATUS_UNKNOWN, font, ConsentTokens.metadata, color = ConsentTokens.secondaryText)
        }
        Spacer(Modifier.height(ConsentTokens.sectionGap))
        SecondaryButton(AlarmConsentStrings.H_DOCUMENT, font, onOpenDocument)
        Spacer(Modifier.height(ConsentTokens.footerItemGap))
        PrimaryButton(AlarmConsentStrings.H_WITHDRAW, font, model.canWithdraw, model::startWithdraw)
    }
}

@Composable
private fun ColumnScope.DocumentScreen(model: AlarmConsentModel, font: FontFamily, onClose: () -> Unit) {
    Header(AlarmConsentStrings.D_TITLE, font, onClose)
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())
        .padding(horizontal = ConsentTokens.screenHorizontal).padding(bottom = ConsentTokens.bodyVertical)) {
        Txt(AlarmConsentStrings.D_READ_ONLY, font, ConsentTokens.bodySize, color = ConsentTokens.secondaryText)
        Spacer(Modifier.height(ConsentTokens.stateTextGap))
        when (val doc = model.doc) {
            Doc.Loading -> StateBlock(AlarmConsentStrings.D_LOADING, font, progress = true)
            Doc.Empty -> RetryBlock(AlarmConsentStrings.D_EMPTY, font, model::openDocument)
            Doc.Error -> RetryBlock(AlarmConsentStrings.D_ERROR, font, model::openDocument)
            Doc.Offline -> RetryBlock(AlarmConsentStrings.D_OFFLINE, font, model::openDocument)
            Doc.MetaMissing -> RetryBlock(AlarmConsentStrings.D_META_MISSING, font, model::openDocument)
            Doc.Preparing -> RetryBlock(AlarmConsentStrings.D_PREPARING, font, model::openDocument)
            is Doc.Ready -> {
                Txt(AlarmConsentStrings.dVersion(doc.version), font, ConsentTokens.metadata, color = ConsentTokens.secondaryText)
                Spacer(Modifier.height(ConsentTokens.textGap))
                Txt(AlarmConsentStrings.dEffective(doc.effectiveAt), font, ConsentTokens.metadata, color = ConsentTokens.secondaryText)
                if (doc.draft) {
                    Spacer(Modifier.height(ConsentTokens.textGap))
                    Txt(AlarmConsentStrings.D_DRAFT, font, ConsentTokens.bodySize, color = ConsentTokens.errorText)
                }
                Spacer(Modifier.height(ConsentTokens.sectionGap))
                Txt(doc.body, font, ConsentTokens.bodySize)
            }
        }
    }
    HorizontalDivider(color = ConsentTokens.separator)
    Box(Modifier.padding(horizontal = ConsentTokens.screenHorizontal, vertical = ConsentTokens.footerVertical)) {
        PrimaryButton(AlarmConsentStrings.CLOSE, font, true, onClose)
    }
}

@Composable
private fun WithdrawDialog(model: AlarmConsentModel, font: FontFamily) {
    val state = model.withdraw
    Dialog(onDismissRequest = { if (state != Withdraw.Checking) model.dismissWithdraw() }) {
        Column(Modifier.fillMaxWidth()
            .background(ConsentTokens.background, RoundedCornerShape(ConsentTokens.modalRadius))
            .padding(horizontal = ConsentTokens.screenHorizontal, vertical = ConsentTokens.bodyVertical).testTag("withdraw-modal")) {
            Txt(AlarmConsentStrings.W_TITLE, font, ConsentTokens.metadata, color = ConsentTokens.secondaryText)
            Spacer(Modifier.height(ConsentTokens.stateTextGap))
            when (state) {
                Withdraw.Checking -> {
                    // 철회 전 조회는 처리 문구와 구분한다.
                    ProgressLine(AlarmConsentStrings.H_LOADING, font)
                    Spacer(Modifier.height(ConsentTokens.stateTextGap))
                    SecondaryButton(AlarmConsentStrings.CANCEL, font, true, model::dismissWithdraw)
                }
                Withdraw.Question -> {
                    Txt(AlarmConsentStrings.W_HEADING, font, ConsentTokens.stateTitle, bold = true, modifier = Modifier.semantics { heading() })
                    Spacer(Modifier.height(ConsentTokens.stateTextGap))
                    Txt(AlarmConsentStrings.W_BODY, font, ConsentTokens.bodySize)
                    Spacer(Modifier.height(ConsentTokens.stateTextGap))
                    SecondaryButton(AlarmConsentStrings.CANCEL, font, true, model::dismissWithdraw)
                    Spacer(Modifier.height(ConsentTokens.footerItemGap))
                    PrimaryButton(AlarmConsentStrings.W_CONFIRM, font, !model.writesLocked, model::confirmWithdraw)
                }
                Withdraw.Working -> {
                    ProgressLine(AlarmConsentStrings.W_LOADING, font)
                    Spacer(Modifier.height(ConsentTokens.stateTextGap))
                    SecondaryButton(AlarmConsentStrings.CANCEL, font, true, model::dismissWithdraw)
                }
                Withdraw.Empty -> ModalNotice(AlarmConsentStrings.W_EMPTY, font,
                    listOf(AlarmConsentStrings.CLOSE to model::dismissWithdraw))
                Withdraw.Unavailable -> ModalNotice(AlarmConsentStrings.W_UNAVAILABLE, font,
                    listOf(AlarmConsentStrings.CLOSE to model::dismissWithdraw))
                Withdraw.Error -> ModalNotice(AlarmConsentStrings.W_ERROR, font, listOf(
                    AlarmConsentStrings.RETRY to model::retryWithdraw, AlarmConsentStrings.CANCEL to model::dismissWithdraw))
                Withdraw.Offline -> ModalNotice(AlarmConsentStrings.W_OFFLINE, font, listOf(
                    AlarmConsentStrings.RETRY to model::retryWithdraw, AlarmConsentStrings.CANCEL to model::dismissWithdraw))
                Withdraw.Uncertain -> ModalNotice(AlarmConsentStrings.W_UNCERTAIN, font, listOf(
                    AlarmConsentStrings.W_CHECK to model::checkWithdraw, AlarmConsentStrings.CANCEL to model::dismissWithdraw))
                Withdraw.Closed -> Unit
            }
        }
    }
}

@Composable
private fun PermissionDialog(model: AlarmConsentModel, font: FontFamily, state: Permission) {
    Dialog(onDismissRequest = model::dismissPermission) {
        Column(Modifier.fillMaxWidth()
            .background(ConsentTokens.background, RoundedCornerShape(ConsentTokens.modalRadius))
            .padding(horizontal = ConsentTokens.screenHorizontal, vertical = ConsentTokens.bodyVertical).testTag("permission-modal")) {
            when (state) {
                Permission.Loading -> {
                    ProgressLine(AlarmConsentStrings.P_LOADING, font)
                    Spacer(Modifier.height(ConsentTokens.stateTextGap))
                    SecondaryButton(AlarmConsentStrings.P_LATER, font, true, model::dismissPermission)
                }
                Permission.Denied -> {
                    Txt(AlarmConsentStrings.P_TITLE, font, ConsentTokens.stateTitle, bold = true, modifier = Modifier.semantics { heading() })
                    Spacer(Modifier.height(ConsentTokens.stateTextGap))
                    Txt(AlarmConsentStrings.P_BODY, font, ConsentTokens.bodySize)
                    if (model.osOffline) {
                        Spacer(Modifier.height(ConsentTokens.textGap))
                        Txt(AlarmConsentStrings.P_OFFLINE, font, ConsentTokens.metadata, color = ConsentTokens.secondaryText)
                    }
                    Spacer(Modifier.height(ConsentTokens.stateTextGap))
                    PrimaryButton(AlarmConsentStrings.S_OS_SETTINGS, font, true, model::confirmOsSettings)
                    Spacer(Modifier.height(ConsentTokens.footerItemGap))
                    SecondaryButton(AlarmConsentStrings.P_LATER, font, true, model::dismissPermission)
                }
                Permission.UnknownOs -> ModalNotice(AlarmConsentStrings.P_UNKNOWN, font,
                    listOf(AlarmConsentStrings.P_LATER to model::dismissPermission))
                Permission.Failed -> ModalNotice(AlarmConsentStrings.P_ERROR, font, listOf(
                    AlarmConsentStrings.RETRY to model::retryOsSettings, AlarmConsentStrings.P_LATER to model::dismissPermission))
            }
        }
    }
}

@Composable
private fun ModalNotice(text: String, font: FontFamily, actions: List<Pair<String, () -> Unit>>) {
    Txt(text, font, ConsentTokens.bodySize, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    Spacer(Modifier.height(ConsentTokens.stateTextGap))
    actions.forEachIndexed { index, (label, action) ->
        if (index > 0) Spacer(Modifier.height(ConsentTokens.footerItemGap))
        if (index == 0) PrimaryButton(label, font, true, action) else SecondaryButton(label, font, true, action)
    }
}

@Composable
private fun StateBlock(text: String, font: FontFamily, progress: Boolean = false) {
    if (progress) ProgressLine(text, font) else Txt(text, font, ConsentTokens.bodySize,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    Spacer(Modifier.height(ConsentTokens.stateTextGap))
}

@Composable
private fun ProgressLine(text: String, font: FontFamily) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(ConsentTokens.buttonVertical), color = ConsentTokens.heading,
            strokeWidth = ConsentTokens.textGap)
        Spacer(Modifier.width(ConsentTokens.rowItemGap))
        Txt(text, font, ConsentTokens.bodySize, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
}

@Composable
private fun RetryBlock(text: String, font: FontFamily, retry: () -> Unit) {
    StateBlock(text, font)
    SecondaryButton(AlarmConsentStrings.RETRY, font, retry)
}

@Composable
private fun PrimaryButton(label: String, font: FontFamily, enabled: Boolean, action: () -> Unit) {
    Button(onClick = action, enabled = enabled, shape = RoundedCornerShape(ConsentTokens.buttonRadius),
        modifier = Modifier.fillMaxWidth().heightIn(min = ConsentTokens.touchMinimum),
        colors = ButtonDefaults.buttonColors(containerColor = ConsentTokens.primaryBackground,
            disabledContainerColor = ConsentTokens.separator, disabledContentColor = ConsentTokens.secondaryText)) {
        Txt(label, font, ConsentTokens.action, bold = true,
            color = if (enabled) ConsentTokens.primaryText else ConsentTokens.secondaryText)
    }
}

@Composable
private fun SecondaryButton(label: String, font: FontFamily, action: () -> Unit) {
    SecondaryButton(label, font, true, action)
}

@Composable
private fun SecondaryButton(label: String, font: FontFamily, enabled: Boolean, action: () -> Unit) {
    OutlinedButton(onClick = action, enabled = enabled, shape = RoundedCornerShape(ConsentTokens.buttonRadius),
        modifier = Modifier.fillMaxWidth().heightIn(min = ConsentTokens.touchMinimum),
        border = BorderStroke(ConsentTokens.strokeWidth, ConsentTokens.separator)) {
        Txt(label, font, ConsentTokens.action, color = if (enabled) DesignTokens.navy else ConsentTokens.secondaryText)
    }
}

@Composable
private fun Txt(text: String, font: FontFamily, size: Int, bold: Boolean = false,
                color: Color = DesignTokens.navy, modifier: Modifier = Modifier) {
    Text(text, modifier, color = color, fontSize = size.sp, fontFamily = font,
        fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, textAlign = TextAlign.Start)
}

@Composable
private fun brandFont(): FontFamily {
    val assets = LocalContext.current.assets
    return remember {
        FontFamily(Font("regular.otf", assets), Font("semibold.otf", assets, FontWeight.SemiBold),
            Font("bold.otf", assets, FontWeight.Bold))
    }
}
