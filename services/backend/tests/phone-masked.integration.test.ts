// WS-28 — masked-only phone storage, real PostgreSQL integration test.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest_ws28 \
//     node --test tests/phone-masked.integration.test.ts
//
// Proves four things against a real database:
//   1. `015_phone_masked.sql` exists and its CHECK rejects anything that is not
//      the `010-****-1234` shape (raw number, partial mask, other prefix).
//   2. No column anywhere in `kg_membership` can hold a raw phone number; the
//      only phone columns are digest / masked / verified-at.
//   3. The real signup path stores the masked value and never the raw number —
//      on the registration ticket and then on the member row.
//   4. The admin list and detail endpoints return the stored `phoneMasked`.
//
// Only the SMS transport is a double; the database, migrations and routes are real.
// Rows created here are deleted in `after()`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { postgresSql } from '../src/database.ts';
import { digest, opaque } from '../src/security.ts';
import type { AuthOptions } from '../src/providers.ts';

const DATABASE_URL = process.env.KG_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/kgtest';
const parsed = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('KG_TEST_DATABASE_URL must point at a loopback database');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const sql = postgresSql(pool);

const IDENTITY_KEY = 'ws28-integration-identity-key-0123456789abcdef';
const VERSION = `ws28-${randomUUID().slice(0, 8)}`;
const RAW_PHONE = '01012345678';
const MASKED_PHONE = '010-****-5678';

const smsDouble: { code: string | null } = { code: null };
const provider = {
  authorize: (state: string) => `https://provider.invalid/authorize?state=${state}`,
  exchange: async () => ({ subject: 'ws28-unused-subject' }),
};
const options: AuthOptions = {
  providers: { kakao: provider, naver: provider, google: provider },
  sms: { send: async (_phone, code) => { smsDouble.code = code; } },
  identityKey: IDENTITY_KEY,
};
const app = buildApp(sql, 'integration-phone-masked', options);

const bearer = (token: string) => ({ authorization: 'Bearer ' + token });

const ADMIN = { member: randomUUID(), principal: randomUUID(), token: opaque() };
const LEGACY = { member: randomUUID(), principal: randomUUID() };
const createdMembers: string[] = [];
const createdPrincipals: string[] = [];
const createdTickets: string[] = [];
const createdTicketDigests: string[] = [];
const createdDocuments: number[] = [];

let registeredMemberId: string | null = null;

async function seedMember(account: { member: string; principal: string; token?: string }, nickname: string, admin = false) {
  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [account.principal]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [account.member, account.principal, nickname, `${account.member.slice(0, 8)}@example.invalid`, nickname, digest(`phone-${account.member}`)],
  );
  if (account.token) {
    await pool.query(
      `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
       VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`,
      [randomUUID(), account.member, digest(account.token), digest('refresh-' + account.token), randomUUID()],
    );
  }
  if (admin) {
    await pool.query(
      `INSERT INTO kg_membership.role_grants(id,member_id,role_id,reason) VALUES($1,$2,'ADMIN','WS-28 통합테스트 관리자')`,
      [randomUUID(), account.member],
    );
  }
}

async function seedReadyPolicy(kind: string) {
  const body = `${kind} ${VERSION} 본문`;
  const row = (await pool.query(
    `INSERT INTO kg_membership.policy_documents(kind,version,status,title,body,body_sha256,operator_name,approved_at,effective_at)
     VALUES($1,$2,'READY',$3,$4,$5,'민테크놀로지',now()-interval '1 day',now()-interval '1 day') RETURNING id`,
    [kind, VERSION, `${kind} ${VERSION}`, body, digest(body)],
  )).rows[0];
  createdDocuments.push(Number(row.id));
}

async function issueTicket(subject: string) {
  const raw = opaque();
  const subjectDigest = digest(`subject:${subject}`);
  await pool.query(
    `INSERT INTO kg_membership.registration_tickets(ticket_digest,provider,subject_digest,expires_at)
     VALUES($1,'kakao',$2,now()+interval '10 minutes')`,
    [digest(raw), subjectDigest],
  );
  createdTickets.push(subjectDigest);
  createdTicketDigests.push(digest(raw));
  return raw;
}

