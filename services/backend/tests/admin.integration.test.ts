// Admin console API integration test against real PostgreSQL.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest_ws19 \
//     node --test tests/admin.integration.test.ts
//
// Uses a loopback database only. Rows created here are removed in `after`.

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
const app = buildApp(postgresSql(pool), 'integration-admin', {});

const ADMIN = { id: randomUUID(), token: 'A'.repeat(43) };
const CS_ONLY = { id: randomUUID(), token: 'S'.repeat(43) };
const PLAIN = { id: randomUUID(), token: 'U'.repeat(43) };
const TARGET = { id: randomUUID(), token: 'T'.repeat(43) };
const CUSTOMER = { id: randomUUID(), token: 'C'.repeat(43) };
const LEDGER = randomUUID();
const DOCUMENT = randomUUID();
const PRINCIPALS: string[] = [];
let DOCUMENT_ID = 0;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function seedMember(member: { id: string; token: string }, nickname: string, email: string, expert = false) {
  const principalId = randomUUID();
  PRINCIPALS.push(principalId);
  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest,expert_active)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [member.id, principalId, nickname, email, nickname, sha(`p-${nickname}`), expert],
  );
  await pool.query(
    `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
     VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`,
    [randomUUID(), member.id, sha(member.token), sha('r-' + member.token), randomUUID()],
  );
}

async function grantRole(memberId: string, role: 'CS' | 'ADMIN') {
  await pool.query(
    `INSERT INTO kg_membership.role_grants(id,member_id,role_id,reason,starts_at)
     VALUES($1,$2,$3,'admin-suite fixture',now())`,
    [randomUUID(), memberId, role],
  );
}

before(async () => {
  await pool.query(`TRUNCATE kg_membership.audit_log, kg_membership.agreements, kg_membership.ledger_notes,
    kg_membership.ledgers, kg_membership.role_grants, kg_membership.consent_events,
    kg_membership.notification_preferences, kg_membership.sessions, kg_membership.sms_challenges,
    kg_membership.registration_tickets, kg_membership.oauth_flows, kg_membership.social_links,
    kg_membership.restrictions, kg_membership.members, kg_membership.principals CASCADE`);

  await seedMember(ADMIN, '운영자A', 'operator@dev.invalid');
  await seedMember(CS_ONLY, '상담원S', 'cs@dev.invalid');
  await seedMember(PLAIN, '일반U', 'plain@dev.invalid');
  await seedMember(TARGET, '대상T', 'target@dev.invalid', true);
  await seedMember(CUSTOMER, '고객C', 'customer@dev.invalid');
  await grantRole(ADMIN.id, 'ADMIN');
  await grantRole(CS_ONLY.id, 'CS');

  await pool.query(
    `INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id,display_name) VALUES($1,$2,$3,'원장-1')`,
    [LEDGER, TARGET.id, CUSTOMER.id],
  );
  const body = '테스트 본문';
  const document = (await pool.query(
    `INSERT INTO kg_membership.policy_documents(kind,version,status,title,body,body_sha256,operator_name,approved_at,effective_at)
     VALUES('TERMS','test-v1','READY','테스트 약관',$1,$2,'민테크놀로지',now()-interval '1 day',now()-interval '1 day')
     RETURNING id`,
    [body, sha(body)],
  )).rows[0];
  DOCUMENT_ID = Number(document.id);
  await pool.query(
    `INSERT INTO kg_membership.consent_events(member_id,document_id,action,request_id) VALUES($1,$2,'GRANTED',$3)`,
    [TARGET.id, DOCUMENT_ID, DOCUMENT],
  );
});

after(async () => {
  // Leave the loopback database as it was found.
  await pool.query(`DELETE FROM kg_membership.audit_log WHERE actor_member_id = ANY($1::uuid[])`, [[ADMIN.id]]);
  await pool.query(`DELETE FROM kg_membership.restrictions WHERE principal_id IN
    (SELECT principal_id FROM kg_membership.members WHERE id = ANY($1::uuid[]))`, [[ADMIN.id, CS_ONLY.id, PLAIN.id, TARGET.id, CUSTOMER.id]]);
  await pool.query(`DELETE FROM kg_membership.consent_events WHERE member_id = ANY($1::uuid[])`, [[TARGET.id]]);
  await pool.query(`DELETE FROM kg_membership.policy_documents WHERE id=$1`, [DOCUMENT_ID]);
  await pool.query(`DELETE FROM kg_membership.ledgers WHERE id=$1`, [LEDGER]);
  await pool.query(`DELETE FROM kg_membership.role_grants WHERE member_id = ANY($1::uuid[])`, [[ADMIN.id, CS_ONLY.id]]);
  await pool.query(`DELETE FROM kg_membership.sessions WHERE member_id = ANY($1::uuid[])`, [[ADMIN.id, CS_ONLY.id, PLAIN.id, TARGET.id, CUSTOMER.id]]);
  await pool.query(`DELETE FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [[ADMIN.id, CS_ONLY.id, PLAIN.id, TARGET.id, CUSTOMER.id]]);
  await pool.query(`DELETE FROM kg_membership.principals WHERE id = ANY($1::uuid[])`, [PRINCIPALS]);
  await app.close();
  await pool.end();
});

test('anonymous and non-admin callers are refused before member data is read', async () => {
  const anonymous = await app.inject({ method: 'GET', url: '/v1/admin/members' });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().error.code, 'AUTH_REQUIRED');

  // CS is a real role, but only ADMIN may operate the console.
  for (const headers of [auth(CS_ONLY.token), auth(PLAIN.token)]) {
    const list = await app.inject({ method: 'GET', url: '/v1/admin/members', headers });
    assert.equal(list.statusCode, 403);
    assert.equal(list.json().error.code, 'ADMIN_REQUIRED');
    assert.equal(list.json().members, undefined);
    const detail = await app.inject({ method: 'GET', url: `/v1/admin/members/${TARGET.id}`, headers });
    assert.equal(detail.statusCode, 403);
    const restrict = await app.inject({ method: 'POST', url: `/v1/admin/members/${TARGET.id}/restrict`, headers, payload: { reason: '권한 없음 시도' } });
    assert.equal(restrict.statusCode, 403);
    const release = await app.inject({ method: 'POST', url: `/v1/admin/members/${TARGET.id}/release`, headers, payload: { reason: '권한 없음 시도' } });
    assert.equal(release.statusCode, 403);
  }
  const rows = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.restrictions`)).rows[0];
  assert.equal(rows.n, 0, 'a refused call must not create a restriction');
});

