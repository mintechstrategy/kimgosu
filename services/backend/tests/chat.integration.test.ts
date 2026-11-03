// Ledger chat storage + paging integration test against real PostgreSQL.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest_ws15 \
//     node --test tests/chat.integration.test.ts
//
// The test refuses to run against a non-loopback database and truncates the
// tables it uses. Never point KG_TEST_DATABASE_URL at Railway.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { postgresSql } from '../src/database.ts';

const DATABASE_URL = process.env.KG_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/kgtest_ws15';
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const parsed = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('KG_TEST_DATABASE_URL must point at a loopback database');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const app = buildApp(postgresSql(pool), 'integration-chat', {});

const EXPERT = { id: randomUUID(), token: 'X'.repeat(43) };
const CUSTOMER = { id: randomUUID(), token: 'Y'.repeat(43) };
const OUTSIDER = { id: randomUUID(), token: 'Z'.repeat(43) };
const LEDGER = randomUUID();
const OTHER_LEDGER = randomUUID();

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function seedMember(member: { id: string; token: string }, nickname: string, expert: boolean) {
  const principalId = randomUUID();
  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest,expert_active)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [member.id, principalId, nickname, `${nickname}@dev.invalid`, nickname.slice(0, 10), sha(`p-${nickname}`), expert],
  );
  await pool.query(
    `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
     VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`,
    [randomUUID(), member.id, sha(member.token), sha('r-' + member.token), randomUUID()],
  );
}

before(async () => {
  await pool.query(`TRUNCATE kg_membership.chat_messages, kg_membership.ledger_notes, kg_membership.agreements,
    kg_membership.ledgers, kg_membership.audit_log, kg_membership.role_grants, kg_membership.consent_events,
    kg_membership.notification_preferences, kg_membership.sessions, kg_membership.sms_challenges,
    kg_membership.registration_tickets, kg_membership.oauth_flows, kg_membership.social_links,
    kg_membership.restrictions, kg_membership.members, kg_membership.principals CASCADE`);

  await seedMember(EXPERT, '고수챗', true);
  await seedMember(CUSTOMER, '고객챗', false);
  await seedMember(OUTSIDER, '제3자챗', false);

  await pool.query(
    `INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id) VALUES($1,$2,$3)`,
    [LEDGER, EXPERT.id, CUSTOMER.id],
  );
  // A second ledger that does not involve OUTSIDER either, used as a foreign cursor.
  await pool.query(
    `INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id) VALUES($1,$2,$3)`,
    [OTHER_LEDGER, EXPERT.id, OUTSIDER.id],
  );
});

after(async () => {
  await pool.query(`DELETE FROM kg_membership.chat_messages`);
  await app.close();
  await pool.end();
});

