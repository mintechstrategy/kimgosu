import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { RailwayStore } from '../../services/samples/railway-db/src/store.ts';
const root = new URL('../../', import.meta.url);
const evidence = new URL('engineering/env-resolve-02/', root);
const session = JSON.parse(await readFile(`${homedir()}/.hermes/profiles/project-lead/cache/scratch/kg-env-sample-01/session.json`, 'utf8'));
const githubSHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const store = new RailwayStore(session.runId, session.ownerId);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const result = { taskId: 'KG-ENV-RESOLVE-02', githubSHA, release: session.release, status: 'RUNNING', startedAt: new Date().toISOString(), receipts: [] };
let failed = false;
page.on('response', response => {
  if (response.url().startsWith('https://api-dev-kimgosu.mintech.ai/')) {
    result.receipts.push({ method: response.request().method(), url: response.url(), status: response.status(), cfRay: response.headers()['cf-ray'] });
  }
});
try {
  const response = await page.goto('https://dev-kimgosu.mintech.ai/', { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  assert.ok(response.headers()['cf-ray']);
  result.web = { status: response.status(), cfRay: response.headers()['cf-ray'] };
  await page.getByTestId('health').filter({ hasText: session.release.slice(0, 12) }).waitFor();
  await page.getByTestId('token').fill(session.token);
  await page.getByTestId('message').fill('브라우저→Cloudflare→Railway→DB 저장·조회');
  await page.getByTestId('transact').click();
  await page.getByTestId('result').filter({ hasText: '저장·재조회 성공' }).waitFor({ timeout: 45000 });
  const text = await page.getByTestId('result').textContent();
  const record = JSON.parse(text.slice(text.indexOf('{')));
  result.record = record;
  const row = await store.inspect(record.id);
  assert.equal(row.input.message, record.message);
  assert.equal(row.synthetic, true);
  result.independentSQLReadback = row;
  assert.ok(result.receipts.some(r => r.method === 'POST' && r.status === 201 && r.cfRay));
  assert.ok(result.receipts.some(r => r.url.endsWith(record.id) && r.status === 200 && r.cfRay));
  await page.getByTestId('token').fill('');
  await page.screenshot({ path: new URL('web-transaction.png', evidence).pathname, fullPage: true });
  result.status = 'PASS_BROWSER_CLOUDFLARE_RAILWAY_DB';
} catch (error) {
  failed = true;
  result.status = 'FAIL';
  result.error = error.name; // Avoid logging page/authorization data.
} finally {
  try { result.remainingRows = await store.cleanup(); assert.equal(result.remainingRows, 0); }
  catch { failed = true; result.status = 'FAIL_CLEANUP'; }
  await browser.close();
  result.finishedAt = new Date().toISOString();
  await writeFile(new URL('WEB-TRANSACTION.json', evidence), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
if (failed) process.exitCode = 1;
