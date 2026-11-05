// Customer ledger + bilateral agreement integration test against real PostgreSQL.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest \
//     node --test tests/ledger.integration.test.ts

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
const app = buildApp(postgresSql(pool), 'integration-ledger', {});

const EXPERT = { id: randomUUID(), token: 'E'.repeat(43) };
const CUSTOMER = { id: randomUUID(), token: 'C'.repeat(43) };
const OUTSIDER = { id: randomUUID(), token: 'O'.repeat(43) };
const LEDGER = randomUUID();

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

before(async () => {
  await pool.query(`TRUNCATE kg_membership.audit_log, kg_membership.agreements, kg_membership.ledger_notes,
    kg_membership.ledgers, kg_membership.role_grants, kg_membership.consent_events,
    kg_membership.notification_preferences, kg_membership.sessions, kg_membership.sms_challenges,
    kg_membership.registration_tickets, kg_membership.oauth_flows, kg_membership.social_links,
    kg_membership.restrictions, kg_membership.members, kg_membership.principals CASCADE`);

  await seedMember(EXPERT, '고수A', true);
  await seedMember(CUSTOMER, '고객B', false);
  await seedMember(OUTSIDER, '제3자C', false);

  await pool.query(
    `INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id) VALUES($1,$2,$3)`,
    [LEDGER, EXPERT.id, CUSTOMER.id],
  );
});

after(async () => {
  await app.close();
  await pool.end();
});

test('roles endpoint derives EXPERT from expert_active', async () => {
  const expertRoles = await app.inject({ method: 'GET', url: '/v1/me/roles', headers: auth(EXPERT.token) });
  assert.equal(expertRoles.statusCode, 200);
  assert.deepEqual(expertRoles.json().roles.sort(), ['EXPERT', 'USER']);

  const customerRoles = await app.inject({ method: 'GET', url: '/v1/me/roles', headers: auth(CUSTOMER.token) });
  assert.deepEqual(customerRoles.json().roles, ['USER']);
});

test('ledger list shows only the owning expert', async () => {
  const owner = await app.inject({ method: 'GET', url: '/v1/ledgers', headers: auth(EXPERT.token) });
  assert.equal(owner.statusCode, 200);
  assert.equal(owner.json().ledgers.length, 1);
  assert.equal(owner.json().ledgers[0].id, LEDGER);

  const other = await app.inject({ method: 'GET', url: '/v1/ledgers', headers: auth(CUSTOMER.token) });
  assert.equal(other.json().ledgers.length, 0, 'a customer must not list ledgers owned by the expert');
});

test('ledger detail and notes are owner-scoped', async () => {
  const created = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/notes`, headers: auth(EXPERT.token),
    payload: { body: '첫 상담 메모' },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().body, '첫 상담 메모');

  const detail = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}`, headers: auth(EXPERT.token) });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().notes.length, 1);

  const foreign = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}`, headers: auth(OUTSIDER.token) });
  assert.equal(foreign.statusCode, 404, 'a non-owner must not learn the ledger exists');

  const foreignNote = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/notes`, headers: auth(OUTSIDER.token),
    payload: { body: '침입 시도' },
  });
  assert.equal(foreignNote.statusCode, 404);
});

test('agreement requires a participant, then bilateral accept and complete', async () => {
  const byOutsider = await app.inject({
    method: 'POST', url: '/v1/agreements', headers: auth(OUTSIDER.token),
    payload: { ledgerId: LEDGER, summary: '무단 요청' },
  });
  assert.equal(byOutsider.statusCode, 403);

  const requested = await app.inject({
    method: 'POST', url: '/v1/agreements', headers: auth(EXPERT.token),
    payload: { ledgerId: LEDGER, summary: '욕실 타일 2일' },
  });
  assert.equal(requested.statusCode, 201);
  const agreementId = requested.json().id;
  assert.equal(requested.json().status, 'REQUESTED');
  assert.equal(requested.json().version, 1);

  // The requester cannot accept their own request.
  const selfAccept = await app.inject({
    method: 'POST', url: `/v1/agreements/${agreementId}/accept`, headers: auth(EXPERT.token),
    payload: { expectedVersion: 1 },
  });
  assert.equal(selfAccept.statusCode, 403);

  // Cannot complete before acceptance.
  const early = await app.inject({
    method: 'POST', url: `/v1/agreements/${agreementId}/complete`, headers: auth(CUSTOMER.token),
    payload: { expectedVersion: 1 },
  });
  assert.equal(early.statusCode, 409);
  assert.equal(early.json().error.code, 'INVALID_TRANSITION');

  const accepted = await app.inject({
    method: 'POST', url: `/v1/agreements/${agreementId}/accept`, headers: auth(CUSTOMER.token),
    payload: { expectedVersion: 1 },
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().status, 'ACCEPTED');
  assert.equal(accepted.json().version, 2);

  const stale = await app.inject({
    method: 'POST', url: `/v1/agreements/${agreementId}/complete`, headers: auth(EXPERT.token),
    payload: { expectedVersion: 1 },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'VERSION_CONFLICT');

  const completed = await app.inject({
    method: 'POST', url: `/v1/agreements/${agreementId}/complete`, headers: auth(EXPERT.token),
    payload: { expectedVersion: 2 },
  });
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.json().status, 'COMPLETED');
  assert.ok(completed.json().completedAt);

  const row = (await pool.query(
    `SELECT status, completed_at IS NOT NULL AS done FROM kg_membership.agreements WHERE id=$1`,
    [agreementId],
  )).rows[0];
  assert.equal(row.status, 'COMPLETED');
  assert.equal(row.done, true);
});

test('review eligibility follows the completed agreement, not a self-report', async () => {
  const eligible = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.agreements
      WHERE status='COMPLETED' AND requester_member_id=$1 AND counterpart_member_id=$2`,
    [EXPERT.id, CUSTOMER.id],
  )).rows[0];
  assert.equal(eligible.n, 1);

  const noAgreement = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.agreements
      WHERE status='COMPLETED' AND requester_member_id=$1 AND counterpart_member_id=$2`,
    [EXPERT.id, OUTSIDER.id],
  )).rows[0];
  assert.equal(noAgreement.n, 0, 'a pair with no completed agreement must not be review-eligible');
});