test('비참여자는 조회·전송 모두 404 (원장 존재 은닉)', async () => {
  const list = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(OUTSIDER.token) });
  assert.equal(list.statusCode, 404);
  assert.equal(list.json().error.code, 'LEDGER_NOT_FOUND');

  const send = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(OUTSIDER.token),
    payload: { body: '무단 메시지' },
  });
  assert.equal(send.statusCode, 404);
  assert.equal(send.json().error.code, 'LEDGER_NOT_FOUND');

  const stored = await pool.query(`SELECT count(*)::int AS n FROM kg_membership.chat_messages WHERE ledger_id=$1`, [LEDGER]);
  assert.equal(stored.rows[0].n, 0, 'a rejected send must not persist');

  const anonymous = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages` });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().error.code, 'AUTH_REQUIRED');

  const unknownLedger = await app.inject({ method: 'GET', url: `/v1/ledgers/${randomUUID()}/messages`, headers: bearer(EXPERT.token) });
  assert.equal(unknownLedger.statusCode, 404);
});

test('2001자는 400, 빈 문자열·공백만 본문도 400', async () => {
  for (const [label, body] of [['2001자', '가'.repeat(2001)], ['빈 문자열', ''], ['공백만', '   ']] as const) {
    const res = await app.inject({
      method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token),
      payload: { body },
    });
    assert.equal(res.statusCode, 400, label);
  }
  const stored = await pool.query(`SELECT count(*)::int AS n FROM kg_membership.chat_messages`);
  assert.equal(stored.rows[0].n, 0, 'rejected bodies must not be stored');

  // Exactly 2000 characters is allowed.
  const ok = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token),
    payload: { body: '가'.repeat(2000) },
  });
  assert.equal(ok.statusCode, 201);
  await pool.query(`DELETE FROM kg_membership.chat_messages WHERE id=$1`, [ok.json().id]);
});

test('전송 → 재조회로 영속성과 참여자 양방향 전송이 확인된다', async () => {
  const sent = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token),
    payload: { body: '안녕하세요, 고수입니다.' },
  });
  assert.equal(sent.statusCode, 201);
  const message = sent.json();
  assert.equal(message.ledgerId, LEDGER);
  assert.equal(message.senderId, EXPERT.id);
  assert.equal(message.body, '안녕하세요, 고수입니다.');
  assert.equal(message.readAt, null);
  assert.equal(message.deletedAt, null);
  assert.ok(message.createdAt);

  // The customer is the other participant and may also write.
  const reply = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(CUSTOMER.token),
    payload: { body: '네, 감사합니다.' },
  });
  assert.equal(reply.statusCode, 201);
  assert.equal(reply.json().senderId, CUSTOMER.id);

  const row = (await pool.query(
    `SELECT sender_id, body, read_at, deleted_at FROM kg_membership.chat_messages WHERE id=$1`, [message.id],
  )).rows[0];
  assert.equal(row.sender_id, EXPERT.id);
  assert.equal(row.body, '안녕하세요, 고수입니다.');
  assert.equal(row.read_at, null);
  assert.equal(row.deleted_at, null, 'no deletion path may be exercised implicitly');

  const reread = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token) });
  assert.equal(reread.statusCode, 200);
  const bodies = reread.json().messages.map((m: { body: string }) => m.body);
  assert.deepEqual(bodies, ['네, 감사합니다.', '안녕하세요, 고수입니다.']);
});

test('before 커서 페이지네이션이 중복·누락 없이 동작한다 (동일 시각 포함)', async () => {
  await pool.query(`DELETE FROM kg_membership.chat_messages WHERE ledger_id=$1`, [LEDGER]);

  // 12 rows. Three of them share one timestamp so the id tiebreak is exercised;
  // the rest are one second apart in a fixed, monotonic sequence.
  const seeded: string[] = [];
  const base = new Date('2026-11-03T00:00:00.000Z');
  for (let i = 0; i < 12; i += 1) {
    const id = randomUUID();
    const createdAt = i >= 3 && i <= 5 ? new Date(base.getTime() + 3000) : new Date(base.getTime() + i * 1000);
    await pool.query(
      `INSERT INTO kg_membership.chat_messages(id,ledger_id,sender_id,body,created_at) VALUES($1,$2,$3,$4,$5)`,
      [id, LEDGER, i % 2 === 0 ? EXPERT.id : CUSTOMER.id, `메시지 ${i}`, createdAt],
    );
    seeded.push(id);
  }

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const url: string = `/v1/ledgers/${LEDGER}/messages?limit=5${cursor ? `&before=${cursor}` : ''}`;
    const res = await app.inject({ method: 'GET', url, headers: bearer(EXPERT.token) });
    assert.equal(res.statusCode, 200, `page ${page}`);
    const body = res.json();
    assert.ok(body.messages.length <= 5);
    seen.push(...body.messages.map((m: { id: string }) => m.id));
    cursor = body.nextCursor;
    if (!cursor) break;
  }

  assert.equal(cursor, null, 'the last page must not advertise another cursor');
  assert.equal(seen.length, 12, 'every row is returned exactly once');
  assert.equal(new Set(seen).size, 12, 'no duplicates across pages');
  assert.deepEqual(new Set(seen), new Set(seeded), 'no row is skipped');

  // Ordering is newest-first by (created_at, id). The three rows that share one
  // timestamp are therefore contiguous but have no fixed internal order, so the
  // assertion is: the newest row comes first, every older row follows in
  // created_at order, and the tied group stays contiguous.
  const first = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages?limit=100`, headers: bearer(EXPERT.token) });
  const full = first.json().messages as Array<{ id: string; body: string }>;
  const indexOf = (m: { body: string }) => Number(String(m.body).replace('메시지 ', ''));
  assert.equal(indexOf(full[0]!), 11);
  const tied = new Set([3, 4, 5]);
  const tiedPositions = full.map((m, i) => (tied.has(indexOf(m)) ? i : -1)).filter(i => i >= 0);
  assert.equal(tiedPositions.length, 3);
  assert.equal(tiedPositions[2]! - tiedPositions[0]!, 2, 'same-timestamp rows must stay contiguous');
  const rest = full.filter(m => !tied.has(indexOf(m))).map(indexOf);
  assert.deepEqual(rest, [11, 10, 9, 8, 7, 6, 2, 1, 0]);
  assert.equal(first.json().nextCursor, null);
});

test('limit 상한은 100이고 범위를 벗어나면 400', async () => {
  const tooBig = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages?limit=101`, headers: bearer(EXPERT.token) });
  assert.equal(tooBig.statusCode, 400);
  assert.equal(tooBig.json().error.code, 'INVALID_LIMIT');

  const zero = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages?limit=0`, headers: bearer(EXPERT.token) });
  assert.equal(zero.statusCode, 400);

  const max = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages?limit=100`, headers: bearer(EXPERT.token) });
  assert.equal(max.statusCode, 200);
  assert.equal(max.json().messages.length, 12);
});

test('알 수 없거나 다른 원장의 커서는 400 INVALID_CURSOR', async () => {
  const foreign = await app.inject({
    method: 'POST', url: `/v1/ledgers/${OTHER_LEDGER}/messages`, headers: bearer(EXPERT.token),
    payload: { body: '다른 원장 메시지' },
  });
  assert.equal(foreign.statusCode, 201);

  const crossLedger = await app.inject({
    method: 'GET', url: `/v1/ledgers/${LEDGER}/messages?before=${foreign.json().id}`, headers: bearer(EXPERT.token),
  });
  assert.equal(crossLedger.statusCode, 400);
  assert.equal(crossLedger.json().error.code, 'INVALID_CURSOR');

  const unknown = await app.inject({
    method: 'GET', url: `/v1/ledgers/${LEDGER}/messages?before=${randomUUID()}`, headers: bearer(EXPERT.token),
  });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.json().error.code, 'INVALID_CURSOR');
});

test('삭제 API는 OPEN — 삭제 엔드포인트가 존재하지 않는다', async () => {
  const id = (await pool.query(`SELECT id FROM kg_membership.chat_messages WHERE ledger_id=$1 LIMIT 1`, [LEDGER])).rows[0].id;
  for (const method of ['DELETE', 'PATCH'] as const) {
    const res = await app.inject({ method, url: `/v1/ledgers/${LEDGER}/messages/${id}`, headers: bearer(EXPERT.token) });
    assert.equal(res.statusCode, 404, `${method} must not be implemented`);
    assert.equal(res.json().error.code, 'ROUTE_NOT_FOUND');
  }
  const deleted = await pool.query(`SELECT count(*)::int AS n FROM kg_membership.chat_messages WHERE deleted_at IS NOT NULL`);
  assert.equal(deleted.rows[0].n, 0, 'nothing may soft-delete a message until the policy is decided');
});
