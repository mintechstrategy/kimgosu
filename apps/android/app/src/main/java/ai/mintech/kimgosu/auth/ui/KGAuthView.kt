package ai.mintech.kimgosu.auth.ui

import android.graphics.BitmapFactory
import ai.mintech.kimgosu.settings.AlarmConsentScreen
import ai.mintech.kimgosu.settings.ConsentStart
import ai.mintech.kimgosu.ui.DesignTokens
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val BrandFont = staticCompositionLocalOf<FontFamily> { FontFamily.Default }

@Composable fun KGAuthView(state: AuthState, onEvent: (AuthEvent) -> Unit, modifier: Modifier = Modifier) {
    // 알림 설정·동의 화면은 자체 모델과 4상태를 가진 화면이 그린다(WS-87). 나머지 회원 화면은 그대로 둔다.
    when (state.screen) {
        AuthScreen.F4_NOTI -> { AlarmConsentScreen(ConsentStart.NOTIFICATIONS) { onEvent(AuthEvent(AuthAction.BACK)) }; return }
        AuthScreen.CONSENT_HISTORY -> { AlarmConsentScreen(ConsentStart.HISTORY) { onEvent(AuthEvent(AuthAction.BACK)) }; return }
        else -> Unit
    }
    val assets = LocalContext.current.assets
    val fonts = remember { FontFamily(Font("regular.otf", assets), Font("semibold.otf", assets, FontWeight.SemiBold), Font("bold.otf", assets, FontWeight.Bold)) }
    val surface = AuthSurfaces.getValue(state.screen)
    BackHandler { onEvent(AuthEvent(AuthAction.BACK)) }
    CompositionLocalProvider(BrandFont provides fonts) {
        MaterialTheme(colorScheme = lightColorScheme(primary = DesignTokens.navy, onPrimary = Color.White, surface = Color.White, onSurface = DesignTokens.navy)) {
            Column(modifier.fillMaxSize().background(Color.White).imePadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { onEvent(AuthEvent(AuthAction.BACK)) }, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)) {
                        Copy(if (state.screen in listOf(AuthScreen.E1, AuthScreen.E2_TERMS, AuthScreen.E2_SMS)) "×" else "‹", 28, modifier = Modifier.semantics { contentDescription = "닫기 또는 이전 화면" })
                    }
                    Copy(surface.title, 18, true, Modifier.weight(1f), TextAlign.Center)
                    Spacer(Modifier.width(48.dp))
                }
                if (state.preview) Copy("개발용 UI 예시 · 실제 인증·동의·거래 아님", 12, modifier = Modifier.fillMaxWidth().background(DesignTokens.soft).padding(8.dp), align = TextAlign.Center)
                if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().semantics { contentDescription = "처리 중" }, color = DesignTokens.navy, trackColor = DesignTokens.border)
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 20.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    when (surface.family) {
                        "login" -> Login(state, onEvent)
                        "terms" -> Terms(state, onEvent)
                        "sms" -> Sms(state, onEvent)
                        "document" -> Document(state, onEvent)
                        "account" -> Account(state, onEvent)
                        "withdraw" -> Withdraw(state, onEvent)
                        "member" -> Member(state, onEvent)
                        else -> Status(state, onEvent)
                    }
                    if (state.detail.isNotEmpty()) Panel(state.detail)
                    if (state.error.isNotEmpty()) Copy(state.error, color = Color(0xFFAF2635), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                }
                Footer(state, onEvent)
            }
        }
    }
}

