// Quote -> acceptance -> bilateral completion integration test against real PostgreSQL.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55444/kgtest \
//     node --test tests/quotes.integration.test.ts
//
// Real tables (migrations 001-009 applied), real SQL, real transactions.
// No provider/SMS doubles are involved: auth is a seeded session row.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { postgresSql } from '../src/database.ts';

const DATABASE_URL = process.env.KG_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55444/kgtest';
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const parsed = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('KG_TEST_DATABASE_URL must point at a loopback database');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const app = buildApp(postgresSql(pool), 'integration-quotes', {});

const EXPERT = { id: randomUUID(), token: 'Q'.repeat(43) };
const CUSTOMER = { id: randomUUID(), token: 'R'.repeat(43) };
const OUTSIDER = { id: randomUUID(), token: 'S'.repeat(43) };
const LEDGER = randomUUID();
const created = { quotes: [] as string[], agreements: [] as string[] };

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

async function seedMember(member: { id: string; token: string }, nickname: string, expert: boolean) {
  const principalId = randomUUID();
  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest,expert_active)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [member.id, principalId, nickname, `${nickname}@dev.invalid`, nickname, sha(`q-${nickname}`), expert],
  );
  await pool.query(
    `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
     VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`,
    [randomUUID(), member.id, sha(member.token), sha(`r-${member.token}`), randomUUID()],
  );
}

async function propose(payload: Record<string, unknown> = {}, actor = EXPERT) {
  return app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/quotes`, headers: auth(actor.token),
    payload: { amount: 350000, message: '욕실 타일 교체 2일', expiresAt: later(60), ...payload },
  });
}

before(async () => {
  await pool.query(`TRUNCATE kg_membership.quote_transitions, kg_membership.quotes, kg_membership.audit_log,
    kg_membership.agreements, kg_membership.ledger_notes, kg_membership.ledgers, kg_membership.role_grants,
    kg_membership.consent_events, kg_membership.notification_preferences, kg_membership.sessions,
    kg_membership.sms_challenges, kg_membership.registration_tickets, kg_membership.oauth_flows,
    kg_membership.social_links, kg_membership.restrictions, kg_membership.members,
    kg_membership.principals CASCADE`);

  await seedMember(EXPERT, '고수Q', true);
  await seedMember(CUSTOMER, '고객R', false);
  await seedMember(OUTSIDER, '제3자S', false);
  await pool.query(
    `INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id) VALUES($1,$2,$3)`,
    [LEDGER, EXPERT.id, CUSTOMER.id],
  );
});

after(async () => {
  // Remove everything this suite created, then close resources.
  await pool.query(`DELETE FROM kg_membership.quote_transitions WHERE quote_id = ANY($1::uuid[])`, [created.quotes]);
  await pool.query(`DELETE FROM kg_membership.quotes WHERE id = ANY($1::uuid[])`, [created.quotes]);
  await pool.query(`DELETE FROM kg_membership.agreements WHERE ledger_id=$1`, [LEDGER]);
  await pool.query(`DELETE FROM kg_membership.ledger_notes WHERE ledger_id=$1`, [LEDGER]);
  await pool.query(`DELETE FROM kg_membership.ledgers WHERE id=$1`, [LEDGER]);
  await pool.query(`DELETE FROM kg_membership.audit_log WHERE actor_member_id = ANY($1::uuid[])`,
    [[EXPERT.id, CUSTOMER.id, OUTSIDER.id]]);
  await pool.query(`DELETE FROM kg_membership.sessions WHERE member_id = ANY($1::uuid[])`,
    [[EXPERT.id, CUSTOMER.id, OUTSIDER.id]]);
  await pool.query(`DELETE FROM kg_membership.members WHERE id = ANY($1::uuid[])`,
    [[EXPERT.id, CUSTOMER.id, OUTSIDER.id]]);
  await pool.query(`DELETE FROM kg_membership.principals WHERE id NOT IN (SELECT principal_id FROM kg_membership.members)`);
  const residue = (await pool.query(
    `SELECT (SELECT count(*)::int FROM kg_membership.quotes) AS quotes,
            (SELECT count(*)::int FROM kg_membership.agreements) AS agreements,
            (SELECT count(*)::int FROM kg_membership.members) AS members`,
  )).rows[0];
  assert.deepEqual(residue, { quotes: 0, agreements: 0, members: 0 }, 'the suite must leave no test data behind');
  await app.close();
  await pool.end();
});

test('non-participants cannot create, list or respond to quotes', async () => {
  const foreignCreate = await propose({}, OUTSIDER);
  assert.equal(foreignCreate.statusCode, 404, 'a stranger must not learn the ledger exists');
  assert.equal(foreignCreate.json().error.code, 'LEDGER_NOT_FOUND');

  const foreignList = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/quotes`, headers: auth(OUTSIDER.token) });
  assert.equal(foreignList.statusCode, 404);

  const customerCreate = await propose({}, CUSTOMER);
  assert.equal(customerCreate.statusCode, 403, 'only the expert prices their own customer');
  assert.equal(customerCreate.json().error.code, 'EXPERT_ONLY');

  const unknownQuote = await app.inject({
    method: 'POST', url: `/v1/quotes/${randomUUID()}/respond`, headers: auth(CUSTOMER.token),
    payload: { action: 'accept', expectedVersion: 1 },
  });
  assert.equal(unknownQuote.statusCode, 404);
});

