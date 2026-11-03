// WS-24 quote terms: price type (HOURLY/TOTAL), VAT handling and the 7/30-day
// validity window, against real PostgreSQL.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55924/kgtest \
//     node --test tests/quote-terms.integration.test.ts
//
// Migrations 001-011 plus 013_quote_terms.sql must be applied. The suite seeds
// its own members/ledger and deletes everything it created.

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
const app = buildApp(postgresSql(pool), 'integration-quote-terms', {});

const EXPERT = { id: randomUUID(), token: 'T'.repeat(43) };
const CUSTOMER = { id: randomUUID(), token: 'U'.repeat(43) };
const LEDGER = randomUUID();
const created = { quotes: [] as string[] };

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

async function seedMember(member: { id: string; token: string }, nickname: string, expert: boolean) {
  const principalId = randomUUID();
  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest,expert_active)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [member.id, principalId, nickname, `${nickname}@dev.invalid`, nickname, sha(`qt-${nickname}`), expert],
  );
  await pool.query(
    `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
     VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`,
    [randomUUID(), member.id, sha(member.token), sha(`r-${member.token}`), randomUUID()],
  );
}

async function propose(payload: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/quotes`, headers: auth(EXPERT.token),
    payload: { amount: 350000, message: '욕실 타일 교체 2일', ...payload },
  });
  if (response.statusCode === 201) created.quotes.push(response.json().id);
  return response;
}

/**
 * The API replies from inside its transaction (commit happens just after the
 * response is handed back), so an immediate read on another connection can
 * legitimately see the previous state. Poll briefly instead of racing.
 */
async function rowEventually(query: string, params: unknown[], ms = 2_000): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const row = (await pool.query(query, params)).rows[0];
    if (row) return row;
    if (Date.now() > deadline) return undefined;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function listEventually(actorToken: string, id: string): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const listed = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/quotes`, headers: auth(actorToken) });
    const row = listed.json().quotes.find((q: { id: string }) => q.id === id);
    if (row) return row;
    if (Date.now() > deadline) return undefined;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

before(async () => {
  await pool.query(`TRUNCATE kg_membership.quote_transitions, kg_membership.quotes, kg_membership.audit_log,
    kg_membership.agreements, kg_membership.ledger_notes, kg_membership.ledgers, kg_membership.role_grants,
    kg_membership.consent_events, kg_membership.notification_preferences, kg_membership.sessions,
    kg_membership.sms_challenges, kg_membership.registration_tickets, kg_membership.oauth_flows,
    kg_membership.social_links, kg_membership.restrictions, kg_membership.members,
    kg_membership.principals CASCADE`);
  await seedMember(EXPERT, '고수T', true);
  await seedMember(CUSTOMER, '고객U', false);
  await pool.query(
    `INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id) VALUES($1,$2,$3)`,
    [LEDGER, EXPERT.id, CUSTOMER.id],
  );
});

