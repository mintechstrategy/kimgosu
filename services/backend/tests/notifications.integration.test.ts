// Notification inbox (WS-75) against real PostgreSQL.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest \
//     node --test tests/notifications.integration.test.ts
//
// Mirrors the other integration suites: loopback-only, truncates the named test
// database, and cleans up every row it creates in `after`.

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
const app = buildApp(postgresSql(pool), 'integration-notifications', {});

const EXPERT = { id: randomUUID(), token: 'E'.repeat(43) };
const CUSTOMER = { id: randomUUID(), token: 'C'.repeat(43) };
const ADMIN = { id: randomUUID(), token: 'A'.repeat(43) };
const LEDGER = randomUUID();
let ADMIN_SESSION_TOKEN = '';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function seedMember(member: { id: string; token: string }, nickname: string, expert: boolean) {
  const principalId = randomUUID();
  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest,expert_active)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [member.id, principalId, nickname, `${nickname}@dev.invalid`, nickname, sha(`p-${nickname}`), expert],
  );
  await pool.query(
    `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
     VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`,
    [randomUUID(), member.id, sha(member.token), sha('r-' + member.token), randomUUID()],
  );
}

const inbox = async (token: string, kind?: string) => {
  const response = await app.inject({
    method: 'GET', url: '/v1/notifications' + (kind ? `?kind=${kind}` : ''), headers: auth(token),
  });
  return { status: response.statusCode, body: response.json() };
};

before(async () => {
  await pool.query(`TRUNCATE kg_membership.notifications, kg_membership.reviews, kg_membership.audit_log,
    kg_membership.agreements, kg_membership.ledger_notes, kg_membership.ledgers,
    kg_membership.quotes, kg_membership.quote_transitions, kg_membership.role_grants,
    kg_membership.consent_events, kg_membership.notification_preferences, kg_membership.sessions,
    kg_membership.restrictions, kg_membership.members, kg_membership.principals CASCADE`);

  await seedMember(EXPERT, '고수A', true);
  await seedMember(CUSTOMER, '고객B', false);
  await seedMember(ADMIN, '운영자C', false);
  await pool.query(
    `INSERT INTO kg_membership.role_grants(id,member_id,role_id,reason) VALUES($1,$2,'ADMIN','WS-75 통합 테스트 운영자')`,
    [randomUUID(), ADMIN.id],
  );
  await pool.query(`INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id) VALUES($1,$2,$3)`,
    [LEDGER, EXPERT.id, CUSTOMER.id]);

  const exchanged = await app.inject({ method: 'POST', url: '/v1/admin/session', payload: { sessionToken: ADMIN.token } });
  assert.equal(exchanged.statusCode, 201);
  ADMIN_SESSION_TOKEN = exchanged.json().adminToken;
});

after(async () => {
  await pool.query(`TRUNCATE kg_membership.notifications, kg_membership.reviews, kg_membership.audit_log,
    kg_membership.agreements, kg_membership.ledger_notes, kg_membership.ledgers,
    kg_membership.quotes, kg_membership.quote_transitions, kg_membership.role_grants,
    kg_membership.notification_preferences, kg_membership.sessions, kg_membership.members,
    kg_membership.principals CASCADE`);
  await app.close();
  await pool.end();
});

test('an anonymous caller cannot read the inbox (401)', async () => {
  const response = await app.inject({ method: 'GET', url: '/v1/notifications' });
  assert.equal(response.statusCode, 401);
});

