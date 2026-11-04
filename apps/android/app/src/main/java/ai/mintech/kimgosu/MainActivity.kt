package ai.mintech.kimgosu

import android.app.Application
import ai.mintech.kimgosu.auth.*
import ai.mintech.kimgosu.auth.ui.*
import ai.mintech.kimgosu.ui.DesignTokens
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

internal val LocalBrandFont = staticCompositionLocalOf<FontFamily> { FontFamily.Default }

data class Item(val label: String, val icon: String)
class Home(val json: JSONObject) {
    fun text(key: String): String = json.getString(key)
    val categories = items("categories")
    val navigation = items("navigation")
    val popularTabs = json.getJSONArray("popularTabs").let { a -> List(a.length()) { a.getString(it) } }
    private fun items(key: String) = json.getJSONArray(key).let { a -> List(a.length()) {
        val item = a.getJSONObject(it); Item(item.getString("label"), item.getString("icon"))
    } }
}

class LaunchModel(application: Application) : AndroidViewModel(application) {
    var home by mutableStateOf<Home?>(null); private set
    var entered by mutableStateOf(false); private set
    var error by mutableStateOf(false); private set
    var apiStatus by mutableStateOf("연결 확인 중"); private set
    private var started = false
    fun event(state: String) {
        if (BuildConfig.DEBUG) File(getApplication<Application>().filesDir, "launch-events.jsonl").appendText(
            JSONObject().put("state", state).put("uptimeMs", SystemClock.elapsedRealtime()).toString() + "\n")
    }
    fun prepare(hold: Boolean, verify: Boolean, offlineTransport: Boolean = false) {
        if (started) return
        started = true
        viewModelScope.launch {
            try {
                home = withContext(Dispatchers.IO) {
                    val raw = getApplication<Application>().assets.open("home.json").bufferedReader().use { it.readText() }
                    Home(JSONObject(raw)).also { require(it.categories.size == 8 && it.navigation.size == 5) }
                }
                if (!hold) { kotlinx.coroutines.delay(3000); entered = true }
                if (verify && BuildConfig.DEBUG) probe(offlineTransport)
            } catch (_: Exception) { error = true }
        }
    }
    fun retry() { started = false; error = false; prepare(false, false) }
    private suspend fun probe(offlineTransport: Boolean) {
        val result = withContext(Dispatchers.IO) {
            val receipt = JSONObject().put("platform", "AOS").put("observedAt", Instant.now().toString())
                .put("url", BuildConfig.API_BASE_URL + "/health")
                .put("transportBlocked", offlineTransport)
                .put("failureInjection", if (offlineTransport) "URL_LOADING_FAILURE_BEFORE_REMOTE_IO" else "NONE")
            var connection: HttpURLConnection? = null
            try {
                val endpoint = URL(receipt.getString("url"))
                connection = if (offlineTransport) OfflineConnection(endpoint) else endpoint.openConnection() as HttpURLConnection
                connection.connectTimeout = 8000; connection.readTimeout = 8000
                val code = connection.responseCode
                val ray = connection.getHeaderField("cf-ray")
                val body = connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
                val release = body.getString("release")
                require(code == 200 && !ray.isNullOrEmpty() && body.getString("status") == "ok" &&
                    body.getString("scope") == "diagnostic-only" && release.matches(Regex("[0-9a-f]{64}")))
                receipt.put("status", "PASS").put("httpStatus", code).put("cfRay", ray).put("release", release)
            } catch (e: Exception) { receipt.put("status", "UNAVAILABLE").put("errorType", e.javaClass.simpleName) }
            finally { connection?.disconnect() }
            File(getApplication<Application>().filesDir, "api-receipt.json").writeText(receipt.toString(2))
            receipt.getString("status")
        }
        apiStatus = if (result == "PASS") "연결 확인 완료" else "연결 불가 · 메인은 계속 이용할 수 있습니다"
    }
}

