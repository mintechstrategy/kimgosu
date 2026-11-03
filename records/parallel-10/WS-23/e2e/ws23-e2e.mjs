// WS-23 browser E2E: real browser + real backend (buildApp) + real PostgreSQL.
//
//   node ws23-e2e.mjs
//
// Locally seeds 4 members and 2 dev tester accounts, starts the backend on
// 127.0.0.1:4401 and the built console (`vite preview`) on 127.0.0.1:4180,
// drives the login -> list -> detail -> logout flow, then removes every row it
// created. No remote host, no database outside 127.0.0.1:55432.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pgDefault from '/Users/mintech-mac/hermes/dev-profile/shared/projects/wt-WS-23/services/backend/node_modules/pg/lib/index.js';

const ROOT = '/Users/mintech-mac/hermes/dev-profile/shared/projects/wt-WS-23';
const BACKEND = ROOT + '/services/backend';
const WEB = ROOT + '/apps/web';
const DATABASE_URL = process.env.KG_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/kgtest_ws23';
const SCREENS = ROOT + '/records/parallel-10/WS-23/screens';
const API_PORT = 4401;
const WEB_PORT = 4180;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;

process.env.PLAYWRIGHT_BROWSERS_PATH = '/Users/mintech-mac/hermes/dev-profile/shared/projects/kimgosu/apps/web/.cache/ms-playwright';
const requireWeb = createRequire(WEB + '/package.json');
const { chromium } = requireWeb('playwright');

const { buildApp } = await import(BACKEND + '/src/app.ts');
const { postgresSql } = await import(BACKEND + '/src/database.ts');

mkdirSync(SCREENS, { recursive: true });
setTimeout(() => { console.error('WATCHDOG: e2e exceeded 240s; aborting'); process.exit(3); }, 240000).unref?.();
const results = [];
const check = async (name, fn) => { try { const detail = await fn(); results.push({ name, status: 'PASS', detail: String(detail ?? '') }); console.log('PASS ' + name + (detail ? ' — ' + detail : '')); } catch (e) { results.push({ name, status: 'FAIL', detail: String(e.message).slice(0, 800) }); console.error('FAIL ' + name + ' — ' + String(e.message).slice(0, 400)); throw e; } };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const pg = pgDefault.default ?? pgDefault;
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

const IDS = { admin: randomUUID(), plain: randomUUID(), target: randomUUID(), customer: randomUUID() };
const principals = [];
const created = { members: Object.values(IDS), principals, slots: [1, 2] };
const LABELS = { 1: '운영자 계정', 2: '일반 계정' };

async function seedMember(id, name, nickname, email) {
  const principalId = randomUUID();
  principals.push(principalId);
  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
  await pool.query(`INSERT INTO kg_membership.members(id,principal_id,name,email,nickname) VALUES($1,$2,$3,$4,$5)`,
    [id, principalId, name, email, nickname]);
}

let app;
let preview;
const serverLog = [];