test('expert proposes a quote and the server records the transition', async () => {
  const response = await propose({ scheduleAt: later(60 * 24) });
  assert.equal(response.statusCode, 201);
  const quote = response.json();
  created.quotes.push(quote.id);
  assert.equal(quote.status, 'PROPOSED');
  assert.equal(quote.version, 1);
  assert.equal(quote.amount, 350000);
  assert.equal(quote.ledgerId, LEDGER);
  assert.equal(quote.expertMemberId, EXPERT.id);
  assert.equal(quote.customerMemberId, CUSTOMER.id);
  assert.equal(quote.agreementId, null);

  const row = (await pool.query(
    `SELECT status, amount, version::int AS version, message FROM kg_membership.quotes WHERE id=$1`, [quote.id],
  )).rows[0];
  assert.equal(row.status, 'PROPOSED');
  assert.equal(row.amount, 350000);

  const transitions = (await pool.query(
    `SELECT from_status, to_status FROM kg_membership.quote_transitions WHERE quote_id=$1 ORDER BY id`, [quote.id],
  )).rows;
  assert.deepEqual(transitions, [{ from_status: null, to_status: 'PROPOSED' }]);

  const auditRow = (await pool.query(
    `SELECT action, target_type FROM kg_membership.audit_log WHERE target_id=$1 ORDER BY id`, [quote.id],
  )).rows[0];
  assert.equal(auditRow.action, 'QUOTE_PROPOSED');
  assert.equal(auditRow.target_type, 'quote');

  const listed = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/quotes`, headers: auth(CUSTOMER.token) });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().quotes.some((q: { id: string }) => q.id === quote.id), true, 'the customer sees the quote');
});

test('client-supplied status, amount or confirmation flags are rejected, not trusted', async () => {
  const forgedCreate = await propose({ status: 'COMPLETED', amount: 1 });
  assert.equal(forgedCreate.statusCode, 400);
  assert.equal(forgedCreate.json().error.code, 'INVALID_REQUEST');

  const quote = (await propose()).json();
  created.quotes.push(quote.id);

  for (const payload of [
    { action: 'accept', expectedVersion: 1, status: 'ACCEPTED' },
    { action: 'accept', expectedVersion: 1, amount: 1 },
    { action: 'accept', expectedVersion: 1, customerConfirmedAt: later(1) },
  ]) {
    const forged = await app.inject({
      method: 'POST', url: `/v1/quotes/${quote.id}/respond`, headers: auth(CUSTOMER.token), payload,
    });
    assert.equal(forged.statusCode, 400, JSON.stringify(payload));
  }
  const stored = (await pool.query(`SELECT status FROM kg_membership.quotes WHERE id=$1`, [quote.id])).rows[0];
  assert.equal(stored.status, 'PROPOSED', 'rejected requests must not change state');
});

test('expired quotes cannot be accepted', async () => {
  const id = randomUUID();
  created.quotes.push(id);
  await pool.query(
    `INSERT INTO kg_membership.quotes(id,ledger_id,expert_member_id,customer_member_id,amount,message,expires_at,created_at)
     VALUES($1,$2,$3,$4,$5,$6,now()-interval '1 hour',now()-interval '2 hours')`,
    [id, LEDGER, EXPERT.id, CUSTOMER.id, 120000, '만료된 견적'],
  );
  const response = await app.inject({
    method: 'POST', url: `/v1/quotes/${id}/respond`, headers: auth(CUSTOMER.token),
    payload: { action: 'accept', expectedVersion: 1 },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'QUOTE_EXPIRED');

  const stored = (await pool.query(`SELECT status, agreement_id FROM kg_membership.quotes WHERE id=$1`, [id])).rows[0];
  assert.equal(stored.status, 'EXPIRED');
  assert.equal(stored.agreement_id, null, 'an expired quote must not create an agreement');

  const transitions = (await pool.query(
    `SELECT to_status FROM kg_membership.quote_transitions WHERE quote_id=$1 ORDER BY id`, [id],
  )).rows.map(r => r.to_status);
  assert.ok(transitions.includes('EXPIRED'));

  const listed = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/quotes`, headers: auth(EXPERT.token) });
  const listedRow = listed.json().quotes.find((q: { id: string }) => q.id === id);
  assert.equal(listedRow.effectiveStatus, 'EXPIRED', 'a past-deadline PROPOSED quote must not read as live');
});

