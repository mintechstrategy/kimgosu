package ai.mintech.kimgosu

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import ai.mintech.kimgosu.auth.*
import ai.mintech.kimgosu.auth.ui.*
import kotlinx.coroutines.*
import org.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class PolicySnapshotTests {
    private val app get()=ApplicationProvider.getApplicationContext<Application>()
    private fun main(block:()->Unit)=InstrumentationRegistry.getInstrumentation().runOnMainSync(block)
    private fun wait(model:AuthModel) { repeat(250){var done=false;main{done=!model.state.busy};if(done)return;Thread.sleep(10)};error("MODEL_TIMEOUT") }
    private fun input(name:String)=InstrumentationRegistry.getInstrumentation().context.assets.open(name).bufferedReader().use{it.readText()}
    private fun receipt(id:String) {File(app.filesDir,"policy-cases.jsonl").appendText(JSONObject().put("id",id).put("status","PASS").toString()+"\n")}
    @Test fun snapshotOracle() {
        val cases=JSONArray(input("oracle.json"))
        repeat(cases.length()){i->val row=cases.getJSONObject(i);val id=row.getString("id");val valid=row.getBoolean("valid")
            val parsed=runCatching {PolicySnapshot.decode(row.getJSONObject("envelope"))}.getOrNull()
            assertEquals(id,valid,parsed!=null)
            parsed?.let {snap->
                assertEquals(id,row.getBoolean("ready"),snap.ready)
                assertEquals(id,if(row.isNull("currentTerms"))null else row.getString("currentTerms"),snap.current("TERMS")?.id)
                if(snap.ready){val body=snap.consentBody(snap.requirements.requiredGrantKinds);assertEquals(snap.policyRevision,body.getString("expectedPolicyRevision"));val list=body.getJSONArray("consents");assertEquals(listOf("TERMS","PRIVACY_CONSENT"),List(list.length()){list.getJSONObject(it).getString("kind")})}
            };receipt("snapshot-$id")
        }
    }
    private class Local(var response:JSONObject):AuthTransport {
        var slow=false;var reject=false
        val calls=mutableListOf<Triple<String,String,JSONObject?>>()
        override suspend fun request(method:String,path:String,token:String?,body:JSONObject?):JSONObject {
            calls+=Triple(method,path,body)
            if(method=="POST"){if(reject)throw AuthFailure(409,"POLICY_VERSION_CHANGED");return JSONObject().put("recorded",true)}
            check(path.contains("metadata=policy-v0.3") && token==null)
            val captured=JSONObject(response.toString());if(slow)withContext(NonCancellable){delay(150)};return captured
        }
    }
    @Test fun modelFreshRevisionAndBoundMutations()= runBlocking {
        SecureSession(app).clear();val base=JSONObject(input("ready.json"));val t=Local(base);lateinit var model:AuthModel
        main{model=AuthModel(app,AuthRepository(t));model.start()};wait(model)
        main{model.handle(AuthEvent(AuthAction.OPEN,"E2_TERMS"))};wait(model)
        main{model.handle(AuthEvent(AuthAction.CHANGE_ALL_CONSENTS,value="true"));assertTrue(model.state.canContinue);assertTrue(model.state.documents[AuthDocumentKind.TERMS]!!.canConsent)}
        receipt("model-server-authority-no-local-clock-or-trim-veto")
        val before=t.calls.size;main{model.refreshPolicy()};wait(model);main{assertTrue(model.state.canContinue)};assertEquals(before+1,t.calls.size)
        receipt("model-resume-fresh-no-store-same-revision-retains")
        main{model.handle(AuthEvent(AuthAction.OPEN_DOCUMENT,"TERMS"))};wait(model)
        main{assertEquals(base.getString("body"),model.state.documents[AuthDocumentKind.TERMS]?.body);model.back()};wait(model);main{assertTrue(model.state.canContinue)}
        receipt("model-detail-and-return-fresh-single-snapshot")
        val cases=JSONArray(input("oracle.json"));fun get(id:String):JSONObject=(0 until cases.length()).map{cases.getJSONObject(it)}.first{it.getString("id")==id}.getJSONObject("envelope")
        t.response=get("revision-changed");main{model.handle(AuthEvent(AuthAction.SUBMIT_CONSENTS))};wait(model)
        main{assertFalse(model.state.canContinue);assertEquals(setOf("age14"),model.state.accepted);assertTrue(model.state.error.contains("정책이 변경"))};assertFalse(t.calls.any{it.first=="POST"})
        receipt("model-final-fresh-revision-change-clear-no-replay")
        main{model.handle(AuthEvent(AuthAction.CHANGE_ALL_CONSENTS,value="true"))};t.response=get("same-revision-hash-changed");main{model.refreshPolicy()};wait(model);main{assertFalse(model.state.canContinue)}
        receipt("model-raw-hash-change-clears")
        t.response=JSONObject();main{model.refreshPolicy()};wait(model);main{assertFalse(model.state.canContinue);assertFalse(model.state.policyReady);assertNull(model.snapshot)}
        receipt("model-missing-failclosed-retry")
        t.response=base;main{model.refreshPolicy()};wait(model);main{assertNotNull(model.snapshot)}
        t.slow=true;main{model.handle(AuthEvent(AuthAction.OPEN_DOCUMENT,"TERMS"))};Thread.sleep(20);main{model.back()};Thread.sleep(350);main{assertEquals(AuthScreen.E2_TERMS,model.state.screen);assertFalse(model.state.busy)}
        receipt("model-cancel-epoch-late-snapshot-no-navigation")
        t.slow=false;t.reject=true;val repo=AuthRepository(t);val snap=PolicySnapshot.decode(base)
        for(op in listOf("signup","grant")){
            val count=t.calls.count{it.first=="POST"}
            try{if(op=="signup")repo.signup(JSONObject().put("name","보존 이름").put("email","test@example.invalid").put("age14Confirmed",true).put("expertRequested",false).put("registrationTicket","local-only"),snap,snap.requirements.requiredGrantKinds) else repo.recordConsents("test-only",snap,snap.requirements.requiredGrantKinds);fail("expected conflict")}
            catch(e:AuthFailure){assertEquals("POLICY_VERSION_CHANGED",e.code);assertEquals(AuthRequestContext.PRIVATE,e.requestContext)}
            assertEquals(count+1,t.calls.count{it.first=="POST"});assertEquals(snap.policyRevision,t.calls.last().third!!.getString("expectedPolicyRevision"));receipt("repository-$op-bound-revision-conflict-single-send")
        }
        main{model.failure(AuthFailure(409,"POLICY_VERSION_CHANGED",AuthRequestContext.PRIVATE))};wait(model)
        main{assertEquals(setOf("age14"),model.state.accepted);assertTrue(model.state.error.contains("정책이 변경"))};receipt("model-private-revision-rejection-refresh-no-post")
        t.response=base
        main{model.handle(AuthEvent(AuthAction.BROWSE));model.enter();model.handle(AuthEvent(AuthAction.OPEN,"E2_TERMS"))};wait(model)
        main{model.handle(AuthEvent(AuthAction.CHANGE_ALL_CONSENTS,value="true"));assertTrue(model.state.canContinue)}
        t.response=get("revision-changed");val reentryBefore=t.calls.size;main{model.refreshPolicy()};wait(model)
        main{assertEquals(reentryBefore+1,t.calls.size);assertEquals(setOf("age14"),model.state.accepted);assertFalse(model.state.canContinue)}
        t.response=base;main{model.refreshPolicy()};wait(model)
        main{model.handle(AuthEvent(AuthAction.CHANGE_ALL_CONSENTS,value="true"));model.handle(AuthEvent(AuthAction.OPEN_DOCUMENT,"TERMS"))};wait(model)
        t.response=get("revision-changed");val documentBefore=t.calls.size;main{model.refreshPolicy()};wait(model)
        main{assertEquals(documentBefore+1,t.calls.size);assertEquals(setOf("age14"),model.state.accepted);assertEquals(AuthScreen.TERMS_DOC,model.state.screen)}
        receipt("model-browsing-return-resume-current-refresh")
        SecureSession(app).clear()
    }
}
