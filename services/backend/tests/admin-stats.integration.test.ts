// WS-72 — operator dashboard aggregates against real PostgreSQL.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest_ws72 \
//     node --test tests/admin-stats.integration.test.ts
//
// Loopback database only. Every row created here is removed in `after`.
// `kg_membership.reports` is created by WS-61 (migration 021); a database without
// it skips the report assertions instead of reporting a false pass.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { postgresSql } from '../src/database.ts';

const DATABASE_URL = process.env.KG_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/kgtest';
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const parsed = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('KG_TEST_DATABASE_URL must point at a loopback database');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const app = buildApp(postgresSql(pool), 'integration-admin-stats', {});

const MEMBER_TOKEN = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 12);
const ADMIN = randomUUID();
const EXPERT = randomUUID();
const CUSTOMER = randomUUID();
const EXTRA = randomUUID();
const LEDGER = randomUUID();
let adminToken = '';
// Read before the tests are registered: `skip` is decided at registration time.
const reportsAvailable = Boolean((await pool.query('SELECT to_regclass($1) AS name', ['kg_membership.reports'])).rows[0]?.name);

async function seedMember(id: string, nickname: string, createdAt: string, expert = false) {
  const principalId = randomUUID();
  await pool.query('INSERT INTO kg_membership.principals(id) VALUES($1)', [principalId]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest,expert_active,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, principalId, nickname, `${nickname}@dev.invalid`, nickname, sha(randomUUID()), expert, createdAt],
  );
}

async function seedAgreement(requester: string, counterpart: string, status: string, requestedAt: string) {
  await pool.query(
    `INSERT INTO kg_membership.agreements(id,ledger_id,requester_member_id,counterpart_member_id,summary,status,requested_at,accepted_at,completed_at)
     VALUES($1,$2,$3,$4,'ws72 집계',$5,$6,$7,$8)`,
    [randomUUID(), LEDGER, requester, counterpart, status, requestedAt,
      status === 'REQUESTED' ? null : requestedAt, status === 'COMPLETED' ? requestedAt : null],
  );
}

before(async () => {
  await pool.query(`TRUNCATE kg_membership.audit_log, kg_membership.agreements, kg_membership.ledger_notes,
    kg_membership.ledgers, kg_membership.role_grants, kg_membership.consent_events,
    kg_membership.notification_preferences, kg_membership.sessions, kg_membership.sms_challenges,
    kg_membership.registration_tickets, kg_membership.oauth_flows, kg_membership.social_links,
    kg_membership.restrictions, kg_membership.members, kg_membership.principals CASCADE`);

  if (reportsAvailable) await pool.query('TRUNCATE kg_membership.reports');

  await seedMember(ADMIN, '운영자', '2026-10-15T10:00:00+09:00');
  await seedMember(EXPERT, '고수', '2026-10-25T10:00:00+09:00', true);
  await seedMember(CUSTOMER, '고객', '2026-11-02T10:00:00+09:00');
  await seedMember(EXTRA, '신규', '2026-11-03T10:00:00+09:00');

  await pool.query(
    `INSERT INTO kg_membership.role_grants(id,member_id,role_id,reason,starts_at)
     VALUES($1,$2,'ADMIN','admin-stats fixture',now())`, [randomUUID(), ADMIN],
  );
  await pool.query(
    `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
     VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`,
    [randomUUID(), ADMIN, sha(MEMBER_TOKEN), sha('r-' + MEMBER_TOKEN), randomUUID()],
  );
  await pool.query(
    `INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id,created_at) VALUES($1,$2,$3,$4)`,
    [LEDGER, EXPERT, CUSTOMER, '2026-10-30T10:00:00+09:00'],
  );

  // 2026-11-01: 2 trades, 1 completed. 2026-11-03: 1 trade. 2026-10-20: 1 completed.
  await seedAgreement(CUSTOMER, EXPERT, 'COMPLETED', '2026-11-01T01:00:00Z');
  await seedAgreement(EXPERT, CUSTOMER, 'ACCEPTED', '2026-11-01T06:00:00Z');
  await seedAgreement(CUSTOMER, EXPERT, 'REQUESTED', '2026-11-03T00:00:00Z');
  await seedAgreement(EXPERT, CUSTOMER, 'COMPLETED', '2026-10-20T00:00:00Z');

  if (reportsAvailable) {
    // 23:30 KST is still 11-04 in the operator's day, not 11-04 UTC.
    await pool.query(
      `INSERT INTO kg_membership.reports(id,reporter_member_id,target_type,target_id,reason_code,created_at)
       VALUES($1,$2,'MEMBER',$3,'SPAM','2026-11-04T14:30:00Z')`,
      [randomUUID(), CUSTOMER, randomUUID()],
    );
  }

  const login = await app.inject({
    method: 'POST', url: '/v1/admin/session',
    headers: { 'content-type': 'application/json' },
    payload: { sessionToken: MEMBER_TOKEN },
  });
  assert.equal(login.statusCode, 201);
  adminToken = login.json().adminToken;
});

