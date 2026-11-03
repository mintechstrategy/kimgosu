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

test('본인 메시지 삭제 → 본인 조회에서 사라지고 deleted_at만 설정된다 (audit_log에 본문 없음)', async () => {
  await pool.query(`DELETE FROM kg_membership.chat_messages WHERE ledger_id=$1`, [LEDGER]);
  await pool.query(`DELETE FROM kg_membership.audit_log WHERE target_type='chat_message'`);

  const sent = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token),
    payload: { body: '삭제할 메시지' },
  });
  assert.equal(sent.statusCode, 201);
  assert.equal(sent.json().deleted, false);
  const id = sent.json().id;

  const res = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${id}`, headers: bearer(EXPERT.token) });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.id, id);
  assert.equal(body.senderId, EXPERT.id);
  assert.equal(body.deleted, true);
  assert.equal(body.body, null, '삭제 응답은 본문을 반환하지 않는다');
  assert.ok(body.deletedAt);

  const mine = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token) });
  assert.equal(mine.statusCode, 200);
  assert.deepEqual(mine.json().messages, [], '본인 조회에서 사라진다');
  assert.equal(mine.json().total, 0);

  // Soft delete only: the row and its text are retained (retention/restore is OPEN).
  const row = (await pool.query(
    `SELECT deleted_at, body, sender_id FROM kg_membership.chat_messages WHERE id=$1`, [id],
  )).rows[0];
  assert.ok(row.deleted_at, 'deleted_at이 설정된다');
  assert.equal(row.sender_id, EXPERT.id);
  assert.equal(row.body, '삭제할 메시지', '물리 삭제는 하지 않는다(보존 정책 OPEN)');

  const auditRows = (await pool.query(
    `SELECT actor_member_id, action, target_type, target_id, detail
       FROM kg_membership.audit_log WHERE action='MESSAGE_DELETED' ORDER BY id`,
  )).rows;
  assert.equal(auditRows.length, 1, '삭제 1건당 audit 1건');
  assert.equal(auditRows[0].actor_member_id, EXPERT.id);
  assert.equal(auditRows[0].target_type, 'chat_message');
  assert.equal(auditRows[0].target_id, id);
  assert.equal(auditRows[0].detail.ledgerId, LEDGER);
  assert.equal(JSON.stringify(auditRows[0].detail).includes('삭제할 메시지'), false, 'audit에 본문이 남지 않는다');
  assert.equal(JSON.stringify(auditRows[0]).includes('삭제할 메시지'), false);
});

test('상대방 조회에서는 삭제된 메시지가 deleted:true·body:null 자리로 남는다', async () => {
  await pool.query(`DELETE FROM kg_membership.chat_messages WHERE ledger_id=$1`, [LEDGER]);

  const kept = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token),
    payload: { body: '남는 메시지' },
  });
  const gone = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token),
    payload: { body: '지워질 메시지' },
  });
  const del = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${gone.json().id}`, headers: bearer(EXPERT.token) });
  assert.equal(del.statusCode, 200);

  const seen = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(CUSTOMER.token) });
  assert.equal(seen.statusCode, 200);
  const messages = seen.json().messages as Array<Record<string, unknown>>;
  assert.equal(messages.length, 2, '상대방에게는 자리가 유지된다');
  assert.equal(seen.json().total, 2);

  const tombstone = messages.find(m => m.id === gone.json().id)!;
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.body, null, '상대방에게 본문이 노출되지 않는다');
  assert.equal(tombstone.senderId, EXPERT.id);
  assert.ok(tombstone.deletedAt);
  assert.ok(tombstone.createdAt);

  const live = messages.find(m => m.id === kept.json().id)!;
  assert.equal(live.deleted, false);
  assert.equal(live.body, '남는 메시지');
});