test('an invented client role flag is not authority', async () => {
  const headers = { ...auth(PLAIN.token), 'x-member-role': 'ADMIN', 'x-admin': '1' };
  const list = await app.inject({ method: 'GET', url: '/v1/admin/members', headers });
  assert.equal(list.statusCode, 403);
});

test('list masks PII, searches and paginates', async () => {
  const all = await app.inject({ method: 'GET', url: '/v1/admin/members?limit=100', headers: auth(ADMIN.token) });
  assert.equal(all.statusCode, 200);
  const body = all.json();
  assert.equal(body.total, 5);
  assert.equal(body.members.length, 5);
  assert.equal(body.page, 1);
  assert.equal(body.limit, 100);

  // No raw phone number is present anywhere in the list payload. The schema only
  // stores a digest, so masking is structural: the field is null by design.
  const serialized = JSON.stringify(body);
  assert.equal(/01[016789][0-9]{7,8}/.test(serialized), false, 'list must not carry a raw phone number');
  for (const m of body.members) {
    assert.equal(m.phoneMasked, null);
    assert.match(m.emailMasked, /^..\*+@/);
    assert.equal(Object.hasOwn(m, 'email'), false, 'raw email stays out of the list response');
  }

  const search = await app.inject({ method: 'GET', url: '/v1/admin/members?query=대상', headers: auth(ADMIN.token) });
  assert.equal(search.statusCode, 200);
  assert.equal(search.json().total, 1);
  assert.equal(search.json().members[0].id, TARGET.id);

  const byNumber = await app.inject({ method: 'GET', url: `/v1/admin/members?query=${body.members.find((m: { id: string }) => m.id === TARGET.id).customerNumber}`, headers: auth(ADMIN.token) });
  assert.equal(byNumber.json().total, 1);
  assert.equal(byNumber.json().members[0].id, TARGET.id);

  const paged = await app.inject({ method: 'GET', url: '/v1/admin/members?limit=2&page=2', headers: auth(ADMIN.token) });
  assert.equal(paged.statusCode, 200);
  assert.equal(paged.json().members.length, 2);
  assert.equal(paged.json().totalPages, 3);
  const firstPage = await app.inject({ method: 'GET', url: '/v1/admin/members?limit=2&page=1', headers: auth(ADMIN.token) });
  const seen = new Set([...firstPage.json().members, ...paged.json().members].map((m: { id: string }) => m.id));
  assert.equal(seen.size, 4, 'pages must not repeat rows');

  const filtered = await app.inject({ method: 'GET', url: '/v1/admin/members?status=WITHDRAWN', headers: auth(ADMIN.token) });
  assert.equal(filtered.statusCode, 200);
  assert.equal(filtered.json().total, 0);

  const badStatus = await app.inject({ method: 'GET', url: '/v1/admin/members?status=DELETED', headers: auth(ADMIN.token) });
  assert.equal(badStatus.statusCode, 400);
});

test('detail returns consents, ledgers and restriction history', async () => {
  const detail = await app.inject({ method: 'GET', url: `/v1/admin/members/${TARGET.id}`, headers: auth(ADMIN.token) });
  assert.equal(detail.statusCode, 200);
  const body = detail.json();
  assert.equal(body.member.id, TARGET.id);
  assert.equal(body.member.status, 'ACTIVE');
  assert.equal(body.member.phoneMasked, null);
  assert.equal(body.consents.length, 1);
  assert.equal(body.consents[0].kind, 'TERMS');
  assert.equal(body.ledgers.length, 1);
  assert.equal(body.ledgers[0].id, LEDGER);
  assert.equal(body.ledgers[0].role, 'EXPERT');
  assert.equal(body.ledgers[0].counterpartId, CUSTOMER.id);
  assert.deepEqual(body.restrictions, []);

  const missing = await app.inject({ method: 'GET', url: `/v1/admin/members/${randomUUID()}`, headers: auth(ADMIN.token) });
  assert.equal(missing.statusCode, 404);
  const malformed = await app.inject({ method: 'GET', url: '/v1/admin/members/not-a-uuid', headers: auth(ADMIN.token) });
  assert.equal(malformed.statusCode, 400);
});