test('rejection is terminal: accept or complete afterwards fails with 409', async () => {
  const quote = (await propose()).json();
  created.quotes.push(quote.id);

  const rejected = await app.inject({
    method: 'POST', url: `/v1/quotes/${quote.id}/respond`, headers: auth(CUSTOMER.token),
    payload: { action: 'reject', expectedVersion: 1 },
  });
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.json().status, 'REJECTED');
  assert.ok(rejected.json().rejectedAt);
  assert.equal(rejected.json().version, 2);

  const acceptAgain = await app.inject({
    method: 'POST', url: `/v1/quotes/${quote.id}/respond`, headers: auth(CUSTOMER.token),
    payload: { action: 'accept', expectedVersion: 2 },
  });
  assert.equal(acceptAgain.statusCode, 409);
  assert.equal(acceptAgain.json().error.code, 'INVALID_TRANSITION');

  const completeAfterReject = await app.inject({
    method: 'POST', url: `/v1/quotes/${quote.id}/complete`, headers: auth(EXPERT.token),
    payload: { expectedVersion: 2 },
  });
  assert.equal(completeAfterReject.statusCode, 409);
  assert.equal(completeAfterReject.json().error.code, 'INVALID_TRANSITION');
});

test('acceptance creates the agreement, and completion needs both sides', async () => {
  const quote = (await propose()).json();
  created.quotes.push(quote.id);

  const expertAccept = await app.inject({
    method: 'POST', url: `/v1/quotes/${quote.id}/respond`, headers: auth(EXPERT.token),
    payload: { action: 'accept', expectedVersion: 1 },
  });
  assert.equal(expertAccept.statusCode, 403, 'only the customer responds to a quote');
  assert.equal(expertAccept.json().error.code, 'CUSTOMER_ONLY');

  const accepted = await app.inject({
    method: 'POST', url: `/v1/quotes/${quote.id}/respond`, headers: auth(CUSTOMER.token),
    payload: { action: 'accept', expectedVersion: 1 },
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().status, 'ACCEPTED');
  assert.ok(accepted.json().acceptedAt);
  const agreementId = accepted.json().agreementId;
  assert.ok(agreementId, 'acceptance must materialise the agreement');
  created.agreements.push(agreementId);

  const agreement = (await pool.query(
    `SELECT status, completed_at FROM kg_membership.agreements WHERE id=$1`, [agreementId],
  )).rows[0];
  assert.equal(agreement.status, 'ACCEPTED');
  assert.equal(agreement.completed_at, null);

  // One side only: still ACCEPTED, never completed.
  const customerConfirm = await app.inject({
    method: 'POST', url: `/v1/quotes/${quote.id}/complete`, headers: auth(CUSTOMER.token),
    payload: { expectedVersion: 2 },
  });
  assert.equal(customerConfirm.statusCode, 200);
  assert.equal(customerConfirm.json().status, 'ACCEPTED');
  assert.ok(customerConfirm.json().customerConfirmedAt);
  assert.equal(customerConfirm.json().expertConfirmedAt, null);
  assert.equal(customerConfirm.json().completedAt, null);

  const afterOneSide = (await pool.query(
    `SELECT status FROM kg_membership.quotes WHERE id=$1`, [quote.id],
  )).rows[0];
  assert.equal(afterOneSide.status, 'ACCEPTED', 'one confirmation must not complete the trade');

  const duplicate = await app.inject({
    method: 'POST', url: `/v1/quotes/${quote.id}/complete`, headers: auth(CUSTOMER.token),
    payload: { expectedVersion: 3 },
  });
  assert.equal(duplicate.statusCode, 409, 'the same side cannot confirm twice');

  const expertConfirm = await app.inject({
    method: 'POST', url: `/v1/quotes/${quote.id}/complete`, headers: auth(EXPERT.token),
    payload: { expectedVersion: 3 },
  });
  assert.equal(expertConfirm.statusCode, 200);
  assert.equal(expertConfirm.json().status, 'COMPLETED');
  assert.ok(expertConfirm.json().completedAt);
  assert.equal(expertConfirm.json().expertConfirmedAt !== null, true);

  const finalAgreement = (await pool.query(
    `SELECT status, completed_at IS NOT NULL AS done FROM kg_membership.agreements WHERE id=$1`, [agreementId],
  )).rows[0];
  assert.equal(finalAgreement.status, 'COMPLETED');
  assert.equal(finalAgreement.done, true);

  const transitions = (await pool.query(
    `SELECT to_status FROM kg_membership.quote_transitions WHERE quote_id=$1 ORDER BY id`, [quote.id],
  )).rows.map(r => r.to_status);
  assert.deepEqual(transitions, ['PROPOSED', 'ACCEPTED', 'COMPLETED']);
});

test('every transition is present in audit_log', async () => {
  const rows = (await pool.query(
    `SELECT action, target_id FROM kg_membership.audit_log WHERE target_type='quote' ORDER BY id`,
  )).rows;
  const actions = new Set(rows.map(r => String(r.action)));
  for (const expected of ['QUOTE_PROPOSED', 'QUOTE_ACCEPTED', 'QUOTE_REJECTED', 'QUOTE_EXPIRED',
    'QUOTE_COMPLETION_CONFIRMED', 'QUOTE_COMPLETED']) {
    assert.ok(actions.has(expected), `audit_log is missing ${expected}`);
  }
  assert.ok(rows.every(r => r.target_id), 'each audit row must point at a quote');
});

test('an expert lists the quotes they received across every ledger', async () => {
  const mine = await app.inject({
    method: 'GET', url: '/v1/me/quotes', headers: auth(EXPERT.token),
  });
  assert.equal(mine.statusCode, 200);
  const quotes = mine.json().quotes;
  assert.ok(Array.isArray(quotes) && quotes.length > 0, 'expert inbox must not be empty');
  assert.ok(quotes.every(q => q.expertMemberId === EXPERT.id), 'only own quotes');
  assert.ok(quotes[0].customerNickname, 'the inbox needs the customer name');
  assert.ok(typeof quotes[0].version === 'number' && quotes[0].version > 0);

  const newestFirst = quotes.every((q, i) => i === 0 || new Date(quotes[i - 1].createdAt) >= new Date(q.createdAt));
  assert.ok(newestFirst, 'newest first');

  const filtered = await app.inject({
    method: 'GET', url: '/v1/me/quotes?status=PROPOSED', headers: auth(EXPERT.token),
  });
  assert.equal(filtered.statusCode, 200);
  assert.ok(filtered.json().quotes.every(q => q.status === 'PROPOSED'));

  const anonymous = await app.inject({ method: 'GET', url: '/v1/me/quotes' });
  assert.equal(anonymous.statusCode, 401);
});
