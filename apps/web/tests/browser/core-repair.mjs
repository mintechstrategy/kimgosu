// Isolated network doubles. These are developer regressions, never independent UIX QA.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeFixture } from './fixture.mjs';
import { snapshotFixture } from './snapshot-fixture.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=process.env.WEB_REPAIR_EVIDENCE_DIR || fileURLToPath(new URL('../../../../engineering/auth-core-repair-01/web/repair-browser/',import.meta.url));
mkdirSync(out,{recursive:true});
process.env.PLAYWRIGHT_BROWSERS_PATH=root+'.cache/ms-playwright';
const {chromium}=await import('playwright');
const results=[],metrics=[],serverLogs=[];let browser,server,mode;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function serve(next){
  if(server){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
  mode=next;server=spawn(process.execPath,[root+'node_modules/vite/bin/vite.js',...(mode==='dist'?['preview']:[]),'--host','127.0.0.1','--port','4178','--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',x=>serverLogs.push(x.toString()));server.stderr.on('data',x=>serverLogs.push(x.toString()));
  for(let n=0;n<100;n++){if(server.exitCode!==null)throw Error('Owned preview exited');try{if((await fetch('http://127.0.0.1:4178/')).ok)return;}catch{}await pause(100);}throw Error('Owned preview not ready');
}
const screen=async(p,title)=>{await p.getByRole('heading',{level:1,name:title,exact:true}).waitFor();await p.locator('main[aria-busy="false"]').waitFor();};
const go=async(p,route,title)=>{await p.evaluate(r=>location.hash=r,route);await screen(p,title);};
const shot=async(p,name)=>p.screenshot({path:out+'/'+name+'.png',fullPage:false});
async function setup(viewport={width:390,height:844}){
 const context=await browser.newContext({viewport,locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce'}), page=await context.newPage();page.setDefaultTimeout(7000);
 const fixture=makeFixture();fixture.config.providers.forEach(p=>p.enabled=true);
 const state={deny:null,privateDeny:null,requireAuth:mode==='harness',authPresence:[],publicAuthPresence:[],mutations:0,lastVersion:null,holdList:null,holdDocument:null};
 const runtimeErrors=[];page.on('pageerror',()=>runtimeErrors.push('pageerror'));
 await fixture.install(page);
 await page.route('https://api-dev-kimgosu.mintech.ai/**',async route=>{
  const r=route.request(),u=new URL(r.url()),path=u.pathname,isPublic=path==='/v1/auth/config'||path.startsWith('/v1/policies');
  if(r.method()==='OPTIONS')return route.fallback();
  const authorized=!!r.headers().authorization;
  if(isPublic)state.publicAuthPresence.push(authorized);else state.authPresence.push(authorized);
  if(r.method()==='PATCH')state.mutations++;
  if(path.startsWith('/v1/policies/'))state.lastVersion=u.searchParams.get('version');
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/v1/policies'&&state.holdList){const h=state.holdList;state.holdList=null;h.started();await h.wait;return send({documents:h.documents,policySnapshot:snapshotFixture(h.documents)});}
  if(path.startsWith('/v1/policies/')&&state.holdDocument){const h=state.holdDocument;state.holdDocument=null;h.started();await h.wait;return send({error:{code:'SESSION_INVALID'}},401);}
  if(!isPublic&&state.requireAuth&&!authorized)return send({error:{code:'AUTH_REQUIRED'}},401);
  if(state.privateDeny&&state.privateDeny.path===path&&(!state.privateDeny.method||state.privateDeny.method===r.method()))return send({error:{code:state.privateDeny.code}},state.privateDeny.status);
  if(state.deny&&state.deny.path===path){
   const shape=state.deny.shape;
   if(shape==='contract401')return send({error:{code:'SESSION_INVALID'}},401);
   if(shape==='contract403')return send({error:{code:'ACCOUNT_RESTRICTED'}},403);
   if(shape==='edge403')return send({cloudflare_error:true},403);
   if(shape==='malformed200')return send({diagnostic:true});
   return route.fulfill({status:shape==='html401'?401:403,contentType:'text/html',body:'<html>isolated edge denial</html>'});
  }
  return route.fallback();
 });
 await page.goto('http://127.0.0.1:4178/'+(mode==='harness'?'tests/browser/repair-harness.html':'')+'#browse');await screen(page,'둘러보기');await page.evaluate(()=>document.fonts.ready);
 return {context,page,fixture,state,runtimeErrors};
}
async function login(e){await go(e.page,'browse','둘러보기');await e.page.getByRole('button',{name:'회원 메뉴 이용하기',exact:true}).click();await screen(e.page,'로그인/가입');await e.page.getByRole('button',{name:'Google로 시작',exact:true}).click();await screen(e.page,'마이페이지');assert.equal(e.state.authPresence.at(-1),true);}
async function run(name,fn,viewport){let e;const started=Date.now();try{e=await setup(viewport);await fn(e);assert.equal(e.runtimeErrors.length,0);assert.deepEqual(await e.page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,cookie:document.cookie})),{local:0,session:0,cookie:''});results.push({name,target:mode==='dist'?'production-dist':'isolated-source-auth-harness',status:'PASS',durationMs:Date.now()-started});console.log('PASS '+name);}catch(err){results.push({name,target:mode,status:'FAIL',error:String(err.message).slice(0,1600)});console.error('FAIL '+name+' '+String(err.message).slice(0,700));if(e)await shot(e.page,'FAIL-'+name.replace(/[^a-z0-9]/gi,'-'));}finally{if(e)await e.context.close();}}
async function publicFailure(e,operation,shape,signedIn){
 const {page:p,state}=e;if(signedIn)await login(e);
 if(operation==='config'){await go(p,'sms','SMS 인증');state.deny={path:'/v1/auth/config',shape};await p.getByRole('button',{name:'준비 상태 다시 확인',exact:true}).click();await p.locator('.service-warning').waitFor();await screen(p,'SMS 인증');}
 else if(operation==='list'){state.deny={path:'/v1/policies',shape};await go(p,'policies','약관 및 서비스 정책');await p.getByRole('alert').waitFor();}
 else {
  if(operation==='old-version'){await go(p,'consents','동의 이력');state.deny={path:'/v1/policies/TERMS',shape};await p.getByRole('button',{name:'이 버전 문서 보기',exact:true}).first().click();}
  else {await go(p,'policies','약관 및 서비스 정책');state.deny={path:'/v1/policies/TERMS',shape};await p.locator('[data-document-trigger="TERMS"]').click();}
  await screen(p,'정책 전문');await p.getByRole('alert').waitFor();if(operation==='old-version')assert.equal(state.lastVersion,'browser-test-v1');
 }
 assert.ok(!['#expired','#restricted'].includes(await p.evaluate(()=>location.hash)));
 assert.equal(await p.locator('.site-header nav').getByRole('button',{name:signedIn?'마이페이지':'로그인/가입',exact:true}).count(),1,'Public failure must not clear existing member context');
 assert.ok(state.publicAuthPresence.every(v=>!v),'Public requests are bearer-free');
 if(signedIn&&operation==='detail'&&shape==='contract403')await shot(p,'public403-signed-in-document');
 if(operation==='detail'||operation==='old-version'){state.deny=null;await p.getByRole('button',{name:'같은 문서 다시 불러오기'}).click();await screen(p,'정책 전문');await p.locator('.document-body').waitFor();if(operation==='old-version')assert.equal(state.lastVersion,'browser-test-v1');await p.getByRole('button',{name:'읽기 마치고 돌아가기'}).click();await screen(p,operation==='old-version'?'동의 이력':'약관 및 서비스 정책');}
 state.deny=null;
 if(signedIn){await go(p,'member','마이페이지');assert.equal(state.authPresence.at(-1),true,'Session survives public error and retry');}
}
async function uncovered(p,el){
 await el.evaluate(e=>e.scrollIntoView({block:'center'}));
 const m=await el.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {top:r.top,bottom:r.bottom,height:innerHeight,covered:!hit||!(e===hit||e.contains(hit))};});
 assert.ok(m.top>=-1&&m.bottom<=m.height+1,JSON.stringify(m));assert.equal(m.covered,false,'Element is not hidden by footer or another layer');return m;
}
try{
 await serve('dist');browser=await chromium.launch({headless:true});
 for(const operation of ['config','list','detail'])for(const shape of ['contract401','contract403','html401','html403','edge403','malformed200'])await run(`CORE-UIQA-01 signed-out ${operation} ${shape}`,e=>publicFailure(e,operation,shape,false));
 for(const [width,height,large] of [[390,844,false],[390,844,true],[320,640,false],[320,640,true]])await run(`CORE-UIQA-02 viewport ${width}x${height} large=${large}`,async({page:p})=>{
  if(large)await p.addStyleTag({content:'html{font-size:24px!important} button,input,select,textarea,p,label{font-size:1rem!important}'});
  await go(p,'signup','약관 동의');const suffix=`${width}x${height}-${large?'large':'normal'}`;assert.equal(await p.evaluate(()=>getComputedStyle(document.documentElement).fontSize),large?'24px':'16px');if(large)assert.equal(await p.locator('.check-row').first().evaluate(e=>getComputedStyle(e).fontSize),'24px');await shot(p,'terms-top-'+suffix);
  assert.equal(await p.locator('.sticky-actions').evaluate(e=>getComputedStyle(e).position),'static');
  const rows=p.locator('.consent-row');for(let i=0;i<3;i++){const m=await uncovered(p,rows.nth(i));metrics.push({scenario:'uncovered-consent',viewport:suffix,row:i,...m});await shot(p,`terms-middle-${i}-${suffix}`);}
  const geometry=await p.evaluate(()=>({footer:document.querySelector('.sticky-actions').getBoundingClientRect().top,last:[...document.querySelectorAll('.consent-row')].at(-1).getBoundingClientRect().bottom}));assert.ok(geometry.footer>=geometry.last);
  for(const el of [p.getByRole('button',{name:'다음 단계',exact:true}),p.getByRole('button',{name:'필수 가입정보 안내 확인',exact:true}),p.getByRole('button',{name:'가입 취소 · 둘러보기',exact:true})])await uncovered(p,el);
  await shot(p,'terms-bottom-'+suffix);
  const trigger=p.locator('[data-document-trigger="MARKETING"]');await trigger.focus();await p.keyboard.press('Tab');assert.equal(await p.getByRole('button',{name:'필수 가입정보 안내 확인',exact:true}).evaluate(e=>e===document.activeElement),true);await p.keyboard.press('Tab');await shot(p,'terms-keyboard-forward-'+suffix);await p.keyboard.press('Shift+Tab');assert.equal(await p.getByRole('button',{name:'필수 가입정보 안내 확인',exact:true}).evaluate(e=>e===document.activeElement),true);await shot(p,'terms-keyboard-backward-'+suffix);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await p.getByRole('button',{name:'다음 단계',exact:true}).isDisabled());
 },{width,height});
 for(const variant of ['close-middle','browser-back-bottom','failed-retry-close'])await run(`CORE-UIQA-03 signup ${variant}`,async({page:p,fixture,state})=>{
  await p.addStyleTag({content:'html{font-size:24px!important} button,p,label{font-size:1rem!important}'});
  await go(p,'info','필수 가입정보');await p.getByLabel('이름 필수').fill('합성 문맥');await p.getByLabel('이메일 필수').fill('context@example.invalid');await p.getByRole('button',{name:'약관으로 돌아가기',exact:true}).click();await screen(p,'약관 동의');
  await p.getByLabel('[필수] 만 14세 이상입니다.',{exact:true}).check();
  const kind=variant==='close-middle'?'TERMS':'MARKETING',trigger=p.locator(`[data-document-trigger="${kind}"]`);await uncovered(p,trigger);await trigger.focus();
  const before=await p.evaluate(()=>({x:scrollX,y:scrollY,focus:document.activeElement.dataset.documentTrigger}));assert.ok(before.y>100);
  if(variant==='failed-retry-close')state.deny={path:'/v1/policies/'+kind,shape:'html401'};
  await p.keyboard.press('Enter');await screen(p,'정책 전문');
  if(variant==='failed-retry-close'){await p.getByRole('alert').waitFor();state.deny=null;await p.getByRole('button',{name:'같은 문서 다시 불러오기'}).click();await screen(p,'정책 전문');await p.locator('.document-body').waitFor();}
  await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  if(variant==='browser-back-bottom')await p.goBack();else await p.getByRole('button',{name:'읽기 마치고 돌아가기'}).click();
  await screen(p,'약관 동의');const after=await p.evaluate(()=>({x:scrollX,y:scrollY,focus:document.activeElement.dataset.documentTrigger}));assert.ok(Math.abs(after.y-before.y)<=1,JSON.stringify({before,after}));assert.equal(after.focus,before.focus);assert.ok(await p.getByLabel('[필수] 만 14세 이상입니다.',{exact:true}).isChecked());assert.ok(await p.getByRole('button',{name:'다음 단계',exact:true}).isDisabled());metrics.push({scenario:variant,before,after});await shot(p,'context-'+variant);
  await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
  await p.getByRole('button',{name:'필수 가입정보 안내 확인',exact:true}).click();await screen(p,'필수 가입정보');assert.equal(await p.getByLabel('이름 필수').inputValue(),'합성 문맥');assert.equal(await p.getByLabel('이메일 필수').inputValue(),'context@example.invalid');await p.getByRole('button',{name:'입력 취소',exact:true}).click();await screen(p,'둘러보기');await go(p,'info','필수 가입정보');assert.equal(await p.getByLabel('이름 필수').inputValue(),'');assert.equal(await p.getByLabel('이메일 필수').inputValue(),'');
 },{width:320,height:640});
 await run('CORE-UIQA-03 version and DRAFT safety overrides preserved form checks',async({page:p,fixture})=>{
  fixture.documents.forEach(d=>Object.assign(d,{status:'READY',canConsent:true,operator:'ISOLATED TEST ONLY',effectiveAt:'2020-01-01T00:00:00Z'}));await go(p,'signup','약관 동의');await p.getByLabel('[필수] 만 14세 이상입니다.',{exact:true}).check();await p.getByLabel('[필수] 김고수 서비스 이용약관 동의',{exact:false}).check();await p.getByLabel('[필수] 개인정보 수집 및 이용 동의',{exact:false}).check();assert.ok(await p.getByRole('button',{name:'다음 단계',exact:true}).isEnabled());
  await p.locator('[data-document-trigger="TERMS"]').click();await screen(p,'정책 전문');Object.assign(fixture.documents[0],{version:'ISOLATED TEST changed draft',status:'DRAFT',canConsent:false});await p.getByRole('button',{name:'읽기 마치고 돌아가기'}).click();await screen(p,'약관 동의');assert.ok(await p.getByLabel('[필수] 만 14세 이상입니다.',{exact:true}).isChecked());assert.equal(await p.getByLabel('[필수] 김고수 서비스 이용약관 동의',{exact:false}).isChecked(),false);assert.equal(await p.getByLabel('[필수] 개인정보 수집 및 이용 동의',{exact:false}).isChecked(),false);assert.ok(await p.getByRole('button',{name:'다음 단계',exact:true}).isDisabled());
 });
 await run('CORE-UIQA-01 cancelled late public list cannot overwrite newer DRAFT or form',async({page:p,fixture,state})=>{
  let release,started;const wait=new Promise(r=>release=r),began=new Promise(r=>started=r);state.holdList={wait,started,documents:fixture.documents.map(d=>({...d,status:'READY',canConsent:true,operator:'ISOLATED TEST ONLY',effectiveAt:'2020-01-01T00:00:00Z'}))};await p.evaluate(()=>location.hash='signup');await began;await p.getByRole('button',{name:'가입 취소 · 둘러보기',exact:true}).click();await screen(p,'둘러보기');await go(p,'signup','약관 동의');await p.getByLabel('[필수] 만 14세 이상입니다.',{exact:true}).check();release();await pause(200);assert.ok(await p.getByLabel('[필수] 김고수 서비스 이용약관 동의',{exact:false}).isDisabled());assert.ok(await p.getByLabel('[필수] 만 14세 이상입니다.',{exact:true}).isChecked());assert.ok(await p.getByRole('button',{name:'다음 단계',exact:true}).isDisabled());
 });
 await serve('harness');
 for(const operation of ['config','list','detail','old-version'])for(const shape of ['contract401','contract403','html401','html403','edge403','malformed200'])await run(`CORE-UIQA-01 signed-in ${operation} ${shape}`,e=>publicFailure(e,operation,shape,true));
 for(const method of ['GET','PATCH'])for(const [status,code,outcome] of [[401,'SESSION_INVALID','expired'],[403,'ACCOUNT_RESTRICTED','restricted'],[403,'CONSENT_RENEWAL_REQUIRED','reconsent'],[403,'FORBIDDEN','unknown'],[403,'ORIGIN_NOT_ALLOWED','unknown']])await run(`CORE-UIQA-01 private ${method} ${status} ${code}`,async e=>{
  const {page:p,state}=e;await login(e);if(method==='PATCH')await go(p,'notifications','알림 설정');state.privateDeny={path:method==='GET'?'/v1/me':'/v1/me/notifications',method,status,code};
  if(method==='GET')await go(p,'notifications',outcome==='expired'?'로그인이 만료됐어요':outcome==='restricted'?'이용 제한 안내':'알림 설정');else await p.getByRole('switch',{name:'채팅 알림',exact:true}).click();
  if(outcome==='expired'||outcome==='restricted'){await screen(p,outcome==='expired'?'로그인이 만료됐어요':'이용 제한 안내');assert.equal(await p.getByRole('switch').count(),0);assert.equal(await p.locator('.profile-card').count(),0);}
  else {await screen(p,'알림 설정');await p.getByRole('alert').waitFor();assert.ok(!['#restricted','#expired'].includes(await p.evaluate(()=>location.hash)));if(outcome==='reconsent')assert.match(await p.getByRole('alert').innerText(),/재동의/);}
  if(method==='PATCH')assert.equal(state.mutations,1);
  state.privateDeny=null;await go(p,'member',outcome==='expired'?'로그인이 만료됐어요':'마이페이지');assert.equal(state.authPresence.at(-1),outcome!=='expired');
  if(outcome==='expired'){await p.getByRole('button',{name:'로그인 화면으로',exact:true}).click();await screen(p,'로그인/가입');await p.getByRole('button',{name:'Google로 시작',exact:true}).click();await screen(p,'마이페이지');}
  assert.equal(state.mutations,method==='PATCH'?1:0,'No automatic mutation replay after reauthentication');
 });
 await run('CORE-UIQA-03 parent-specific policy list and past-version history context',async e=>{
  const {page:p}=e;await login(e);for(const parent of ['policies','consents']){await go(p,parent,parent==='policies'?'약관 및 서비스 정책':'동의 이력');const trigger=p.locator('[data-document-trigger]').last();await uncovered(p,trigger);await trigger.focus();const before=await p.evaluate(()=>({y:scrollY,focus:document.activeElement.dataset.documentTrigger}));await p.keyboard.press('Enter');await screen(p,'정책 전문');await p.goBack();await screen(p,parent==='policies'?'약관 및 서비스 정책':'동의 이력');const after=await p.evaluate(()=>({y:scrollY,focus:document.activeElement.dataset.documentTrigger}));assert.ok(Math.abs(before.y-after.y)<=1);assert.equal(before.focus,after.focus);metrics.push({scenario:'parent-'+parent,before,after});}
 },{width:320,height:640});
 await run('CORE-UIQA-01 closed document late401 does not clear session or restored focus',async e=>{
  const {page:p,state}=e;await login(e);await go(p,'policies','약관 및 서비스 정책');let release,started;const wait=new Promise(r=>release=r),began=new Promise(r=>started=r);state.holdDocument={wait,started};const trigger=p.locator('[data-document-trigger="TERMS"]');await trigger.click();await began;await p.getByRole('button',{name:'읽기 마치고 돌아가기'}).click();await screen(p,'약관 및 서비스 정책');release();await pause(200);assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);await go(p,'member','마이페이지');assert.equal(state.authPresence.at(-1),true);
 });
 await run('CORE-UIQA-01 actual in-memory fixture session logout revocation no reuse',async e=>{const {page:p,state}=e;await login(e);await p.getByRole('button',{name:'로그아웃',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();await go(p,'member','마이페이지');assert.equal(state.authPresence.at(-1),true);await p.getByRole('button',{name:'로그아웃',exact:true}).click();await p.getByRole('button',{name:'로그아웃 확인',exact:true}).click();await screen(p,'둘러보기');await go(p,'member','로그인이 만료됐어요');assert.equal(state.authPresence.at(-1),false);});
}catch(err){results.push({name:'infrastructure',status:'FAIL',error:String(err.message)});console.error(err.message);}
finally{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}writeFileSync(out+'/results.json',JSON.stringify({scope:'ISOLATED_NETWORK_FIXTURE_DEVELOPER_REGRESSION_NOT_UIX_QA_OR_REAL_PROVIDER',at:new Date().toISOString(),results,total:results.length,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,cleanup:{browserClosed:true,ownedServerExited:server?.exitCode!==null||!!server?.signalCode}},null,2));writeFileSync(out+'/viewport-metrics.json',JSON.stringify(metrics,null,2));writeFileSync(out+'/preview.log',serverLogs.join(''));}
process.exitCode=results.some(r=>r.status!=='PASS')?1:0;
