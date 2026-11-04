package ai.mintech.kimgosu.customer

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import ai.mintech.kimgosu.auth.MembershipHttp
import ai.mintech.kimgosu.auth.SecureSession
import ai.mintech.kimgosu.expert.ExpertCopy
import ai.mintech.kimgosu.expert.expertFont
import ai.mintech.kimgosu.ui.DesignTokens
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.io.IOException

sealed interface CustomerReviewSubmit {
    data object Idle : CustomerReviewSubmit
    data object Busy : CustomerReviewSubmit
    data class Failed(val message: String) : CustomerReviewSubmit
}

class CustomerReviewModel(
    private val transport: AuthTransport = MembershipHttp(),
    private val sessions: SecureSession,
) {
    var submit by mutableStateOf<CustomerReviewSubmit>(CustomerReviewSubmit.Idle); private set

    /** 후기 자격(완료된 거래·기간·중복)은 서버가 판정한다. 화면은 응답 코드만 안내한다. */
    suspend fun submit(ledgerId: String, rating: Int, body: String, onDone: () -> Unit) {
        if (submit is CustomerReviewSubmit.Busy) return
        if (rating !in 1..5) {
            submit = CustomerReviewSubmit.Failed("별점을 선택해주세요.")
            return
        }
        val token = runCatching { sessions.read() }.getOrNull()
        if (token == null) {
            submit = CustomerReviewSubmit.Failed("세션이 만료되었습니다. 다시 로그인해주세요.")
            return
        }
        submit = CustomerReviewSubmit.Busy
        try {
            transport.request("POST", "/v1/ledgers/" + java.net.URLEncoder.encode(ledgerId, "UTF-8") + "/reviews", token,
                org.json.JSONObject().put("rating", rating).put("body", body))
            submit = CustomerReviewSubmit.Idle
            onDone()
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthFailure) {
            submit = CustomerReviewSubmit.Failed(when (e.code) {
                "REVIEW_EXISTS" -> "이미 후기를 작성했습니다."
                "REVIEW_NOT_ELIGIBLE" -> "완료된 거래에만 후기를 남길 수 있습니다."
                "REVIEW_WINDOW_CLOSED" -> "후기 작성 기간이 지났습니다."
                else -> if (e.status == 401) "세션이 만료되었습니다. 다시 로그인해주세요." else "후기를 저장하지 못했습니다. (${e.code})"
            })
        } catch (_: IOException) {
            submit = CustomerReviewSubmit.Failed("네트워크에 연결할 수 없습니다.")
        } catch (_: Exception) {
            submit = CustomerReviewSubmit.Failed("후기를 저장하지 못했습니다. (INVALID_API_RESPONSE)")
        }
    }
}

@Composable
fun CustomerReviewScreen(ledgerId: String, expertNickname: String, onBack: () -> Unit, onDone: () -> Unit) {
    val context: Context = LocalContext.current.applicationContext
    val model = remember(ledgerId) { CustomerReviewModel(MembershipHttp(context), SecureSession(context)) }
    val scope = rememberCoroutineScope()
    CustomerReviewContent(
        expertNickname = expertNickname,
        submit = model.submit,
        onSubmit = { rating, body -> scope.launch { model.submit(ledgerId, rating, body, onDone) } },
        onBack = onBack,
    )
}

@Composable
fun CustomerReviewContent(
    expertNickname: String,
    submit: CustomerReviewSubmit,
    onSubmit: (Int, String) -> Unit,
    onBack: () -> Unit,
) {
    var rating by remember { mutableStateOf(0) }
    var body by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding().padding(horizontal = 20.dp).testTag("customer-review")) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            ExpertCopy("후기 작성", Modifier.weight(1f), 22, bold = true)
            TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp).testTag("customer-review-back")) { ExpertCopy("뒤로") }
        }
        ExpertCopy((expertNickname.ifBlank { "고수" }) + " 님과의 거래는 어떠셨나요?", Modifier.padding(top = 16.dp), 15, color = DesignTokens.muted)
        Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (1..5).forEach { value ->
                Box(Modifier.size(48.dp).border(1.dp, if (rating >= value) DesignTokens.navy else DesignTokens.border, RoundedCornerShape(6.dp))
                    .background(if (rating >= value) DesignTokens.soft else Color.White, RoundedCornerShape(6.dp))
                    .clickable { rating = value }.testTag("customer-rating-$value"), contentAlignment = Alignment.Center) {
                    ExpertCopy("★", align = TextAlign.Center, weight = if (rating >= value) FontWeight.Bold else FontWeight.Normal,
                        color = if (rating >= value) DesignTokens.navy else DesignTokens.muted)
                }
            }
        }
        ExpertCopy(if (rating == 0) "별점을 선택해주세요." else "$rating 점", Modifier.padding(top = 8.dp).testTag("customer-rating-value"), 13, color = DesignTokens.muted)
        OutlinedTextField(
            value = body,
            onValueChange = { if (it.length <= 2000) body = it },
            modifier = Modifier.padding(top = 16.dp).fillMaxWidth().testTag("customer-review-body"),
            placeholder = { Text("후기를 남겨주세요 (선택)", fontFamily = expertFont(), fontSize = 14.sp) },
            textStyle = TextStyle(fontFamily = expertFont(), fontSize = 14.sp, color = DesignTokens.navy),
            minLines = 4,
            shape = RoundedCornerShape(6.dp),
        )
        (submit as? CustomerReviewSubmit.Failed)?.let { ExpertCopy(it.message, Modifier.padding(top = 10.dp).testTag("customer-review-error"), 13) }
        Button(onClick = { onSubmit(rating, body.trim()) }, enabled = submit !is CustomerReviewSubmit.Busy,
            modifier = Modifier.padding(top = 20.dp).fillMaxWidth().heightIn(min = 50.dp).testTag("customer-review-submit"),
            colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy)) {
            ExpertCopy(if (submit is CustomerReviewSubmit.Busy) "등록 중…" else "후기 등록", color = Color.White, weight = FontWeight.SemiBold)
        }
    }
}
