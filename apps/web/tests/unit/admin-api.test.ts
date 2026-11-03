// WS-19/WS-23: operator console API client. Local pure-module regressions only —
// the transport is an explicit fetch double, no API, DB or network is contacted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AdminApiError, createAdminApi } from '../../src/admin/api.ts';

// Operator scope: `adm_` + a 43-char opaque token. A member token (43 chars, no
// prefix) is *not* an operator session.
const TOKEN = 'adm_' + 'T'.repeat(43);
const MEMBER_TOKEN = 'M'.repeat(43);
const source = readFileSync(new URL('../../src/admin/api.ts', import.meta.url), 'utf8');
// Comments are allowed to *name* these APIs; only executable code may not use them.
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');

interface Call { url: string; init: RequestInit }
const respond = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

function client(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const api = createAdminApi('http://127.0.0.1:55433', (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch);
  return { api, calls };
}

const member = {
  id: '11111111-1111-4111-8111-111111111111', customerNumber: '12', name: '김고수', nickname: '고수',
  emailMasked: 'ki***@dev.invalid', status: 'ACTIVE', expertActive: true,
  createdAt: '2026-11-03T00:00:00.000Z', withdrawnAt: null,
};

test('WS19 only an approved origin can be configured', () => {
  assert.throws(() => createAdminApi('https://evil.example'), /UNAPPROVED_API_ORIGIN/);
  assert.throws(() => createAdminApi('http://127.0.0.1:55433/admin'), /INVALID_API_BASE/);
  assert.doesNotThrow(() => createAdminApi('https://api-dev-kimgosu.mintech.ai'));
  assert.doesNotThrow(() => createAdminApi('http://127.0.0.1:55433'));
});

test('WS19 the operator token never leaves component memory', () => {
  for (const store of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB']) {
    assert.equal(code.includes(store), false, `${store} must not be used by the operator client`);
  }
  assert.equal(code.includes('history.pushState'), false);
});

test('WS19 requests carry the bearer token, no cookies, and no cache', async () => {
  const { api, calls } = client(() => new Response(JSON.stringify({ page: 1, limit: 20, total: 0, totalPages: 1, members: [] }), { status: 200 }));
  await assert.rejects(() => api.members({}), (e: unknown) => e instanceof AdminApiError && e.code === 'AUTH_REQUIRED');
  assert.equal(calls.length, 0, 'no request is sent without a token');

  api.setAdminSession(TOKEN);
  await api.members({ query: ' 고수 ', status: 'ACTIVE', page: 2, limit: 20 });
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, 'http://127.0.0.1:55433/v1/admin/members?query=%EA%B3%A0%EC%88%98&status=ACTIVE&page=2&limit=20');
  assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer ' + TOKEN);
  assert.equal(call.init.credentials, 'omit');
  assert.equal(call.init.cache, 'no-store');
  assert.equal(call.init.referrerPolicy, 'no-referrer');
  assert.equal(call.init.redirect, 'error');

  api.clearSession();
  await assert.rejects(() => api.member(member.id), (e: unknown) => e instanceof AdminApiError && e.code === 'AUTH_REQUIRED');
});

