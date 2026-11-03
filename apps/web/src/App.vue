<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { ApiError, createApiClient, privateFailure, safeMessage, unavailableAuth, uncertainWrite, type BrowserAuthPort, type MembershipApi } from './api';
import { digits, notice, parseScreen, policyKinds, validInfo, validPhone } from './domain';
import { canSnapshotConsent, consentPayload, samePolicy, snapshotCurrent, snapshotDisplay, type PolicySnapshot, type SnapshotDocument } from './policy';
import type { AuthConfig, ConsentRecord, Member, NotificationKey, PolicyDocument, PolicyKind, Preferences, Provider, Screen } from './types';
const props = defineProps<{ api?: MembershipApi; auth?: BrowserAuthPort }>();
const api = props.api ?? createApiClient(import.meta.env.VITE_API_BASE_URL || 'https://api-dev-kimgosu.mintech.ai');
const auth = props.auth ?? unavailableAuth;
const screen = ref<Screen>('browse'); const socialIssue = ref(''); const loading = ref(false); const saving = ref(false); const message = ref(''); const error = ref('');
const config = ref<AuthConfig>(); const configError = ref(''); const docs = ref<PolicyDocument[]>([]); const docsLoaded = ref(false); const doc = ref<SnapshotDocument>(); const documentKind = ref<PolicyKind>('TERMS'); const documentVersion = ref<string>(); const documentParent = ref<Screen>('policies');
const member = ref<Member>(); const records = ref<ConsentRecord[]>([]); const preferences = ref<Preferences>(); const conflict = ref<{ key: NotificationKey; value: boolean }>(); const conflictReloaded = ref(false);
const region = ref('전체 지역'); const manualRegion = ref(''); const category = ref('전체 서비스'); const browseScroll = ref(0); const returnTarget = ref<Screen>('browse'); const returnLabel = ref('둘러보던 화면');
const form = reactive({ age14: false, TERMS: false, PRIVACY_CONSENT: false, MARKETING: false, name: '', email: '', phone: '', code: '', withdrawAcknowledged: false, withdrawReason: '', withdrawDetail: '' });
const dialog = ref<HTMLDialogElement>(); const dialogType = ref<'logout'|'withdraw'|'marketing'>('logout'); const dialogTrigger = ref<HTMLElement>(); const titleRef = ref<HTMLElement>();
let epoch = 0; let configEpoch = 0;
// Memory-only tickets. UNKNOWN blocks this intent, including view refresh.
const registrationTicket = ref<string>(); const smsChallenge = ref<{challengeId:string;phone:string}>();
const smsVerified = ref(false); const writeUnknown = ref(false);
const canSendSms = computed(() => !!registrationTicket.value && config.value?.sms.available === true && validPhone(form.phone) && !saving.value && !writeUnknown.value);
const canFinishSignup = computed(() => !!registrationTicket.value && !!smsChallenge.value && smsChallenge.value.phone === form.phone && form.code.length === 5 && validInfo(form.name,form.email) && canContinue.value && !saving.value && !writeUnknown.value);
// Form values remain in the existing reactive memory only; never replay snapshots
// over loadPolicies' version/DRAFT safety resets. Store view context per parent.
const documentContexts = new Map<Screen, { x: number; y: number; focusKey?: string }>();
const titles: Record<Screen,string> = { browse:'둘러보기', login:'로그인/가입', signup:'약관 동의', info:'필수 가입정보', sms:'SMS 인증', policies:'약관 및 서비스 정책', document:'정책 전문', member:'마이페이지', consents:'동의 이력', notifications:'알림 설정', withdraw:'회원 탈퇴', expired:'로그인이 만료됐어요', restricted:'이용 제한 안내', 'social-error':'소셜 로그인 안내' };
const title = computed(() => titles[screen.value]);
const consentOptions = [{ kind:'TERMS' as const, label:'[필수] 김고수 서비스 이용약관 동의' }, { kind:'PRIVACY_CONSENT' as const, label:'[필수] 개인정보 수집 및 이용 동의' }, { kind:'MARKETING' as const, label:'[선택] 마케팅 정보 수신 동의' }];
const labels: Record<PolicyKind,string> = { TERMS:'서비스 이용약관', PRIVACY_CONSENT:'개인정보 수집 및 이용 동의', PRIVACY_POLICY:'개인정보 처리방침', MARKETING:'마케팅 정보 수신 동의', OPERATIONS:'서비스 운영정책' };
const notificationRows: { key: NotificationKey; title: string; detail: string }[] = [{ key:'advertising',title:'광고 알림',detail:'마케팅 등 다양한 혜택 알림 · 별도 마케팅 동의 필요' },{ key:'chat',title:'채팅 알림',detail:'새로운 메시지가 온 경우 알려드려요.' },{ key:'comment',title:'댓글 알림',detail:'서비스 또는 견적에 새로운 댓글이 달린 경우 알려드려요.' },{ key:'quote',title:'신규 견적 알림',detail:'서비스 카테고리에 새로운 견적이 등록되면 알려드려요.' },{ key:'inquiry',title:'신규 문의/제안 알림',detail:'새로운 문의나 제안이 온 경우 알려드려요.' }];
const snapshot = ref<PolicySnapshot>();
const policyFor = (kind: PolicyKind) => snapshotDisplay(snapshot.value,kind);
const canAgree = (kind: PolicyKind) => docsLoaded.value && canSnapshotConsent(snapshot.value,kind);
const documentCanConsent = computed(() => !!doc.value && docsLoaded.value && snapshotCurrent(snapshot.value,doc.value.kind)?.id === doc.value.id);
const allAgreed = computed(() => form.age14 && consentOptions.every(o => canAgree(o.kind) && form[o.kind]));
const canContinue = computed(() => {
  if (!form.age14 || !docsLoaded.value || !snapshot.value) return false;
  try { consentPayload(snapshot.value,form); return true; } catch { return false; }
});
const marketingGranted = computed(() => records.value.filter(r => r.kind === 'MARKETING').sort((a,b) => b.recordedAt.localeCompare(a.recordedAt))[0]?.status === 'GRANTED');
const protectedScreens: Screen[] = ['member','consents','notifications','withdraw'];
function clearPrivate() { for (const to of protectedScreens) documentContexts.delete(to); member.value = undefined; records.value = []; preferences.value = undefined; conflict.value = undefined; form.withdrawAcknowledged = false; form.withdrawReason = ''; form.withdrawDetail = ''; }
function clearSignup() { registrationTicket.value = undefined; smsChallenge.value = undefined; smsVerified.value = false; writeUnknown.value = false; for (const to of ['signup','info','sms'] as Screen[]) documentContexts.delete(to); form.name = ''; form.email = ''; form.phone = ''; form.code = ''; form.age14 = false; form.TERMS = false; form.PRIVACY_CONSENT = false; form.MARKETING = false; snapshot.value = undefined; docsLoaded.value = false; }
function navigate(to: Screen, replace = false) {
  if (saving.value) return;
  if (screen.value === 'browse') browseScroll.value = window.scrollY;
  if (location.hash === '#' + to) { void enter(to); return; }
  if (replace) { history.replaceState(null, '', '#' + to); void enter(to); }
  else location.hash = to;
}
function failure(e: unknown, destination?: Screen) {
  const decision = privateFailure(e);
  if (decision === 'expired') { saving.value = false; api.clearSession(); clearPrivate(); returnTarget.value = destination ?? 'member'; returnLabel.value = titles[returnTarget.value]; navigate('expired', true); return; }
  if (decision === 'restricted') { saving.value = false; clearPrivate(); navigate('restricted', true); return; }
  error.value = safeMessage(e);
}
async function refreshConfig() {
  const current = ++configEpoch; configError.value = '';
  try { const next = await api.config(); if (current === configEpoch) config.value = next; } catch (e) { if (current === configEpoch) { config.value = undefined; configError.value = safeMessage(e); } }
}
function resetPolicyChecks() { for (const o of consentOptions) form[o.kind] = false; }
function applySnapshot(next: PolicySnapshot) {
  if (!samePolicy(snapshot.value,next)) resetPolicyChecks();
  snapshot.value = next; docs.value = next.documents; docsLoaded.value = true;
}
async function loadPolicies(current: number) {
  docsLoaded.value = false;
  try {
    const next = await api.policySnapshot();
    if (current !== epoch) return;
    applySnapshot(next);
  } catch (e) {
    if (current === epoch) { resetPolicyChecks(); snapshot.value = undefined; docs.value = []; }
    throw e;
  }
}
async function continueSignup() {
  if (!canContinue.value || loading.value || saving.value || writeUnknown.value) return;
  if (member.value) { await saveConsents(); return; }
  const current = ++epoch; loading.value = true; error.value = '';
  try { await loadPolicies(current); if (current === epoch && canContinue.value) navigate('info'); }
  catch (e) { if (current === epoch) failure(e); }
  finally { if (current === epoch) loading.value = false; }
}
async function resumePolicies() {
  if (document.visibilityState !== 'visible' || saving.value || !['signup','info','sms','policies','document'].includes(screen.value)) return;
  // Preserve the existing scroll/focus/form memory; only authority is refreshed.
  const current = ++epoch; loading.value = true; error.value = '';
  try {
    if (screen.value === 'document') {
      doc.value = undefined;
      const next = await api.policyDocument(documentKind.value,documentVersion.value);
      if (current !== epoch) return;
      applySnapshot(next.snapshot); doc.value = next.document;
    } else await loadPolicies(current);
  } catch (e) { if (current === epoch) { docsLoaded.value = false; snapshot.value = undefined; resetPolicyChecks(); failure(e); } }
  finally { if (current === epoch) loading.value = false; }
}
async function enter(to: Screen) {
  const restore = screen.value === 'document' && to === documentParent.value ? documentContexts.get(to) : undefined;
  const current = ++epoch; screen.value = to; error.value = to === 'social-error' ? socialIssue.value : ''; message.value = ''; loading.value = true; conflict.value = undefined; conflictReloaded.value = false;
  try {
    if (protectedScreens.includes(to)) {
      const next = await api.me(); if (current !== epoch) return;
      member.value = next;
      if (next.status === 'RESTRICTED') { clearPrivate(); navigate('restricted', true); return; }
      if (to === 'consents' || to === 'notifications') { const r = await api.consents(); if (current !== epoch) return; records.value = r; }
      if (to === 'notifications') { const p = await api.notifications(); if (current !== epoch) return; preferences.value = p; }
    }
    if (['policies','signup','info','sms'].includes(to)) { await loadPolicies(current); if (current !== epoch) return; }
    if (to === 'document') { doc.value = undefined; docsLoaded.value = false; const d = await api.policyDocument(documentKind.value, documentVersion.value); if (current !== epoch) return; applySnapshot(d.snapshot); doc.value = d.document; }
  } catch (e) { if (current === epoch) { if (to === 'document') { resetPolicyChecks(); snapshot.value = undefined; docsLoaded.value = false; } failure(e, to); } }
  finally {
    if (current === epoch) {
      loading.value = false; await nextTick(); if (current !== epoch) return;
      const trigger = restore?.focusKey ? [...document.querySelectorAll<HTMLElement>('[data-document-trigger]')].find(el => el.dataset.documentTrigger === restore.focusKey) : undefined;
      (trigger ?? titleRef.value)?.focus({ preventScroll: true });
      if (restore) window.scrollTo(restore.x, restore.y);
      else window.scrollTo(0, to === 'browse' ? browseScroll.value : 0);
    }
  }
}
function hashChanged() { const to = parseScreen(location.hash); if (saving.value) { history.replaceState(null, '', '#' + screen.value); return; } if (location.hash !== '#' + to) history.replaceState(null,'','#' + to); void enter(to); }
function requireMember() { returnTarget.value = 'member'; returnLabel.value = '마이페이지'; if (member.value) navigate('member'); else navigate('login'); }
function cancelAuth() { epoch++; saving.value = false; loading.value = false; clearSignup(); navigate('browse'); message.value = '로그인하지 않고 둘러보던 화면으로 돌아왔습니다.'; }
async function openDocument(kind: PolicyKind, version?: string) {
  documentContexts.set(screen.value, { x: window.scrollX, y: window.scrollY, focusKey: (document.activeElement as HTMLElement | null)?.dataset.documentTrigger });
  documentParent.value = screen.value; documentKind.value = kind; documentVersion.value = version; navigate('document'); }