test('타인 메시지는 403, 비참여자는 404, 다른 원장·없는 메시지는 404 (삭제는 무변경)', async () => {
  await pool.query(`DELETE FROM kg_membership.chat_messages WHERE ledger_id=$1`, [LEDGER]);

  const mine = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(CUSTOMER.token),
    payload: { body: '고객 메시지' },
  });
  const messageId = mine.json().id;

  const foreign = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${messageId}`, headers: bearer(EXPERT.token) });
  assert.equal(foreign.statusCode, 403);
  assert.equal(foreign.json().error.code, 'MESSAGE_NOT_OWNED');

  const outsider = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${messageId}`, headers: bearer(OUTSIDER.token) });
  assert.equal(outsider.statusCode, 404);
  assert.equal(outsider.json().error.code, 'LEDGER_NOT_FOUND', '비참여자에게 원장 존재를 알리지 않는다');

  const unknown = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${randomUUID()}`, headers: bearer(CUSTOMER.token) });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'MESSAGE_NOT_FOUND');

  // A message id that belongs to another ledger must not be deletable through this one.
  const other = await app.inject({
    method: 'POST', url: `/v1/ledgers/${OTHER_LEDGER}/messages`, headers: bearer(EXPERT.token),
    payload: { body: '다른 원장 소속' },
  });
  const crossLedger = await app.inject({
    method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${other.json().id}`, headers: bearer(EXPERT.token),
  });
  assert.equal(crossLedger.statusCode, 404);
  assert.equal(crossLedger.json().error.code, 'MESSAGE_NOT_FOUND');

  const untouched = (await pool.query(
    `SELECT deleted_at FROM kg_membership.chat_messages WHERE id = ANY($1::uuid[])`, [[messageId, other.json().id]],
  )).rows;
  assert.equal(untouched.length, 2);
  for (const row of untouched) assert.equal(row.deleted_at, null, '거부된 삭제는 아무것도 바꾸지 않는다');

  const anonymous = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${messageId}` });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().error.code, 'AUTH_REQUIRED');

  const notUuid = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/not-a-uuid`, headers: bearer(CUSTOMER.token) });
  assert.equal(notUuid.statusCode, 400);
  assert.equal(notUuid.json().error.code, 'INVALID_REQUEST');

  const patch = await app.inject({ method: 'PATCH', url: `/v1/ledgers/${LEDGER}/messages/${messageId}`, headers: bearer(CUSTOMER.token) });
  assert.equal(patch.statusCode, 404, '수정 엔드포인트는 만들지 않는다');
  assert.equal(patch.json().error.code, 'ROUTE_NOT_FOUND');
});

test('이미 삭제된 메시지 재삭제는 409 MESSAGE_ALREADY_DELETED (일관된 단일 선택)', async () => {
  await pool.query(`DELETE FROM kg_membership.chat_messages WHERE ledger_id=$1`, [LEDGER]);
  const sent = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token),
    payload: { body: '한 번만 삭제' },
  });
  const id = sent.json().id;

  const first = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${id}`, headers: bearer(EXPERT.token) });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${id}`, headers: bearer(EXPERT.token) });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, 'MESSAGE_ALREADY_DELETED');

  const auditCount = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.audit_log WHERE action='MESSAGE_DELETED' AND target_id=$1`, [id],
  )).rows[0].n;
  assert.equal(auditCount, 1, '실패한 재삭제는 audit을 추가하지 않는다');
});

test('페이지네이션 total이 삭제 후에도 조회자별로 일관적이다', async () => {
  await pool.query(`DELETE FROM kg_membership.chat_messages WHERE ledger_id=$1`, [LEDGER]);

  // 6 messages: EXPERT sends 0,2,4 and CUSTOMER sends 1,3,5.
  const ids: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const who = i % 2 === 0 ? EXPERT : CUSTOMER;
    const res = await app.inject({
      method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(who.token),
      payload: { body: `총개수 ${i}` },
    });
    assert.equal(res.statusCode, 201);
    ids.push(res.json().id);
  }

  const before = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token) });
  assert.equal(before.json().total, 6);
  const customerBefore = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(CUSTOMER.token) });
  assert.equal(customerBefore.json().total, 6);

  // EXPERT deletes their own message #4.
  const del = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${ids[4]}`, headers: bearer(EXPERT.token) });
  assert.equal(del.statusCode, 200);

  // Sender: total drops by one and matches what paging can actually return.
  const mine = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token) });
  assert.equal(mine.json().total, 5);

  const collected: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const url: string = `/v1/ledgers/${LEDGER}/messages?limit=2${cursor ? `&before=${cursor}` : ''}`;
    const res = await app.inject({ method: 'GET', url, headers: bearer(EXPERT.token) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().total, 5, 'total은 페이지마다 동일하다');
    collected.push(...res.json().messages.map((m: { id: string }) => m.id));
    cursor = res.json().nextCursor;
    if (!cursor) break;
  }
  assert.equal(collected.length, 5, 'total과 실제 수집 건수가 일치한다');
  assert.equal(new Set(collected).size, 5, '페이지 간 중복이 없다');
  assert.equal(collected.includes(ids[4]!), false, '삭제한 본인 메시지는 페이지에 나오지 않는다');

  // Counterpart: same physical rows, tombstone counted, total unchanged.
  const theirs = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages?limit=100`, headers: bearer(CUSTOMER.token) });
  assert.equal(theirs.json().total, 6);
  assert.equal(theirs.json().messages.length, 6);
  const tomb = theirs.json().messages.find((m: { id: string }) => m.id === ids[4]);
  assert.equal(tomb.deleted, true);
  assert.equal(tomb.body, null);

  // The counterpart deletes their own message #5. For the expert that row stays
  // as a tombstone, while the expert's own deleted #4 stays hidden: 6 - 1 = 5,
  // and the count still equals the number of rows paging returns.
  const delOther = await app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${ids[5]}`, headers: bearer(CUSTOMER.token) });
  assert.equal(delOther.statusCode, 200);
  const expertAgain = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token) });
  assert.equal(expertAgain.json().total, 5, '상대 삭제는 자리(tombstone)로 남아 내 수를 줄이지 않고, 내 삭제만 빠진다');
  assert.equal(expertAgain.json().messages.length, 5);
  const expertTombstones = expertAgain.json().messages.filter((m: { deleted: boolean }) => m.deleted);
  assert.equal(expertTombstones.length, 1);
  assert.equal(expertTombstones[0].id, ids[5]);
  assert.equal(expertTombstones[0].body, null);
  const customerAgain = await app.inject({ method: 'GET', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(CUSTOMER.token) });
  assert.equal(customerAgain.json().total, 5, '본인 삭제만 본인 수에서 빠진다');
  assert.equal(customerAgain.json().messages.length, 5);
});

