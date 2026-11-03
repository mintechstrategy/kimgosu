// Isolated browser-test double only. No fixture is imported by product code or dist.
import { createHash } from 'node:crypto';
import { snapshotFixture } from './snapshot-fixture.mjs';
export function makeFixture(options = {}) {
  const body = '브라우저 시험 전용 정책 초안\n실제 법률 문서나 이용 동의가 아닙니다.\n<script>window.untrustedPolicyExecuted = true</script>';
  const kinds = ['TERMS','PRIVACY_CONSENT','PRIVACY_POLICY','MARKETING','OPERATIONS'];
  const documents = kinds.map(kind=>({kind,title:({TERMS:'서비스 이용약관',PRIVACY_CONSENT:'개인정보 수집 및 이용 동의',PRIVACY_POLICY:'개인정보 처리방침',MARKETING:'마케팅 정보 수신 동의',OPERATIONS:'서비스 운영정책'})[kind],version:'browser-test-v1',status:'DRAFT',body,bodySha256:createHash('sha256').update(body).digest('hex'),operator:null,effectiveAt:null,canConsent:false}));
  const config = {release:'isolated-browser-test-double',signupReady:false,providers:['kakao','naver','google'].map(id=>({id,enabled:false,reason:'NOT_CONFIGURED'})),sms:{available:false,codeDigits:5,expiresInSeconds:60,phonePattern:'^010[0-9]{8}$'},requiredFields:['name','email'],minimumAgeAcknowledgement:14,collectsGender:false,collectsAgeGroup:false,rejoinWaitDays:30,retention:{purpose:'거래상대방 보호',startsAt:'WITHDRAWAL_CONFIRMED',calendarYears:1,rejoinResetsClock:false},documents:documents.map(({kind,version,status,canConsent})=>({kind,version,status,canConsent}))};
  const member = {id:'browser-test-member',customerNumber:'BROWSER-TEST-ONLY',name:'합성시험',email:'browser-test@example.invalid',nickname:'브라우저시험',status:options.restricted?'RESTRICTED':'ACTIVE',expertActive:false,createdAt:'2026-01-01T00:00:00Z'};
  const records = [{kind:'TERMS',title:'서비스 이용약관',version:'browser-test-v1',status:'GRANTED',recordedAt:'2026-01-02T00:00:00Z'},{kind:'MARKETING',title:'마케팅 정보 수신 동의',version:'browser-test-v1',status:'GRANTED',recordedAt:'2026-01-02T00:00:00Z'}];
  const state = { prefs:{advertising:false,chat:true,comment:false,quote:true,inquiry:false,version:1}, loggedOut:false, patches:[], requests:[], failDocument:!!options.failDocument, failConfig:!!options.failConfig, failPatch:options.failPatch, conflictOnce:!!options.conflictOnce, failLogout:!!options.failLogout, documentVersion:null };
  async function install(page) {
    await page.route('https://api-dev-kimgosu.mintech.ai/**',async route=>{
      const request=route.request(), url=new URL(request.url()), method=request.method(), path=url.pathname;
      state.requests.push({method,path,metadata:url.searchParams.get('metadata'),authorization:!!request.headers().authorization,cache:request.headers()['cache-control']});
      const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:4178','Cache-Control':'no-store'},body:JSON.stringify(data)});
      const error=(code,status)=>send({error:{code}},status);
      if(method==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:4178','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,Cache-Control'}});
      if(path==='/v1/auth/config')return state.failConfig?send({diagnostic:true}):send({...config,documents:state.currentDocuments??documents.map(({kind,version,status,canConsent})=>({kind,version,status,canConsent}))});
      if(path==='/v1/policies')return send({documents,policySnapshot:snapshotFixture(documents,state)});
      if(path.startsWith('/v1/policies/')){state.documentVersion=url.searchParams.get('version');if(state.failDocument)return error('DOCUMENT_PREPARING',404);const s=snapshotFixture(documents,state),kind=path.split('/').at(-1),id=s?.currentDocuments?.find(x=>x.kind===kind)?.currentDocument?.id;const d=state.documentVersion?s?.documents?.find(d=>d.kind===kind&&d.version===state.documentVersion):s?.documents?.find(d=>d.id===id)??s?.documents?.find(d=>d.kind===kind&&d.isDisplay);return d?send({...d,policySnapshot:s}):error('DOCUMENT_PREPARING',404);}
      if(path==='/v1/me')return options.unauthorized||state.loggedOut?error('UNAUTHORIZED',401):options.forbidden?error('ACCOUNT_RESTRICTED',403):send(member);
      if(path==='/v1/me/consents')return send({records});
      if(path==='/v1/me/notifications'&&method==='GET')return send(state.prefs);
      if(path==='/v1/me/notifications'&&method==='PATCH'){
        const payload=request.postDataJSON();state.patches.push(payload);
        if(options.denyPatchStatus)return error(options.denyPatchStatus===401?'UNAUTHORIZED':'ACCOUNT_RESTRICTED',options.denyPatchStatus);
        if(state.conflictOnce){state.conflictOnce=false;state.prefs.version++;return error('VERSION_CONFLICT',409);}
        if(payload.expectedVersion!==state.prefs.version)return error('VERSION_CONFLICT',409);
        const changes=Object.fromEntries(Object.entries(payload).filter(([k])=>k!=='expectedVersion'));state.prefs={...state.prefs,...changes,version:state.prefs.version+1};
        if(state.failPatch){state.failPatch=false;return route.abort('failed');}return send(state.prefs);
      }
      if(path==='/v1/auth/logout'&&method==='POST'){if(state.failLogout){state.failLogout=false;return error('FAILED',503);}state.loggedOut=true;return send({loggedOut:true});}
      return error('NOT_FOUND',404);
    });
  }
  return {install,state,documents,records,config,snapshot:()=>snapshotFixture(documents,state),envelope:d=>{const s=snapshotFixture(documents,state);return {...s.documents.find(x=>x.kind===d.kind&&x.version===d.version),policySnapshot:s};}};
}
