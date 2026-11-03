import type { AuthConfig, ConsentRecord, Member, NotificationKey, PolicyDocument, PolicyKind, Preferences, Provider } from './types.ts';
import { policyKinds } from './domain.ts';
import { consentPayload, readPolicySnapshot, samePolicy, snapshotDisplay, type PolicySnapshot } from './policy.ts';

export type RequestContext = { access: 'public' | 'private'; operation: string };
export class ApiError extends Error {
  readonly status: number; readonly code: string; readonly context?: RequestContext;
  constructor(status: number, code: string, context?: RequestContext) { super(code); this.name = 'ApiError'; this.status = status; this.code = code; this.context = context; }
}
/** HTTP status alone (including an edge denial) is not an account decision. */
export function privateFailure(e: unknown): 'expired' | 'restricted' | 'reconsent' | undefined {
  if (!(e instanceof ApiError) || e.context?.access !== 'private') return;
  if (e.status === 401 && ['AUTH_REQUIRED','SESSION_INVALID','SESSION_EXPIRED','UNAUTHORIZED'].includes(e.code)) return 'expired';
  if (e.status === 403 && e.code === 'ACCOUNT_RESTRICTED') return 'restricted';
  if (e.status === 403 && e.code === 'CONSENT_RENEWAL_REQUIRED') return 'reconsent';
}
// Include decoding and semantic validation, not only fetch, in the request boundary.
function scoped<A extends unknown[], R>(access: RequestContext['access'], operation: string, run: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    try { return await run(...args); }
    catch (e) { throw e instanceof ApiError ? new ApiError(e.status, e.code, e.context ?? { access, operation }) : new ApiError(502, 'INVALID_RESPONSE', { access, operation }); }
  };
}
const invalid = () => { throw new ApiError(502, 'INVALID_RESPONSE'); };
const obj = (v: unknown): Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : invalid();
const text = (v: unknown): string => typeof v === 'string' ? v : invalid();
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
const list = (v: unknown): any[] => Array.isArray(v) ? v : invalid();
const num = (v: unknown): number => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : invalid();
const kind = (v: unknown): PolicyKind => policyKinds.includes(v as PolicyKind) ? v as PolicyKind : invalid();
export function readDocument(value: unknown): PolicyDocument {
  const d = obj(value);
  if (!['DRAFT','READY','RETIRED'].includes(d.status)) return invalid();
  return { kind: kind(d.kind), title: text(d.title), version: text(d.version), status: d.status, body: text(d.body), bodySha256: text(d.bodySha256), operator: d.operator === null ? null : text(d.operator), effectiveAt: d.effectiveAt === null ? null : text(d.effectiveAt), canConsent: bool(d.canConsent) };
}
export async function verifyDocument(value: unknown): Promise<PolicyDocument> {
  const d = readDocument(value);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d.body))), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== d.bodySha256.toLowerCase()) throw new ApiError(502, 'INVALID_RESPONSE');
  return d;
}
export function readPreferences(value: unknown): Preferences {
  const d = obj(value); return { advertising: bool(d.advertising), chat: bool(d.chat), comment: bool(d.comment), quote: bool(d.quote), inquiry: bool(d.inquiry), version: num(d.version) };
}
export interface BrowserAuthPort {
  // Must resolve only after a trusted server-verified flow. Never return OAuth codes in URLs or logs.
  start(provider: Provider): Promise<{ kind: 'session'; opaqueToken: string } | { kind: 'cancelled' } | { kind: 'signup-required'; registrationTicket?: string } | { kind: 'link-required' }>;
}
export const unavailableAuth: BrowserAuthPort = { async start() { throw new ApiError(503, 'BROWSER_AUTH_NOT_CONFIGURED'); } };

