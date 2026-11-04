package ai.mintech.kimgosu.chat

import ai.mintech.kimgosu.auth.AuthFailure
import ai.mintech.kimgosu.auth.AuthTransport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * WS-51 채팅 이미지 첨부 — 서버 계약(contracts/chat.v0.1.json)의 클라이언트 구현.
 *
 * 사진은 API를 거치지 않는다. `POST /v1/uploads {contentType, kind:"chat"}`로 받은
 * presigned URL에 바이트를 직접 PUT하고, 돌려받은 키(`chat/<memberId>/...`)만
 * 메시지 전송에 쓴다. 조회 응답의 imageUrl은 서버가 R2 공개 도메인으로 합성한 값이며
 * 클라이언트는 URL을 만들지 않는다.
 */
data class ChatMessage(
    val id: String,
    val ledgerId: String,
    val senderId: String,
    /** 이미지 전용 메시지와 삭제된 메시지는 빈 문자열이다. */
    val body: String,
    val imageUrl: String?,
    val imageWidth: Int?,
    val imageHeight: Int?,
    val deleted: Boolean,
    val createdAt: String,
) {
    companion object {
        private fun JSONObject.text(key: String): String? =
            if (isNull(key)) null else optString(key, "").ifEmpty { null }

        fun decode(json: JSONObject) = ChatMessage(
            id = json.getString("id"),
            ledgerId = json.getString("ledgerId"),
            senderId = json.getString("senderId"),
            body = json.text("body").orEmpty(),
            imageUrl = json.text("imageUrl"),
            imageWidth = if (json.isNull("imageWidth")) null else json.optInt("imageWidth"),
            imageHeight = if (json.isNull("imageHeight")) null else json.optInt("imageHeight"),
            deleted = json.optBoolean("deleted", false),
            createdAt = json.getString("createdAt"),
        )
    }
}

data class ChatPage(val messages: List<ChatMessage>, val total: Int, val nextCursor: String?)

class ChatApi(private val transport: AuthTransport) {

    suspend fun list(token: String, ledgerId: String, before: String? = null): ChatPage {
        val query = before?.let { "?before=" + java.net.URLEncoder.encode(it, "UTF-8") }.orEmpty()
        val body = transport.request("GET", "/v1/ledgers/$ledgerId/messages$query", token)
        val rows = body.getJSONArray("messages")
        return ChatPage(
            messages = List(rows.length()) { ChatMessage.decode(rows.getJSONObject(it)) },
            total = body.optInt("total"),
            nextCursor = if (body.isNull("nextCursor")) null else body.getString("nextCursor"),
        )
    }

    suspend fun sendText(token: String, ledgerId: String, body: String) =
        send(token, ledgerId, JSONObject().put("body", body))

    /** 사진을 R2에 올린 뒤 그 키로 메시지를 보낸다. 본문은 선택이다. */
    suspend fun sendPhoto(
        token: String,
        ledgerId: String,
        bytes: ByteArray,
        contentType: String,
        width: Int,
        height: Int,
        body: String = "",
    ): ChatMessage {
        val key = upload(token, bytes, contentType)
        val payload = JSONObject().put("imageKey", key).put("imageWidth", width).put("imageHeight", height)
        if (body.isNotBlank()) payload.put("body", body)
        return send(token, ledgerId, payload)
    }

    private suspend fun send(token: String, ledgerId: String, payload: JSONObject) =
        ChatMessage.decode(transport.request("POST", "/v1/ledgers/$ledgerId/messages", token, payload))

    private suspend fun upload(token: String, bytes: ByteArray, contentType: String): String =
        withContext(Dispatchers.IO) {
            val slot = transport.request(
                "POST", "/v1/uploads", token,
                JSONObject().put("contentType", contentType).put("kind", "chat"),
            )
            val connection = URL(slot.getString("uploadUrl")).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "PUT"
                connection.doOutput = true
                connection.connectTimeout = 15000
                connection.readTimeout = 15000
                connection.setRequestProperty("Content-Type", slot.optString("contentType", contentType))
                connection.outputStream.use { out -> out.write(bytes) }
                if (connection.responseCode !in 200..299) {
                    throw AuthFailure(connection.responseCode, "UPLOAD_FAILED")
                }
            } finally {
                connection.disconnect()
            }
            slot.getString("key")
        }
}