function toggleAll(checked: boolean) { form.age14 = checked; for (const o of consentOptions) if (canAgree(o.kind)) form[o.kind] = checked; }
async function startSocial(provider: Provider) {
  if (saving.value) return;
  const current = ++epoch;
  saving.value = true; error.value = ''; message.value = '';
  let destination: Screen | undefined;
  try {
    if (!config.value?.providers.some(p => p.id === provider && p.enabled)) throw new ApiError(503,'BROWSER_AUTH_NOT_CONFIGURED');
    const result = await auth.start(provider);
    if (current !== epoch) return;
    if (result.kind === 'cancelled') message.value = '소셜 로그인이 취소됐습니다. 다시 선택하거나 둘러보기로 돌아가세요.';
    else if (result.kind === 'session') { const m = await api.adoptSession(result.opaqueToken,()=>current === epoch); if (current !== epoch) return; member.value = m; clearSignup(); destination = m.status === 'RESTRICTED' ? 'restricted' : returnTarget.value; if (m.status === 'RESTRICTED') clearPrivate(); }
    else if (result.kind === 'signup-required') { clearSignup(); if (result.registrationTicket !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(result.registrationTicket)) throw new ApiError(502,'INVALID_RESPONSE'); registrationTicket.value = result.registrationTicket; destination = 'signup'; }
    else { error.value = '계정 연결에는 별도 소유 확인과 명시적 동의가 필요합니다. 이메일이나 전화번호 일치만으로 자동 연결하지 않습니다. 현재 웹 계정 연결 API는 준비 중입니다.'; destination = 'social-error'; }
  } catch (e) { if (current === epoch) { api.clearSession(); clearPrivate(); error.value = safeMessage(e); destination = 'social-error'; } }
  finally { if (current === epoch) saving.value = false; }
  if (destination) { socialIssue.value = error.value; navigate(destination); }
}
function phoneChanged(value:string) { form.phone = digits(value,11); form.code = ''; smsChallenge.value = undefined; smsVerified.value = false; }
async function mutationFailure(e:unknown,current:number) {
  if (current !== epoch) return;
  if (uncertainWrite(e)) writeUnknown.value = true;
  if (e instanceof ApiError && e.code === 'REGISTRATION_INVALID') { registrationTicket.value = undefined; smsChallenge.value = undefined; smsVerified.value = false; }
  if (e instanceof ApiError && ['POLICY_VERSION_CHANGED','DOCUMENT_NOT_READY'].includes(e.code)) {
    resetPolicyChecks();
    try { await loadPolicies(current); } catch { /* retain the original refusal */ }
  }
  if (current !== epoch) return;
  failure(writeUnknown.value ? new ApiError(0,'TIMEOUT') : e);
}
async function sendSms() {
  if (!canSendSms.value || !registrationTicket.value) return;
  const current = epoch, ticket = registrationTicket.value, phone = form.phone;
  saving.value = true; error.value = ''; smsChallenge.value = undefined; smsVerified.value = false; form.code = '';
  try { const next = await api.smsSend(ticket,phone); if (current === epoch) smsChallenge.value = {...next,phone}; }
  catch (e) { await mutationFailure(e,current); }
  finally { if (current === epoch) saving.value = false; }
}
async function finishSignup() {
  if (!canFinishSignup.value || !registrationTicket.value || !smsChallenge.value || !snapshot.value) return;
  const current = epoch, ticket = registrationTicket.value, selected = snapshot.value;
  saving.value = true; error.value = ''; let committed = false;
  try {
    if (!smsVerified.value) { await api.smsVerify(ticket,smsChallenge.value.challengeId,form.code); if (current !== epoch) return; smsVerified.value = true; }
    const result = await api.signup(selected,{...form},{registrationTicket:ticket,name:form.name,email:form.email,age14Confirmed:true,expertRequested:false},()=>current === epoch);
    committed = true; if (current !== epoch) return;
    const next = await api.adoptSession(result.session.accessToken,()=>current === epoch);
    if (current !== epoch) return;
    member.value = next; clearSignup(); saving.value = false; navigate(next.status === 'RESTRICTED' ? 'restricted' : returnTarget.value,true);
  } catch (e) { if (committed && current === epoch) writeUnknown.value = true; await mutationFailure(e,current); }
  finally { if (current === epoch) saving.value = false; }
}
async function saveConsents() {
  if (!member.value || !snapshot.value || saving.value || writeUnknown.value) return;
  const current = epoch, selected = snapshot.value; saving.value = true; error.value = ''; let committed = false;
  try {
    await api.grantConsents(selected,{...form},()=>current === epoch); committed = true;
    if (current !== epoch) return;
    const next = await api.consents(); if (current !== epoch) return;
    const expected = consentPayload(selected,form).consents;
    if (!expected.every(d=>next.some(r=>r.kind === d.kind && r.version === d.version && r.status === 'GRANTED'))) throw new ApiError(502,'INVALID_RESPONSE');
    records.value = next; saving.value = false; navigate('consents');
  } catch (e) { if (committed && current === epoch) writeUnknown.value = true; await mutationFailure(e,current); }
  finally { if (current === epoch) saving.value = false; }
}
async function saveNotification(key: NotificationKey, value: boolean) {
  if (!preferences.value || saving.value) return;
  if (key === 'advertising' && value && !marketingGranted.value) { error.value = '광고 알림을 켜려면 별도 마케팅 동의가 필요합니다. 동의 이력을 확인해주세요.'; return; }
  saving.value = true; error.value = ''; message.value = ''; const version = preferences.value.version;
  try {
    const saved = await api.saveNotification(key, value, version);
    const fetched = await api.notifications();
    preferences.value = fetched;
    if (fetched.version < saved.version || fetched[key] !== value) { conflict.value = {key,value}; conflictReloaded.value = true; error.value = '저장 후 최신 설정이 다시 변경됐습니다. 현재 값을 확인한 후 다시 저장해주세요.'; }
    else { conflict.value = undefined; message.value = '알림 설정을 저장하고 서버에서 다시 확인했습니다.'; }
  } catch (e) {
    if (!(e instanceof ApiError && [401,403].includes(e.status))) conflict.value = { key,value };
    // Mutations are never retried automatically; read latest before an explicit second attempt.
    conflictReloaded.value = false; failure(e, 'notifications');
  } finally { saving.value = false; }
}
async function reloadPreferences() {
  saving.value = true; error.value = '';
  try { preferences.value = await api.notifications(); conflictReloaded.value = true; message.value = '최신 설정을 불러왔습니다. 변경 의도를 확인한 후 다시 저장하세요.'; } catch (e) { failure(e,'notifications'); }
  finally { saving.value = false; }
}
async function confirmDialog(type: 'logout'|'withdraw'|'marketing', event: Event) { dialogType.value = type; dialogTrigger.value = event.currentTarget as HTMLElement; await nextTick(); dialog.value?.showModal(); }
function closeDialog() { dialog.value?.close(); dialogTrigger.value?.focus(); }
async function logout() {
  if (saving.value) return; saving.value = true; error.value = '';
  try { await api.logout(); clearPrivate(); clearSignup(); closeDialog(); saving.value = false; navigate('browse',true); await nextTick(); message.value = '로그아웃했습니다. 다시 로그인하기 전까지 회원 기능에 접근할 수 없습니다.'; }
  catch (e) { closeDialog(); error.value = '로그아웃 결과를 확인하지 못했습니다. 서버 세션이 종료됐을 수 있습니다. 회원 상태를 다시 확인해주세요.'; }
  finally { saving.value = false; }
}
function back() {
  if (screen.value === 'document') navigate(documentParent.value);
  else if (['login','expired','social-error','signup','info','sms'].includes(screen.value)) cancelAuth();
  else if (['consents','notifications','withdraw'].includes(screen.value)) navigate('member');
  else navigate('browse');
}
const date = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ko-KR',{ dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Seoul' }).format(new Date(value)) + ' KST' : '일시 확인 필요';
function forgetOnPageHide() { epoch++; configEpoch++; documentContexts.clear(); api.clearSession(); clearPrivate(); clearSignup(); }
function restoreFromPageCache(event: PageTransitionEvent) { if (event.persisted) navigate('browse',true); }
onMounted(() => { void refreshConfig(); hashChanged(); window.addEventListener('hashchange',hashChanged); window.addEventListener('pagehide',forgetOnPageHide); window.addEventListener('pageshow',restoreFromPageCache); document.addEventListener('visibilitychange',resumePolicies); });
onUnmounted(() => { forgetOnPageHide(); window.removeEventListener('hashchange',hashChanged); window.removeEventListener('pagehide',forgetOnPageHide); window.removeEventListener('pageshow',restoreFromPageCache); document.removeEventListener('visibilitychange',resumePolicies); });
</script>

