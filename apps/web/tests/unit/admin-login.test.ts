// WS-23: operator login client (pre-session half of the console).
// Pure module regressions — explicit fetch double, no API, DB or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdminApiError } from '../../src/admin/api.ts';
import { createAdminLoginClient } from '../../src/admin/login.ts';

const MEMBER_TOKEN = 'M'.repeat(43);

interface Call { url: string; init: RequestInit }
const respond = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

function client(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const api = createAdminLoginClient('http://127.0.0.1:55433', (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch);
  return { api, calls };
}

test('WS23 the login client refuses unapproved origins like the console client', () => {
  assert.throws(() => createAdminLoginClient('https://evil.example'), /UNAPPROVED_API_ORIGIN/);
  assert.doesNotThrow(() => createAdminLoginClient('https://api-dev-kimgosu.mintech.ai'));
});

test('WS23 providers are only reported connected when the server says so', async () => {
  const partial = client(() => respond(200, {
    providers: [{ id: 'kakao', enabled: true }, { id: 'naver', enabled: false, reason: 'PROVIDER_INTEGRATION_NOT_CONNECTED' }],
  }));
  const providers = await partial.api.providers();
  assert.deepEqual(providers.map(p => p.id), ['kakao', 'naver', 'google']);
  assert.equal(providers[0]!.connected, true);
  assert.equal(providers[1]!.connected, false);
  assert.equal(providers[1]!.reason, 'PROVIDER_INTEGRATION_NOT_CONNECTED');
  // A provider the server never mentioned is not connected.
  assert.equal(providers[2]!.connected, false);

  // A zero/false-ish envelope must not be read as "connected".
  const off = client(() => respond(200, { providers: [{ id: 'kakao', enabled: 'true' }] }));
  assert.equal((await off.api.providers())[0]!.connected, false, 'only a literal true counts');

  const down = client(() => respond(503, { error: { code: 'SERVICE_UNAVAILABLE' } }));
  await assert.rejects(() => down.api.providers(), (e: unknown) => e instanceof AdminApiError && e.code === 'CONFIG_UNAVAILABLE');
});

test('WS23 tester accounts are absent, not invented, when the server does not expose them', async () => {
  const none = client(() => respond(404, { error: { code: 'ROUTE_NOT_FOUND' } }));
  assert.deepEqual(await none.api.devAccounts(), []);

  const rows = client(() => respond(200, { temporary: true, accounts: [{ slot: 1, role: 'ADMIN', label: '운영자', nickname: '운영자A', expertActive: false }] }));
  assert.deepEqual(await rows.api.devAccounts(), [{ slot: 1, role: 'ADMIN', label: '운영자', nickname: '운영자A', expertActive: false }]);

  const broken = client(() => respond(200, { accounts: [{ slot: 'x', role: 'ADMIN', label: '운영자', nickname: '운영자A' }] }));
  await assert.rejects(() => broken.api.devAccounts(), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_RESPONSE');
});

test('WS23 tester login returns the real server session token only', async () => {
  const ok = client(() => respond(200, { temporary: true, session: { accessToken: MEMBER_TOKEN, refreshToken: 'r', tokenType: 'Bearer', expiresInSeconds: 900 } }));
  assert.equal(await ok.api.devLogin(1), MEMBER_TOKEN);
  assert.equal(ok.calls[0]!.url, 'http://127.0.0.1:55433/v1/auth/dev/login');
  assert.deepEqual(JSON.parse(String(ok.calls[0]!.init.body)), { slot: 1 });

  const bad = client(() => respond(200, { session: { accessToken: 'short' } }));
  await assert.rejects(() => bad.api.devLogin(1), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_RESPONSE');

  const missing = client(() => respond(404, { error: { code: 'DEV_ACCOUNT_NOT_FOUND' } }));
  await assert.rejects(() => missing.api.devLogin(9), (e: unknown) => e instanceof AdminApiError && e.code === 'DEV_ACCOUNT_NOT_FOUND');

  const outOfRange = client(() => respond(200, {}));
  await assert.rejects(() => outOfRange.api.devLogin(0), (e: unknown) => e instanceof AdminApiError && e.code === 'INVALID_REQUEST');
  assert.equal(outOfRange.calls.length, 0, 'an out-of-range slot is refused before any request');
});