/** Opaque session exists only in this closure. No local/sessionStorage, cookie, URL or global bridge. */
export function createApiClient(baseUrl: string, transport: typeof fetch = fetch, timeoutMs = 10000) {
  const origin = new URL(baseUrl);
  if (origin.origin !== 'https://api-dev-kimgosu.mintech.ai' && !(origin.protocol === 'http:' && ['127.0.0.1','localhost'].includes(origin.hostname))) throw new Error('UNAPPROVED_API_ORIGIN');
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('INVALID_API_BASE');
  let session: string | undefined;
  function setSession(value: string) { if (!value || /[\r\n]/.test(value)) throw new Error('INVALID_SESSION'); session = value; }
  function clearSession() { session = undefined; }
  async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string,string> = { Accept: 'application/json', 'Cache-Control': 'no-store' };
      const pathname = path.split('?')[0];
      if (session && !(pathname === '/v1/auth/config' || pathname === '/v1/auth/signup' || pathname.startsWith('/v1/auth/social/') || pathname.startsWith('/v1/auth/sms/') || pathname === '/v1/policies' || pathname.startsWith('/v1/policies/'))) headers.Authorization = `Bearer ${session}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await transport(origin.origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (controller.signal.aborted) throw new ApiError(0, 'TIMEOUT');
      let result: unknown; try { result = await response.json(); } catch { throw new ApiError(502, 'INVALID_RESPONSE'); }
      if (controller.signal.aborted) throw new ApiError(0, 'TIMEOUT');
      if (!response.ok) {
        // Do not copy arbitrary server messages or error codes (which can contain PII) to UI/logs.
        const envelope = obj(result).error;
        if (!envelope || typeof envelope !== 'object' || typeof envelope.code !== 'string') throw new ApiError(502, 'INVALID_RESPONSE');
        const raw = envelope.code;
        const allowed = ['DOCUMENT_PREPARING','VERSION_CONFLICT','STALE_VERSION','MARKETING_CONSENT_REQUIRED','SESSION_EXPIRED','UNAUTHORIZED','AUTH_REQUIRED','SESSION_INVALID','CONSENT_RENEWAL_REQUIRED','ACCOUNT_RESTRICTED','FORBIDDEN','POLICY_NOT_READY','POLICY_METADATA_UNAVAILABLE','POLICY_VERSION_CHANGED','DOCUMENT_NOT_READY','REQUIRED_CONSENT_MISSING','PROVIDER_UNAVAILABLE','SMS_UNAVAILABLE','RATE_LIMITED','NOT_FOUND','REGISTRATION_INVALID','OAUTH_FLOW_INVALID','PROVIDER_NOT_CONFIGURED','SMS_PROVIDER_NOT_CONFIGURED','SMS_CODE_INVALID_OR_EXPIRED','SMS_RATE_LIMITED','SMS_DELIVERY_FAILED','PHONE_ALREADY_REGISTERED','PHONE_VERIFICATION_REQUIRED','ALREADY_REGISTERED','IDENTITY_RECOVERY_REQUIRED','REJOIN_WAIT_REQUIRED','INVALID_REQUEST','AUTH_RATE_LIMITED'];
        throw new ApiError(response.status, allowed.includes(raw) ? raw : 'REQUEST_FAILED');
      }
      return result;
    } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(0, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR'); }
    finally { clearTimeout(timer); }
  }
  const api = {
    setSession, clearSession,
    // Normal wire adapters. Browser redirect/account configuration remains an
    // explicit BrowserAuthPort prerequisite; no URL/global test-token bridge.
    async socialStart(provider: Provider, codeChallenge: string) {
      const d = obj(await request('/v1/auth/social/start','POST',{provider,codeChallenge}));
      if (!/^[A-Za-z0-9_-]{43}$/.test(d.state) || d.expiresInSeconds !== 300) return invalid();
      return { authorizationUrl:text(d.authorizationUrl), state:text(d.state), expiresInSeconds:300 };
    },
    async socialComplete(input: {provider:Provider;state:string;code:string;codeVerifier:string}) {
      const d = obj(await request('/v1/auth/social/complete','POST',input));
      if (d.outcome === 'REGISTRATION_REQUIRED' && /^[A-Za-z0-9_-]{43}$/.test(d.registrationTicket) && d.expiresInSeconds === 600) return {kind:'signup-required' as const,registrationTicket:text(d.registrationTicket)};
      if (d.outcome === 'AUTHENTICATED') {
        const s = obj(d.session);
        if (!/^[A-Za-z0-9_-]{43}$/.test(s.accessToken) || !/^[A-Za-z0-9_-]{43}$/.test(s.refreshToken) || s.tokenType !== 'Bearer' || s.expiresInSeconds !== 900) return invalid();
        return {kind:'session' as const,opaqueToken:text(s.accessToken)};
      }
      return invalid();
    },
    async smsSend(registrationTicket:string,phone:string) {
      const d = obj(await request('/v1/auth/sms/send','POST',{registrationTicket,phone}));
      if (!/^[0-9a-f-]{36}$/.test(d.challengeId) || d.expiresInSeconds !== 60 || d.codeDigits !== 5 || ![d.serverTime,d.expiresAt,d.retryAfter].every(v=>typeof v === 'string' && Number.isFinite(Date.parse(v)))) return invalid();
      return {challengeId:text(d.challengeId),serverTime:text(d.serverTime),expiresAt:text(d.expiresAt),retryAfter:text(d.retryAfter)};
    },
    async smsVerify(registrationTicket:string,challengeId:string,code:string) {
      if (obj(await request('/v1/auth/sms/verify','POST',{registrationTicket,challengeId,code})).verified !== true) return invalid();
      return {verified:true as const};
    },
    async adoptSession(accessToken:string, active:()=>boolean): Promise<Member> {
      // Verify with a temporary memory-only client before adopting into the
      // live closure. A cancelled/late reply cannot install a new session.
      const candidate = createApiClient(baseUrl,transport,timeoutMs); candidate.setSession(accessToken);
      try { const member = await candidate.me(); if (!active()) throw new ApiError(0,'CANCELLED'); setSession(accessToken); return member; }
      finally { candidate.clearSession(); }
    },
    async policySnapshot(): Promise<PolicySnapshot> {
      return readPolicySnapshot(obj(await request('/v1/policies?metadata=policy-v0.3')).policySnapshot);
    },
    async policyDocument(policy: PolicyKind, version?: string) {
      if (!policyKinds.includes(policy)) return invalid();
      const response = obj(await request('/v1/policies/' + policy + '?metadata=policy-v0.3' + (version === undefined ? '' : '&version=' + encodeURIComponent(version))));
      const snapshot = await readPolicySnapshot(response.policySnapshot);
      const document = version === undefined ? snapshotDisplay(snapshot,policy) : snapshot.documents.find(d=>d.kind === policy && d.version === version);
      if (!document) return invalid();
      for (const key of Object.keys(document)) if (response[key] !== document[key as keyof typeof document]) return invalid();
      return { snapshot, document };
    },
    // Fresh comparison is not itself a commit fence. Server owns commit rules.
    async grantConsents(snapshot: PolicySnapshot, checked: Partial<Record<PolicyKind,boolean>>, active: () => boolean = () => true) {
      const fresh = await scoped('public','policySnapshot',api.policySnapshot)();
      if (!active()) throw new ApiError(0,'CANCELLED');
      if (!samePolicy(snapshot,fresh)) throw new ApiError(409,'POLICY_VERSION_CHANGED');
      const payload = consentPayload(fresh,checked);
      if (obj(await request('/v1/me/consents','POST',payload)).recorded !== true) return invalid();
      return {recorded:true as const};
    },
    async signup(snapshot: PolicySnapshot, checked: Partial<Record<PolicyKind,boolean>>, input: {registrationTicket:string;name:string;email:string;age14Confirmed:true;expertRequested:boolean}, active: () => boolean = () => true) {
      const fresh = await scoped('public','policySnapshot',api.policySnapshot)();
      if (!active()) throw new ApiError(0,'CANCELLED');
      if (!samePolicy(snapshot,fresh)) throw new ApiError(409,'POLICY_VERSION_CHANGED');
      const payload = consentPayload(fresh,checked);
      if (!/^[A-Za-z0-9_-]{43}$/.test(input.registrationTicket) || input.age14Confirmed !== true || !input.name.trim() || [...input.name].length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || [...input.email].length > 254 || typeof input.expertRequested !== 'boolean') return invalid();
      const result = obj(await request('/v1/auth/signup','POST',{registrationTicket:input.registrationTicket,name:input.name,email:input.email,age14Confirmed:true,expertRequested:input.expertRequested,...payload}));
      const session = obj(result.session);
      if (result.outcome !== 'REGISTERED' || !/^[A-Za-z0-9_-]{43}$/.test(session.accessToken) || !/^[A-Za-z0-9_-]{43}$/.test(session.refreshToken) || session.tokenType !== 'Bearer' || session.expiresInSeconds !== 900) return invalid();
      return {outcome:'REGISTERED' as const,session:{accessToken:text(session.accessToken),refreshToken:text(session.refreshToken),tokenType:'Bearer' as const,expiresInSeconds:900}};
    },
    async config(): Promise<AuthConfig> {
      const d = obj(await request('/v1/auth/config')); const sms = obj(d.sms); const r = obj(d.retention);
      return { release: text(d.release), signupReady: bool(d.signupReady), providers: list(d.providers).map(x => { const p = obj(x); if (!['kakao','naver','google'].includes(p.id)) return invalid(); return { id: p.id, enabled: bool(p.enabled), reason: p.reason === undefined ? undefined : text(p.reason) }; }), sms: { available: bool(sms.available), codeDigits: num(sms.codeDigits), expiresInSeconds: num(sms.expiresInSeconds), phonePattern: text(sms.phonePattern) }, requiredFields: list(d.requiredFields).map(text), minimumAgeAcknowledgement: num(d.minimumAgeAcknowledgement), collectsGender: bool(d.collectsGender), collectsAgeGroup: bool(d.collectsAgeGroup), rejoinWaitDays: num(d.rejoinWaitDays), retention: { purpose: text(r.purpose), startsAt: text(r.startsAt), calendarYears: num(r.calendarYears), rejoinResetsClock: bool(r.rejoinResetsClock) }, documents: list(d.documents).map(x => { const p = obj(x); if (!['DRAFT','READY','RETIRED'].includes(p.status)) return invalid(); return { kind: kind(p.kind), version: text(p.version), status: p.status, canConsent: bool(p.canConsent) }; }) };
    },
    async policies() { return Promise.all(list(obj(await request('/v1/policies')).documents).map(verifyDocument)); },
    async document(policy: PolicyKind, version?: string) {
      if (!policyKinds.includes(policy)) return invalid();
      const document = await verifyDocument(await request('/v1/policies/' + policy + (version ? '?version=' + encodeURIComponent(version) : '')));
      if (document.kind !== policy || (version !== undefined && document.version !== version)) return invalid();
      return document;
    },
    async me(): Promise<Member> {
      const d = obj(await request('/v1/me')); if (!['ACTIVE','RESTRICTED'].includes(d.status)) return invalid();
      return { id: text(d.id), customerNumber: text(d.customerNumber), name: text(d.name), email: text(d.email), nickname: text(d.nickname), status: d.status, expertActive: bool(d.expertActive), createdAt: text(d.createdAt) };
    },
    async consents(): Promise<ConsentRecord[]> { return list(obj(await request('/v1/me/consents')).records).map(x => { const r = obj(x); if (!['GRANTED','WITHDRAWN'].includes(r.status)) return invalid(); return { kind: kind(r.kind), title: text(r.title), version: text(r.version), status: r.status, recordedAt: text(r.recordedAt) }; }); },
    async notifications() { return readPreferences(await request('/v1/me/notifications')); },
    async saveNotification(key: NotificationKey, value: boolean, expectedVersion: number) {
      if (!['advertising','chat','comment','quote','inquiry'].includes(key) || typeof value !== 'boolean' || !Number.isSafeInteger(expectedVersion)) return invalid();
      return readPreferences(await request('/v1/me/notifications', 'PATCH', { expectedVersion, [key]: value }));
    },
    async logout() { if (obj(await request('/v1/auth/logout', 'POST')).loggedOut !== true) return invalid(); clearSession(); },
  };
  return { ...api,
    socialStart: scoped('public','socialStart',api.socialStart),
    socialComplete: scoped('public','socialComplete',api.socialComplete),
    smsSend: scoped('public','smsSend',api.smsSend),
    smsVerify: scoped('public','smsVerify',api.smsVerify),
    policySnapshot: scoped('public', 'policySnapshot', api.policySnapshot),
    policyDocument: scoped('public', 'policyDocument', api.policyDocument),
    grantConsents: scoped('private', 'grantConsents', api.grantConsents),
    signup: scoped('public', 'signup', api.signup),
    config: scoped('public', 'config', api.config),
    policies: scoped('public', 'policies', api.policies),
    document: scoped('public', 'document', api.document),
    me: scoped('private', 'me', api.me),
    consents: scoped('private', 'consents', api.consents),
    notifications: scoped('private', 'notifications', api.notifications),
    saveNotification: scoped('private', 'saveNotification', api.saveNotification),
    logout: scoped('private', 'logout', api.logout),
  };
}
export type MembershipApi = ReturnType<typeof createApiClient>;
export const uncertainWrite = (e:unknown) => e instanceof ApiError && ['signup','smsSend','smsVerify','grantConsents'].includes(e.context?.operation ?? '') && (e.status === 0 || e.code === 'INVALID_RESPONSE' || e.status >= 500);
export const safeMessage = (e: unknown): string => {
  if (!(e instanceof ApiError)) return '처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
  if (privateFailure(e) === 'reconsent') return '필수 문서의 재동의가 필요합니다. 이용 제한이나 세션 만료가 아닙니다. 약관 및 정책을 확인해주세요. 현재 웹 재동의 저장 기능은 준비 중이며 이전 요청은 자동 실행하지 않습니다.';
  if (e.status === 409) return e.code === 'MARKETING_CONSENT_REQUIRED' ? '광고 알림을 켜려면 별도 마케팅 동의가 필요합니다.' : '다른 곳에서 설정이 변경됐습니다. 최신 설정을 확인한 후 다시 저장해주세요.';
  if (e.status === 404) return '문서를 준비 중이거나 현재 API가 아직 제공되지 않습니다.';
  if (e.code === 'CONFIG_UNAVAILABLE' || e.code === 'CONFIG_PENDING') return '회원 서비스 준비 상태를 확인하지 못했습니다. 서비스 상태 다시 확인을 누른 뒤 다시 시도해주세요.';
  if (e.code === 'BROWSER_AUTH_NOT_CONFIGURED') return '소셜 로그인을 준비 중입니다. 제공자 연결과 웹 인증 설정이 완료된 뒤 이용할 수 있습니다.';
  if (e.code === 'TIMEOUT') return '응답 시간이 초과됐습니다. 저장 결과가 불확실하면 최신 상태부터 확인해주세요.';
  if (e.code === 'INVALID_RESPONSE') return '서비스 응답을 확인할 수 없습니다. 새 회원 API 연결을 확인한 후 다시 시도해주세요.';
  if (e.status === 429) return '요청이 많습니다. 잠시 기다린 뒤 다시 시도해주세요.';
  return '연결 또는 처리에 실패했습니다. 입력은 이 화면에 유지됩니다. 다시 시도해주세요.';
};