test('restrict blocks the account server-side and records reason, period and audit', async () => {
  const endsAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const missingReason = await app.inject({ method: 'POST', url: `/v1/admin/members/${TARGET.id}/restrict`, headers: auth(ADMIN.token), payload: {} });
  assert.equal(missingReason.statusCode, 400);
  const past = await app.inject({ method: 'POST', url: `/v1/admin/members/${TARGET.id}/restrict`, headers: auth(ADMIN.token), payload: { reason: '과거 기한', endsAt: '2020-01-01T00:00:00.000Z' } });
  assert.equal(past.statusCode, 400);

  const created = await app.inject({
    method: 'POST', url: `/v1/admin/members/${TARGET.id}/restrict`, headers: auth(ADMIN.token),
    payload: { reason: '반복적인 거래 취소', endsAt },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().status, 'RESTRICTED');
  assert.equal(created.json().reason, '반복적인 거래 취소');

  const stored = (await pool.query(
    `SELECT reason, ends_at AS "endsAt", revoked_at AS "revokedAt" FROM kg_membership.restrictions
      WHERE principal_id=(SELECT principal_id FROM kg_membership.members WHERE id=$1)`,
    [TARGET.id],
  )).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].reason, '반복적인 거래 취소');
  assert.ok(stored[0].endsAt);
  assert.equal(stored[0].revokedAt, null);

  const audited = (await pool.query(
    `SELECT actor_member_id AS "actor", action, target_id AS "target", reason FROM kg_membership.audit_log
      WHERE action='MEMBER_RESTRICTED' ORDER BY id DESC LIMIT 1`,
  )).rows[0];
  assert.equal(audited.actor, ADMIN.id);
  assert.equal(audited.target, TARGET.id);
  assert.equal(audited.reason, '반복적인 거래 취소');

  // The restriction is enforced by the server, not just displayed.
  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth(TARGET.token) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().status, 'RESTRICTED');

  const duplicate = await app.inject({ method: 'POST', url: `/v1/admin/members/${TARGET.id}/restrict`, headers: auth(ADMIN.token), payload: { reason: '중복 제재' } });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'ALREADY_RESTRICTED');

  const listed = await app.inject({ method: 'GET', url: '/v1/admin/members?status=RESTRICTED', headers: auth(ADMIN.token) });
  assert.equal(listed.json().total, 1);
  assert.equal(listed.json().members[0].id, TARGET.id);
});

test('release keeps the history and restores access', async () => {
  const notRestricted = await app.inject({ method: 'POST', url: `/v1/admin/members/${PLAIN.id}/release`, headers: auth(ADMIN.token), payload: { reason: '제재 없음' } });
  assert.equal(notRestricted.statusCode, 409);
  assert.equal(notRestricted.json().error.code, 'NOT_RESTRICTED');

  const released = await app.inject({ method: 'POST', url: `/v1/admin/members/${TARGET.id}/release`, headers: auth(ADMIN.token), payload: { reason: '소명 확인' } });
  assert.equal(released.statusCode, 200);
  assert.equal(released.json().released, true);
  assert.ok(released.json().revokedAt);

  const rows = (await pool.query(
    `SELECT reason, revoked_at AS "revokedAt" FROM kg_membership.restrictions
      WHERE principal_id=(SELECT principal_id FROM kg_membership.members WHERE id=$1) ORDER BY starts_at`,
    [TARGET.id],
  )).rows;
  assert.equal(rows.length, 1, 'release revokes the row instead of deleting the history');
  assert.ok(rows[0].revokedAt);

  const auditRows = (await pool.query(`SELECT action FROM kg_membership.audit_log WHERE target_id=$1 ORDER BY id`, [TARGET.id])).rows;
  assert.deepEqual(auditRows.map(r => r.action), ['MEMBER_RESTRICTED', 'MEMBER_RELEASED']);

  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth(TARGET.token) });
  assert.equal(me.json().status, 'ACTIVE');

  const detail = await app.inject({ method: 'GET', url: `/v1/admin/members/${TARGET.id}`, headers: auth(ADMIN.token) });
  assert.equal(detail.json().member.status, 'ACTIVE');
  assert.equal(detail.json().restrictions.length, 1);
  assert.equal(detail.json().restrictions[0].active, false);
  assert.ok(detail.json().restrictions[0].revokedAt);
  assert.equal(detail.json().restrictions[0].releaseReason, '소명 확인', 'the release reason is visible in the history');

  const again = await app.inject({ method: 'POST', url: `/v1/admin/members/${TARGET.id}/release`, headers: auth(ADMIN.token), payload: { reason: '재해제 시도' } });
  assert.equal(again.statusCode, 409);
});