test('WS19 a malformed token is refused before any request', () => {
  const { api } = client(() => respond(200, {}));
  assert.throws(() => api.setAdminSession('short'), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_TOKEN');
  assert.throws(() => api.setAdminSession(MEMBER_TOKEN), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_TOKEN');
  assert.equal(api.hasSession(), false, 'a refused token never becomes the session');
});

test('WS19 server error codes are mapped and unknown codes are not echoed', async () => {
  const denied = client(() => respond(403, { error: { code: 'ADMIN_REQUIRED' } }));
  denied.api.setAdminSession(TOKEN);
  await assert.rejects(() => denied.api.members({}), (e: unknown) => e instanceof AdminApiError && e.status === 403 && e.code === 'ADMIN_REQUIRED');

  const weird = client(() => respond(500, { error: { code: 'INTERNAL_SQL_DETAIL' } }));
  weird.api.setAdminSession(TOKEN);
  await assert.rejects(() => weird.api.members({}), (e: unknown) => e instanceof AdminApiError && e.code === 'REQUEST_FAILED');

  const html = client(() => new Response('<html>gateway</html>', { status: 502 }));
  html.api.setAdminSession(TOKEN);
  await assert.rejects(() => html.api.members({}), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_RESPONSE');

  const down = client(() => { throw new TypeError('fetch failed'); });
  down.api.setAdminSession(TOKEN);
  await assert.rejects(() => down.api.members({}), (e: unknown) => e instanceof AdminApiError && e.status === 0 && e.code === 'NETWORK_ERROR');
});

test('WS19 list and detail responses are validated, not trusted', async () => {
  const ok = client(() => respond(200, {
    page: 1, limit: 20, total: 1, totalPages: 1, members: [member],
    member: { ...member, email: 'kimgosu@dev.invalid', rejoinAfter: null, retentionUntil: null },
    restrictions: [{ id: 'r1', reason: '반복 취소', startsAt: '2026-11-01T00:00:00.000Z', endsAt: null, revokedAt: '2026-11-02T00:00:00.000Z', active: false, releaseReason: '소명 확인' }],
    consents: [{ kind: 'TERMS', title: '이용약관', version: 'v1', status: 'GRANTED', recordedAt: '2026-11-01T00:00:00.000Z' }],
    ledgers: [{ id: 'l1', displayName: '원장', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', role: 'EXPERT', counterpartId: 'c1', counterpartNickname: '고객', counterpartNumber: '13', agreementCount: 2, completedAgreements: 1 }],
    roles: [{ id: 'g1', role: 'ADMIN', reason: '운영', startsAt: '2026-11-01T00:00:00.000Z', endsAt: null, revokedAt: null }],
  }));
  ok.api.setAdminSession(TOKEN);
  const page = await ok.api.members({});
  assert.equal(page.members[0]!.emailMasked, 'ki***@dev.invalid');
  assert.equal(Object.hasOwn(page.members[0]!, 'email'), false, 'the list row type carries no raw email');

  const detail = await ok.api.member(member.id);
  assert.equal(detail.restrictions[0]!.releaseReason, '소명 확인');
  assert.equal(detail.member.email, 'kimgosu@dev.invalid');
  assert.equal(detail.ledgers[0]!.completedAgreements, 1);

  const broken = client(() => respond(200, { page: 1, limit: 20, total: 1, totalPages: 1, members: [{ ...member, status: 'DELETED' }] }));
  broken.api.setAdminSession(TOKEN);
  await assert.rejects(() => broken.api.members({}), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_RESPONSE');
});

test('WS19 restriction writes send only the operator-supplied reason and period', async () => {
  const { api, calls } = client((call) => new Response(JSON.stringify(
    call.url.endsWith('/release')
      ? { released: true, restrictionId: 'r1', revokedAt: '2026-11-03T00:00:00.000Z' }
      : { id: 'r1', reason: '반복 취소', startsAt: '2026-11-03T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z', revokedAt: null },
  ), { status: 200 }));
  api.setAdminSession(TOKEN);
  await api.restrict(member.id, { reason: '반복 취소', endsAt: '2026-11-10T00:00:00.000Z' });
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { reason: '반복 취소', endsAt: '2026-11-10T00:00:00.000Z' });
  const released = await api.release(member.id, '소명 확인');
  assert.equal(released.released, true);
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { reason: '소명 확인' });
});

// ── WS-23: login flow instead of a pasted token ──────────────────────────────

const OPERATOR = { memberId: '22222222-2222-4222-8222-222222222222', nickname: '운영자A', customerNumber: '7' };
const SESSION_ENVELOPE = { adminToken: TOKEN, tokenType: 'Bearer', expiresInSeconds: 7200, expiresAt: '2026-11-03T02:00:00.000Z', operator: OPERATOR };

test('WS23 login sends the member session in the body and keeps only the operator token', async () => {
  const { api, calls } = client(call => call.url.endsWith('/v1/admin/session')
    ? respond(201, SESSION_ENVELOPE)
    : respond(200, { page: 1, limit: 20, total: 0, totalPages: 1, members: [] }));
  const info = await api.login(MEMBER_TOKEN);
  assert.equal(info.operator.nickname, '운영자A');
  assert.equal(info.expiresAt, SESSION_ENVELOPE.expiresAt);
  assert.equal(api.hasSession(), true, 'the operator session exists after a successful exchange');
  assert.equal(calls[0]!.url, 'http://127.0.0.1:55433/v1/admin/session');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { sessionToken: MEMBER_TOKEN });
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, undefined, 'the member token is never sent as the operator bearer');

  await api.members({});
  assert.equal((calls[1]!.init.headers as Record<string, string>).Authorization, 'Bearer ' + TOKEN);
});

test('WS23 a non-admin login is refused and leaves no session behind', async () => {
  const denied = client(() => respond(403, { error: { code: 'ADMIN_REQUIRED', attemptsRemaining: 4 } }));
  await assert.rejects(() => denied.api.login(MEMBER_TOKEN), (e: unknown) =>
    e instanceof AdminApiError && e.status === 403 && e.code === 'ADMIN_REQUIRED' && e.attemptsRemaining === 4);
  assert.equal(denied.api.hasSession(), false);
  await assert.rejects(() => denied.api.members({}), (e: unknown) => e instanceof AdminApiError && e.code === 'AUTH_REQUIRED');

  const locked = client(() => respond(429, { error: { code: 'ADMIN_LOGIN_LOCKED', retryAfterSeconds: 300 } }));
  await assert.rejects(() => locked.api.login(MEMBER_TOKEN), (e: unknown) =>
    e instanceof AdminApiError && e.status === 429 && e.code === 'ADMIN_LOGIN_LOCKED' && e.retryAfterSeconds === 300);
  assert.equal(locked.api.hasSession(), false);
});

test('WS23 a login response without an operator token is not trusted', async () => {
  for (const payload of [
    { ...SESSION_ENVELOPE, adminToken: MEMBER_TOKEN },
    { ...SESSION_ENVELOPE, adminToken: undefined },
    { operator: OPERATOR, expiresAt: SESSION_ENVELOPE.expiresAt },
  ]) {
    const { api } = client(() => respond(201, payload));
    await assert.rejects(() => api.login(MEMBER_TOKEN), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_RESPONSE');
    assert.equal(api.hasSession(), false, 'no session is kept from a malformed envelope');
  }
});

test('WS23 logout revokes on the server and forgets the token even when the call fails', async () => {
  const ok = client(call => call.url.endsWith('/v1/admin/session/logout') ? respond(200, { loggedOut: true }) : respond(200, {}));
  ok.api.setAdminSession(TOKEN);
  await ok.api.logout();
  assert.equal(ok.calls[0]!.url, 'http://127.0.0.1:55433/v1/admin/session/logout');
  assert.equal(ok.api.hasSession(), false);
  await assert.rejects(() => ok.api.members({}), (e: unknown) => e instanceof AdminApiError && e.code === 'AUTH_REQUIRED');

  const failing = client(() => { throw new TypeError('fetch failed'); });
  failing.api.setAdminSession(TOKEN);
  await assert.rejects(() => failing.api.logout(), (e: unknown) => e instanceof AdminApiError && e.code === 'NETWORK_ERROR');
  assert.equal(failing.api.hasSession(), false, 'a failed logout still drops the local session');
});

test('WS23 the session probe validates the operator envelope', async () => {
  const good = client(() => respond(200, { operator: OPERATOR, expiresAt: SESSION_ENVELOPE.expiresAt }));
  good.api.setAdminSession(TOKEN);
  assert.deepEqual((await good.api.session()).operator, OPERATOR);

  const broken = client(() => respond(200, { operator: { nickname: '운영자A' }, expiresAt: SESSION_ENVELOPE.expiresAt }));
  broken.api.setAdminSession(TOKEN);
  await assert.rejects(() => broken.api.session(), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_RESPONSE');
});