// Debug caller only: refuse URL loading; never synthesize a successful API response.
private class OfflineConnection(url: URL) : HttpURLConnection(url) {
    override fun connect(): Unit = throw java.net.NoRouteToHostException("QA URL transport unavailable")
    override fun getResponseCode(): Int = throw java.net.NoRouteToHostException("QA URL transport unavailable")
    override fun disconnect() { }
    override fun usingProxy() = false
}

class MainActivity : ComponentActivity() {
    // launchMode=singleTop: 로그인 콜백은 새 화면을 만들지 않고 실행 중인 화면에 전달된다.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.data?.let { ViewModelProvider(this)[AuthModel::class.java].handleOAuthCallback(it) }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val model = ViewModelProvider(this)[LaunchModel::class.java]
        val auth = ViewModelProvider(this)[AuthModel::class.java]
        // 콜드 스타트가 딥링크로 시작한 경우(앱이 백그라운드에서 정리된 뒤)에도 세션을 복원한다.
        // start()를 먼저 끝내 두지 않으면, 스플래시 뒤 AuthHost의 start()가 진행 중인
        // 콜백 세션 검증을 취소할 수 있다(start()는 멱등이라 두 번 호출해도 한 번만 실행된다).
        if (intent.data != null) auth.start()
        intent.data?.let { auth.handleOAuthCallback(it) }
        val profile = ViewModelProvider(this)[ProfileModel::class.java]
        val expert = ViewModelProvider(this)[ExpertHomeModel::class.java]
        val hold = BuildConfig.DEBUG && intent.getBooleanExtra("hold_splash", false)
        val verify = BuildConfig.DEBUG && intent.getBooleanExtra("verify_api", false)
        val offlineTransport = BuildConfig.DEBUG && intent.getBooleanExtra("offline_transport", false)
        if (BuildConfig.DEBUG) {
            // QA-only: hold the loading state, or make the server answer 5xx, so the
            // A1 states can be observed on a device. Release builds never assign these.
            profile.qaLoadingHoldMillis = intent.getLongExtra("profile_loading_hold_ms", 0L)
            profile.qaServerError = intent.getBooleanExtra("profile_server_error", false)
            expert.qaLoadingHoldMillis = intent.getLongExtra("expert_loading_hold_ms", 0L)
            expert.qaServerError = intent.getBooleanExtra("expert_server_error", false)
        }
        setContent {
            var expertHomeOpen by rememberSaveable { mutableStateOf(false) }
            var quotesPendingNotice by rememberSaveable { mutableStateOf(false) }
            val fonts = remember { FontFamily(Font("regular.otf", assets), Font("semibold.otf", assets, FontWeight.SemiBold), Font("bold.otf", assets, FontWeight.Bold)) }
            MaterialTheme(colorScheme = lightColorScheme(primary = DesignTokens.navy, onPrimary = Color.White, surface = Color.White, onSurface = DesignTokens.navy)) {
                CompositionLocalProvider(LocalBrandFont provides fonts) {
                    if (model.error) {
                        Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.Center) {
                            Copy("앱 화면을 준비하지 못했습니다.")
                            Button(onClick = model::retry) { Copy("다시 시도", color = Color.White) }
                        }
                    } else if (!model.entered) {
                        Box(Modifier.fillMaxSize().background(Color.White).testTag("splash")) {
                            AssetImage("splash.jpg", "김고수 시작 화면", Modifier.fillMaxSize().testTag("splash-image"))
                        }
                        LaunchedEffect(Unit) {
                            model.event("splash-visible")
                            // Bundled splash is displayed for at least three seconds; no network dependency.
                            withFrameNanos { }
                            model.prepare(hold, verify, offlineTransport)
                        }
                    } else model.home?.let { home ->
                        // The root screen has no splash entry in its back stack.
                        BackHandler { if (expertHomeOpen) expertHomeOpen = false else moveTaskToBack(true) }
                        if (expertHomeOpen) {
                            ExpertHomeScreen(
                                nickname = (profile.state as? ProfileState.Ready)?.nickname.orEmpty(),
                                onBack = { expertHomeOpen = false },
                                onOpenQuotes = { quotesPendingNotice = true })
                        } else AuthHost(auth) {
                            MainScreen(home, if (verify) model.apiStatus else null,
                                profile = profile.state,
                                onRetryProfile = { profile.refresh() },
                                onProfileLogin = { auth.enter(ReturnTarget(screenId = "A1")) },
                                onExpertHome = { expertHomeOpen = true },
                                onProtected = { auth.enter(ReturnTarget(screenId = "A1", targetId = it)) },
                                onPolicy = { auth.handle(AuthEvent(AuthAction.OPEN_DOCUMENT, it)) })
                        }
                        LaunchedEffect(Unit) { model.event("main-visible") }
                    }
                    LaunchedEffect(Unit) { profile.refresh() }
                    // 로그인 직후 A1 카드가 이전 세션 상태에 머물지 않게 서버에서 다시 읽는다.
                    LaunchedEffect(auth.state.nickname) { if (auth.state.nickname.isNotEmpty()) profile.refresh() }
                    // Returning to A1 from an auth screen (including logout) re-reads /v1/me,
                    // so a cleared session turns the card into Empty instead of stale data.
                    val returnedHome = auth.browsing && auth.stack.isEmpty()
                    LaunchedEffect(returnedHome) { if (returnedHome) profile.refresh() }
                    // 401 on the stored session: drop it and return to the login screen.
                    LaunchedEffect(profile.sessionExpired) {
                        if (profile.sessionExpired) { profile.acknowledgeExpiry(); auth.enter(ReturnTarget(screenId = "A1"), "SESSION_EXPIRED") }
                    }
                    // 받은 견적 화면은 WS-43 몫이라 이 후보에는 없다. 탭이 죽은 채로 남지 않게 안내만 한다.
                    if (quotesPendingNotice) {
                        AlertDialog(onDismissRequest = { quotesPendingNotice = false },
                            title = { Copy("받은 견적", size = 19, bold = true) },
                            text = { Copy("받은 견적 화면은 다음 통합에서 연결됩니다.") },
                            confirmButton = { TextButton(onClick = { quotesPendingNotice = false }) { Copy("확인") } })
                    }
                }
            }
        }
    }
}

