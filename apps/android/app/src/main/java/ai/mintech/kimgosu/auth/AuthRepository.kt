package ai.mintech.kimgosu.auth

import ai.mintech.kimgosu.BuildConfig
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.coroutineContext

/** Raw bearer values never enter URLs, logs, saved UI state, or public fixtures. */
class SecureSession(context: Context) {
    private val prefs = context.getSharedPreferences("auth_private", Context.MODE_PRIVATE)
    private val alias = "kimgosu.session.aes.v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    fun read(): String? {
        val raw = prefs.getString("sealed", null) ?: return null
        return try {
            val parts = raw.split(':'); require(parts.size == 2)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (_: Exception) { clear(); null }
    }
    fun write(token: String) {
        require(token.isNotBlank() && token.none { it == '\r' || it == '\n' })
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(cipher.doFinal(token.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        check(prefs.edit().putString("sealed", sealed).commit()) { "SESSION_STORAGE_FAILED" }
    }
    fun clear() { check(prefs.edit().remove("sealed").commit()) { "SESSION_STORAGE_FAILED" } }
}

enum class AuthRequestContext { UNKNOWN, PUBLIC, PRIVATE }
class AuthFailure(val status: Int, val code: String,
    val requestContext: AuthRequestContext = AuthRequestContext.UNKNOWN) : Exception(code)

/** Decode without losing HTTP status; a non-contract response is never an account verdict. */
fun decodeMembershipResponse(status: Int, raw: String): JSONObject {
    val json = try { JSONObject(raw) } catch (_: Exception) { throw AuthFailure(status, "INVALID_API_RESPONSE") }
    if (status !in 200..299) {
        val code = json.optJSONObject("error")?.opt("code") as? String
        throw AuthFailure(status, code?.takeIf { it.matches(Regex("[A-Z][A-Z0-9_]{0,79}")) } ?: "HTTP_ERROR")
    }
    return json
}
interface AuthTransport {
    suspend fun request(method: String, path: String, token: String? = null, body: JSONObject? = null): JSONObject
}
class MembershipHttp(private val context: Context? = null) : AuthTransport {
    // Resolved per build flavor. Never falls back to another environment.
    private val base = BuildConfig.API_BASE_URL
    override suspend fun request(method: String, path: String, token: String?, body: JSONObject?): JSONObject = withContext(Dispatchers.IO) {
        require(path.startsWith("/v1/") || path == "/health")
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method; connection.instanceFollowRedirects = false
            connection.connectTimeout = 8000; connection.readTimeout = 8000; connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            // Every write is JSON. Declared even without a body, and a bodiless write sends `{}`:
            // Android's HTTP stack otherwise defaults POST to application/x-www-form-urlencoded
            // (415), and an empty body under a JSON content type is rejected as 400
            // (both observed on POST /v1/auth/logout).
            val payload = body ?: if (method == "GET") null else JSONObject()
            if (method != "GET") connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            payload?.let {
                connection.doOutput = true
                connection.outputStream.use { out -> out.write(it.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (ai.mintech.kimgosu.BuildConfig.DEBUG && context != null) {
                val receipt = JSONObject().put("method", method).put("path", path).put("httpStatus", status)
                    .put("observedAt", java.time.Instant.now().toString()).put("cfRay", connection.getHeaderField("cf-ray") ?: JSONObject.NULL)
                java.io.File(context.filesDir, "membership-http.jsonl").appendText(receipt.toString() + "\n")
            }
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText().take(1_000_000) }.orEmpty()
            coroutineContext.ensureActive()
            decodeMembershipResponse(status, raw)
        } finally { connection.disconnect() }
    }
}
class AuthRepository(val transport: AuthTransport = MembershipHttp()) {
    // Scope belongs to the operation, never to whether this client happens to hold a token.
    private suspend fun request(context: AuthRequestContext, method: String, path: String,
        token: String? = null, body: JSONObject? = null): JSONObject {
        try {
            val result = transport.request(method, path, token, body)
            kotlinx.coroutines.currentCoroutineContext().ensureActive()
            return result
        } catch (e: AuthFailure) {
            kotlinx.coroutines.currentCoroutineContext().ensureActive()
            throw AuthFailure(e.status, e.code, context)
        }
    }
    suspend fun health() = request(AuthRequestContext.PUBLIC, "GET", "/health")
    suspend fun config() = request(AuthRequestContext.PUBLIC, "GET", "/v1/auth/config?metadata=policy-v0.3")
    suspend fun policies() = request(AuthRequestContext.PUBLIC, "GET", "/v1/policies?metadata=policy-v0.3")
    suspend fun policy(kind: String, version: String? = null): JSONObject {
        require(kind in listOf("TERMS", "PRIVACY_CONSENT", "PRIVACY_POLICY", "MARKETING", "OPERATIONS"))
        val suffix = version?.let { "&version=" + java.net.URLEncoder.encode(it, "UTF-8") }.orEmpty()
        return request(AuthRequestContext.PUBLIC, "GET", "/v1/policies/$kind?metadata=policy-v0.3$suffix")
    }
    suspend fun sendSms(ticket: String, phone: String) = request(AuthRequestContext.PRIVATE, "POST", "/v1/auth/sms/send", body = JSONObject().put("registrationTicket", ticket).put("phone", phone))
    suspend fun verifySms(ticket: String, challenge: String, code: String) = request(AuthRequestContext.PRIVATE, "POST", "/v1/auth/sms/verify", body = JSONObject().put("registrationTicket", ticket).put("challengeId", challenge).put("code", code))
    suspend fun withdrawMarketing(token: String) = request(AuthRequestContext.PRIVATE, "POST", "/v1/me/consents/withdraw", token, JSONObject().put("kind", "MARKETING"))
    suspend fun me(token: String) = request(AuthRequestContext.PRIVATE, "GET", "/v1/me", token)
    suspend fun consents(token: String) = request(AuthRequestContext.PRIVATE, "GET", "/v1/me/consents", token)
    suspend fun notifications(token: String) = request(AuthRequestContext.PRIVATE, "GET", "/v1/me/notifications", token)
    suspend fun changeNotification(token: String, version: Int, key: String, value: Boolean): JSONObject {
        require(key in listOf("advertising", "chat", "comment", "quote", "inquiry"))
        return request(AuthRequestContext.PRIVATE, "PATCH", "/v1/me/notifications", token, JSONObject().put("expectedVersion", version).put(key, value))
    }
    suspend fun recordConsents(token: String, snapshot: PolicySnapshot, kinds: List<String>) =
        request(AuthRequestContext.PRIVATE, "POST", "/v1/me/consents", token, snapshot.consentBody(kinds))
    suspend fun signup(input: JSONObject, snapshot: PolicySnapshot, kinds: List<String>): JSONObject {
        val body = JSONObject(input.toString()); val grant = snapshot.consentBody(kinds)
        body.put("consents", grant.getJSONArray("consents")).put("expectedPolicyRevision", snapshot.policyRevision)
        return request(AuthRequestContext.PRIVATE, "POST", "/v1/auth/signup", body = body)
    }
    suspend fun logout(token: String) = request(AuthRequestContext.PRIVATE, "POST", "/v1/auth/logout", token)
    // Expert self-view and owner writes. The server re-reads the expert flag and
    // rejects invalid price combinations; the client never corrects a payload.
    suspend fun expertSelf(token: String) = request(AuthRequestContext.PRIVATE, "GET", "/v1/me/expert", token)
    suspend fun patchExpertProfile(token: String, fields: JSONObject) =
        request(AuthRequestContext.PRIVATE, "PATCH", "/v1/expert/profile", token, fields)
    suspend fun createExpertService(token: String, body: JSONObject) =
        request(AuthRequestContext.PRIVATE, "POST", "/v1/expert/services", token, body)
    suspend fun patchExpertService(token: String, id: String, body: JSONObject) =
        request(AuthRequestContext.PRIVATE, "PATCH", "/v1/expert/services/" + java.net.URLEncoder.encode(id, "UTF-8"), token, body)
    // 고객 거래 흐름. 상태·금액·완료 여부는 모두 서버가 판정하며 클라이언트는
    // 표시만 한다. 목록/상세는 공개, 원장·메시지·견적·후기 작성은 세션 필요.
    suspend fun searchExperts(category: String?, cursor: String? = null): JSONObject {
        val query = buildString {
            append("/v1/experts?limit=20")
            if (!category.isNullOrBlank()) append("&category=" + java.net.URLEncoder.encode(category, "UTF-8"))
            if (!cursor.isNullOrBlank()) append("&cursor=" + java.net.URLEncoder.encode(cursor, "UTF-8"))
        }
        return request(AuthRequestContext.PUBLIC, "GET", query)
    }
    suspend fun expertDetail(expertId: String) =
        request(AuthRequestContext.PUBLIC, "GET", "/v1/experts/" + java.net.URLEncoder.encode(expertId, "UTF-8"))
    suspend fun expertReviews(expertId: String, limit: Int = 20) =
        request(AuthRequestContext.PUBLIC, "GET",
            "/v1/experts/" + java.net.URLEncoder.encode(expertId, "UTF-8") + "/reviews?limit=$limit")
    suspend fun createLedger(token: String, expertId: String) =
        request(AuthRequestContext.PRIVATE, "POST", "/v1/ledgers", token, JSONObject().put("expertId", expertId))
    suspend fun ledgerMessages(token: String, ledgerId: String) =
        request(AuthRequestContext.PRIVATE, "GET", ledgerPath(ledgerId) + "/messages?limit=50", token)
    suspend fun sendMessage(token: String, ledgerId: String, body: String) =
        request(AuthRequestContext.PRIVATE, "POST", ledgerPath(ledgerId) + "/messages", token, JSONObject().put("body", body))
    suspend fun ledgerQuotes(token: String, ledgerId: String) =
        request(AuthRequestContext.PRIVATE, "GET", ledgerPath(ledgerId) + "/quotes", token)
    suspend fun respondQuote(token: String, quoteId: String, action: String, expectedVersion: Int) =
        request(AuthRequestContext.PRIVATE, "POST",
            "/v1/quotes/" + java.net.URLEncoder.encode(quoteId, "UTF-8") + "/respond", token,
            JSONObject().put("action", action).put("expectedVersion", expectedVersion))
    suspend fun completeQuote(token: String, quoteId: String, expectedVersion: Int) =
        request(AuthRequestContext.PRIVATE, "POST",
            "/v1/quotes/" + java.net.URLEncoder.encode(quoteId, "UTF-8") + "/complete", token,
            JSONObject().put("expectedVersion", expectedVersion))
    suspend fun createReview(token: String, ledgerId: String, rating: Int, body: String?) {
        val payload = JSONObject().put("rating", rating)
        if (!body.isNullOrBlank()) payload.put("body", body)
        request(AuthRequestContext.PRIVATE, "POST", ledgerPath(ledgerId) + "/reviews", token, payload)
    }
    private fun ledgerPath(id: String) = "/v1/ledgers/" + java.net.URLEncoder.encode(id, "UTF-8")
    // Temporary tester login (dev deployment only). The server issues the session;
    // nothing about these calls creates a local-only identity.
    suspend fun devAccounts() = request(AuthRequestContext.PUBLIC, "GET", "/v1/auth/dev/accounts")
    suspend fun devLogin(slot: Int) = request(AuthRequestContext.PUBLIC, "POST", "/v1/auth/dev/login", body = JSONObject().put("slot", slot))
}

// v0.3 typed wire DTO; no local-clock eligibility, numeric ID or version sorting.
data class PolicyRow(val id:String,val kind:String,val version:String,val status:String,val title:String,val body:String,val bodySha256:String,
    val operator:String?,val effectiveAt:String?,val approvedAt:String?,val createdAt:String,val canConsent:Boolean,val isCurrent:Boolean,val isDisplay:Boolean)
data class PolicyCurrent(val id:String,val kind:String,val version:String,val bodySha256:String,val status:String,val canConsent:Boolean)
data class PolicySlot(val kind:String,val currentDocument:PolicyCurrent?)
data class PolicyRequirements(val requiredGrantKinds:List<String>,val requiredReadyKindsForGrant:List<String>,val optionalGrantKinds:List<String>,val operationsConsentRequired:Boolean)
data class PolicySnapshot(val policyRevision:String,val serverTime:String,val requirements:PolicyRequirements,val currentDocuments:List<PolicySlot>,val missingReadyKinds:List<String>,val documents:List<PolicyRow>) {
    val identity get() = policyRevision + documents.sortedBy{it.id}.joinToString { it.id + ":" + it.kind + ":" + it.version + ":" + it.bodySha256 + ":" + it.isCurrent + ":" + it.canConsent }
    val ready get()=missingReadyKinds.isEmpty()
    fun current(kind:String)=documents.firstOrNull { it.kind==kind && it.isCurrent }
    fun display(kind:String)=current(kind) ?: documents.firstOrNull { it.kind==kind && it.isDisplay }
    fun consentBody(kinds:List<String>):JSONObject {
        require(ready && kinds.distinct().size==kinds.size && kinds.containsAll(requirements.requiredGrantKinds) && (requirements.requiredGrantKinds+requirements.optionalGrantKinds).containsAll(kinds))
        val rows=org.json.JSONArray()
        kinds.forEach { kind -> val row=current(kind) ?: throw invalid();require(row.canConsent && row.version.length<=100);rows.put(JSONObject().put("kind",kind).put("version",row.version)) }
        return JSONObject().put("consents",rows).put("expectedPolicyRevision",policyRevision)
    }
    companion object {
        fun invalid()=AuthFailure(503,"POLICY_METADATA_UNAVAILABLE",AuthRequestContext.PUBLIC)
        private fun JSONObject.str(k:String)=get(k).let { require(it is String);it }
        private fun JSONObject.bool(k:String)=get(k).let { require(it is Boolean);it }
        private fun JSONObject.nullstr(k:String):String? { val v=get(k);require(v===JSONObject.NULL || v is String);return v as? String }
        private fun JSONObject.strings(k:String)=getJSONArray(k).let { a -> List(a.length()){i->a.get(i).let{require(it is String);it}} }
        private fun timestamp(s:String):Boolean=runCatching { require(Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z").matches(s));java.time.Instant.parse(s);true }.getOrDefault(false)
        private fun canonical(v:Any):Any=when(v) { is JSONObject -> v.keys().asSequence().toList().sorted().associateWith { canonical(v.get(it)) };is org.json.JSONArray -> List(v.length()){canonical(v.get(it))};else->v }
        fun decode(envelope:JSONObject):PolicySnapshot = try {
            val raw=envelope.getJSONObject("policySnapshot")
            require(raw.str("schemaVersion")=="policy-v0.3" && Regex("ps3-[0-9a-f]{64}").matches(raw.str("policyRevision")) && timestamp(raw.str("serverTime")) && raw.str("timeAuthority")=="POSTGRES_TRANSACTION_NOW")
            val cache=raw.getJSONObject("cache");require(cache.str("control")=="no-store" && cache.get("ttlSeconds") is Int && cache.getInt("ttlSeconds")==0 && cache.bool("revalidateBeforeConsent"))
            val req=raw.getJSONObject("requirements");val requirements=PolicyRequirements(req.strings("requiredGrantKinds"),req.strings("requiredReadyKindsForGrant"),req.strings("optionalGrantKinds"),req.bool("operationsConsentRequired"))
            require(requirements==PolicyRequirements(listOf("TERMS","PRIVACY_CONSENT"),listOf("TERMS","PRIVACY_CONSENT","PRIVACY_POLICY"),listOf("MARKETING"),false))
            require(canonical(raw.getJSONObject("constraints"))==canonical(JSONObject(POLICY_CONSTRAINTS)))
            val limit=raw.getJSONObject("limitations");require(!limit.bool("commitFence") && limit.str("allowedActions")=="NOT_IMPLEMENTED" && limit.str("materialChangeClassification")=="NOT_IMPLEMENTED")
            val arr=raw.getJSONArray("documents")
            val docs=List(arr.length()){i->val r=arr.getJSONObject(i);PolicyRow(r.str("id"),r.str("kind"),r.str("version"),r.str("status"),r.str("title"),r.str("body"),r.str("bodySha256"),r.nullstr("operator"),r.nullstr("effectiveAt"),r.nullstr("approvedAt"),r.str("createdAt"),r.bool("canConsent"),r.bool("isCurrent"),r.bool("isDisplay"))}
            val slots=raw.getJSONArray("currentDocuments").let{a->List(a.length()){i->val slot=a.getJSONObject(i);val c=slot.get("currentDocument");PolicySlot(slot.str("kind"),if(c===JSONObject.NULL)null else {require(c is JSONObject);PolicyCurrent(c.str("id"),c.str("kind"),c.str("version"),c.str("bodySha256"),c.str("status"),c.bool("canConsent"))})}}
            val result=PolicySnapshot(raw.str("policyRevision"),raw.str("serverTime"),requirements,slots,raw.strings("missingReadyKinds"),docs)
            val kinds=ai.mintech.kimgosu.auth.ui.AuthDocumentKind.entries.map{it.name}.toSet()
            require(slots.size==kinds.size && slots.map{it.kind}.toSet()==kinds && docs.map{it.id}.distinct().size==docs.size && docs.map{it.kind to it.version}.distinct().size==docs.size)
            require(docs.filter{it.isCurrent}.map{it.kind}.distinct().size==docs.count{it.isCurrent} && docs.filter{it.isDisplay}.map{it.kind}.distinct().size==docs.count{it.isDisplay})
            docs.forEach { r ->
                require(r.kind in kinds && r.id.isNotEmpty() && r.version.isNotEmpty() && r.status in listOf("DRAFT","READY","RETIRED"))
                require(timestamp(r.createdAt) && (r.effectiveAt?.let(::timestamp)?:true) && (r.approvedAt?.let(::timestamp)?:true))
                val sha=java.security.MessageDigest.getInstance("SHA-256").digest(r.body.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}
                require(Regex("[0-9a-f]{64}").matches(r.bodySha256) && sha==r.bodySha256)
                require(!r.canConsent || r.status=="READY");require(!r.isCurrent || (r.canConsent && r.status=="READY"))
            }
            slots.forEach { slot -> val r=result.current(slot.kind);val c=slot.currentDocument
                if(c==null)require(r==null) else require(r!=null && c.kind==slot.kind && c.status=="READY" && c.canConsent && c.id==r.id && c.version==r.version && c.bodySha256==r.bodySha256)
            }
            require(result.missingReadyKinds.distinct().size==result.missingReadyKinds.size && result.missingReadyKinds.toSet()==requirements.requiredReadyKindsForGrant.filter{result.current(it)==null}.toSet())
            result
        } catch(e:Exception) { throw invalid() }
    }
}

private const val POLICY_CONSTRAINTS = """{"consentInputs":{"type":"array","minItems":2,"maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["kind","version"],"properties":{"kind":{"type":"string","enum":["TERMS","PRIVACY_CONSENT","MARKETING"]},"version":{"type":"string","minLength":1,"maxLength":100}}}},"nickname":{"type":"string","pattern":"^[\\p{L}\\p{N}]{1,10}$","maxLength":10}}"""
