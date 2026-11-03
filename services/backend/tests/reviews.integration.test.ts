// Review eligibility / write / read integration test against real PostgreSQL.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest \
//     node --test tests/reviews.integration.test.ts
//
// Mirrors tests/ledger.integration.test.ts: loopback-only, truncates the named
// test database, and cleans up every row it creates in `after`.

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
const app = buildApp(postgresSql(pool), 'integration-reviews', {});

const EXPERT = { id: randomUUID(), token: 'E'.repeat(43) };
const CUSTOMER = { id: randomUUID(), token: 'C'.repeat(43) };
const OUTSIDER = { id: randomUUID(), token: 'O'.repeat(43) };
const OPEN_LEDGER = randomUUID();
const IDLE_LEDGER = randomUUID();

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

async function seedAgreement(ledgerId: string, status: 'REQUESTED' | 'COMPLETED') {
  const completed = status === 'COMPLETED';
  return (await pool.query(
    `INSERT INTO kg_membership.agreements(id,ledger_id,requester_member_id,counterpart_member_id,summary,status,completed_at)
     VALUES($1,$2,$3,$4,'욕실 타일 2일',$5,CASE WHEN $6 THEN now() END) RETURNING id`,
    [randomUUID(), ledgerId, EXPERT.id, CUSTOMER.id, status, completed],
  )).rows[0].id as string;
}

before(async () => {
  await pool.query(`TRUNCATE kg_membership.reviews, kg_membership.audit_log, kg_membership.agreements,
    kg_membership.ledger_notes, kg_membership.ledgers, kg_membership.role_grants, kg_membership.consent_events,
    kg_membership.notification_preferences, kg_membership.sessions, kg_membership.sms_challenges,
    kg_membership.registration_tickets, kg_membership.oauth_flows, kg_membership.social_links,
    kg_membership.restrictions, kg_membership.members, kg_membership.principals CASCADE`);

  await seedMember(EXPERT, '고수A', true);
  await seedMember(CUSTOMER, '고객B', false);
  await seedMember(OUTSIDER, '제3자C', false);

  await pool.query(`INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id) VALUES($1,$2,$3)`, [OPEN_LEDGER, EXPERT.id, CUSTOMER.id]);
  await pool.query(`INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id) VALUES($1,$2,$3)`, [IDLE_LEDGER, EXPERT.id, OUTSIDER.id]);
  await seedAgreement(OPEN_LEDGER, 'COMPLETED');
  await seedAgreement(IDLE_LEDGER, 'REQUESTED');
});

after(async () => {
  // Leave the shared local test database as we found it.
  await pool.query(`TRUNCATE kg_membership.reviews, kg_membership.audit_log, kg_membership.agreements,
    kg_membership.ledger_notes, kg_membership.ledgers, kg_membership.role_grants,
    kg_membership.notification_preferences, kg_membership.sessions,
    kg_membership.members, kg_membership.principals CASCADE`);
  await app.close();
  await pool.end();
});