after(async () => {
  await pool.query(`DELETE FROM kg_membership.quote_transitions WHERE quote_id = ANY($1::uuid[])`, [created.quotes]);
  await pool.query(`DELETE FROM kg_membership.quotes WHERE id = ANY($1::uuid[])`, [created.quotes]);
  await pool.query(`DELETE FROM kg_membership.agreements WHERE ledger_id=$1`, [LEDGER]);
  await pool.query(`DELETE FROM kg_membership.ledger_notes WHERE ledger_id=$1`, [LEDGER]);
  await pool.query(`DELETE FROM kg_membership.ledgers WHERE id=$1`, [LEDGER]);
  await pool.query(`DELETE FROM kg_membership.audit_log WHERE actor_member_id = ANY($1::uuid[])`, [[EXPERT.id, CUSTOMER.id]]);
  await pool.query(`DELETE FROM kg_membership.sessions WHERE member_id = ANY($1::uuid[])`, [[EXPERT.id, CUSTOMER.id]]);
  await pool.query(`DELETE FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [[EXPERT.id, CUSTOMER.id]]);
  await pool.query(`DELETE FROM kg_membership.principals WHERE id NOT IN (SELECT principal_id FROM kg_membership.members)`);
  const residue = (await pool.query(
    `SELECT (SELECT count(*)::int FROM kg_membership.quotes) AS quotes,
            (SELECT count(*)::int FROM kg_membership.members) AS members`,
  )).rows[0];
  assert.deepEqual(residue, { quotes: 0, members: 0 }, 'the suite must leave no test data behind');
  await app.close();
  await pool.end();
});

test('expires_at is optional and defaults to 7 days from the request', async () => {
  const before = Date.now();
  const response = await propose();
  assert.equal(response.statusCode, 201, response.body);
  const quote = response.json();
  const expires = new Date(quote.expiresAt).getTime();
  assert.ok(expires >= before + 7 * DAY - 5_000, 'default expiry must not be shorter than 7 days');
  assert.ok(expires <= Date.now() + 7 * DAY + 5_000, 'default expiry must not exceed 7 days');

  const stored = await rowEventually(
    `SELECT expires_at AS "expiresAt", created_at AS "createdAt" FROM kg_membership.quotes WHERE id=$1`, [quote.id],
  );
  assert.ok(stored, 'the quote must be persisted');
  const window = new Date(String(stored.expiresAt)).getTime() - new Date(String(stored.createdAt)).getTime();
  assert.ok(Math.abs(window - 7 * DAY) < 5_000, `stored window was ${window}ms`);
});

test('a validity window longer than 30 days is rejected, 30 days is accepted', async () => {
  const tooLong = await propose({ expiresAt: at(31 * DAY) });
  assert.equal(tooLong.statusCode, 400);
  assert.equal(tooLong.json().error.code, 'EXPIRY_EXCEEDS_MAX_TTL');

  const wayTooLong = await propose({ expiresAt: at(365 * DAY) });
  assert.equal(wayTooLong.statusCode, 400);

  const justUnder = await propose({ expiresAt: at(30 * DAY - 60_000) });
  assert.equal(justUnder.statusCode, 201, justUnder.body);

  const past = await propose({ expiresAt: at(-60_000) });
  assert.equal(past.statusCode, 400);
  assert.equal(past.json().error.code, 'INVALID_EXPIRY');

  // A rejected request must not write a row.
  const rows = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.quotes WHERE ledger_id=$1`, [LEDGER],
  )).rows[0];
  assert.equal(rows.n, created.quotes.length, 'rejected expiries must not persist a quote');
});

test('HOURLY requires hourly_rate and TOTAL must not carry one', async () => {
  const missing = await propose({ priceType: 'HOURLY' });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, 'HOURLY_RATE_REQUIRED');

  const hourly = await propose({ priceType: 'HOURLY', hourlyRate: 50000, amount: 200000 });
  assert.equal(hourly.statusCode, 201, hourly.body);
  assert.equal(hourly.json().priceType, 'HOURLY');
  assert.equal(hourly.json().hourlyRate, 50000);
  assert.equal(hourly.json().amount, 200000);

  const stored = await rowEventually(
    `SELECT price_type, hourly_rate, vat_included FROM kg_membership.quotes WHERE id=$1`, [hourly.json().id],
  );
  assert.deepEqual(stored, { price_type: 'HOURLY', hourly_rate: 50000, vat_included: false });

  const stray = await propose({ priceType: 'TOTAL', hourlyRate: 50000 });
  assert.equal(stray.statusCode, 400);
  assert.equal(stray.json().error.code, 'HOURLY_RATE_NOT_ALLOWED');

  const badRate = await propose({ priceType: 'HOURLY', hourlyRate: 0 });
  assert.equal(badRate.statusCode, 400, 'a zero rate is not a rate');
});