test('동시 삭제 요청은 한 번만 성공하고 audit도 1건이다', async () => {
  await pool.query(`DELETE FROM kg_membership.chat_messages WHERE ledger_id=$1`, [LEDGER]);
  const sent = await app.inject({
    method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token),
    payload: { body: '동시 삭제 대상' },
  });
  const id = sent.json().id;

  const results = await Promise.all([
    app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${id}`, headers: bearer(EXPERT.token) }),
    app.inject({ method: 'DELETE', url: `/v1/ledgers/${LEDGER}/messages/${id}`, headers: bearer(EXPERT.token) }),
  ]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  const failed = results.find(r => r.statusCode === 409)!;
  assert.equal(failed.json().error.code, 'MESSAGE_ALREADY_DELETED');

  const auditCount = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.audit_log WHERE action='MESSAGE_DELETED' AND target_id=$1`, [id],
  )).rows[0].n;
  assert.equal(auditCount, 1);
  const row = (await pool.query(`SELECT deleted_at FROM kg_membership.chat_messages WHERE id=$1`, [id])).rows[0];
  assert.ok(row.deleted_at);
});

// 회귀: 커서가 밀리초로 잘리면 같은 밀리초 안의 마이크로초 차이 행을 건너뛴다.
// created_at을 인위적으로 같은 밀리초(.123456 / .123999)로 맞춰 결정적으로 재현한다.
test('같은 밀리초에 생성된 메시지도 커서 페이지네이션에서 누락되지 않는다', async () => {
  await pool.query(`DELETE FROM kg_membership.chat_messages WHERE ledger_id=$1`, [LEDGER]);
  const ids: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await app.inject({
      method: 'POST', url: `/v1/ledgers/${LEDGER}/messages`, headers: bearer(EXPERT.token),
      payload: { body: `동일밀리초 ${i}` },
    });
    assert.equal(res.statusCode, 201);
    ids.push(res.json().id);
  }
  // 두 행을 같은 밀리초, 다른 마이크로초로 고정한다.
  await pool.query(
    `UPDATE kg_membership.chat_messages SET created_at='2026-01-01 00:00:00.123456+00' WHERE id=$1::uuid`, [ids[1]],
  );
  await pool.query(
    `UPDATE kg_membership.chat_messages SET created_at='2026-01-01 00:00:00.123999+00' WHERE id=$1::uuid`, [ids[2]],
  );

  const collected: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const url: string = `/v1/ledgers/${LEDGER}/messages?limit=1${cursor ? `&before=${cursor}` : ''}`;
    const res = await app.inject({ method: 'GET', url, headers: bearer(EXPERT.token) });
    assert.equal(res.statusCode, 200, res.body);
    collected.push(...res.json().messages.map((m: { id: string }) => m.id));
    cursor = res.json().nextCursor;
    if (!cursor) break;
  }
  assert.equal(collected.length, 4, '같은 밀리초 행이 누락되면 안 된다');
  assert.equal(new Set(collected).size, 4, '페이지 간 중복이 없어야 한다');
});