test('a proposed quote notifies the customer only', async () => {
  const proposed = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/quotes`, headers: auth(EXPERT.token),
    payload: { amount: 180000, message: '욕실 타일 2일 작업입니다' },
  });
  assert.equal(proposed.statusCode, 201);

  const customer = await inbox(CUSTOMER.token);
  assert.equal(customer.status, 200);
  assert.equal(customer.body.unreadCount, 1);
  assert.equal(customer.body.notifications.length, 1);
  assert.equal(customer.body.notifications[0].kind, 'QUOTE');
  assert.equal(customer.body.notifications[0].ledgerId, LEDGER);
  assert.equal(customer.body.notifications[0].readAt, null);

  // The expert proposed it; their inbox must stay empty.
  const expert = await inbox(EXPERT.token);
  assert.equal(expert.body.notifications.length, 0);
  assert.equal(expert.body.unreadCount, 0);
});

test('the kind query parameter selects the list on the server', async () => {
  const quote = await inbox(CUSTOMER.token, 'QUOTE');
  assert.equal(quote.status, 200);
  assert.equal(quote.body.notifications.length, 1);

  const review = await inbox(CUSTOMER.token, 'REVIEW');
  assert.equal(review.status, 200);
  assert.equal(review.body.notifications.length, 0);
  // The badge is the unfiltered total, so a chip cannot change it.
  assert.equal(review.body.unreadCount, 1);

  const invalid = await app.inject({ method: 'GET', url: '/v1/notifications?kind=CHAT', headers: auth(CUSTOMER.token) });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_REQUEST');
});

test('completing an agreement notifies the counterpart', async () => {
  const requested = await app.inject({
    method: 'POST', url: '/v1/agreements', headers: auth(CUSTOMER.token),
    payload: { ledgerId: LEDGER, summary: '욕실 타일 2일' },
  });
  assert.equal(requested.statusCode, 201);
  const agreementId = requested.json().id;

  const accepted = await app.inject({
    method: 'POST', url: `/v1/agreements/${agreementId}/accept`, headers: auth(EXPERT.token),
    payload: { expectedVersion: 1 },
  });
  assert.equal(accepted.statusCode, 200);

  const completed = await app.inject({
    method: 'POST', url: `/v1/agreements/${agreementId}/complete`, headers: auth(EXPERT.token),
    payload: { expectedVersion: 2 },
  });
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.json().status, 'COMPLETED');

  const customer = await inbox(CUSTOMER.token, 'AGREEMENT');
  assert.equal(customer.body.notifications.length, 1);
  assert.equal(customer.body.notifications[0].ledgerId, LEDGER);
});

test('a review notifies its target', async () => {
  const created = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/reviews`, headers: auth(CUSTOMER.token),
    payload: { rating: 5, body: '깔끔했습니다' },
  });
  assert.equal(created.statusCode, 201);

  const expert = await inbox(EXPERT.token, 'REVIEW');
  assert.equal(expert.body.notifications.length, 1);
  assert.equal(expert.body.notifications[0].kind, 'REVIEW');
});

test('hiding a reported review notifies its author', async () => {
  const reviewId = (await pool.query(
    `SELECT id FROM kg_membership.reviews WHERE ledger_id=$1 AND author_id=$2`, [LEDGER, CUSTOMER.id],
  )).rows[0].id as string;

  const hidden = await app.inject({
    method: 'POST', url: `/v1/admin/reviews/${reviewId}/hide`,
    headers: auth(ADMIN_SESSION_TOKEN), payload: { reason: '신고 접수: 허위 후기' },
  });
  assert.equal(hidden.statusCode, 200);

  const customer = await inbox(CUSTOMER.token, 'REPORT');
  assert.equal(customer.body.notifications.length, 1);
  assert.equal(customer.body.notifications[0].ledgerId, LEDGER);
});

test('read-all clears the badge to zero for exactly this member', async () => {
  const before = await inbox(CUSTOMER.token);
  const unread = before.body.notifications.filter((n: { readAt: string | null }) => n.readAt === null).length;
  assert.ok(unread >= 3, 'the customer should have quote, agreement, review-report rows unread');

  const cleared = await app.inject({ method: 'POST', url: '/v1/notifications/read-all', headers: auth(CUSTOMER.token) });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().updated, unread);
  assert.equal(cleared.json().unreadCount, 0);

  const afterClear = await inbox(CUSTOMER.token);
  assert.equal(afterClear.body.unreadCount, 0);
  assert.ok(afterClear.body.notifications.every((n: { readAt: string | null }) => n.readAt !== null));

  // Idempotent: nothing left to update, and the expert's unread row is untouched.
  const again = await app.inject({ method: 'POST', url: '/v1/notifications/read-all', headers: auth(CUSTOMER.token) });
  assert.equal(again.json().updated, 0);
  assert.equal((await inbox(EXPERT.token)).body.unreadCount, 1);
});