test('VAT is computed server-side and quoted separately by default', async () => {
  const response = await propose({ amount: 1000000 });
  assert.equal(response.statusCode, 201, response.body);
  const quote = response.json();
  assert.equal(quote.vatIncluded, false);
  assert.equal(quote.vatRate, 0.1);
  assert.equal(quote.currency, 'KRW');
  assert.equal(quote.supplyAmount, 1000000);
  assert.equal(quote.vatAmount, 100000, '1,000,000원의 부가세는 100,000원');
  assert.equal(quote.totalAmount, 1100000, '합계는 1,100,000원');

  // The same numbers must come back from the list endpoint (single source).
  const listedRow = await listEventually(CUSTOMER.token, quote.id);
  assert.ok(listedRow, 'the customer must see the quote');
  assert.equal(listedRow.supplyAmount, 1000000);
  assert.equal(listedRow.vatAmount, 100000);
  assert.equal(listedRow.totalAmount, 1100000);

  // vatIncluded=true means the amount is already the payable total.
  const inclusive = await propose({ amount: 1100000, vatIncluded: true });
  assert.equal(inclusive.statusCode, 201, inclusive.body);
  assert.equal(inclusive.json().supplyAmount, 1000000);
  assert.equal(inclusive.json().vatAmount, 100000);
  assert.equal(inclusive.json().totalAmount, 1100000);
  const storedInclusive = await rowEventually(
    `SELECT vat_included FROM kg_membership.quotes WHERE id=$1`, [inclusive.json().id],
  );
  assert.deepEqual(storedInclusive, { vat_included: true }, 'the VAT flag must be persisted, not just echoed');
});

test('client-supplied derived amounts are rejected instead of trusted', async () => {
  for (const payload of [
    { totalAmount: 1 },
    { vatAmount: 0 },
    { supplyAmount: 1 },
    { vatRate: 0 },
    { currency: 'USD' },
  ]) {
    const response = await propose(payload);
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.equal(response.json().error.code, 'INVALID_REQUEST');
  }
});

test('acceptance summary states the VAT basis and the payable total', async () => {
  const quote = (await propose({ amount: 1000000 })).json();
  const accepted = await app.inject({
    method: 'POST', url: `/v1/quotes/${quote.id}/respond`, headers: auth(CUSTOMER.token),
    payload: { action: 'accept', expectedVersion: 1 },
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().status, 'ACCEPTED');
  assert.equal(accepted.json().totalAmount, 1100000, 'the respond response keeps the derived amounts');

  const agreement = await rowEventually(
    `SELECT summary FROM kg_membership.agreements WHERE id=$1`, [accepted.json().agreementId],
  );
  assert.ok(agreement, 'acceptance must persist an agreement');
  assert.match(String(agreement.summary), /1,100,000원/);
  assert.match(String(agreement.summary), /부가세 별도/);
});

test('rows written before the migration read back as TOTAL / VAT-excluded', async () => {
  const id = randomUUID();
  created.quotes.push(id);
  await pool.query(
    `INSERT INTO kg_membership.quotes(id,ledger_id,expert_member_id,customer_member_id,amount,message,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,now()+interval '2 days')`,
    [id, LEDGER, EXPERT.id, CUSTOMER.id, 120000, '구 규칙으로 생성된 견적'],
  );
  const listed = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/quotes`, headers: auth(EXPERT.token) });
  const row = listed.json().quotes.find((q: { id: string }) => q.id === id);
  assert.equal(row.priceType, 'TOTAL');
  assert.equal(row.vatIncluded, false);
  assert.equal(row.hourlyRate, null);
  assert.equal(row.supplyAmount, 120000);
  assert.equal(row.vatAmount, 12000);
  assert.equal(row.totalAmount, 132000);
});

test('the database itself refuses an incoherent price type or expiry', async () => {
  const base = [randomUUID(), LEDGER, EXPERT.id, CUSTOMER.id, 100000, 'DB 제약 검증'] as const;

  await assert.rejects(
    pool.query(
      `INSERT INTO kg_membership.quotes(id,ledger_id,expert_member_id,customer_member_id,amount,message,expires_at,price_type)
       VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 day','HOURLY')`, [...base],
    ),
    /quote_hourly_rate_required/,
    'HOURLY without hourly_rate must not be storable',
  );

  await assert.rejects(
    pool.query(
      `INSERT INTO kg_membership.quotes(id,ledger_id,expert_member_id,customer_member_id,amount,message,expires_at,price_type)
       VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 day','MEETING')`, [...base],
    ),
    /quote_price_type_valid/,
    'only HOURLY and TOTAL are price types',
  );

  await assert.rejects(
    pool.query(
      `INSERT INTO kg_membership.quotes(id,ledger_id,expert_member_id,customer_member_id,amount,message,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,now()+interval '31 days')`, [...base],
    ),
    /quote_ttl_max_30_days/,
    'a 31-day validity window must not be storable',
  );
});
