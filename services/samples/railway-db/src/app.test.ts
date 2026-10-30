import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { buildApp } from './app.ts';
import type { RecordValue, Store } from './store.ts';

test('API validation/authentication/errors (stub storage; not live DB evidence)', async () => {
  const data = new Map<string, RecordValue>();
  let calls = 0;
  const store: Store = {
    async create(id, message) { calls++; if (data.has(id)) return null; const row = { id, message, version: 1 }; data.set(id, row); return row; },
    async read(id) { calls++; return data.get(id) ?? null; },
  };
  const token = randomBytes(32).toString('hex');
  const app = buildApp(store, token);
  const headers = { authorization: `Bearer ${token}` };
  const id = randomUUID();
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/sample/records', payload: { id, message: 'test' } })).statusCode, 401);
    for (const payload of [{ id: 'bad', message: 'test' }, { id, message: '' }, { id, message: '  ' }, { id, message: 'x'.repeat(121) }, { id, message: 'test', owner: 'forged' }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/sample/records', headers, payload })).statusCode, 400);
    }
    assert.equal(calls, 0);
    const created = await app.inject({ method: 'POST', url: '/sample/records', headers, payload: { id, message: "한글 ' SQL ; --" } });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json(), { id, message: "한글 ' SQL ; --", version: 1 });
    assert.equal((await app.inject({ method: 'POST', url: '/sample/records', headers, payload: { id, message: 'duplicate' } })).statusCode, 409);
    assert.equal((await app.inject({ url: `/sample/records/${id}`, headers })).statusCode, 200);
    assert.equal((await app.inject({ url: `/sample/records/${randomUUID()}`, headers })).statusCode, 404);
    assert.equal((await app.inject({ url: '/sample/records/not-a-uuid', headers })).statusCode, 400);
    store.read = async () => { throw new Error('do not disclose secret connection data'); };
    const failed = await app.inject({ url: `/sample/records/${id}`, headers });
    assert.equal(failed.statusCode, 503);
    assert.ok(!failed.body.includes('secret connection'));
  } finally { await app.close(); }
});

test('deployed diagnostic digest, public health and expiry', async () => {
  const store: Store = { async create() { throw new Error('unexpected'); }, async read() { return null; } };
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  const app = buildApp(store, digest, { tokenIsHash: true, expiresAt: Date.now() + 60000, release: 'test' });
  const expired = buildApp(store, digest, { tokenIsHash: true, expiresAt: 0, release: 'test' });
  const request = { url: `/sample/records/${randomUUID()}`, headers: { authorization: `Bearer ${token}` } };
  try {
    assert.equal((await app.inject('/health')).statusCode, 200);
    const preflight = await app.inject({ method: 'OPTIONS', url: '/sample/records', headers: { origin: 'https://dev-kimgosu.mintech.ai', 'access-control-request-method': 'POST' } });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'https://dev-kimgosu.mintech.ai');
    assert.equal((await app.inject({ url: '/health', headers: { origin: 'https://untrusted.invalid' } })).statusCode, 403);
    assert.equal((await app.inject(request)).statusCode, 404);
    assert.equal((await expired.inject(request)).statusCode, 401);
    assert.equal((await app.inject({ ...request, headers: { authorization: `Basic ${token}` } })).statusCode, 401);
  } finally { await app.close(); await expired.close(); }
});