async function expectCheckViolation(text: string, values: unknown[]) {
  try {
    await pool.query(text, values);
  } catch (error) {
    assert.equal((error as { code?: string }).code, '23514', `expected a CHECK violation, got ${String(error)}`);
    assert.equal((error as { constraint?: string }).constraint, 'members_phone_masked_format');
    return;
  }
  assert.fail('the database accepted a value that is not the masked phone format');
}

before(async () => {
  await pool.query(`TRUNCATE kg_membership.audit_log, kg_membership.agreements, kg_membership.ledger_notes,
    kg_membership.ledgers, kg_membership.role_grants, kg_membership.consent_events,
    kg_membership.notification_preferences, kg_membership.sessions, kg_membership.sms_challenges,
    kg_membership.registration_tickets, kg_membership.oauth_flows, kg_membership.social_links,
    kg_membership.restrictions, kg_membership.members, kg_membership.principals,
    kg_membership.policy_documents CASCADE`);

  await seedReadyPolicy('TERMS');
  await seedReadyPolicy('PRIVACY_CONSENT');
  await seedReadyPolicy('PRIVACY_POLICY');

  await seedMember(ADMIN, '운영자28', true);
  await seedMember(LEGACY, '기존회원28');

  createdMembers.push(ADMIN.member, LEGACY.member);
  createdPrincipals.push(ADMIN.principal, LEGACY.principal);
});

after(async () => {
  if (registeredMemberId) createdMembers.push(registeredMemberId);
  const principals = createdMembers.length > 0
    ? (await pool.query(`SELECT principal_id FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [createdMembers]))
      .rows.map(r => String(r.principal_id))
    : [];
  if (createdMembers.length > 0) {
    await pool.query(`DELETE FROM kg_membership.consent_events WHERE member_id = ANY($1::uuid[])`, [createdMembers]);
    await pool.query(`DELETE FROM kg_membership.notification_preferences WHERE member_id = ANY($1::uuid[])`, [createdMembers]);
    await pool.query(`DELETE FROM kg_membership.sessions WHERE member_id = ANY($1::uuid[])`, [createdMembers]);
    await pool.query(`DELETE FROM kg_membership.audit_log WHERE actor_member_id = ANY($1::uuid[])`, [createdMembers]);
  }
  await pool.query(`DELETE FROM kg_membership.social_links WHERE principal_id = ANY($1::uuid[])`, [[...principals, ...createdPrincipals]]);
  await pool.query(`DELETE FROM kg_membership.role_grants WHERE member_id = ANY($1::uuid[])`, [createdMembers]);
  if (createdTicketDigests.length > 0) {
    await pool.query(`DELETE FROM kg_membership.sms_challenges WHERE ticket_digest = ANY($1::char(64)[])`, [createdTicketDigests]);
  }
  if (createdTickets.length > 0 || createdTicketDigests.length > 0) {
    await pool.query(`DELETE FROM kg_membership.registration_tickets WHERE subject_digest = ANY($1::char(64)[])
      OR ticket_digest = ANY($2::char(64)[])`, [createdTickets, createdTicketDigests]);
  }
  if (createdDocuments.length > 0) {
    await pool.query(`DELETE FROM kg_membership.policy_documents WHERE id = ANY($1::int[])`, [createdDocuments]);
  }
  if (createdMembers.length > 0) {
    await pool.query(`DELETE FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [createdMembers]);
  }
  await pool.query(`DELETE FROM kg_membership.principals WHERE id = ANY($1::uuid[])`, [[...principals, ...createdPrincipals]]);
  await app.close();
  await pool.end();
});