try {
  // ── fixture ────────────────────────────────────────────────────────────────
  await seedMember(IDS.admin, '운영자A', '운영자A', 'operator@dev.invalid');
  await seedMember(IDS.plain, '일반U', '일반U', 'plain@dev.invalid');
  await seedMember(IDS.target, '대상T', '대상T', 'target@dev.invalid');
  await seedMember(IDS.customer, '고객C', '고객C', 'customer@dev.invalid');
  await pool.query(`INSERT INTO kg_membership.role_grants(id,member_id,role_id,reason,starts_at)
    VALUES($1,$2,'ADMIN','ws23 e2e fixture',now())`, [randomUUID(), IDS.admin]);
  await pool.query(`INSERT INTO kg_membership.dev_test_accounts(slot,role,label,member_id) VALUES
    (1,'USER',$1,$2),(2,'USER',$3,$4)`, [LABELS[1], IDS.admin, LABELS[2], IDS.plain]);

  // ── servers ────────────────────────────────────────────────────────────────
  app = buildApp(postgresSql(pool), 'e2e-ws23', { devLogin: true, identityKey: 'k'.repeat(48), corsOrigins: [WEB_ORIGIN] });
  await app.listen({ host: '127.0.0.1', port: API_PORT });
  const health = await (await fetch(`http://127.0.0.1:${API_PORT}/health`)).json();
  await check('backend is listening on loopback with dev login enabled', () => {
    assert(health.status === 'ok', 'health not ok');
    return `release=${health.release}`;
  });

  preview = spawn(process.execPath, [WEB + '/node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], { cwd: WEB, stdio: ['ignore', 'pipe', 'pipe'] });
  preview.stdout.on('data', x => serverLog.push(x.toString()));
  preview.stderr.on('data', x => serverLog.push(x.toString()));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (preview.exitCode !== null) throw new Error('preview exited: ' + serverLog.join(''));
    try { const r = await fetch(WEB_ORIGIN + '/admin/login'); if (r.ok && (await r.text()).includes('id="app"')) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  if (!ready) throw new Error('preview not ready: ' + serverLog.join(''));
  await check('/admin/login is served from the built console document', () => 'vite preview served /admin/login as admin.html');

  // ── browser ────────────────────────────────────────────────────────────────
  console.log('step: launching browser');
  const browser = await chromium.launch({ headless: true, timeout: 30000 });
  console.log('step: browser up');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  const apiCalls = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
  page.on('response', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/admin') || u.pathname.startsWith('/v1/auth/dev')) apiCalls.push({ method: r.request().method(), path: u.pathname, status: r.status() }); });
  const shot = async (name) => page.screenshot({ path: `${SCREENS}/${name}.png`, fullPage: true });

  await page.goto(WEB_ORIGIN + '/admin/login');
  console.log('step: login page loaded');
  await page.getByRole('heading', { level: 1, name: '운영자 로그인', exact: true }).waitFor();
  await page.locator('main[aria-busy="false"]').waitFor();
  console.log('step: login screen finished loading');
  await check('login screen renders at /admin/login', async () => {
    const accounts = await page.locator('input[type=radio]').count();
    const social = await page.locator('section[aria-labelledby="social-title"]').innerText();
    assert(accounts === 2, `expected 2 tester accounts, rendered ${accounts}`);
    assert(social.length > 0, 'social section is empty');
    return `heading "운영자 로그인", tester accounts ${accounts}, social section present`;
  });

  await check('the pasted-token input is gone and social login is reported honestly', async () => {
    assert(await page.locator('input[type="password"]').count() === 0, 'a password/token input is still rendered');
    const social = await page.locator('section[aria-labelledby="social-title"]').innerText();
    assert(social.includes('연결되어 있지 않아'), 'provider state is not stated honestly: ' + social.slice(0, 120));
    return 'no token input; social providers reported as not connected';
  });
  await shot('01-login');

  // non-admin account: server refuses at POST /v1/admin/session
  await page.getByText(LABELS[2], { exact: false }).click();
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  const denied = page.getByRole('alert');
  await denied.waitFor();
  const deniedText = await denied.innerText();
  await check('a non-admin account is refused by the server (403) and stays on login', async () => {
    assert(/관리자\(ADMIN\) 역할이 없습니다/.test(deniedText), 'unexpected message: ' + deniedText);
    const call = apiCalls.filter(c => c.path === '/v1/admin/session').at(-1);
    assert(call && call.status === 403, 'no 403 from /v1/admin/session: ' + JSON.stringify(call));
    assert(await page.getByRole('heading', { level: 1, name: '운영자 로그인' }).count() === 1, 'left the login screen');
    return `POST /v1/admin/session → 403; message: ${deniedText.slice(0, 60)}`;
  });
  await shot('02-login-denied-non-admin');

  // admin account
  await page.getByText(LABELS[1], { exact: false }).click();
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: '김고수 운영 콘솔', exact: true }).waitFor();
  await page.locator('table.members tbody tr').first().waitFor();
  await check('admin login reaches the console and loads the member list from the server', async () => {
    const rows = await page.locator('table.members tbody tr').count();
    const call = apiCalls.filter(c => c.path === '/v1/admin/members').at(-1);
    assert(rows === 4, `expected 4 members, rendered ${rows}`);
    assert(call && call.status === 200, 'member list request did not return 200: ' + JSON.stringify(call));
    const exchange = apiCalls.filter(c => c.path === '/v1/admin/session').at(-1);
    assert(exchange && (exchange.status === 201 || exchange.status === 200), 'no successful session exchange: ' + JSON.stringify(exchange));
    assert(page.url().endsWith('/admin/'), 'console URL is not /admin/: ' + page.url());
    return `4 rows, POST /v1/admin/session ${exchange.status}, GET /v1/admin/members ${call.status}, url ${new URL(page.url()).pathname}`;
  });
  await shot('03-console-member-list');

  await page.getByRole('button', { name: '대상T 상세 보기' }).click();
  await page.getByRole('heading', { level: 2, name: /회원 상세/ }).waitFor();
  await check('member detail opens inside the console', async () => {
    const facts = await page.locator('dl.facts').innerText();
    assert(facts.includes('대상T'), 'detail does not show the member nickname');
    const call = apiCalls.filter(c => c.path.startsWith('/v1/admin/members/')).at(-1);
    assert(call && call.status === 200, 'detail request failed: ' + JSON.stringify(call));
    return 'GET /v1/admin/members/:id → 200, 닉네임 표시';
  });
  await shot('04-console-member-detail');

  // logout
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: '운영자 로그인', exact: true }).waitFor();
  await check('logout returns to the login screen', async () => {
    const logout = apiCalls.filter(c => c.path === '/v1/admin/session/logout').at(-1);
    assert(logout && logout.status === 200, 'logout was not confirmed by the server: ' + JSON.stringify(logout));
    assert(await page.locator('table.members').count() === 0, 'member data is still rendered after logout');
    return 'POST /v1/admin/session/logout → 200, 목록 제거, url ' + new URL(page.url()).pathname;
  });
  await shot('05-after-logout');

  await page.goto(WEB_ORIGIN + '/admin/');
  await page.getByRole('heading', { level: 1, name: '운영자 로그인', exact: true }).waitFor();
  await check('re-entering the console URL after logout is blocked', async () => {
    assert(await page.locator('table.members').count() === 0, 'a reload of /admin/ restored the console');
    const alert = await page.getByRole('alert').innerText();
    assert(/세션이 없습니다/.test(alert), 'no explanation after the blocked re-entry: ' + alert);
    return 'reload of /admin/ → login screen with "운영자 세션이 없습니다"';
  });
  await shot('06-reentry-blocked');

  // lockout (last: it locks this client address for 5 minutes)
  await page.getByText(LABELS[2], { exact: false }).click();
  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.getByRole('alert').waitFor();
  }
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '잠겼습니다' }).waitFor();
  await check('five failed logins lock the client and say so', async () => {
    const statuses = apiCalls.filter(c => c.path === '/v1/admin/session').map(c => c.status);
    assert(statuses.includes(429), 'no 429 from the server: ' + JSON.stringify(statuses));
    const text = await page.getByRole('alert').filter({ hasText: '잠겼습니다' }).innerText();
    return `attempt statuses ${statuses.slice(-6).join(',')}; message: ${text.slice(0, 40)}`;
  });
  await shot('07-login-locked');

  await check('no browser runtime errors', () => { assert(pageErrors.length === 0, pageErrors.join(' | ')); return '0 pageerror'; });

  await browser.close();
  writeFileSync(SCREENS + '/../e2e-api-calls.json', JSON.stringify({ at: new Date().toISOString(), apiCalls }, null, 2));
} catch (error) {
  results.push({ name: 'e2e-run', status: 'FAIL', detail: String(error.message).slice(0, 1200) });
  console.error('E2E ERROR: ' + String(error.message).slice(0, 800));
} finally {
  if (preview && preview.exitCode === null) { const done = new Promise(r => preview.once('exit', r)); preview.kill('SIGTERM'); await done; }
  if (app) await app.close();
  try {
    await pool.query(`DELETE FROM kg_membership.audit_log WHERE target_type='admin_login'`);
    await pool.query(`DELETE FROM kg_membership.audit_log WHERE actor_member_id = ANY($1::uuid[])`, [created.members]);
    await pool.query(`DELETE FROM kg_membership.dev_test_accounts WHERE slot = ANY($1::int[])`, [created.slots]);
    await pool.query(`DELETE FROM kg_membership.role_grants WHERE member_id = ANY($1::uuid[])`, [created.members]);
    await pool.query(`DELETE FROM kg_membership.sessions WHERE member_id = ANY($1::uuid[])`, [created.members]);
    await pool.query(`DELETE FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [created.members]);
    await pool.query(`DELETE FROM kg_membership.principals WHERE id = ANY($1::uuid[])`, [created.principals]);
    const left = await pool.query(`SELECT
      (SELECT count(*)::int FROM kg_membership.members WHERE id = ANY($1::uuid[])) AS members,
      (SELECT count(*)::int FROM kg_membership.principals WHERE id = ANY($2::uuid[])) AS principals,
      (SELECT count(*)::int FROM kg_membership.sessions WHERE member_id = ANY($1::uuid[])) AS sessions,
      (SELECT count(*)::int FROM kg_membership.audit_log WHERE actor_member_id = ANY($1::uuid[])) AS audit,
      (SELECT count(*)::int FROM kg_membership.dev_test_accounts WHERE slot = ANY($3::int[])) AS slots`,
      [created.members, created.principals, created.slots]);
    results.push({ name: 'fixture cleanup', status: Object.values(left.rows[0]).every(v => v === 0) ? 'PASS' : 'FAIL', detail: JSON.stringify(left.rows[0]) });
    console.log('cleanup: ' + JSON.stringify(left.rows[0]));
  } catch (e) { console.error('cleanup error: ' + String(e.message).slice(0, 300)); }
  await pool.end();
  writeFileSync(SCREENS + '/../e2e-results.json', JSON.stringify({
    scope: 'REAL_BROWSER + REAL_BACKEND + REAL_LOCAL_POSTGRESQL (loopback only)',
    at: new Date().toISOString(),
    webOrigin: WEB_ORIGIN,
    apiOrigin: `http://127.0.0.1:${API_PORT}`,
    database: DATABASE_URL.replace(/\/\/[^@]*@/, '//'),
    results, passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length,
  }, null, 2));
  process.exit(results.some(r => r.status !== 'PASS') ? 1 : 0);
}