@Composable internal fun Copy(text: String, modifier: Modifier = Modifier, size: Int = 14, bold: Boolean = false,
                             color: Color = DesignTokens.navy, align: TextAlign = TextAlign.Start, weight: FontWeight? = null) {
    Text(text, modifier, color, fontSize = size.sp, fontFamily = LocalBrandFont.current,
        fontWeight = weight ?: if (bold) FontWeight.Bold else FontWeight.Normal, textAlign = align)
}
@Composable private fun AssetImage(name: String, description: String?, modifier: Modifier) {
    val context = LocalContext.current
    val bitmap = remember(name) { context.assets.open(name).use { BitmapFactory.decodeStream(it) }.asImageBitmap() }
    Image(bitmap, description, modifier, contentScale = ContentScale.Crop)
}
@Composable private fun MainScreen(home: Home, apiStatus: String?, profile: ProfileState,
                                   onRetryProfile: () -> Unit, onProfileLogin: () -> Unit,
                                   onExpertHome: () -> Unit,
                                   onProtected: (String) -> Unit, onPolicy: (String) -> Unit) {
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    var popular by rememberSaveable { mutableIntStateOf(0) }
    val open: (String) -> Unit = { if (it in listOf("알림", "마이페이지", "마이", "내정보", "견적요청", "서비스등록", "채팅", "원장") || it.contains("요청") || it.contains("등록")) onProtected(it) else notice = it }
    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().testTag("main")) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).testTag("main-scroll")) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Copy(home.text("brand"), size = 23, bold = true)
                    Box(Modifier.padding(top = 2.dp).size(26.dp, 3.dp).background(DesignTokens.lime, RoundedCornerShape(2.dp)))
                }
                IconButton(onClick = { open("알림") }, modifier = Modifier.size(48.dp)) { AssetImage("notification.png", "알림", Modifier.size(23.dp)) }
            }
            ProfileCard(profile, onRetryProfile, onProfileLogin, onExpertHome)
            Copy(home.text("introduction"), Modifier.fillMaxWidth().padding(top = 20.dp).testTag("main-introduction"), 20, true, align = TextAlign.Center)
            Row(Modifier.padding(top = 16.dp).fillMaxWidth().heightIn(min = 48.dp).border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp))
                .clickable { open("검색") }.padding(14.dp).testTag("search"), verticalAlignment = Alignment.CenterVertically) {
                AssetImage("nav_1.png", null, Modifier.size(20.dp))
                Copy(home.text("search"), Modifier.padding(start = 14.dp), 16, color = DesignTokens.muted)
            }
            BoxWithConstraints(Modifier.padding(top = 16.dp).fillMaxWidth()
                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                .drawWithContent {
                    drawContent()
                    val fadeStart = (1f - 24.dp.toPx() / size.width).coerceIn(0f, 1f)
                    drawRect(Brush.horizontalGradient(0f to Color.Black, fadeStart to Color.Black, 1f to Color.Transparent), blendMode = BlendMode.DstIn)
                }) {
                val itemWidth = (maxWidth - 32.dp) / 4.5f
                Row(Modifier.horizontalScroll(rememberScrollState()).testTag("categories"), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    (home.categories + home.categories.take(2)).chunked(2).forEachIndexed { column, pair ->
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            pair.forEach { item ->
                                val modifier = Modifier.width(itemWidth).heightIn(min = 90.dp).then(if (column == 4) Modifier.clearAndSetSemantics { } else Modifier)
                                Column(modifier.clickable { open(item.label) }.padding(top = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                    AssetImage(item.icon, null, Modifier.size(48.dp))
                                    Copy(item.label, Modifier.padding(top = 6.dp), 12, align = TextAlign.Center)
                                }
                            }
                        }
                    }
                }
            }
            Banner(home.text("quoteCopy"), home.text("quoteAction"), open)
            Section(home.text("recentTitle"), home.text("unavailable"))
            Banner(home.text("registerCopy"), home.text("registerAction"), open)
            Copy(home.text("popularTitle"), Modifier.padding(top = 20.dp).semantics { heading() }, 19, true)
            Row(Modifier.padding(top = 8.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                home.popularTabs.forEachIndexed { index, title ->
                    FilterChip(selected = popular == index, onClick = { popular = index }, label = { Copy(title) },
                        shape = RoundedCornerShape(percent = 50),
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = DesignTokens.soft))
                }
            }
            EmptyCopy(home.text("unavailable"))
            Section(home.text("historyTitle"), home.text("historyEmpty"))
            TextButton(onClick = { onProtected("마이페이지") }) { Copy("로그인/가입 · 회원관리") }
            TextButton(onClick = { onPolicy("OPERATIONS") }) { Copy("서비스 운영정책") }
            TextButton(onClick = { onPolicy("PRIVACY_POLICY") }) { Copy("개인정보 처리방침") }
            Copy("구글 로그인을 이용할 수 있으며, 문자 인증은 준비 중입니다.", Modifier.padding(vertical = 24.dp), 12, color = DesignTokens.muted)
            if (apiStatus != null) Copy(apiStatus, Modifier.padding(bottom = 16.dp).testTag("api-status"), 12, color = DesignTokens.muted)
        }
        HorizontalDivider(color = DesignTokens.border)
        Row(Modifier.fillMaxWidth().padding(vertical = 5.dp).selectableGroup(), horizontalArrangement = Arrangement.SpaceEvenly) {
            home.navigation.forEachIndexed { index, item ->
                Column(Modifier.weight(1f).heightIn(min = 58.dp).padding(horizontal = 4.dp)
                    .background(if (index == 0) DesignTokens.soft else Color.White, RoundedCornerShape(8.dp))
                    .selectable(selected = index == 0, role = Role.Tab, onClick = { if (index != 0) open(item.label) })
                    .padding(vertical = 7.dp).testTag("nav-$index"),
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    AssetImage(item.icon, null, Modifier.size(26.dp))
                    Copy(item.label, Modifier.padding(top = 3.dp), 11, index == 0, if (index == 0) DesignTokens.navy else DesignTokens.muted)
                }
            }
        }
    }
    notice?.let { title ->
        AlertDialog(onDismissRequest = { notice = null }, title = { Copy(title, size = 19, bold = true) },
            text = { Copy("이 기능은 다음 개발 단계에서 연결됩니다. 공개 탐색과 회원·정책 화면을 이용할 수 있습니다.") },
            confirmButton = { TextButton(onClick = { notice = null }) { Copy("확인") } })
    }
}
@Composable private fun ProfileCard(state: ProfileState, onRetry: () -> Unit, onLogin: () -> Unit, onExpertHome: () -> Unit) {
    val tag = when (state) {
        ProfileState.Loading -> "profile-loading"
        ProfileState.Empty -> "profile-empty"
        is ProfileState.Failed -> "profile-error"
        is ProfileState.Ready -> "profile-ready"
    }
    val signedIn = state is ProfileState.Ready
    Column(Modifier.padding(top = 14.dp).fillMaxWidth().heightIn(min = 60.dp)
        .background(if (signedIn) DesignTokens.soft else Color.White, RoundedCornerShape(6.dp))
        .border(1.dp, if (signedIn) DesignTokens.soft else DesignTokens.border, RoundedCornerShape(6.dp))
        .padding(horizontal = 14.dp, vertical = 12.dp).testTag(tag)) {
        when (state) {
            ProfileState.Loading -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(16.dp), color = DesignTokens.navy, strokeWidth = 2.dp)
                Copy("회원 정보를 불러오는 중…", Modifier.padding(start = 10.dp), size = 13, color = DesignTokens.muted)
            }
            is ProfileState.Ready -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Copy(state.nickname, size = 16, bold = true)
                    if (state.expert) Box(Modifier.padding(start = 8.dp).background(DesignTokens.lime, RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)) { Copy("고수", size = 11, weight = FontWeight.SemiBold) }
                    if (state.status == "RESTRICTED") Box(Modifier.padding(start = 8.dp).border(1.dp, DesignTokens.muted, RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)) { Copy("이용 제한", size = 11, color = DesignTokens.muted) }
                }
                Copy(if (state.customerNumber.isBlank()) "고객번호 없음" else "고객번호 ${state.customerNumber}",
                    Modifier.padding(top = 4.dp), size = 13, color = DesignTokens.muted)
                if (state.expert) TextButton(onClick = onExpertHome,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("open-expert-home")) {
                    Copy("고수 홈", weight = FontWeight.SemiBold)
                }
            }
            ProfileState.Empty -> {
                Copy("로그인하면 회원 정보가 표시됩니다.", size = 13, color = DesignTokens.muted)
                TextButton(onClick = onLogin, modifier = Modifier.heightIn(min = 48.dp).testTag("profile-login")) {
                    Copy("로그인", weight = FontWeight.SemiBold)
                }
            }
            is ProfileState.Failed -> {
                Copy(if (state.network) "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해주세요."
                    else "회원 정보를 불러오지 못했습니다. (${state.code})", size = 13, color = DesignTokens.muted)
                TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp).testTag("profile-retry")) {
                    Copy("다시 시도", weight = FontWeight.SemiBold)
                }
            }
        }
    }
}
@Composable private fun Banner(text: String, action: String, open: (String) -> Unit) {
    Column(Modifier.padding(top = 18.dp).fillMaxWidth().background(Color(0xFFF4F4F4), RoundedCornerShape(6.dp)).padding(14.dp)) {
        Copy(text, size = 15, weight = FontWeight.SemiBold)
        TextButton(onClick = { open(action) }, modifier = Modifier.align(Alignment.End).heightIn(min = 48.dp)) { Copy("$action  →", weight = FontWeight.SemiBold) }
    }
}
@Composable private fun Section(title: String, empty: String) {
    Copy(title, Modifier.padding(top = 20.dp).semantics { heading() }, 19, true)
    EmptyCopy(empty)
}
@Composable private fun EmptyCopy(text: String) {
    Copy(text, Modifier.padding(top = 13.dp).fillMaxWidth().border(1.dp, DesignTokens.border, RoundedCornerShape(6.dp)).padding(20.dp), color = DesignTokens.muted)
}