@Composable private fun Copy(text: String, size: Int = 14, bold: Boolean = false, modifier: Modifier = Modifier, align: TextAlign = TextAlign.Start, color: Color = DesignTokens.navy) {
    Text(text, modifier, color, fontSize = size.sp, fontFamily = BrandFont.current, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, textAlign = align, lineHeight = (size * 1.5).sp)
}
@Composable private fun Heading(text: String) = Copy(text, 20, true, Modifier.semantics { heading() })
@Composable private fun Panel(text: String) = Copy(text, modifier = Modifier.fillMaxWidth().background(DesignTokens.soft, RoundedCornerShape(6.dp)).padding(14.dp))
@Composable private fun Action(label: String, enabled: Boolean = true, primary: Boolean = false, event: AuthEvent, onEvent: (AuthEvent) -> Unit) {
    if (primary) Button(onClick = { onEvent(event) }, enabled = enabled, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy, disabledContainerColor = DesignTokens.border, disabledContentColor = DesignTokens.muted)) { Copy(label, 15, true, color = if (enabled) Color.White else DesignTokens.muted) }
    else OutlinedButton(onClick = { onEvent(event) }, enabled = enabled, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Copy(label, color = if (enabled) DesignTokens.navy else DesignTokens.muted) }
}
@Composable private fun Asset(name: String, description: String?, modifier: Modifier) {
    val assets = LocalContext.current.assets
    val bitmap = remember(name) { assets.open(name).use { BitmapFactory.decodeStream(it).asImageBitmap() } }
    Image(bitmap, description, modifier, contentScale = ContentScale.Fit)
}
@Composable private fun Login(s: AuthState, emit: (AuthEvent) -> Unit) {
    Spacer(Modifier.height(16.dp))
    Copy("김고수", 34, true, Modifier.fillMaxWidth(), TextAlign.Center)
    Copy(AuthSurfaces.getValue(s.screen).body, 20, true, Modifier.fillMaxWidth(), TextAlign.Center)
    Box(Modifier.fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(12.dp)).padding(8.dp), contentAlignment = Alignment.Center) {
        Asset("app_icon.png", "우리동네 김고수", Modifier.size(146.dp))
    }
    listOf(Triple("kakao", "카카오로 시작", DesignTokens.kakao), Triple("naver", "네이버로 시작", DesignTokens.naver), Triple("google", "Google로 시작", Color.White)).forEach { (id, title, color) ->
        Button(onClick = { emit(AuthEvent(AuthAction.START_SOCIAL, id)) }, enabled = !s.busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).border(if (id == "google") 1.dp else 0.dp, if (id == "google") DesignTokens.googleBorder else color, RoundedCornerShape(6.dp)),
            shape = RoundedCornerShape(6.dp), colors = ButtonDefaults.buttonColors(containerColor = color)) {
            if (id == "google") { Asset("google-g.png", null, Modifier.size(18.dp)); Spacer(Modifier.width(12.dp)) }
            Copy(title, 16, color = if (id == "naver") Color.White else Color(0xFF1F1F1F))
        }
    }
}
@Composable private fun Check(label: String, checked: Boolean, enabled: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, change, enabled = enabled, colors = CheckboxDefaults.colors(checkedColor = DesignTokens.lime, checkmarkColor = DesignTokens.navy, uncheckedColor = DesignTokens.muted), modifier = Modifier.semantics { contentDescription = label })
        Copy(label, modifier = Modifier.weight(1f))
    }
}
@Composable private fun Terms(s: AuthState, emit: (AuthEvent) -> Unit) {
    val f = AuthSurfaces.getValue(s.screen)
    Heading(f.heading); Copy(f.body)
    if (s.screen == AuthScreen.E2_TERMS) {
        Check("약관 전체 동의 (선택 포함)", s.options.all { it.id in s.accepted }, !s.busy) {
            emit(AuthEvent(AuthAction.CHANGE_ALL_CONSENTS, value = it.toString()))
        }
    }
    s.options.forEach { option ->
        Column {
            Check("[${if (option.required) "필수" else "선택"}] ${option.title}", option.id in s.accepted, s.consentEnabled(option)) {
                emit(AuthEvent(AuthAction.CHANGE_CONSENT, option.id, it.toString()))
            }
            option.document?.let { doc ->
                TextButton(onClick = { emit(AuthEvent(AuthAction.OPEN_DOCUMENT, doc.name)) }) { Copy("전문 보기  ›", color = DesignTokens.muted) }
                if (s.documents[doc]?.canConsent != true) Copy("문서 준비·승인 확인 후 동의할 수 있습니다.", 12, color = DesignTokens.muted)
            }
        }
    }
    Action("서비스 운영정책 열람", event = AuthEvent(AuthAction.OPEN_DOCUMENT, AuthDocumentKind.OPERATIONS.name), onEvent = emit)
    Action("개인정보 처리방침 열람", event = AuthEvent(AuthAction.OPEN_DOCUMENT, AuthDocumentKind.PRIVACY_POLICY.name), onEvent = emit)
}
@Composable private fun Input(s: AuthState, key: String, label: String, emit: (AuthEvent) -> Unit, type: KeyboardType = KeyboardType.Text, multiline: Boolean = false) {
    OutlinedTextField(s.input(key), { value ->
        val filtered = when (key) { "phone" -> AuthInput.phone(value); "code" -> AuthInput.code(value); "withdrawDetail" -> AuthInput.withdrawalDetail(value); else -> value }
        emit(AuthEvent(AuthAction.CHANGE_INPUT, key, filtered))
    }, label = { Copy(label) }, enabled = !s.busy, modifier = Modifier.fillMaxWidth(), singleLine = !multiline, minLines = if (multiline) 3 else 1, keyboardOptions = KeyboardOptions(keyboardType = type), textStyle = LocalTextStyle.current.copy(fontFamily = BrandFont.current, color = DesignTokens.navy))
}
@Composable private fun Sms(s: AuthState, emit: (AuthEvent) -> Unit) {
    val f = AuthSurfaces.getValue(s.screen)
    Heading(f.heading); Copy(f.body)
    Input(s, "phone", "휴대폰 번호 · 010 시작 숫자 11자리", emit, KeyboardType.Phone)
    if (s.input("phone").isNotEmpty() && !AuthInput.validPhone(s.input("phone"))) Copy("010으로 시작하는 숫자 11자리를 입력해주세요.", 12)
    Action(if (s.screen == AuthScreen.E2_SMS) "인증번호 전송" else "인증번호 재전송", s.canSend, event = AuthEvent(AuthAction.SEND_SMS), onEvent = emit)
    if (!s.smsAvailable) Panel("문자 인증 서비스 연결 준비 중입니다. 실제 문자는 발송되지 않으며 가입을 완료할 수 없습니다.")
    if (s.challengeActive) Copy("남은 시간 ${s.remainingSeconds.coerceAtLeast(0)}초 · 인증번호 5자리", modifier = Modifier.semantics { contentDescription = "인증번호 유효시간 ${s.remainingSeconds.coerceAtLeast(0)}초" })
    Input(s, "code", "인증번호 · 숫자 5자리", emit, KeyboardType.NumberPassword)
    Copy("재전송하면 이전 인증번호는 사용할 수 없습니다. SMS 점유 인증은 실명 확인이 아닙니다.", 12, color = DesignTokens.muted)
    if (s.screen == AuthScreen.SMS_DUPLICATE) Action("계정 확인", event = AuthEvent(AuthAction.OTHER_LOGIN), onEvent = emit)
}
@Composable private fun Document(s: AuthState, emit: (AuthEvent) -> Unit) {
    val f = AuthSurfaces.getValue(s.screen)
    val kind = f.document ?: s.selectedDocument
    val doc = s.documents[kind]
    Heading(doc?.title ?: f.heading)
    if (f.body.isNotEmpty()) Copy(f.body)
    when (if (s.screen == AuthScreen.LEGAL_ERROR) AuthDocumentStatus.ERROR else doc?.status ?: AuthDocumentStatus.PREPARING) {
        AuthDocumentStatus.LOADING -> { CircularProgressIndicator(color = DesignTokens.navy); Copy("문서를 불러오는 중입니다.") }
        AuthDocumentStatus.PREPARING -> Panel("문서 준비 중입니다. 운영자 정보·시행일·법률 검토를 확인한 후 제공됩니다.")
        AuthDocumentStatus.ERROR -> { Panel("문서를 확인할 수 없습니다. 동의는 진행되지 않습니다."); Action("다시 시도", !s.busy, event = AuthEvent(AuthAction.RETRY_DOCUMENT, kind.name), onEvent = emit) }
        else -> {
            if (doc != null) {
                if (!doc.canConsent) Panel("사용자 검토용 초안 · 법률 확정·실제 동의용 아님")
                Copy("버전: ${doc.version.ifEmpty { "미확정" }}\n시행일: ${doc.effectiveDate.ifEmpty { "미확정" }}\n운영자: ${doc.operator.ifEmpty { "미확정" }}", 12, color = DesignTokens.muted)
                Copy(doc.body)
            }
        }
    }
    Copy("문서를 열거나 닫는 동작은 동의가 아닙니다.", 12, color = DesignTokens.muted)
}
@Composable private fun Account(s: AuthState, emit: (AuthEvent) -> Unit) {
    Action("프로필 수정 · 후속 단계", false, event = AuthEvent(AuthAction.OPEN, "PROFILE_EDIT"), onEvent = emit)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Copy("◯", 30, modifier = Modifier.background(DesignTokens.soft, RoundedCornerShape(24.dp)).padding(8.dp))
        Column(Modifier.padding(start = 12.dp)) { Copy(s.nickname.ifEmpty { "회원 정보 확인 중" }, bold = true); Copy(s.email, 12, color = DesignTokens.muted); Copy("고객번호 ${s.customerNumber.ifEmpty { "서버 확인 중" }}", 12, color = DesignTokens.muted) }
    }
    listOf("견적요청/서비스 관리", "찜한 전문가").forEach { Action("$it · 후속 단계", false, event = AuthEvent(AuthAction.OPEN), onEvent = emit) }
    listOf("알림 설정" to AuthScreen.F4_NOTI, "동의 내역·철회" to AuthScreen.CONSENT_HISTORY, "서비스 운영정책" to AuthScreen.OPERATIONS_DOC, "로그아웃" to AuthScreen.LOGOUT_CONFIRM, "회원탈퇴" to AuthScreen.F5).forEach { (title, screen) ->
        Action(title, !s.busy, event = AuthEvent(AuthAction.OPEN, screen.name), onEvent = emit)
    }
    Action("고객센터", !s.busy && s.supportAvailable, event = AuthEvent(AuthAction.SUPPORT), onEvent = emit)
    Action("고수 모드 · 후속 단계", false, event = AuthEvent(AuthAction.OPEN), onEvent = emit)
    Copy("고수는 필수정보 입력·신청 후 즉시 활성화합니다. 자격 인증 배지는 별도 확인 전 표시하지 않습니다.", 12, color = DesignTokens.muted)
}
@Composable private fun Withdraw(s: AuthState, emit: (AuthEvent) -> Unit) {
    val f = AuthSurfaces.getValue(s.screen)
    Heading(f.heading); Panel(f.body)
    Check("위 안내 사항을 확인하고 동의합니다.", s.withdrawalAcknowledged, !s.busy) { emit(AuthEvent(AuthAction.CHANGE_CONSENT, "withdrawAcknowledged", it.toString())) }
    Heading("탈퇴 사유가 무엇인가요?")
    listOf("알림이 너무 많이와요", "사용하기 어려워요", "오류가 많아서 불편해요", "기타").forEach { reason ->
        Row(verticalAlignment = Alignment.CenterVertically) { RadioButton(s.input("withdrawReason") == reason, { emit(AuthEvent(AuthAction.CHANGE_INPUT, "withdrawReason", reason)) }, enabled = !s.busy, modifier = Modifier.semantics { contentDescription = reason }); Copy(reason) }
    }
    Input(s, "withdrawDetail", "상세 사유 (선택, 최대 500자)", emit, multiline = true)
    Copy("${s.input("withdrawDetail").codePointCount(0, s.input("withdrawDetail").length)}/500", 12, modifier = Modifier.fillMaxWidth(), align = TextAlign.End, color = DesignTokens.muted)
}
@Composable private fun Member(s: AuthState, emit: (AuthEvent) -> Unit) {
    Heading(AuthSurfaces.getValue(s.screen).heading); Copy(AuthSurfaces.getValue(s.screen).body)
    Input(s, "name", "이름 (필수)", emit)
    Input(s, "email", "이메일 (필수)", emit, KeyboardType.Email)
    Input(s, "nickname", "자동 생성 닉네임 수정 (선택)", emit)
    if (s.input("nickname").isNotEmpty() && !AuthInput.validNickname(s.input("nickname"))) Copy("닉네임은 문자·숫자만 최대 10자입니다. 공백·특수문자를 제외해주세요.", 12)
    Copy("공급자 필수정보가 없으면 확인·보완 후 진행합니다. 고객번호와 자동 닉네임은 서버가 부여합니다.", 12, color = DesignTokens.muted)
}
@Composable private fun Status(s: AuthState, emit: (AuthEvent) -> Unit) {
    val f = AuthSurfaces.getValue(s.screen)
    Heading(f.heading); Panel(f.body)
    if (s.provider.isNotEmpty() && s.screen == AuthScreen.ACCOUNT_LINK) Copy("연결할 로그인: ${s.provider}")
    f.action?.let { action ->
        val enabled = !s.busy && when (action) { AuthAction.SUPPORT -> s.supportAvailable; AuthAction.CONFIRM_LINK -> s.linkOwnershipVerified; AuthAction.CONFIRM_WITHDRAW -> s.withdrawalAcknowledged; AuthAction.WITHDRAW_MARKETING -> s.marketingConsented; else -> true }
        Action(f.actionLabel, enabled, true, AuthEvent(action), emit)
    }
    if (s.screen == AuthScreen.ACCOUNT_LINK && !s.linkOwnershipVerified) {
        Copy("계정 소유 확인이 완료되면 연결할 수 있습니다.", 12)
        Action("계정 소유 다시 확인", !s.busy, event = AuthEvent(AuthAction.VERIFY_LINK_OWNERSHIP), onEvent = emit)
    }
    if (s.screen == AuthScreen.HOME_SIGNED_OUT) Action("로그인/가입", event = AuthEvent(AuthAction.OPEN, AuthScreen.E1.name), onEvent = emit)
    if (s.screen in listOf(AuthScreen.ACCOUNT_RESTRICTED, AuthScreen.RESTRICTION_CARRIED)) Action("홈으로", event = AuthEvent(AuthAction.BROWSE), onEvent = emit)
    Action(if (f.kind in listOf("sheet", "modal")) "취소" else "돌아가기", event = AuthEvent(AuthAction.CANCEL), onEvent = emit)
}
@Composable private fun Footer(s: AuthState, emit: (AuthEvent) -> Unit) {
    val family = AuthSurfaces.getValue(s.screen).family
    val label = when (family) { "login" -> "둘러보기"; "terms" -> if (s.screen == AuthScreen.RECONSENT) "필수 정책 동의" else "다음 단계"; "sms" -> "회원가입 완료"; "withdraw" -> "회원 탈퇴하기"; "member" -> "정보 확인 후 계속"; "document" -> "닫기"; else -> return }
    val enabled = when (family) { "terms" -> s.canContinue; "sms" -> s.canVerify; "withdraw" -> s.withdrawalAcknowledged && !s.busy; "member" -> s.canSubmitMember; else -> true }
    val event = when (family) { "login" -> AuthEvent(AuthAction.BROWSE); "terms" -> AuthEvent(AuthAction.SUBMIT_CONSENTS); "sms" -> AuthEvent(AuthAction.VERIFY_SMS); "withdraw" -> AuthEvent(AuthAction.OPEN, AuthScreen.WITHDRAW_CONFIRM.name); "member" -> AuthEvent(AuthAction.SUBMIT_MEMBER); else -> AuthEvent(AuthAction.BACK) }
    HorizontalDivider(color = DesignTokens.border)
    Box(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) { Action(if (s.busy && family !in listOf("document", "login")) "처리 중…" else label, enabled, family !in listOf("login", "document"), event, emit) }
}