// ---------------------------------------------------------------------------
// 1. 스키마: 마스킹 형식만 통과한다
// ---------------------------------------------------------------------------
test('015: members.phone_masked만 허용 형식을 통과시키고 나머지는 DB가 거부한다', async () => {
  const column = (await pool.query(
    `SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_schema='kg_membership' AND table_name='members' AND column_name='phone_masked'`,
  )).rows[0];
  assert.ok(column, 'members.phone_masked 컬럼이 있어야 한다');
  assert.equal(column.data_type, 'text');
  assert.equal(column.is_nullable, 'YES', '기존 회원은 null을 유지해야 한다');

  const constraint = (await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname='members_phone_masked_format' AND conrelid='kg_membership.members'::regclass`,
  )).rows[0];
  assert.ok(constraint, 'CHECK 제약이 있어야 한다');
  assert.match(String(constraint.def), /\^010-/);

  const newPrincipal = async () => {
    const principal = randomUUID();
    createdPrincipals.push(principal);
    await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principal]);
    return principal;
  };
  const insert = async (masked: string | null) => {
    const id = randomUUID();
    createdMembers.push(id);
    return pool.query(
      `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_masked)
       VALUES($1,$2,'형식검사','format@example.invalid','형식검사',$3) RETURNING phone_masked AS "phoneMasked"`,
      [id, await newPrincipal(), masked],
    );
  };

  // 원문, 부분 마스킹, 다른 접두사, 하이픈 없는 값 모두 거부된다.
  for (const bad of [RAW_PHONE, '010-1234-5678', '010-****-567', '010-****-56789', '011-****-5678', '010-***-5678', '010-****-56a8']) {
    const principal = await newPrincipal();
    await expectCheckViolation(
      `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_masked)
       VALUES($1,$2,'형식검사','format@example.invalid','형식검사',$3)`,
      [randomUUID(), principal, bad],
    );
  }

  // 정확한 형식과 NULL은 통과한다.
  const ok = await insert('010-****-9999');
  assert.equal(ok.rowCount, 1);
  assert.equal(ok.rows[0].phoneMasked, '010-****-9999');
  const nulls = await insert(null);
  assert.equal(nulls.rows[0].phoneMasked, null);

  // 같은 규칙이 등록 티켓에도 적용된다.
  await assert.rejects(
    pool.query(
      `INSERT INTO kg_membership.registration_tickets(ticket_digest,provider,subject_digest,expires_at,phone_masked)
       VALUES($1,'kakao',$2,now()+interval '10 minutes',$3)`,
      [digest(`ticket-${randomUUID()}`), digest(`subj-${randomUUID()}`), RAW_PHONE],
    ),
    (error: { code?: string; constraint?: string }) =>
      error.code === '23514' && error.constraint === 'registration_tickets_phone_masked_format',
  );
});

// ---------------------------------------------------------------------------
// 2. 스키마: 원문 전화번호를 담을 컬럼이 없다
// ---------------------------------------------------------------------------
test('kg_membership 어디에도 원문 전화번호 컬럼이 없다', async () => {
  const columns = (await pool.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema='kg_membership'
        AND (column_name ~ 'phone' OR column_name ~ 'mobile' OR column_name ~ 'tel')
      ORDER BY table_name, column_name`,
  )).rows.map(r => `${r.table_name}.${r.column_name}:${r.data_type}`);

  assert.deepEqual(columns, [
    'members.phone_digest:character',
    'members.phone_masked:text',
    'registration_tickets.phone_digest:character',
    'registration_tickets.phone_masked:text',
    'registration_tickets.phone_verified_at:timestamp with time zone',
    'sms_challenges.phone_digest:character',
  ], '전화 관련 컬럼은 digest / masked / verified_at 뿐이어야 한다');

  // digest는 64자 해시, masked는 CHECK 형식 — 둘 다 원문을 담을 수 없다.
  const digests = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.members
      WHERE phone_digest IS NOT NULL AND phone_digest !~ '^[0-9a-f]{64}$'`,
  )).rows[0];
  assert.equal(digests.n, 0);
});

// ---------------------------------------------------------------------------
// 3. 저장 경로: 가입 전체 흐름에서 원문은 저장되지 않는다
// ---------------------------------------------------------------------------
test('SMS 발송·확인·가입 경로가 마스킹 값만 저장한다', async () => {
  const ticket = await issueTicket('ws28-signup');

  const sent = await app.inject({
    method: 'POST', url: '/v1/auth/sms/send',
    payload: { registrationTicket: ticket, phone: RAW_PHONE },
  });
  assert.equal(sent.statusCode, 200, sent.body);
  assert.ok(smsDouble.code, 'SMS double must receive a code');

  const ticketRow = (await pool.query(
    `SELECT phone_masked AS "phoneMasked" FROM kg_membership.registration_tickets WHERE ticket_digest=$1`,
    [digest(ticket)],
  )).rows[0];
  assert.equal(ticketRow.phoneMasked, MASKED_PHONE, '티켓에는 마스킹 값만 남아야 한다');

  const verified = await app.inject({
    method: 'POST', url: '/v1/auth/sms/verify',
    payload: { registrationTicket: ticket, challengeId: sent.json().challengeId, code: smsDouble.code },
  });
  assert.equal(verified.statusCode, 200, verified.body);

  // 확인 단계는 digest만 채우고 마스킹 값은 그대로 둔다.
  const verifiedTicket = (await pool.query(
    `SELECT phone_masked AS "phoneMasked", phone_digest AS "phoneDigest"
       FROM kg_membership.registration_tickets WHERE ticket_digest=$1`,
    [digest(ticket)],
  )).rows[0];
  assert.equal(verifiedTicket.phoneMasked, MASKED_PHONE);
  assert.match(String(verifiedTicket.phoneDigest), /^[0-9a-f]{64}$/);

  const signup = await app.inject({
    method: 'POST', url: '/v1/auth/signup',
    payload: {
      registrationTicket: ticket,
      name: '마스킹회원',
      email: 'ws28-masked@example.invalid',
      age14Confirmed: true,
      expertRequested: false,
      consents: [{ kind: 'TERMS', version: VERSION }, { kind: 'PRIVACY_CONSENT', version: VERSION }],
    },
  });
  assert.equal(signup.statusCode, 200, signup.body);
  assert.ok(signup.json().session?.accessToken);

  const member = (await pool.query(
    `SELECT id, phone_masked AS "phoneMasked" FROM kg_membership.members
      WHERE phone_digest=(SELECT phone_digest FROM kg_membership.registration_tickets WHERE ticket_digest=$1)`,
    [digest(ticket)],
  )).rows[0];
  assert.ok(member, '가입이 회원 행을 만들어야 한다');
  assert.equal(member.phoneMasked, MASKED_PHONE, '회원 행에는 마스킹 값이 저장되어야 한다');
  registeredMemberId = String(member.id);

  // 회원 행 전체를 직렬화해도 원문이 남아 있지 않다.
  const rawRow = (await pool.query(`SELECT to_jsonb(m) AS row FROM kg_membership.members m WHERE m.id=$1`, [member.id])).rows[0];
  assert.equal(JSON.stringify(rawRow.row).includes(RAW_PHONE), false, '원문 전화번호가 DB에 남으면 안 된다');
  assert.equal(JSON.stringify(rawRow.row).includes(MASKED_PHONE), true);
});

// ---------------------------------------------------------------------------
// 4. 관리자 API: 실제 저장값을 반환한다
// ---------------------------------------------------------------------------
test('관리자 목록·상세가 phoneMasked를 실제 값으로 반환하고, 없으면 null이다', async () => {
  assert.ok(registeredMemberId, '선행 가입 테스트가 회원을 만들어야 한다');

  // Admin routes take the operator session minted by POST /v1/admin/session
  // (WS-23), not the member session token.
  const exchanged = await app.inject({ method: 'POST', url: '/v1/admin/session', payload: { sessionToken: ADMIN.token } });
  assert.equal(exchanged.statusCode, 201, exchanged.body);
  const adminToken: string = exchanged.json().adminToken;

  const list = await app.inject({ method: 'GET', url: '/v1/admin/members?limit=100', headers: bearer(adminToken) });
  assert.equal(list.statusCode, 200, list.body);
  const body = list.json();
  const signedUp = body.members.find((m: { id: string }) => m.id === registeredMemberId);
  assert.ok(signedUp, '가입 회원이 관리자 목록에 있어야 한다');
  assert.equal(signedUp.phoneMasked, MASKED_PHONE);
  assert.equal(JSON.stringify(body).includes(RAW_PHONE), false, '목록 응답에 원문이 없어야 한다');

  const legacy = body.members.find((m: { id: string }) => m.id === LEGACY.member);
  assert.equal(legacy.phoneMasked, null, '마스킹 값이 없는 기존 회원은 null');

  const detail = await app.inject({ method: 'GET', url: `/v1/admin/members/${registeredMemberId}`, headers: bearer(adminToken) });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().member.phoneMasked, MASKED_PHONE);
  assert.equal(JSON.stringify(detail.json()).includes(RAW_PHONE), false);

  const legacyDetail = await app.inject({ method: 'GET', url: `/v1/admin/members/${LEGACY.member}`, headers: bearer(adminToken) });
  assert.equal(legacyDetail.json().member.phoneMasked, null);
});
