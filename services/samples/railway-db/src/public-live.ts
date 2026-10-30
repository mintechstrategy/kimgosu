import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve4 } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { RailwayStore } from './store.ts';
const exec = promisify(execFile);
const sessionPath = '/Users/mintech-mac/.hermes/profiles/project-lead/cache/scratch/kg-env-sample-01/session.json';
const session = JSON.parse(await readFile(sessionPath, 'utf8')) as { token: string; runId: string; ownerId: string; expiresAt: number; release: string };
const store = new RailwayStore(session.runId, session.ownerId);
const origin = 'https://api-dev-kimgosu.mintech.ai';
const hostname = new URL(origin).hostname;
const edgeAddresses = await resolve4(hostname);
const id = randomUUID();
const message = `Cloudflare→Railway→PostgreSQL 실제 거래 '${id.slice(0, 8)}'`;
const expectedSHA = process.env.EXPECTED_GITHUB_SHA;
assert.match(expectedSHA ?? '', /^[a-f0-9]{40}$/);
const result: Record<string, unknown> = { taskId: 'KG-ENV-RESOLVE-02', startedAt: new Date().toISOString(), origin, id,
  release: session.release, path: 'Cloudflare proxy HTTPS -> Railway Fastify -> private PostgreSQL', githubSHA: expectedSHA,
  dns: { edgeAddresses, method: 'default OS resolver; original hostname and normal TLS verification' }, status: 'RUNNING' };
let failed = false;
const receipts: unknown[] = [];
async function request(method: string, path: string, body: unknown, expected: number, auth = true) {
  const response = await new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const req = httpsRequest({ hostname, servername: hostname, path, method,
      headers: { host: hostname, 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${session.token}` } : {}) },
      signal: AbortSignal.timeout(30000),
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const text = response.text;
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { nonJsonLength: text.length }; }
  const cfRay = response.headers['cf-ray'];
  receipts.push({ method, path, status: response.status, cfRay, server: response.headers.server,
    railwayRequestId: response.headers['x-railway-request-id'], cacheControl: response.headers['cache-control'], body: data });
  assert.equal(response.status, expected);
  assert.ok(cfRay, 'Cloudflare proxy traversal must be evidenced');
  assert.equal(response.headers['cache-control'], 'no-store');
  return data;
}
try {
  result.http = receipts;
  const health = await request('GET', '/health', undefined, 200, false) as { release: string };
  assert.equal(health.release, session.release);
  // Verify runtime consumption of every written variable without printing the digest/token.
  const code = 'console.log(JSON.stringify({digest:process.env.SAMPLE_TOKEN_SHA256,run:process.env.SAMPLE_RUN_ID,owner:process.env.SAMPLE_OWNER_ID,expiry:process.env.SAMPLE_EXPIRES_AT,deployment:process.env.RAILWAY_DEPLOYMENT_ID,githubSHA:process.env.RAILWAY_GIT_COMMIT_SHA}))';
  const { stdout } = await exec('railway', ['ssh', '-p', '95b52b2c-e1c0-45da-909b-d7989ce08a90', '-e', 'a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18', '-s', 'cc5a98f5-3918-41d7-b64b-a6c07746d2ed', '-i', '/Users/mintech-mac/.hermes/profiles/project-lead/private-credentials/kimgosu-dev-163/identity_ed25519', '--', 'node', '-e', code], { timeout: 45000 });
  const runtime = JSON.parse(stdout.trim());
  assert.equal(runtime.digest, createHash('sha256').update(session.token).digest('hex'));
  assert.equal(runtime.run, session.runId);
  assert.equal(runtime.owner, session.ownerId);
  assert.equal(Number(runtime.expiry), session.expiresAt);
  assert.equal(runtime.githubSHA, expectedSHA);
  result.runtimeVariablesVerified = true;
  result.deploymentId = runtime.deployment;
  await request('POST', '/sample/records', { id, message }, 401, false);
  await request('POST', '/sample/records', { id: 'invalid', message }, 400);
  const created = await request('POST', '/sample/records', { id, message }, 201);
  assert.deepEqual(created, { id, message, version: 1 });
  assert.deepEqual(await request('GET', `/sample/records/${id}`, undefined, 200), created);
  const row = await store.inspect(id) as { id: string; input: { message: string }; role: string; synthetic: boolean };
  assert.equal(row.id, id); assert.equal(row.input.message, message); assert.equal(row.role, 'kg_dev_runtime'); assert.equal(row.synthetic, true);
  result.independentSQLReadback = row;
  await request('POST', '/sample/records', { id, message: 'must not overwrite' }, 409);
  assert.deepEqual(await request('GET', `/sample/records/${id}`, undefined, 200), created);
  await request('GET', `/sample/records/${randomUUID()}`, undefined, 404);
  result.status = 'PASS_CLOUDFLARE_RAILWAY_POSTGRES';
} catch {
  failed = true;
  result.status = 'FAIL';
  result.error = 'Assertion/transport failure; sanitized HTTP evidence retained';
} finally {
  try {
    result.remainingRows = await store.cleanup();
    assert.equal(result.remainingRows, 0);
    assert.equal(await store.read(id), null);
    result.cleanup = 'PASS: exact run/owner removed, SQL zero rows';
    if (!failed) await request('GET', `/sample/records/${id}`, undefined, 404);
  } catch { failed = true; result.cleanup = 'BLOCKED'; result.namespace = store.namespace; result.owner = store.owner; }
  result.finishedAt = new Date().toISOString();
  if (failed) result.status = 'FAIL';
  await writeFile(new URL('../../../../engineering/env-resolve-02/PUBLIC-RESULT.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
if (failed) process.exitCode = 1;
