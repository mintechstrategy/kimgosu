// WS-19: operator console API client. Local pure-module regressions only —
// the transport is an explicit fetch double, no API, DB or network is contacted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AdminApiError, createAdminApi } from '../../src/admin/api.ts';

const TOKEN = 'T'.repeat(43);
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

  api.setToken(TOKEN);
  await api.members({ query: ' 고수 ', status: 'ACTIVE', page: 2, limit: 20 });
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, 'http://127.0.0.1:55433/v1/admin/members?query=%EA%B3%A0%EC%88%98&status=ACTIVE&page=2&limit=20');
  assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer ' + TOKEN);
  assert.equal(call.init.credentials, 'omit');
  assert.equal(call.init.cache, 'no-store');
  assert.equal(call.init.referrerPolicy, 'no-referrer');
  assert.equal(call.init.redirect, 'error');

  api.clearToken();
  await assert.rejects(() => api.member(member.id), (e: unknown) => e instanceof AdminApiError && e.code === 'AUTH_REQUIRED');
});

test('WS19 a malformed token is refused before any request', () => {
  const { api } = client(() => respond(200, {}));
  assert.throws(() => api.setToken('short'), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_TOKEN');
});

test('WS19 server error codes are mapped and unknown codes are not echoed', async () => {
  const denied = client(() => respond(403, { error: { code: 'ADMIN_REQUIRED' } }));
  denied.api.setToken(TOKEN);
  await assert.rejects(() => denied.api.members({}), (e: unknown) => e instanceof AdminApiError && e.status === 403 && e.code === 'ADMIN_REQUIRED');

  const weird = client(() => respond(500, { error: { code: 'INTERNAL_SQL_DETAIL' } }));
  weird.api.setToken(TOKEN);
  await assert.rejects(() => weird.api.members({}), (e: unknown) => e instanceof AdminApiError && e.code === 'REQUEST_FAILED');

  const html = client(() => new Response('<html>gateway</html>', { status: 502 }));
  html.api.setToken(TOKEN);
  await assert.rejects(() => html.api.members({}), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_RESPONSE');

  const down = client(() => { throw new TypeError('fetch failed'); });
  down.api.setToken(TOKEN);
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
  ok.api.setToken(TOKEN);
  const page = await ok.api.members({});
  assert.equal(page.members[0]!.emailMasked, 'ki***@dev.invalid');
  assert.equal(Object.hasOwn(page.members[0]!, 'email'), false, 'the list row type carries no raw email');

  const detail = await ok.api.member(member.id);
  assert.equal(detail.restrictions[0]!.releaseReason, '소명 확인');
  assert.equal(detail.member.email, 'kimgosu@dev.invalid');
  assert.equal(detail.ledgers[0]!.completedAgreements, 1);

  const broken = client(() => respond(200, { page: 1, limit: 20, total: 1, totalPages: 1, members: [{ ...member, status: 'DELETED' }] }));
  broken.api.setToken(TOKEN);
  await assert.rejects(() => broken.api.members({}), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_RESPONSE');
});

test('WS19 restriction writes send only the operator-supplied reason and period', async () => {
  const { api, calls } = client((call) => new Response(JSON.stringify(
    call.url.endsWith('/release')
      ? { released: true, restrictionId: 'r1', revokedAt: '2026-11-03T00:00:00.000Z' }
      : { id: 'r1', reason: '반복 취소', startsAt: '2026-11-03T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z', revokedAt: null },
  ), { status: 200 }));
  api.setToken(TOKEN);
  await api.restrict(member.id, { reason: '반복 취소', endsAt: '2026-11-10T00:00:00.000Z' });
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { reason: '반복 취소', endsAt: '2026-11-10T00:00:00.000Z' });
  const released = await api.release(member.id, '소명 확인');
  assert.equal(released.released, true);
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { reason: '소명 확인' });
});