<template>
  <a class="skip" href="#content" @click.prevent="titleRef?.focus()">본문 바로가기</a>
  <header class="site-header"><button class="brand" :disabled="saving" @click="navigate('browse')">김고수<span class="brand-dot" aria-hidden="true"></span></button><nav aria-label="주 메뉴"><button :disabled="saving" @click="navigate('policies')">약관 및 정책</button><button :disabled="saving" @click="requireMember">{{ member ? '마이페이지' : '로그인/가입' }}</button></nav></header>
  <main id="content" class="shell" :class="{ 'wide': screen === 'browse' }" :aria-busy="loading || saving">
    <header class="page-header"><button v-if="screen !== 'browse'" class="icon" aria-label="이전 화면" :disabled="saving" @click="back">‹</button><h1 ref="titleRef" tabindex="-1">{{ title }}</h1><span v-if="screen !== 'browse'" class="header-spacer"></span></header>
    <div v-if="configError" class="notice service-warning"><p>회원 서비스 준비 상태를 확인하지 못했습니다. {{ configError }}</p><button class="text-button" @click="refreshConfig">서비스 상태 다시 확인</button></div>
    <p v-if="loading" role="status" class="notice">불러오는 중입니다…</p>
    <p v-if="message" role="status" class="notice success">{{ message }}</p>
    <div v-if="error" role="alert" class="notice error"><p>{{ error }}</p><button v-if="!conflict && !['social-error'].includes(screen)" class="text-button" :disabled="saving" @click="enter(screen)">현재 화면 다시 확인</button></div>

    <template v-if="screen === 'browse'">
      <section class="browse-hero"><p class="eyebrow">전문가 서비스, 더 합리적으로</p><h2>내 주변 전문가를<br>김고수에서 편리하게 찾으세요</h2><p>로그인하지 않아도 공개 영역을 둘러볼 수 있어요.</p><div class="browse-controls"><label>탐색 지역<select v-model="region"><option>전체 지역</option><option>직접 입력</option><option>비대면</option></select></label><label>서비스 분야<select v-model="category"><option>전체 서비스</option><option>디자인/개발</option><option>청소/인테리어</option><option>영상편집</option><option>반려</option><option>번역</option><option>헤어/미용</option><option>법률</option><option>레슨</option></select></label></div><label v-if="region === '직접 입력'">탐색 지역 직접 입력<input v-model="manualRegion" maxlength="80" autocomplete="off" placeholder="시·군·구를 입력해주세요"></label><p v-if="region === '직접 입력'" class="muted">입력한 지역은 이 탭에서만 유지됩니다. 지역 코드와 실제 서비스 검색 연동은 후속 단계입니다.</p></section>
      <section class="browse-empty"><h2>전문가의 서비스</h2><p>현재 공개 서비스 목록 API는 연결 준비 중입니다.<br>예시 전문가나 가격을 실제 서비스로 표시하지 않습니다.</p><button class="primary" @click="requireMember">회원 메뉴 이용하기</button><p class="muted">보호된 기능은 로그인 후 이용할 수 있습니다. 이전 작업은 자동 실행하지 않습니다.</p></section>
      <section class="policy-callout"><h2>이용 전 확인해주세요</h2><p>약관·개인정보·운영정책의 전문과 준비 상태를 확인하세요.</p><button class="secondary" @click="navigate('policies')">약관 및 정책 보기</button></section>
    </template>

    <template v-else-if="screen === 'login'">
      <section class="auth-hero"><h2>김고수</h2><p>전문가 서비스를 더욱 합리적으로<br>오로지 김고수에서!</p><img class="app-icon" src="/assets/app_icon.png" alt="김고수 브랜드 아이콘" width="168" height="168"></section>
      <p class="context">로그인 후 {{ returnLabel }}으로 돌아갑니다. 저장·삭제·전송은 자동 실행하지 않습니다.</p>
      <div class="social-buttons"><button class="social kakao" :disabled="saving" @click="startSocial('kakao')">카카오로 시작</button><button class="social naver" :disabled="saving" @click="startSocial('naver')"><span aria-hidden="true" class="social-mark">N</span>네이버로 시작</button><button class="social google" :disabled="saving" @click="startSocial('google')"><img src="/assets/google-g.png" alt="" width="20" height="20">Google로 시작</button></div>
      <p class="muted">소셜 인증 제공자와 웹 인증 연결이 준비되기 전에는 로그인·가입이 완료되지 않습니다.</p>
      <div class="stack"><button class="text-button" @click="navigate('signup')">가입 전 약관·필수정보 확인</button><button class="secondary" @click="cancelAuth">둘러보기</button></div>
    </template>

    <template v-else-if="screen === 'social-error' || screen === 'expired' || screen === 'restricted'">
      <section class="state-card"><div class="state-icon" aria-hidden="true">!</div><h2>{{ screen === 'expired' ? '다시 로그인해주세요' : screen === 'restricted' ? '현재 회원 기능을 이용할 수 없습니다' : '로그인을 완료하지 못했어요' }}</h2><p v-if="screen === 'expired'">세션이 만료됐거나 해제됐습니다. 재인증 후 원래 화면으로 돌아가며 이전 작업은 자동 재실행하지 않습니다.</p><p v-else-if="screen === 'restricted'">제한된 계정의 권한은 서버에서 확인합니다. 새 고객번호로 재가입해도 유효한 이용제한은 유지됩니다. 상세 사유·기간·지원 창구는 서버 연결 후 제공됩니다.</p><p v-else>취소·연결 실패·제공자 준비 중 상태에서는 회원 가입이나 계정 연결이 발생하지 않습니다. 같은 이메일·전화번호만으로 계정을 자동 병합하지 않습니다.</p><div class="stack"><button class="primary" @click="navigate('login')">로그인 화면으로</button><button class="secondary" @click="refreshConfig">서비스 상태 다시 확인</button><button class="text-button" @click="cancelAuth">둘러보던 화면으로 돌아가기</button></div></section>
    </template>

    <template v-else-if="screen === 'signup'">
      <h2>김고수에 오신 것을 환영합니다!</h2><p>필수와 선택 동의를 각각 확인해주세요. 문서 열람만으로 동의하지 않습니다.</p>
      <p class="notice">현재는 가입 전 안내입니다. 승인된 필수 문서·실제 소셜 인증·SMS가 준비돼야 가입할 수 있습니다.</p>
      <label class="check-row check-all"><input type="checkbox" :checked="allAgreed" :disabled="!consentOptions.some(o => canAgree(o.kind))" @change="toggleAll(($event.target as HTMLInputElement).checked)"><span>약관 전체 동의 <small>동의 가능한 항목만 선택</small></span></label>
      <label class="check-row"><input v-model="form.age14" type="checkbox"><span>[필수] 만 14세 이상입니다.</span></label>
      <div v-for="option in consentOptions" :key="option.kind" class="consent-row"><label class="check-row"><input v-model="form[option.kind]" type="checkbox" :disabled="!canAgree(option.kind)"><span>{{ option.label }}<small>{{ canAgree(option.kind) ? '버전 ' + policyFor(option.kind)?.version : 'DRAFT 또는 문서 준비 중 · 동의 불가' }}</small></span></label><button class="text-button" :data-document-trigger="option.kind" :aria-label="labels[option.kind] + ' 전문 보기'" @click="openDocument(option.kind)">전문 보기</button></div>
      <div class="sticky-actions"><button class="primary" :disabled="!canContinue || saving || writeUnknown" @click="continueSignup">다음 단계</button><button class="text-button" @click="navigate('info')">필수 가입정보 안내 확인</button><button class="text-button" @click="cancelAuth">가입 취소 · 둘러보기</button></div>
    </template>

    <template v-else-if="screen === 'info'">
      <h2>가입에 필요한 정보만 확인해요</h2><p>이름과 이메일은 필수입니다. 성별·연령대·생년월일은 수집하지 않습니다. 이름은 표시이름이며 실명 인증을 뜻하지 않습니다.</p>
      <form class="stack" @submit.prevent="navigate('sms')"><label for="name">이름 <span class="required">필수</span><input id="name" v-model="form.name" name="name" autocomplete="name" :maxlength="200" required></label><label for="email">이메일 <span class="required">필수</span><input id="email" v-model="form.email" name="email" type="text" inputmode="email" autocomplete="email" autocapitalize="none" :spellcheck="false" maxlength="508" required></label><p v-if="(form.name || form.email) && !validInfo(form.name,form.email)" class="field-error">이름과 올바른 이메일을 입력해주세요.</p><p class="muted">닉네임과 고객번호는 서버가 생성합니다. 이 입력은 현재 탭 메모리에만 유지되며 서버에 전송되지 않습니다.</p><button class="primary" :disabled="!validInfo(form.name,form.email)">SMS 인증 안내 확인</button></form><button class="text-button" @click="navigate('signup')">약관으로 돌아가기</button><button class="text-button" @click="cancelAuth">입력 취소</button>
    </template>

    <template v-else-if="screen === 'sms'">
      <h2>마지막 단계예요!</h2><p>가입 시 SMS 점유 인증이 필요합니다. 실제 문자 발송 서비스는 현재 준비 중입니다.</p><div class="notice">실제 발송·인증은 진행되지 않습니다. 인증번호는 5자리, 유효시간은 발송 후 60초이며 재발송하면 이전 번호는 무효화됩니다. 인증 성공을 가장하지 않습니다.</div>
      <label for="phone">휴대폰 번호<input id="phone" :disabled="saving" :value="form.phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="11" placeholder="010으로 시작하는 숫자 11자리" @input="phoneChanged(($event.target as HTMLInputElement).value)"></label><p v-if="form.phone && !validPhone(form.phone)" class="field-error">010으로 시작하는 숫자 11자리를 입력해주세요.</p><button class="secondary" :disabled="!canSendSms" aria-describedby="sms-blocked" @click="sendSms">인증번호 전송 · 준비 중</button><p id="sms-blocked" class="muted">SMS 제공자·발신번호·발송 승인이 필요합니다. 서버가 available 상태여도 웹 발송 계약 연결 전까지 발송하지 않습니다.</p><label for="code">인증번호<input id="code" :disabled="saving" :value="form.code" name="code" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="숫자 5자리" @input="form.code = digits(($event.target as HTMLInputElement).value,5)"></label><button class="primary" :disabled="!canFinishSignup" @click="finishSignup">회원가입 완료 · 아직 이용 불가</button><div class="stack"><button class="secondary" @click="refreshConfig">준비 상태 다시 확인</button><button class="text-button" @click="navigate('info')">이름·이메일 수정</button><button class="text-button" @click="cancelAuth">가입 취소 · 입력 지우기</button></div>
    </template>

    <template v-else-if="screen === 'policies'">
      <p>문서 종류·버전·시행일을 확인하세요. 초안은 실제 동의를 받을 수 없습니다.</p><div class="policy-list"><button v-for="kind in policyKinds" :key="kind" class="list-row" :data-document-trigger="kind" @click="openDocument(kind)"><span>{{ labels[kind] }}<small>{{ policyFor(kind)?.version || '버전 준비 중' }} · {{ policyFor(kind)?.status || '준비 중' }}</small></span><span aria-hidden="true">›</span></button></div><p v-if="docsLoaded && !docs.length" class="notice">등록된 정책 문서가 없습니다.</p><button class="secondary" @click="enter('policies')">목록 다시 불러오기</button>
    </template>

    <template v-else-if="screen === 'document'">
      <h2>{{ doc?.title || labels[documentKind] }}</h2><template v-if="doc"><dl class="metadata"><div><dt>문서 상태</dt><dd>{{ doc.status }}{{ documentCanConsent ? '' : ' · 실제 동의 불가' }}</dd></div><div><dt>버전</dt><dd>{{ doc.version }}</dd></div><div><dt>시행일</dt><dd>{{ doc.effectiveAt ? date(doc.effectiveAt) : '미정' }}</dd></div><div><dt>운영자</dt><dd>{{ doc.operator || '미정' }}</dd></div></dl><p v-if="!documentCanConsent" class="notice">DRAFT 또는 효력 미확인 문서입니다. 법률 검토·최종 승인·시행을 뜻하지 않으며 정식 동의에 사용할 수 없습니다.</p><article class="document-body" aria-label="문서 전문">{{ doc.body || '문서 본문 준비 중입니다.' }}</article></template><button class="secondary" @click="enter('document')">같은 문서 다시 불러오기</button><button class="primary" @click="navigate(documentParent)">읽기 마치고 돌아가기</button>
    </template>

    <template v-else-if="screen === 'member' && member">
      <section class="profile-card"><div class="avatar" aria-hidden="true">{{ member.nickname.slice(0,1) }}</div><h2>{{ member.nickname }}</h2><p>{{ member.email }}</p><dl class="metadata"><div><dt>이름</dt><dd>{{ member.name }}</dd></div><div><dt>고객번호</dt><dd>{{ member.customerNumber }}</dd></div><div><dt>계정 상태</dt><dd>{{ member.status === 'ACTIVE' ? '이용 가능' : '이용 제한' }}</dd></div></dl></section>
      <div class="policy-list"><button class="list-row" @click="navigate('consents')">동의 이력 <span aria-hidden="true">›</span></button><button class="list-row" @click="navigate('notifications')">알림 설정 <span aria-hidden="true">›</span></button><button class="list-row" @click="navigate('policies')">약관 및 서비스 정책 <span aria-hidden="true">›</span></button><button class="list-row" @click="confirmDialog('logout',$event)">로그아웃 <span aria-hidden="true">›</span></button><button class="list-row danger-text" @click="navigate('withdraw')">회원 탈퇴 <span aria-hidden="true">›</span></button></div><p class="muted">프로필 수정·고수 전환 등 후속 기능은 이번 최초 회원 모듈에 포함되지 않습니다.</p>
    </template>

    <template v-else-if="screen === 'consents' && member">
      <p>서버에 기록된 문서 버전별 동의·철회 이력입니다. 열람이나 알림 OFF는 동의 철회가 아닙니다.</p><p v-if="!loading && !records.length" class="notice">기록된 동의 이력이 없습니다.</p><ol class="consent-history"><li v-for="(record,index) in records" :key="index"><h2>{{ record.title }}</h2><p><strong>{{ record.status === 'GRANTED' ? '동의' : '철회' }}</strong> · {{ record.version }}</p><p class="muted">{{ date(record.recordedAt) }}</p><button class="text-button" :data-document-trigger="record.kind + ':' + record.version" @click="openDocument(record.kind,record.version)">이 버전 문서 보기</button></li></ol><button class="secondary" @click="enter('consents')">동의 이력 다시 확인</button><button class="text-button" @click="confirmDialog('marketing',$event)">마케팅 동의 철회 안내</button>
    </template>

    <template v-else-if="screen === 'notifications' && member">
      <p>항목별 변경 즉시 서버에 저장하고 다시 조회합니다.</p><p class="notice">웹의 알림 선호와 OS/브라우저 알림 권한은 별개입니다. 이 화면은 알림 권한을 요청하거나 실제 광고를 발송하지 않습니다.</p>
      <template v-if="preferences"><section v-for="row in notificationRows" :key="row.key" class="notification-row"><div><h2 :id="row.key + '-label'">{{ row.title }}</h2><p :id="row.key + '-detail'" class="muted">{{ row.detail }}</p></div><button type="button" role="switch" class="switch" :aria-checked="preferences[row.key]" :aria-labelledby="row.key + '-label'" :aria-describedby="row.key + '-detail'" :disabled="saving || !!conflict" @click="saveNotification(row.key,!preferences[row.key])"><span class="knob" aria-hidden="true"></span></button></section></template>
      <p class="muted">마케팅 동의: {{ marketingGranted ? '동의 기록 있음' : '동의 기록 없음' }}. 광고 알림 OFF로 바꿔도 동의는 철회되지 않습니다.</p><button class="text-button" @click="navigate('consents')">동의 이력·철회 안내 보기</button>
      <section v-if="conflict" class="notice" aria-label="저장 복구"><h2>최신 설정 확인이 필요해요</h2><p>요청한 변경은 자동 재시도하지 않습니다. 최신 상태와 내 변경 의도를 비교해주세요.</p><button class="secondary" :disabled="saving" @click="reloadPreferences">최신 설정 불러오기</button><button class="primary" :disabled="saving || !conflictReloaded" @click="saveNotification(conflict.key,conflict.value)">확인한 변경 다시 저장</button><button class="text-button" :disabled="saving" @click="conflict = undefined; error = ''">변경 취소 · 현재 설정 유지</button></section>
    </template>

    <template v-else-if="screen === 'withdraw' && member">
      <h2>김고수 서비스를 정말 해지하시나요?</h2><p>탈퇴 확정 시 기존 고객번호의 이용 접근과 세션이 종료됩니다. 실제 보관 중인 자료를 모두 삭제했다고 안내하지 않습니다.</p><p class="notice">{{ notice }}</p><label class="check-row"><input v-model="form.withdrawAcknowledged" type="checkbox"><span>위 안내 사항과 탈퇴 영향을 확인했습니다.</span></label><label for="reason">탈퇴 사유 <span class="muted">선택</span><select id="reason" v-model="form.withdrawReason"><option value="">선택하지 않음</option><option>알림이 너무 많이 와요</option><option>사용하기 어려워요</option><option>오류가 많아서 불편해요</option><option>기타</option></select></label><label for="withdraw-detail">상세 사유 <span class="muted">선택 · 최대 500자</span><textarea id="withdraw-detail" :value="form.withdrawDetail" rows="4" @input="form.withdrawDetail = [...($event.target as HTMLTextAreaElement).value].slice(0,500).join('')"></textarea></label><p class="counter">{{ [...form.withdrawDetail].length }}/500</p><p class="muted">탈퇴 API와 자료별 보존 검토가 준비되기 전에는 실제 탈퇴 처리를 진행하지 않습니다.</p><button class="primary" :disabled="!form.withdrawAcknowledged" @click="confirmDialog('withdraw',$event)">탈퇴 영향 최종 확인</button><button class="secondary" @click="navigate('member')">탈퇴 취소 · 회원 유지</button>
    </template>
  </main>
  <footer class="site-footer"><span>김고수</span><button :disabled="saving" @click="navigate('policies')">약관·개인정보·운영정책</button><p>회원 서비스 개발 연결 중 · 실제 소셜 인증·SMS 미준비</p></footer>
  <dialog ref="dialog" aria-labelledby="dialog-title" aria-describedby="dialog-description" @close="dialogTrigger?.focus()" @cancel="saving && $event.preventDefault()"><div class="dialog-body"><h2 id="dialog-title">{{ dialogType === 'logout' ? '로그아웃하시겠어요?' : dialogType === 'withdraw' ? '정말 회원 탈퇴하시겠어요?' : '마케팅 동의 철회 안내' }}</h2><p id="dialog-description">{{ dialogType === 'logout' ? '서버 세션을 종료합니다. 다시 로그인하기 전까지 회원 기능에 접근할 수 없습니다.' : dialogType === 'withdraw' ? notice : '광고 알림 OFF와 동의 철회는 다릅니다. 별도 철회 API·버전 기록·실제 발송 차단이 준비되기 전에는 동의를 철회했다고 표시하지 않습니다.' }}</p><p v-if="dialogType !== 'logout'" class="notice">{{ dialogType === 'withdraw' ? '실제 탈퇴 API가 준비 중이므로 아직 탈퇴할 수 없습니다. 취소하면 현재 회원과 입력이 유지됩니다.' : '동의 철회 기능을 준비 중입니다. 현재 동의 이력은 유지됩니다.' }}</p><div class="stack"><button v-if="dialogType === 'logout'" class="primary" :disabled="saving" @click="logout">{{ saving ? '로그아웃 처리 중…' : '로그아웃 확인' }}</button><button v-else class="primary" disabled>{{ dialogType === 'withdraw' ? '회원 탈퇴 · 준비 중' : '동의 철회 · 준비 중' }}</button><button class="secondary" :disabled="saving" autofocus @click="closeDialog">취소</button></div></div></dialog>
</template>
