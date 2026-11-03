package ai.mintech.kimgosu

import ai.mintech.kimgosu.auth.AuthRepository
import ai.mintech.kimgosu.auth.SecureSession
import ai.mintech.kimgosu.ui.DesignTokens
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

/**
 * Temporary tester login.
 *
 * Social providers are not connected yet, so the dev deployment exposes a fixed
 * list of 20 seeded accounts. Tapping one asks the server for a real session and
 * stores the issued bearer token in the same SecureSession the rest of the app
 * uses, so every later call is an authenticated server request — no local-only
 * identity is created here.
 *
 * Development builds only. The list is served by the API, which registers these
 * routes only when the deployment environment is exactly 'dev'.
 */

private data class DevAccount(val slot: Int, val role: String, val label: String, val nickname: String)

private fun parseAccounts(raw: JSONObject): List<DevAccount> {
    val array: JSONArray = raw.getJSONArray("accounts")
    return List(array.length()) { index ->
        val item = array.getJSONObject(index)
        DevAccount(
            slot = item.getInt("slot"),
            role = item.getString("role"),
            label = item.getString("label"),
            nickname = item.getString("nickname"),
        )
    }
}

@Composable
fun DevTestLoginGate(onReady: () -> Unit) {
    val context = LocalContext.current
    val session = remember { SecureSession(context) }
    val repository = remember { AuthRepository() }

    var accounts by remember { mutableStateOf<List<DevAccount>?>(null) }
    var busySlot by remember { mutableStateOf<Int?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var signedInAs by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            accounts = parseAccounts(repository.devAccounts())
        } catch (failure: Exception) {
            error = "계정 목록을 불러오지 못했습니다: ${failure.message}"
        }
    }

    fun login(slot: Int) {
        busySlot = slot
        error = null
    }

    LaunchedEffect(busySlot) {
        val slot = busySlot ?: return@LaunchedEffect
        try {
            val response = repository.devLogin(slot)
            val token = response.getJSONObject("session").getString("accessToken")
            session.write(token)
            // Prove the session is real: read the private profile with it.
            val me = repository.me(token)
            signedInAs = "${me.getString("nickname")} · 고객번호 ${me.getString("customerNumber")}"
        } catch (failure: Exception) {
            error = "로그인 실패: ${failure.message}"
        } finally {
            busySlot = null
        }
    }

    Box(Modifier.fillMaxSize().background(Color.White).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(24.dp))
            Text("임시 로그인", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = DesignTokens.navy)
            Spacer(Modifier.height(6.dp))
            Text(
                "소셜 로그인 연결 전 테스트용입니다. 계정을 선택하면 서버가 실제 세션을 발급합니다.",
                fontSize = 13.sp,
                color = Color(0xFF5F6B7A),
            )
            Spacer(Modifier.height(16.dp))

            signedInAs?.let { who ->
                Surface(color = DesignTokens.soft, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("로그인됨", fontSize = 13.sp, color = DesignTokens.navy)
                        Spacer(Modifier.height(4.dp))
                        Text(who, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = DesignTokens.navy)
                    }
                }
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = onReady,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = DesignTokens.navy, contentColor = Color.White),
                ) { Text("앱으로 계속") }
                Spacer(Modifier.height(12.dp))
            }

            error?.let {
                Text(it, fontSize = 13.sp, color = Color(0xFFB42332))
                Spacer(Modifier.height(8.dp))
            }

            val list = accounts
            if (list == null) {
                Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DesignTokens.navy)
                }
            } else {
                LazyColumn(Modifier.weight(1f)) {
                    listOf("USER" to "일반 사용자", "EXPERT" to "고수 사용자").forEach { (role, title) ->
                        item(key = "header-$role") {
                            Text(
                                title,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = DesignTokens.navy,
                                modifier = Modifier.padding(top = 12.dp, bottom = 8.dp),
                            )
                        }
                        items(list.filter { it.role == role }, key = { it.slot }) { account ->
                            OutlinedButton(
                                onClick = { login(account.slot) },
                                enabled = busySlot == null,
                                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).height(48.dp),
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                Text(
                                    if (busySlot == account.slot) "로그인 중…" else "${account.label}  (${account.nickname})",
                                    fontSize = 14.sp,
                                )
                            }
                        }
                    }
                    item(key = "tail") { Spacer(Modifier.height(16.dp)) }
                }
            }
        }
    }
}