test('an incomplete trade cannot be reviewed (403)', async () => {
  const response = await app.inject({
    method: 'POST', url: `/v1/ledgers/${IDLE_LEDGER}/reviews`, headers: auth(EXPERT.token),
    payload: { rating: 5, body: '아직 끝나지 않은 거래' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'REVIEW_NOT_ELIGIBLE');
});

test('a non-participant cannot review (403)', async () => {
  const response = await app.inject({
    method: 'POST', url: `/v1/ledgers/${OPEN_LEDGER}/reviews`, headers: auth(OUTSIDER.token),
    payload: { rating: 5, body: '제3자 리뷰' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'NOT_A_PARTICIPANT');
});

test('an anonymous caller cannot review (401)', async () => {
  const response = await app.inject({
    method: 'POST', url: `/v1/ledgers/${OPEN_LEDGER}/reviews`,
    payload: { rating: 5 },
  });
  assert.equal(response.statusCode, 401);
  const stored = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.reviews WHERE ledger_id=$1`, [OPEN_LEDGER],
  )).rows[0];
  assert.equal(stored.n, 0, 'nothing may be stored without a session');
});

test('rating outside 1..5 is rejected (400)', async () => {
  for (const rating of [0, 6, 2.5]) {
    const response = await app.inject({
      method: 'POST', url: `/v1/ledgers/${OPEN_LEDGER}/reviews`, headers: auth(CUSTOMER.token),
      payload: { rating },
    });
    assert.equal(response.statusCode, 400, `rating ${rating} must be rejected`);
    assert.equal(response.json().error.code, 'INVALID_REQUEST');
  }
});

test('a completed trade accepts one review, duplicates are 409', async () => {
  const created = await app.inject({
    method: 'POST', url: `/v1/ledgers/${OPEN_LEDGER}/reviews`, headers: auth(CUSTOMER.token),
    payload: { rating: 4, body: '마감이 하루 늦었지만 친절했습니다' },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().rating, 4);
  assert.equal(created.json().authorId, CUSTOMER.id);
  assert.equal(created.json().targetId, EXPERT.id, 'the target is the counterpart, not the author');
  assert.equal(created.json().ledgerId, OPEN_LEDGER);

  const duplicate = await app.inject({
    method: 'POST', url: `/v1/ledgers/${OPEN_LEDGER}/reviews`, headers: auth(CUSTOMER.token),
    payload: { rating: 5 },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'REVIEW_EXISTS');

  const persisted = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.reviews WHERE ledger_id=$1 AND author_id=$2`,
    [OPEN_LEDGER, CUSTOMER.id],
  )).rows[0];
  assert.equal(persisted.n, 1, 'duplicate must not be stored');
});

test('the expert can review the customer once, and reads match stored rows', async () => {
  const created = await app.inject({
    method: 'POST', url: `/v1/ledgers/${OPEN_LEDGER}/reviews`, headers: auth(EXPERT.token),
    payload: { rating: 5, body: '현장 정리가 깔끔했습니다' },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().targetId, CUSTOMER.id);

  const listed = await app.inject({ method: 'GET', url: `/v1/experts/${EXPERT.id}/reviews` });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().reviews.length, 1);
  assert.equal(listed.json().summary.count, 1);
  assert.equal(listed.json().summary.average, 4);
  assert.equal(listed.json().reviews[0].authorName, '고객B');

  const rows = (await pool.query(
    `SELECT rating FROM kg_membership.reviews WHERE target_id=$1 AND hidden_at IS NULL`, [EXPERT.id],
  )).rows;
  const expected = rows.reduce((sum, row) => sum + Number(row.rating), 0) / rows.length;
  assert.equal(listed.json().summary.average, Number(expected.toFixed(2)), 'average must equal the stored rows');
});

test('hidden reviews drop out of the public list and the average', async () => {
  await pool.query(`UPDATE kg_membership.reviews SET hidden_at=now() WHERE target_id=$1`, [EXPERT.id]);
  const listed = await app.inject({ method: 'GET', url: `/v1/experts/${EXPERT.id}/reviews` });
  assert.equal(listed.json().reviews.length, 0);
  assert.equal(listed.json().summary.count, 0);
  assert.equal(listed.json().summary.average, null);
  await pool.query(`UPDATE kg_membership.reviews SET hidden_at=NULL WHERE target_id=$1`, [EXPERT.id]);
});

test('pagination returns stable pages without duplicates', async () => {
  const first = await app.inject({ method: 'GET', url: `/v1/experts/${EXPERT.id}/reviews?limit=1&offset=0` });
  const second = await app.inject({ method: 'GET', url: `/v1/experts/${EXPERT.id}/reviews?limit=1&offset=1` });
  assert.equal(first.json().reviews.length, 1);
  assert.equal(second.json().reviews.length, 0);
  assert.equal(first.json().pagination.total, 1);
  assert.equal(first.json().pagination.limit, 1);

  const tooWide = await app.inject({ method: 'GET', url: `/v1/experts/${EXPERT.id}/reviews?limit=51` });
  assert.equal(tooWide.statusCode, 400);
});

test('a self-review is structurally impossible', async () => {
  // The author/target pair comes from the ledger, and a ledger cannot join a
  // member to themselves. The table check backs that up independently.
  let error: { code?: string } | undefined;
  try {
    await pool.query(
      `INSERT INTO kg_membership.reviews(id,ledger_id,author_id,target_id,rating)
       VALUES($1,$2,$3,$3,5)`,
      [randomUUID(), IDLE_LEDGER, CUSTOMER.id],
    );
  } catch (caught) { error = caught as { code?: string }; }
  assert.equal(error?.code, '23514', 'author_id = target_id must violate the table CHECK');

  await assert.rejects(
    pool.query(
      `INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id) VALUES($1,$2,$2)`,
      [randomUUID(), EXPERT.id],
    ),
    (caught: { code?: string }) => caught.code === '23514',
  );
});

test('unknown expert returns 404', async () => {
  const response = await app.inject({ method: 'GET', url: `/v1/experts/${randomUUID()}/reviews` });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'EXPERT_NOT_FOUND');
});

test('/v1/me/reviews separates written and received', async () => {
  const customer = await app.inject({ method: 'GET', url: '/v1/me/reviews', headers: auth(CUSTOMER.token) });
  assert.equal(customer.statusCode, 200);
  assert.equal(customer.json().written.length, 1);
  assert.equal(customer.json().written[0].targetId, EXPERT.id);
  assert.equal(customer.json().received.length, 1);
  assert.equal(customer.json().received[0].authorId, EXPERT.id);
  assert.equal(customer.json().receivedSummary.count, 1);
  assert.equal(customer.json().receivedSummary.average, 5);

  const anonymous = await app.inject({ method: 'GET', url: '/v1/me/reviews' });
  assert.equal(anonymous.statusCode, 401);
});

test('review creation is audited', async () => {
  const rows = (await pool.query(
    `SELECT action, target_type, target_id FROM kg_membership.audit_log WHERE action='REVIEW_CREATED'`,
  )).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.target_type === 'review'));
  const stored = (await pool.query(`SELECT id FROM kg_membership.reviews`)).rows.map(row => String(row.id));
  assert.deepEqual(rows.map(row => String(row.target_id)).sort(), stored.sort());
});
