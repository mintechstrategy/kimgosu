import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { configuredProviders, realProvider } from './providers.ts';
import { buildApp } from './app.ts';
import type { Sql } from './app.ts';
import { challenge, opaque } from './security.ts';
import { requireDevelopment } from './database.ts';
const db: Sql = { async query() { return { rows: [], rowCount: 0 }; }, async transaction(work) { return work(db); } };
const cfg = { KG_OAUTH_GOOGLE_ENABLED: 'true', KG_OAUTH_GOOGLE_CLIENT_ID: 'synthetic-client', KG_OAUTH_GOOGLE_CLIENT_SECRET: 'synthetic-secret', KG_OAUTH_GOOGLE_REDIRECT_URI: 'https://dev-kimgosu.mintech.ai/auth/callback' };
test('provider configuration fails closed unless explicit flag, every field, and exact HTTPS callback host', () => {
  assert.deepEqual(configuredProviders({}), {}); assert.equal(Object.keys(configuredProviders(cfg)).length, 1);
  for (const patch of [{ KG_OAUTH_GOOGLE_ENABLED: 'false' }, { KG_OAUTH_GOOGLE_CLIENT_SECRET: '' }, { KG_OAUTH_GOOGLE_REDIRECT_URI: 'https://evil.invalid/callback' }, { KG_OAUTH_GOOGLE_REDIRECT_URI: 'http://dev-kimgosu.mintech.ai/callback' }]) assert.deepEqual(configuredProviders({ ...cfg, ...patch }), {});
});
test('authorization uses fixed hosts, state, and Google S256+nonce without client secret', () => {
  for (const id of ['google', 'kakao', 'naver'] as const) {
    const provider = realProvider(id, 'synthetic-client', 'synthetic-secret', 'https://dev-kimgosu.mintech.ai/auth/callback');
    const state = opaque(); const cc = challenge(opaque()); const uri = new URL(provider.authorize(state, cc));
    assert.equal(uri.searchParams.get('state'), state); assert.equal(uri.searchParams.get('client_secret'), null);
    if (id === 'google') { assert.equal(uri.searchParams.get('nonce'), state); assert.equal(uri.searchParams.get('code_challenge'), cc); assert.equal(uri.searchParams.get('code_challenge_method'), 'S256'); }
  }
});
test('real Google adapter checks RSA signature, nonce, audience, issuer and expiry using HTTP doubles only', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 }); const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key' };
  const state = opaque(); const verifier = opaque(); let tokenBody = '';
  let claims: Record<string, unknown> = { iss: 'https://accounts.google.com', aud: 'synthetic-client', sub: 'synthetic-subject', nonce: state, iat: Date.now() / 1000, exp: Date.now() / 1000 + 300 };
  let wrongSignature = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      tokenBody = String(init?.body);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url'); const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const signed = header + '.' + payload; const signature = sign('RSA-SHA256', Buffer.from(signed), keys.privateKey).toString('base64url');
      return new Response(JSON.stringify({ access_token: opaque(), id_token: signed + '.' + (wrongSignature ? opaque() : signature) }));
    }
    assert.equal(String(input), 'https://www.googleapis.com/oauth2/v3/certs'); return new Response(JSON.stringify({ keys: [jwk] }));
  }) as typeof fetch;
  const provider = realProvider('google', 'synthetic-client', 'synthetic-secret', 'https://dev-kimgosu.mintech.ai/auth/callback');
  assert.equal((await provider.exchange(opaque(), state, verifier)).subject, 'synthetic-subject'); assert.equal(new URLSearchParams(tokenBody).get('code_verifier'), verifier);
  const good = { ...claims };
  for (const patch of [{ nonce: opaque() }, { aud: 'other-client' }, { azp: 'other-client' }, { iss: 'https://evil.invalid' }, { exp: 1 }, { iat: Date.now() / 1000 + 600 }, { sub: '' }]) {
    claims = { ...good, ...patch }; await assert.rejects(() => provider.exchange(opaque(), state, verifier), /SOCIAL_AUTH_FAILED/);
  }
  claims = good; wrongSignature = true; await assert.rejects(() => provider.exchange(opaque(), state, verifier), /SOCIAL_AUTH_FAILED/);
});
test('Kakao/Naver real adapter endpoint parsing and secrets only in POST/header, HTTP doubles only', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const id of ['kakao', 'naver'] as const) {
    let calls = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls++; const uri = new URL(String(input)); assert.equal(uri.search, '');
      if (calls === 1) { assert.equal(init?.method, 'POST'); assert.equal(new URLSearchParams(String(init?.body)).get('client_secret'), 'synthetic-secret'); return new Response(JSON.stringify({ access_token: opaque() })); }
      assert.equal(calls, 2); assert(init?.headers && 'Authorization' in init.headers);
      return new Response(JSON.stringify(id === 'kakao' ? { id: 'synthetic-subject' } : { resultcode: '00', response: { id: 'synthetic-subject' } }));
    }) as typeof fetch;
    const p = realProvider(id, 'synthetic-client', 'synthetic-secret', 'https://dev-kimgosu.mintech.ai/auth/callback');
    assert.equal((await p.exchange(opaque(), opaque(), opaque())).subject, 'synthetic-subject'); assert.equal(calls, 2);
  }
});
test('Kakao integer64 subject is preserved without JSON number precision loss, HTTP double only', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; }); let calls = 0;
  globalThis.fetch = (async () => new Response(++calls === 1 ? JSON.stringify({ access_token: opaque() }) : '{"id":9007199254740993123}')) as typeof fetch;
  assert.equal((await realProvider('kakao', 'synthetic-client', 'synthetic-secret', 'https://dev-kimgosu.mintech.ai/auth/callback').exchange(opaque(), opaque(), opaque())).subject, '9007199254740993123');
});
test('provider HTTP failure does not echo upstream body', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () => new Response('PRIVATE_UPSTREAM_DETAIL', { status: 500 })) as typeof fetch;
  await assert.rejects(() => realProvider('google', 'synthetic-client', 'synthetic-secret', 'https://dev-kimgosu.mintech.ai/auth/callback').exchange(opaque(), opaque(), opaque()), /PROVIDER_UNAVAILABLE/);
});
test('CORS exact origin and explicit localhost only; never wildcard or arbitrary reflection', async t => {
  const app = buildApp(db, 'unit-only', { corsOrigins: ['http://localhost:5173', 'https://evil.invalid'] }); t.after(() => app.close());
  for (const origin of ['https://dev-kimgosu.mintech.ai', 'http://localhost:5173']) {
    const r = await app.inject({ url: '/health', headers: { origin } }); assert.equal(r.statusCode, 200); assert.equal(r.headers['access-control-allow-origin'], origin); assert.equal(r.headers['access-control-allow-credentials'], undefined);
  }
  for (const origin of ['https://evil.invalid', 'https://dev-kimgosu.mintech.ai.evil.invalid', 'null', 'http://localhost:9999']) {
    const r = await app.inject({ url: '/health', headers: { origin } }); assert.equal(r.statusCode, 403); assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
});
test('preflight allow-list, malformed JSON, body cap and unknown routes use safe envelope', async t => {
  const app = buildApp(db, 'unit-only'); t.after(() => app.close());
  const r = await app.inject({ method: 'OPTIONS', url: '/v1/me', headers: { origin: 'https://dev-kimgosu.mintech.ai', 'access-control-request-method': 'DELETE' } }); assert.equal(r.statusCode, 403);
  const malformed = await app.inject({ method: 'POST', url: '/v1/auth/refresh', headers: { 'content-type': 'application/json' }, payload: '{' }); assert.equal(malformed.statusCode, 400); assert.equal(malformed.json().error.code, 'INVALID_REQUEST');
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: 'a'.repeat(20000) } })).statusCode, 413);
  assert.deepEqual((await app.inject('/unknown')).json(), { error: { code: 'ROUTE_NOT_FOUND' } });
});
test('new extensions reject caller-owned member id, invalid ages, nickname and refresh before SQL', async t => {
  let queries = 0; const noQuery: Sql = { ...db, async query() { queries++; return { rows: [], rowCount: 0 }; } };
  const app = buildApp(noQuery, 'unit-only'); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/v1/me/withdraw', payload: { confirmed: true, memberId: 'attacker-controlled' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: 'short' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: '/v1/me/profile', payload: { nickname: '고수!' } })).statusCode, 400);
  assert.equal(queries, 0);
});
test('anonymous auth POST burst throttled with bounded in-memory per-process window', async t => {
  const app = buildApp(db, 'unit-only'); t.after(() => app.close());
  for (let i = 0; i < 60; i++) assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: 'short' } })).statusCode, 400);
  const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: 'short' } }); assert.equal(r.statusCode, 429); assert.equal(r.json().error.code, 'AUTH_RATE_LIMITED');
});
test('startup rejects wrong project/environment and non-private DB before connection', () => {
  assert.throws(() => requireDevelopment({}), /development environment required/);
  assert.throws(() => requireDevelopment({ RAILWAY_PROJECT_ID: '95b52b2c-e1c0-45da-909b-d7989ce08a90', RAILWAY_ENVIRONMENT_ID: 'a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18', DATABASE_URL: 'postgresql://localhost/db' }), /private development DB required/);
  assert.throws(() => requireDevelopment({ RAILWAY_PROJECT_ID: '95b52b2c-e1c0-45da-909b-d7989ce08a90', RAILWAY_ENVIRONMENT_ID: 'a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18', DATABASE_URL: 'postgresql://private.railway.internal/db?host=evil.invalid' }), /private development DB required/);
  assert.throws(() => requireDevelopment({ RAILWAY_PROJECT_ID: '95b52b2c-e1c0-45da-909b-d7989ce08a90', RAILWAY_ENVIRONMENT_ID: 'a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18', DATABASE_URL: 'MALFORMED_PRIVATE_SENTINEL' }), error => error instanceof Error && error.message === 'private development DB required' && !('input' in error));
});