after(async () => {
  await pool.query(`DELETE FROM kg_membership.agreements WHERE ledger_id=$1`, [LEDGER]);
  await pool.query(`DELETE FROM kg_membership.ledgers WHERE id=$1`, [LEDGER]);
  await pool.query(`DELETE FROM kg_membership.audit_log WHERE actor_member_id = ANY($1::uuid[])`, [[ADMIN, EXPERT, CUSTOMER, EXTRA]]);
  if (reportsAvailable) await pool.query(`DELETE FROM kg_membership.reports WHERE reporter_member_id = ANY($1::uuid[])`, [[ADMIN, EXPERT, CUSTOMER, EXTRA]]);
  await pool.query(`DELETE FROM kg_membership.sessions WHERE member_id=$1`, [ADMIN]);
  await pool.query(`DELETE FROM kg_membership.role_grants WHERE member_id=$1`, [ADMIN]);
  await pool.query(`DELETE FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [[ADMIN, EXPERT, CUSTOMER, EXTRA]]);
  await app.close();
  await pool.end();
});

// The dashboard aggregates kg_membership.reports (WS-61, migration 021). Without
// that table the route cannot answer at all, so the suite skips instead of
// asserting a false failure; the merged tree has the migration.
const requiresReports = reportsAvailable ? {} : { skip: 'kg_membership.reports (WS-61 migration 021) is not in this database' };

const stats = async (query = '') => app.inject({
  method: 'GET', url: '/v1/admin/stats' + query, headers: { authorization: 'Bearer ' + adminToken },
});

test('WS72 the period decides the numbers, and the day boundary is KST', requiresReports, async () => {
  const week = await stats('?from=2026-10-29&to=2026-11-04');
  assert.equal(week.statusCode, 200);
  const body = week.json();
  assert.equal(body.from, '2026-10-29');
  assert.equal(body.to, '2026-11-04');
  assert.equal(body.totals.trades, 3);
  assert.equal(body.totals.completed, 1);
  assert.equal(body.totals.completionRate, 33.3);
  assert.equal(body.totals.newMembers, 2, 'members created 11-02 and 11-03');
  assert.equal(body.daily.length, 7);
  assert.equal(body.daily[0].date, '2026-10-29');
  assert.equal(body.daily[3].trades, 2, 'both 11-01 agreements land on 11-01 KST');
  assert.equal(body.daily.reduce((sum: number, day: { trades: number }) => sum + day.trades, 0), body.totals.trades);

  const october = (await stats('?from=2026-10-01&to=2026-10-31')).json();
  assert.equal(october.totals.trades, 1);
  assert.equal(october.totals.completed, 1);
  assert.equal(october.totals.completionRate, 100);
  assert.equal(october.totals.newMembers, 2, 'operator (10-15) and expert (10-25)');
  assert.notEqual(october.totals.trades, body.totals.trades, 'a different period must change the count');

  if (reportsAvailable) {
    assert.equal(body.totals.reports, 1, 'a 11-04 23:30 KST report belongs to 11-04');
    assert.equal(october.totals.reports, 0);
  }
});

test('WS72 an omitted period defaults to the last 7 days ending today (KST)', requiresReports, async () => {
  const body = (await stats()).json();
  const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  assert.equal(body.to, todayKst);
  assert.equal(body.daily.length, 7);
});

test('WS72 an impossible or inverted period is refused, not silently clamped', requiresReports, async () => {
  for (const query of ['?from=2026-02-31&to=2026-03-01', '?from=2026-11-04&to=2026-10-01', '?days=7']) {
    const response = await stats(query);
    assert.equal(response.statusCode, 400, query);
    assert.equal(response.json().error.code, 'INVALID_REQUEST', query);
  }
});

test('WS72 the dashboard needs an operator scope', requiresReports, async () => {
  const memberSession = await app.inject({ method: 'GET', url: '/v1/admin/stats', headers: { authorization: 'Bearer ' + MEMBER_TOKEN } });
  assert.equal(memberSession.statusCode, 403);
  assert.equal(memberSession.json().error.code, 'ADMIN_SESSION_REQUIRED');

  const anonymous = await app.inject({ method: 'GET', url: '/v1/admin/stats' });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().error.code, 'AUTH_REQUIRED');
});