test('role grants and audit rows are recorded', async () => {
  const rows = (await pool.query(
    `SELECT action, target_type FROM kg_membership.audit_log ORDER BY id`,
  )).rows;
  assert.ok(rows.some(r => r.action === 'AGREEMENT_REQUESTED'));
  assert.ok(rows.some(r => r.action === 'AGREEMENT_ACCEPTED'));
  assert.ok(rows.some(r => r.action === 'AGREEMENT_COMPLETED'));
  assert.ok(rows.every(r => r.target_type === 'agreement'));
});

test('a customer opens one ledger per expert and reopening returns the same one', async () => {
  // 기존 픽스처가 EXPERT-CUSTOMER 원장을 이미 만들었으므로 새 고객으로 최초 생성을 확인한다.
  const NEWCOMER = { id: randomUUID(), token: 'N'.repeat(43) };
  await seedMember(NEWCOMER, '신규고객G', false);

  const first = await app.inject({
    method: 'POST', url: '/v1/ledgers', headers: auth(NEWCOMER.token), payload: { expertId: EXPERT.id },
  });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().created, true);

  const again = await app.inject({
    method: 'POST', url: '/v1/ledgers', headers: auth(NEWCOMER.token), payload: { expertId: EXPERT.id },
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().created, false);
  assert.equal(again.json().id, first.json().id);

  const rows = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.ledgers WHERE expert_member_id=$1 AND customer_member_id=$2`,
    [EXPERT.id, NEWCOMER.id],
  )).rows[0];
  assert.equal(rows.n, 1);

  const audited = (await pool.query(
    `SELECT 1 FROM kg_membership.audit_log WHERE action='LEDGER_OPENED' AND target_id=$1`, [first.json().id],
  )).rows[0];
  assert.ok(audited, 'opening a ledger must be audited');
});

test('opening a ledger refuses self, unknown experts and unauthenticated callers', async () => {
  const self = await app.inject({
    method: 'POST', url: '/v1/ledgers', headers: auth(EXPERT.token), payload: { expertId: EXPERT.id },
  });
  assert.equal(self.statusCode, 400);
  assert.equal(self.json().error.code, 'SELF_LEDGER_NOT_ALLOWED');

  const unknown = await app.inject({
    method: 'POST', url: '/v1/ledgers', headers: auth(CUSTOMER.token), payload: { expertId: randomUUID() },
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'EXPERT_NOT_FOUND');

  const anonymous = await app.inject({ method: 'POST', url: '/v1/ledgers', payload: { expertId: EXPERT.id } });
  assert.equal(anonymous.statusCode, 401);
});

// ── WS-71 거래 취소 ─────────────────────────────────────────────────────────
// 완료 이력이 없는 새 원장을 쓴다(한 쌍당 원장은 하나이므로 새 당사자 쌍).
const CANCEL_EXPERT = { id: randomUUID(), token: 'X'.repeat(43) };
const CANCEL_CUSTOMER = { id: randomUUID(), token: 'Y'.repeat(43) };
const CANCEL_LEDGER = randomUUID();

test('a cancellation needs both parties: request then counterpart accept', async () => {
  await seedMember(CANCEL_EXPERT, '고수D', true);
  await seedMember(CANCEL_CUSTOMER, '고객E', false);
  await pool.query(
    `INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id) VALUES($1,$2,$3)`,
    [CANCEL_LEDGER, CANCEL_EXPERT.id, CANCEL_CUSTOMER.id],
  );

  const initial = await app.inject({ method: 'GET', url: `/v1/ledgers/${CANCEL_LEDGER}/cancel`, headers: auth(CANCEL_CUSTOMER.token) });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().status, 'ACTIVE');
  assert.equal(initial.json().requestedByMe, null);

  // The reason is required when creating the request.
  const noReason = await app.inject({
    method: 'POST', url: `/v1/ledgers/${CANCEL_LEDGER}/cancel`, headers: auth(CANCEL_EXPERT.token), payload: {},
  });
  assert.equal(noReason.statusCode, 400);
  assert.equal(noReason.json().error.code, 'REASON_REQUIRED');

  const requested = await app.inject({
    method: 'POST', url: `/v1/ledgers/${CANCEL_LEDGER}/cancel`, headers: auth(CANCEL_EXPERT.token),
    payload: { reasonCode: 'SCHEDULE', detail: '일정이 맞지 않습니다' },
  });
  assert.equal(requested.statusCode, 200);
  assert.equal(requested.json().status, 'CANCEL_REQUESTED');
  assert.equal(requested.json().requestedByMe, true);
  assert.equal(requested.json().reasonCode, 'SCHEDULE');

  // The requester cannot accept their own request.
  const selfAccept = await app.inject({
    method: 'POST', url: `/v1/ledgers/${CANCEL_LEDGER}/cancel`, headers: auth(CANCEL_EXPERT.token), payload: {},
  });
  assert.equal(selfAccept.statusCode, 409);
  assert.equal(selfAccept.json().error.code, 'CANCEL_ALREADY_REQUESTED');

  const counterpartView = await app.inject({ method: 'GET', url: `/v1/ledgers/${CANCEL_LEDGER}/cancel`, headers: auth(CANCEL_CUSTOMER.token) });
  assert.equal(counterpartView.json().status, 'CANCEL_REQUESTED');
  assert.equal(counterpartView.json().requestedByMe, false);
  assert.equal(counterpartView.json().detail, '일정이 맞지 않습니다');

  const accepted = await app.inject({
    method: 'POST', url: `/v1/ledgers/${CANCEL_LEDGER}/cancel`, headers: auth(CANCEL_CUSTOMER.token), payload: {},
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().status, 'CANCELLED');
  assert.equal(accepted.json().requestedByMe, false);
  assert.ok(accepted.json().cancelledAt);

  const row = (await pool.query(
    `SELECT status, cancel_requested_by, cancel_reason_code, cancel_reason_detail,
            cancel_requested_at IS NOT NULL AS requested, cancelled_at IS NOT NULL AS cancelled
       FROM kg_membership.ledgers WHERE id=$1`, [CANCEL_LEDGER],
  )).rows[0];
  assert.equal(row.status, 'CANCELLED');
  assert.equal(row.cancel_requested_by, CANCEL_EXPERT.id);
  assert.equal(row.cancel_reason_code, 'SCHEDULE');
  assert.equal(row.cancelled, true);

  const again = await app.inject({
    method: 'POST', url: `/v1/ledgers/${CANCEL_LEDGER}/cancel`, headers: auth(CANCEL_CUSTOMER.token),
    payload: { reasonCode: 'PRICE' },
  });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'ALREADY_CANCELLED');

  const audited = (await pool.query(
    `SELECT action FROM kg_membership.audit_log WHERE target_id=$1 AND target_type='ledger' ORDER BY id`,
    [CANCEL_LEDGER],
  )).rows.map(r => r.action);
  assert.deepEqual(audited, ['LEDGER_CANCEL_REQUESTED', 'LEDGER_CANCELLED']);
});

test('a cancelled ledger refuses a review with 409', async () => {
  const review = await app.inject({
    method: 'POST', url: `/v1/ledgers/${CANCEL_LEDGER}/reviews`, headers: auth(CANCEL_CUSTOMER.token),
    payload: { rating: 5, body: '취소된 거래 후기' },
  });
  assert.equal(review.statusCode, 409);
  assert.equal(review.json().error.code, 'LEDGER_CANCELLED');
});

test('a completed ledger cannot be cancelled and a non-participant sees nothing', async () => {
  // LEDGER 는 앞 테스트에서 COMPLETED agreement 가 생겼다.
  const completed = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/cancel`, headers: auth(EXPERT.token),
    payload: { reasonCode: 'PRICE' },
  });
  assert.equal(completed.statusCode, 409);
  assert.equal(completed.json().error.code, 'LEDGER_COMPLETED');

  const outsiderGet = await app.inject({ method: 'GET', url: `/v1/ledgers/${CANCEL_LEDGER}/cancel`, headers: auth(OUTSIDER.token) });
  assert.equal(outsiderGet.statusCode, 404);
  const outsiderPost = await app.inject({
    method: 'POST', url: `/v1/ledgers/${CANCEL_LEDGER}/cancel`, headers: auth(OUTSIDER.token), payload: { reasonCode: 'OTHER' },
  });
  assert.equal(outsiderPost.statusCode, 404);
  assert.equal(outsiderPost.json().error.code, 'LEDGER_NOT_FOUND');
});
