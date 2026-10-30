import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { buildApp } from './app.ts';
import { RailwayStore } from './store.ts';

const runId = randomUUID();
const owner = randomUUID();
const id = randomUUID();
const store = new RailwayStore(runId, owner);
const token = randomBytes(32).toString('hex');
const app = buildApp(store, token);
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const message = `김고수 새 API DB 검증 '${runId.slice(0, 8)}'`;
const result: Record<string, unknown> = {
  taskId: 'KG-ENV-SAMPLE-01', startedAt: new Date().toISOString(), runId, id,
  path: 'HTTP loopback Fastify -> Railway CLI SSH -> dev Postgres (SET ROLE kg_dev_runtime)',
  scope: 'fresh diagnostic API, existing schema, isolated synthetic data; not deployed product API',
  githubPushed: false, sampleDeployed: false, cloudflareProxied: false,
  status: 'RUNNING',
};
let failed = false;
try {
  const files = ['src/app.ts', 'src/store.ts', 'src/live.ts', 'package-lock.json'];
  result.sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(new URL(`../${file}`, import.meta.url))).digest('hex')])));
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const receipts: unknown[] = [];
  async function request(method: string, path: string, body: unknown, expected: number, authenticated = true) {
    const response = await fetch(origin + path, { method, headers: authenticated ? headers : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    receipts.push({ method, path, status: response.status, body: data });
    assert.equal(response.status, expected);
    return data;
  }
  result.http = receipts;
  await request('POST', '/sample/records', { id, message }, 401, false);
  await request('POST', '/sample/records', { id: 'invalid', message }, 400);
  const created = await request('POST', '/sample/records', { id, message }, 201);
  assert.deepEqual(created, { id, message, version: 1 });
  const read = await request('GET', `/sample/records/${id}`, undefined, 200);
  assert.deepEqual(read, created);
  const direct = await store.inspect(id) as { id: string; input: { message: string }; role: string; synthetic: boolean };
  assert.equal(direct.id, id);
  assert.equal(direct.input.message, message);
  assert.equal(direct.role, 'kg_dev_runtime');
  assert.equal(direct.synthetic, true);
  result.independentSQLReadback = direct;
  await request('POST', '/sample/records', { id, message: 'must not replace' }, 409);
  assert.deepEqual(await request('GET', `/sample/records/${id}`, undefined, 200), created);
  await request('GET', `/sample/records/${randomUUID()}`, undefined, 404);
  // A distinct run/owner cannot read the record, even if the ID is known.
  const other = new RailwayStore(randomUUID(), randomUUID());
  assert.equal(await other.read(id), null);
  result.runIsolation = 'PASS';
  result.status = 'PASS_LIVE_LOCAL_API_TO_RAILWAY_DB';
} catch {
  failed = true;
  result.status = 'FAIL';
  // CLI errors may contain SQL or connection metadata: do not log raw exceptions.
  result.error = 'Live assertion or transport failed; inspect sanitized HTTP evidence, not secrets';
} finally {
  try {
    result.remainingRows = await store.cleanup();
    assert.equal(result.remainingRows, 0);
    assert.equal(await store.read(id), null);
    result.cleanup = 'PASS: exact run/owner only; read back zero and missing ID';
  } catch {
    failed = true;
    result.cleanup = 'BLOCKED: exact namespace requires operator cleanup';
    result.namespace = store.namespace;
    result.owner = store.owner;
  }
  await app.close();
  result.serverClosed = true;
  result.finishedAt = new Date().toISOString();
  if (failed) result.status = 'FAIL';
  await writeFile(new URL('../RESULT.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
if (failed) process.exitCode = 1;
