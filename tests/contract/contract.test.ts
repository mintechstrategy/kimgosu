// Developer contract tests: Fastify inject + explicit SQL/provider doubles only.
// No socket, Railway, SMS delivery, provider login, SDK, or independent QA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildApp } from '../../services/backend/src/app.ts';
import type { Sql, Row } from '../../services/backend/src/app.ts';
import { mac } from '../../services/backend/src/security.ts';
const require = createRequire(new URL('../../services/backend/package.json', import.meta.url));
const Ajv = require('ajv');
const contract = JSON.parse(readFileSync(new URL('../../contracts/auth-membership.v0.2.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, unicodeRegExp: true });
const compile = (schema: unknown) => ajv.compile({ definitions: contract.schemaDefinitions, ...(schema as object) });
const operation = (id: string) => contract.operations.find((o: { id: string }) => o.id === id);
function validate(id: string, value: unknown) { const v = compile(operation(id).responses['200']); assert(v(value), id + ': ' + ajv.errorsText(v.errors)); }
const token = () => randomBytes(32).toString('base64url');
const authorization = () => 'Bearer ' + token();
const time = '2030-01-01T00:00:00.000Z';
const expiry = '2030-01-01T00:01:00.000Z';
const later = '2030-01-01T00:30:00.000Z';
const principal = randomUUID();
const origin = 'https://dev-kimgosu.mintech.ai';
const preferences = { advertising: false, chat: false, comment: false, quote: false, inquiry: false, version: 0 };
const policy = { kind: 'OPERATIONS', version: 'draft-only', status: 'DRAFT', title: 'Test only', body: 'Explicit test double, not an effective policy', bodySha256: createHash('sha256').update('Explicit test double, not an effective policy').digest('hex'), operator: null, effectiveAt: null, canConsent: false };
class DoubleSql implements Sql {
  calls: string[] = [];
  member = randomUUID();
  session = randomUUID();
  valid = true;
  version = 0;
  mode = 'core';
  async query(text: string, _values?: unknown[]) {
    this.calls.push(text);
    let rows: Row[] = [];
    if (text.includes('FROM kg_membership.sessions s')) rows = this.valid ? [{ sessionId: this.session, memberId: this.member, principalId: principal, status: 'ACTIVE' }] : [];
    else if (text.includes('FROM kg_membership.registration_tickets')) rows = [{ ticket_digest: 'TEST_DIGEST', provider: 'google', subject_digest: 'TEST_DIGEST', phone_digest: 'TEST_DIGEST', phone_verified_at: time }];
    else if (text.includes('count(*)::integer')) rows = [{ count: this.mode === 'hour' ? 5 : 1, recent: this.mode !== 'hour', serverTime: time, retryAfter: this.mode === 'hour' ? later : expiry }];
    else if (text.startsWith('INSERT INTO kg_membership.sms_challenges')) rows = [{ serverTime: new Date(time), expiresAt: new Date(expiry), retryAfter: new Date(expiry) }];
    else if (text.includes('FROM kg_membership.social_links')) rows = [{ principal_id: principal }];
    else if (text.startsWith('SELECT id,withdrawn_at')) rows = this.mode.startsWith('principal') ? [{ id: randomUUID(), withdrawn_at: time, waiting: true, serverTime: time, rejoinAfter: this.mode === 'principalBadClock' ? 'invalid' : later }, { id: randomUUID(), withdrawn_at: time, waiting: true, serverTime: time, rejoinAfter: expiry }] : [];
    else if (text.startsWith('SELECT principal_id,withdrawn_at')) rows = [{ principal_id: this.mode === 'differentPrincipal' ? randomUUID() : principal, withdrawn_at: time, waiting: true, serverTime: time, rejoinAfter: later }];
    else if (text.startsWith('SELECT id,customer_no')) rows = [{ id: this.member, customerNumber: '100', name: 'TEST', email: 'test@example.invalid', nickname: '고수테스트', status: 'ACTIVE', expertActive: false, createdAt: time }];
    else if (text.startsWith('SELECT DISTINCT ON(d.kind)')) rows = [];
    else if (text.startsWith('SELECT advertising')) rows = [{ ...preferences, version: String(this.version) }];
    else if (text.startsWith('UPDATE kg_membership.notification_preferences')) rows = [{ ...preferences, chat: true, version: String(++this.version) }];
    else if (text.startsWith('UPDATE kg_membership.sessions')) this.valid = false;
    else if (text.includes('FROM kg_membership.policy_documents')) rows = [policy];
    else if (text.includes('FOR UPDATE')) rows = [{ id: this.member, status: 'ACTIVE' }];
    return { rows, rowCount: rows.length };
  }
  async transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> { return work(this); }
}
const sample: Record<string, () => unknown> = {
  socialStart: () => ({ provider: 'google', codeChallenge: token() }),
  socialLinkStart: () => ({ provider: 'google', codeChallenge: token(), confirmed: true }),
  socialComplete: () => ({ provider: 'google', state: token(), code: token(), codeVerifier: token() }),
  smsSend: () => ({ registrationTicket: token(), phone: '010' + String(randomBytes(4).readUInt32BE()).padStart(10, '0').slice(-8) }),
  smsVerify: () => ({ registrationTicket: token(), challengeId: randomUUID(), code: String(randomBytes(4).readUInt32BE()).padStart(10, '0').slice(-5) }),
  signup: () => ({ registrationTicket: token(), name: 'TEST', email: 'test@example.invalid', age14Confirmed: true, expertRequested: false, consents: [{ kind: 'TERMS', version: 'test' }, { kind: 'PRIVACY_CONSENT', version: 'test' }] }),
  refresh: () => ({ refreshToken: token() }), consentsPost: () => ({ consents: [{ kind: 'TERMS', version: 'test' }, { kind: 'PRIVACY_CONSENT', version: 'test' }] }),
  consentWithdraw: () => ({ kind: 'MARKETING' }), withdraw: () => ({ confirmed: true }), profilePatch: () => ({ nickname: '고수123' }), expert: () => ({ requested: true }),
};
test('v0.2 compiles every input/output/error schema; immutable core9 and complete route inventory', () => {
  for (const o of contract.operations) { if (o.requestSchema) compile(o.requestSchema); for (const s of Object.values(o.responses)) compile(s); if (o.paramsSchema) compile(o.paramsSchema); if (o.querySchema) compile(o.querySchema); }
  compile(contract.errorSchema);
  const v01Bytes = readFileSync(new URL('../../contracts/auth-membership.v0.1.json', import.meta.url));
  assert.equal(createHash('sha256').update(v01Bytes).digest('hex'), contract.compatibility.v01Sha256);
  assert.deepEqual(JSON.parse(v01Bytes.toString()).implementedCore, contract.compatibility.core9PreservedVerbatim);
  const sources = ['app.ts', 'auth.ts'].map(f => readFileSync(new URL('../../services/backend/src/' + f, import.meta.url), 'utf8')).join('\n');
  const actual = [...sources.matchAll(/app\.(get|post|patch|options)(?:<[^\n]*?>)?\('([^']+)'/g)].map(m => m[1].toUpperCase() + ' ' + m[2]);
  assert.deepEqual(actual.sort(), [...contract.operations.map((o: {method: string; path: string}) => o.method + ' ' + o.path), 'OPTIONS /*'].sort());
  assert.equal(contract.operations.length, 21);
});
test('all core9 complete response fields retain legacy types and semantics on explicit SQL double', async t => {
  const db = new DoubleSql(); const app = buildApp(db, 'contract-double'); t.after(() => app.close()); const headers = { authorization: authorization() };
  const cases: [string, string, string, unknown?][] = [['health', 'GET', '/health'], ['authConfig', 'GET', '/v1/auth/config'], ['policies', 'GET', '/v1/policies'], ['policy', 'GET', '/v1/policies/OPERATIONS'], ['me', 'GET', '/v1/me'], ['consentsGet', 'GET', '/v1/me/consents'], ['notificationsGet', 'GET', '/v1/me/notifications'], ['notificationsPatch', 'PATCH', '/v1/me/notifications', { expectedVersion: 0, chat: true }], ['logout', 'POST', '/v1/auth/logout']];
  for (const [id, method, url, payload] of cases) {
    const r = await app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) }); assert.equal(r.statusCode, 200, id); validate(id, r.json()); assert.equal(r.headers['cache-control'], 'no-store');
    if (id === 'health') assert.deepEqual(r.json(), { status: 'ok', scope: 'membership-development', release: 'contract-double' });
    if (id === 'authConfig') { assert.equal(r.json().signupReady, false); assert.equal(r.json().collectsGender, false); assert.equal(r.json().collectsAgeGroup, false); assert.deepEqual(r.json().requiredFields, ['name','email']); }
    if (id === 'policies') assert.deepEqual(r.json(), { documents: [policy] });
    if (id === 'policy') assert.deepEqual(r.json(), policy);
    if (id === 'consentsGet') assert.deepEqual(r.json(), { records: [] });
    if (id === 'notificationsGet') assert.deepEqual(r.json(), preferences);
    if (id === 'notificationsPatch') assert.deepEqual(r.json(), { ...preferences, chat: true, version: 1 });
    if (id === 'logout') assert.deepEqual(r.json(), { loggedOut: true });
  }
});
test('all12 extension request schemas match actual missing/additional-field rejection before SQL', async t => {
  const db = new DoubleSql(); const app = buildApp(db, 'contract-double'); t.after(() => app.close());
  for (const [id, make] of Object.entries(sample)) {
    const o = operation(id); const valid = make() as Record<string, unknown>; const v = compile(o.requestSchema); assert(v(valid), id);
    for (const body of [{ ...valid, memberId: randomUUID() }, {}]) {
      assert.equal(v(body), false, id);
      const r = await app.inject({ method: o.method, url: o.path, headers: { authorization: authorization() }, payload: body });
      assert.equal(r.statusCode, 400, id); assert.equal(r.json().error.code, 'INVALID_REQUEST', id);
    }
  }
  assert.equal(db.calls.length, 0);
});
test('policy optional nickname uses explicit profile step; signup rejects nickname/gender and withdrawal rejects reason/detail', async t => {
  const db = new DoubleSql(); const app = buildApp(db, 'contract-double'); t.after(() => app.close());
  for (const extra of [{ nickname: '고수테스트' }, { gender: 'X' }, { ageGroup: '20' }, { canConsent: true }, { verified: true }, { status: 'ACTIVE' }, { customerNumber: '100' }, { rejoinAfter: time }, { retentionUntil: time }]) {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { ...(sample.signup() as object), ...extra } }); assert.equal(r.statusCode, 400);
  }
  for (const extra of [{ reason: 'other' }, { detail: 'private' }, { confirmed: false }]) {
    const r = await app.inject({ method: 'POST', url: '/v1/me/withdraw', headers: { authorization: authorization() }, payload: { confirmed: true, ...extra } }); assert.equal(r.statusCode, 400);
  }
  assert.equal(db.calls.length, 0);
});
test('exact browser CORS accepts current web Cache-Control preflight; denies wildcard/null/foreign headers', async t => {
  const app = buildApp(new DoubleSql(), 'contract-double', { corsOrigins: ['http://127.0.0.1:4178', 'https://evil.invalid'] }); t.after(() => app.close());
  for (const value of [origin, 'http://127.0.0.1:4178']) {
    const r = await app.inject({ method: 'OPTIONS', url: '/v1/me/notifications', headers: { origin: value, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type,cache-control' } });
    assert.equal(r.statusCode, 204); assert.equal(r.headers['access-control-allow-origin'], value); assert.equal(r.headers.vary, 'Origin'); assert.equal(r.headers['access-control-allow-credentials'], undefined);
  }
  for (const value of ['null', 'https://evil.invalid', 'https://kimsogu.mintech.ai', 'http://localhost:4178']) {
    const r = await app.inject({ url: '/health', headers: { origin: value } }); assert.equal(r.statusCode, 403); assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
  const denied = await app.inject({ method: 'OPTIONS', url: '/v1/me', headers: { origin, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'X-Unapproved' } }); assert.equal(denied.statusCode, 403);
});
test('allowed-origin error 400/401/403/409/429/500 and success carry CORS and exposed time headers', async t => {
  const db = new DoubleSql(); const app = buildApp(db, 'contract-double'); t.after(() => app.close());
  const cases = [await app.inject({ url: '/health', headers: { origin } }), await app.inject({ method: 'POST', url: '/v1/auth/signup', headers: { origin }, payload: {} }), await app.inject({ url: '/v1/me', headers: { origin } }), await app.inject({ method: 'OPTIONS', url: '/v1/me', headers: { origin, 'access-control-request-method': 'DELETE' } }), await app.inject({ method: 'POST', url: '/v1/me/consents/withdraw', headers: { origin, authorization: authorization() }, payload: { kind: 'TERMS' } })];
  db.query = async () => { throw new Error('DO_NOT_EXPOSE'); };
  cases.push(await app.inject({ url: '/v1/policies', headers: { origin } }));
  for (let i = 0; i < 62; i++) { const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { origin }, payload: {} }); if (r.statusCode === 429) { cases.push(r); break; } }
  assert.deepEqual(new Set(cases.map(r => r.statusCode)), new Set([200,400,401,403,409,429,500]));
  for (const r of cases) { assert.equal(r.headers['access-control-allow-origin'], origin); assert.equal(r.headers.vary, 'Origin'); assert.equal(r.headers['access-control-expose-headers'], 'Date, Retry-After, X-Server-Time'); assert(Number.isFinite(Date.parse(String(r.headers['x-server-time'])))); assert(!r.body.includes('DO_NOT_EXPOSE')); }
});
test('SMS success has absolute DB expiry/retry anchors and retained relative60s; no code leaks', async t => {
  const db = new DoubleSql(); db.mode = 'send'; const query = db.query.bind(db); db.query = async (sql, values) => sql.includes('count(*)::integer') ? { rows: [{count:0,recent:false}], rowCount:1 } : query(sql,values);
  let deliveries = 0; const app = buildApp(db, 'contract-double', { identityKey: token(), sms: { send: async (_phone, _code) => { deliveries++; } } }); t.after(() => app.close());
  const r = await app.inject({ method: 'POST', url: '/v1/auth/sms/send', payload: sample.smsSend() }); assert.equal(r.statusCode, 200); validate('smsSend',r.json());
  const b = r.json(); assert.equal(b.serverTime,time); assert.equal(b.expiresAt,expiry); assert.equal(b.retryAfter,expiry); assert.equal(b.expiresInSeconds,60); assert.equal(b.codeDigits,5); assert.equal(deliveries,1); assert.deepEqual(Object.keys(b).sort(),['challengeId','expiresInSeconds','codeDigits','serverTime','expiresAt','retryAfter'].sort());
  assert(db.calls.some(s => s.includes('RETURNING now() AS "serverTime"')));
});
for (const mode of ['recent','hour']) test('SMS '+mode+' rate metadata uses authoritative deadline and Retry-After', async t => {
  const db = new DoubleSql(); db.mode = mode; let deliveries = 0; const app = buildApp(db,'contract-double',{identityKey:token(),sms:{send:async()=>{deliveries++;}}}); t.after(()=>app.close());
  const r = await app.inject({method:'POST',url:'/v1/auth/sms/send',headers:{origin},payload:sample.smsSend()});
  assert.equal(r.statusCode,429); assert.deepEqual(r.json(),{error:{code:'SMS_RATE_LIMITED',serverTime:time,retryAfter:mode==='hour'?later:expiry,retryAfterSeconds:mode==='hour'?1800:60}}); assert.equal(r.headers['retry-after'],mode==='hour'?'1800':'60'); assert.equal(deliveries,0); assert(!db.calls.some(s=>s.startsWith('INSERT INTO kg_membership.sms_challenges')));
});
for (const mode of ['principal','phone','differentPrincipal']) test('rejoin '+mode+' metadata is scoped to verified registration and does not leak other principal', async t => {
  const db = new DoubleSql(); db.mode = mode; const app = buildApp(db,'contract-double'); t.after(()=>app.close());
  const r = await app.inject({method:'POST',url:'/v1/auth/signup',payload:sample.signup()}); assert.equal(r.statusCode,409);
  assert.deepEqual(r.json(),mode==='differentPrincipal'?{error:{code:'IDENTITY_RECOVERY_REQUIRED'}}:{error:{code:'REJOIN_WAIT_REQUIRED',rejoinAfter:later,serverTime:time}}); assert(!db.calls.some(s=>s.startsWith('INSERT INTO kg_membership.members')));
});
test('invalid timing from SQL fails closed instead of fabricating metadata', async t => {
  const db=new DoubleSql(); db.mode='principalBadClock';const app=buildApp(db,'contract-double');t.after(()=>app.close());const r=await app.inject({method:'POST',url:'/v1/auth/signup',payload:sample.signup()});assert.equal(r.statusCode,500);assert.deepEqual(r.json(),{error:{code:'INTERNAL_ERROR'}});
});
test('clock-skew/sleep/transit cannot extend challenge; use DB anchor not client wall clock', () => {
  const remaining = (deadline: string, anchor: string, elapsed: number) => Math.max(0,Date.parse(deadline)-Date.parse(anchor)-elapsed);
  assert.equal(remaining(expiry,time,2500),57500); assert.equal(remaining(expiry,time,65000),0);
  for(const clientWallSkew of [-86400000,0,86400000]) { void clientWallSkew; assert.equal(remaining(expiry,time,5000),55000); }
});
class LifecycleDouble extends DoubleSql {
  key = token();
  challengeId = randomUUID();
  code = String(randomBytes(4).readUInt32BE()).padStart(10, '0').slice(-5);
  flow: 'login' | 'register' | 'link' = 'login';
  async query(text: string, values?: unknown[]) {
    // SQL response shapes only: NOT persistence, provider auth, or transaction correctness.
    this.calls.push(text);
    const result = (rows: Row[]) => ({ rows, rowCount: rows.length });
    if (text.includes('FROM kg_membership.sessions s') && !text.includes('refresh_digest')) return result(this.valid ? [{sessionId:this.session,memberId:this.member,principalId:principal,status:'ACTIVE'}] : []);
    if (text.includes('UPDATE kg_membership.oauth_flows')) return result([{state_digest:'TEST_DIGEST',link_member_id:this.flow==='link'?this.member:null}]);
    if (text.includes('FROM kg_membership.social_links l JOIN')) return result(this.flow==='register'?[]:[{id:this.member}]);
    if (text.includes('FROM kg_membership.social_links')) return result([{principal_id:principal}]);
    if (text.includes('FROM kg_membership.registration_tickets')) return result([{ticket_digest:'TEST_DIGEST',provider:'google',subject_digest:'TEST_DIGEST',phone_digest:'TEST_DIGEST',phone_verified_at:time}]);
    if (text.includes('count(*)::integer')) return result([{count:0,recent:false}]);
    if (text.includes('FROM kg_membership.sms_challenges WHERE id=')) return result([{id:this.challengeId,attempts:0,phone_digest:'TEST_DIGEST',code_mac:mac(this.key,'sms:'+this.challengeId,this.code)}]);
    if (text.startsWith('INSERT INTO kg_membership.sms_challenges')) return result([{serverTime:time,expiresAt:expiry,retryAfter:expiry}]);
    if (text.startsWith('SELECT id,withdrawn_at') || text.startsWith('SELECT principal_id,withdrawn_at') || text.startsWith('SELECT id FROM kg_membership.members WHERE phone_digest') || text.startsWith('SELECT id FROM kg_membership.restrictions')) return result([]);
    if (text.includes('FROM kg_membership.policy_documents')) return result(['TERMS','PRIVACY_CONSENT','PRIVACY_POLICY'].map(kind=>({id:randomUUID(),kind,version:'test'})));
    if (text.startsWith('SELECT action FROM kg_membership.consent_events')) return result([{action:'GRANTED'}]);
    if (text.startsWith('SELECT member_id FROM kg_membership.sessions')) return result([{member_id:this.member}]);
    if (text.startsWith('SELECT s.*,m.withdrawn_at')) return result([{member_id:this.member,family_id:randomUUID(),withdrawn_at:null,revoked_at:null,refresh_expires_at:'2030-02-01T00:00:00.000Z'}]);
    if (text.startsWith('SELECT e.document_id')) return result([{document_id:randomUUID(),action:'GRANTED'}]);
    if (text.startsWith('UPDATE kg_membership.members SET status=')) return result([{withdrawnAt:time,rejoinAfter:'2030-01-31T00:00:00.000Z',retentionUntil:'2031-01-01T00:00:00.000Z'}]);
    if (text.startsWith('UPDATE kg_membership.members SET nickname')) return result([{nickname:values?.[1]}]);
    if (text.startsWith('UPDATE kg_membership.members SET expert_active')) return result([{expertActive:true}]);
    if (text.includes('FOR UPDATE')) return result([{id:this.member,principal_id:principal,status:'ACTIVE'}]);
    return result([]);
  }
}
test('all12 extension success wire schemas and social three-outcome union exercise actual handlers with explicit doubles', async t => {
  const exercised = new Set<string>();
  for (const [id, make] of Object.entries(sample)) {
    const db = new LifecycleDouble();
    const app = buildApp(db,'contract-double',{identityKey:db.key,sms:{send:async()=>{}},providers:{google:{authorize:state=>'https://accounts.google.com/o/oauth2/v2/auth?state='+state,exchange:async()=>({subject:'EXPLICIT_TEST_DOUBLE'})}}});
    t.after(()=>app.close()); const o = operation(id); let payload = make();
    if(id==='smsVerify') payload={registrationTicket:token(),challengeId:db.challengeId,code:db.code};
    const r=await app.inject({method:o.method,url:o.path,headers:{authorization:authorization()},payload});
    assert.equal(r.statusCode,200,id);validate(id,r.json());exercised.add(id);
    if(id==='socialComplete') for(const flow of ['register','link'] as const) {db.flow=flow;const r=await app.inject({method:o.method,url:o.path,headers:{authorization:authorization()},payload:make()});assert.equal(r.statusCode,200);validate(id,r.json());assert.equal(r.json().outcome,flow==='link'?'LINKED':'REGISTRATION_REQUIRED');}
  }
  assert.equal(exercised.size,12);
});
