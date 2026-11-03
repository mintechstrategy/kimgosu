import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ApiError, createApiClient, privateFailure, safeMessage } from '../../src/api.ts';
const base = 'http://127.0.0.1:4999';
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const publicCalls = [ ['config', (a: ReturnType<typeof createApiClient>) => a.config()], ['policies', (a: ReturnType<typeof createApiClient>) => a.policies()], ['document', (a: ReturnType<typeof createApiClient>) => a.document('TERMS')], ['document', (a: ReturnType<typeof createApiClient>) => a.document('TERMS','isolated-old-version')] ] as const;
for (const signedIn of [false,true]) for (const [i,[operation,call]] of publicCalls.entries()) for (const shape of ['contract401','contract403','html401','html403','edge403','malformed200'] as const) {
  test(`CORE-UIQA-01 public context signedIn=${signedIn} operation=${operation}/${i} ${shape}`, async () => {
    const ephemeral = randomBytes(24).toString('hex'); let publicDone = false;
    const api = createApiClient(base, (async (url, init) => {
      const headers = init!.headers as Record<string,string>;
      if (publicDone) { assert.equal(headers.Authorization, signedIn ? 'Bearer '+ephemeral : undefined); return json({error:{code:'AUTH_REQUIRED'}},401); }
      assert.equal(headers.Authorization, undefined, 'Public request is token-free even when signed in');
      if (shape==='contract401') return json({error:{code:'SESSION_INVALID'}},401);
      if (shape==='contract403') return json({error:{code:'ACCOUNT_RESTRICTED'}},403);
      if (shape==='edge403') return json({edge:true},403);
      if (shape==='malformed200') return json({});
      return new Response('<html>edge denial</html>',{status:shape==='html401'?401:403});
    }) as typeof fetch);
    if (signedIn) api.setSession(ephemeral);
    await assert.rejects(call(api), (e: ApiError) => { assert.deepEqual(e.context,{access:'public',operation}); assert.equal(privateFailure(e),undefined); return true; });
    publicDone = true;
    await assert.rejects(api.me(),(e: ApiError) => e.context?.access==='private');
  });
}
for (const [status, code, decision] of [[401,'AUTH_REQUIRED','expired'],[401,'SESSION_INVALID','expired'],[401,'SESSION_EXPIRED','expired'],[401,'UNAUTHORIZED','expired'],[401,'FORBIDDEN',undefined],[403,'ACCOUNT_RESTRICTED','restricted'],[403,'CONSENT_RENEWAL_REQUIRED','reconsent'],[403,'FORBIDDEN',undefined],[403,'ORIGIN_NOT_ALLOWED',undefined],[403,'UNRECOGNIZED',undefined]] as const) {
  test(`CORE-UIQA-01 private ${status}/${code} uses actual reason`,async()=>{
    const api = createApiClient(base,(async()=>json({error:{code}},status)) as typeof fetch);
    await assert.rejects(api.saveNotification('chat',false,1),(e: ApiError)=>{assert.equal(privateFailure(e),decision); assert.deepEqual(e.context,{access:'private',operation:'saveNotification'}); if(decision==='reconsent') assert.match(safeMessage(e),/재동의/);return true;});
  });
}
test('CORE-UIQA-01 private HTML401 and non-contract403 are response errors, not account decisions',async()=>{
  for(const response of [new Response('<html>denial</html>',{status:401}),json({edge:true},403)]) {
    const api=createApiClient(base,(async()=>response) as typeof fetch);
    await assert.rejects(api.me(),(e:ApiError)=>e.code==='INVALID_RESPONSE'&&e.context?.access==='private'&&privateFailure(e)===undefined);
  }
});
test('CORE-UIQA-01 aborted transport late success cannot become a successful response',async()=>{
  const api=createApiClient(base,(async()=>{await new Promise(r=>setTimeout(r,25));return json({documents:[]});}) as typeof fetch,2);
  await assert.rejects(api.policies(),(e:ApiError)=>e.code==='TIMEOUT'&&e.context?.access==='public');
});
test('CORE-UIQA-01 parsing/body verification remains public-scoped',async()=>{
  const api=createApiClient(base,(async()=>json({kind:'TERMS',title:'isolated',version:'isolated-v1',status:'DRAFT',body:'isolated-body',bodySha256:'0'.repeat(64),operator:null,effectiveAt:null,canConsent:false})) as typeof fetch);
  await assert.rejects(api.document('TERMS'),(e:ApiError)=>e.code==='INVALID_RESPONSE'&&e.context?.access==='public');
});
