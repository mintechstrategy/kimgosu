// Real-PostgreSQL integration test for the membership API.
//
// The unit suite (src/*.test.ts) uses SQL doubles. This file exercises the same
// routes against an actual PostgreSQL instance so that schema drift, trigger
// behaviour and query/column mismatches fail loudly.
//
// It refuses to run against anything that is not a loopback database, and it
// truncates that database. Never point KG_TEST_DATABASE_URL at Railway.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest \
//     node --test tests/local-db.integration.test.ts

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
  throw new Error('KG_TEST_DATABASE_URL must point at a loopback database; refusing to truncate a remote one');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const sql = postgresSql(pool);
const app = buildApp(sql, 'integration-local', {});

const ACCESS_TOKEN = 'A'.repeat(43);
const MEMBER_ID = randomUUID();
const PRINCIPAL_ID = randomUUID();
const DOC: Record<string, { id: number; version: string }> = {};

async function seedPolicy(kind: string, version: string, status: 'DRAFT' | 'READY', body: string) {
  const ready = status === 'READY';
  const result = await pool.query(
    `INSERT INTO kg_membership.policy_documents
       (kind,version,status,title,body,body_sha256,operator_name,effective_at,approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [kind, version, status, `${kind} 제목`, body, sha(body),
      ready ? '주식회사 민테크' : null,
      ready ? new Date(Date.now() - 86_400_000) : null,
      ready ? new Date(Date.now() - 86_400_000) : null],
  );
  DOC[kind] = { id: Number(result.rows[0].id), version };
}

before(async () => {
  await pool.query(`TRUNCATE kg_membership.consent_events, kg_membership.notification_preferences,
    kg_membership.sessions, kg_membership.sms_challenges, kg_membership.registration_tickets,
    kg_membership.oauth_flows, kg_membership.social_links, kg_membership.restrictions,
    kg_membership.members, kg_membership.principals, kg_membership.policy_documents CASCADE`);

  await seedPolicy('TERMS', 'v1.0', 'READY', '이용약관 본문 v1.0');
  await seedPolicy('PRIVACY_CONSENT', 'v1.0', 'READY', '개인정보 수집·이용 동의 v1.0');
  await seedPolicy('PRIVACY_POLICY', 'v1.0', 'READY', '개인정보 처리방침 v1.0');
  await seedPolicy('MARKETING', 'v1.0', 'READY', '마케팅 수신 동의 v1.0');
  await seedPolicy('OPERATIONS', 'v0.1', 'DRAFT', '서비스 운영정책 초안');

  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [PRINCIPAL_ID]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest)
     VALUES($1,$2,'김고수','goso@example.com','고수01',$3)`,
    [MEMBER_ID, PRINCIPAL_ID, sha('01012345678')],
  );
  await pool.query(
    `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
     VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`,
    [randomUUID(), MEMBER_ID, sha(ACCESS_TOKEN), sha('refresh-' + ACCESS_TOKEN), randomUUID()],
  );
  for (const kind of ['TERMS', 'PRIVACY_CONSENT']) {
    await pool.query(
      `INSERT INTO kg_membership.consent_events(member_id,document_id,action,request_id)
       VALUES($1,$2,'GRANTED',$3)`,
      [MEMBER_ID, DOC[kind]!.id, randomUUID()],
    );
  }
});

after(async () => {
  await app.close();
  await pool.end();
});

const auth = { authorization: `Bearer ${ACCESS_TOKEN}` };

test('health reports the development scope', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'ok');
  assert.equal(res.json().scope, 'membership-development');
});

test('auth config is honest about unconnected providers and SMS', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/auth/config?metadata=policy-v0.3' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.signupReady, false, 'no provider/SMS adapter is wired, so signup must not claim readiness');
  assert.equal(body.sms.available, false);
  assert.equal(body.sms.codeDigits, 5);
  assert.equal(body.sms.expiresInSeconds, 60);
  assert.equal(body.collectsGender, false);
  assert.equal(body.collectsAgeGroup, false);
  assert.equal(body.rejoinWaitDays, 30);
  assert.equal(body.retention.calendarYears, 1);
  assert.equal(body.retention.rejoinResetsClock, false);
  assert.equal(body.documents.length, 5);
  assert.ok(body.policySnapshot.policyRevision.startsWith('ps3-'));
});

test('policy list and single document expose a verifiable body hash', async () => {
  const list = await app.inject({ method: 'GET', url: '/v1/policies' });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().documents.length, 5);

  const one = await app.inject({ method: 'GET', url: '/v1/policies/TERMS' });
  assert.equal(one.statusCode, 200);
  const doc = one.json();
  assert.equal(doc.version, 'v1.0');
  assert.equal(doc.bodySha256, sha(doc.body));
  assert.equal(doc.canConsent, true);

  const draft = await app.inject({ method: 'GET', url: '/v1/policies/OPERATIONS' });
  assert.equal(draft.statusCode, 200);
  assert.equal(draft.json().status, 'DRAFT');
  assert.equal(draft.json().canConsent, false, 'a draft must never be consentable');

  const unknown = await app.inject({ method: 'GET', url: '/v1/policies/NOT_A_KIND' });
  assert.equal(unknown.statusCode, 400);
});

test('private routes reject anonymous callers before touching member data', async () => {
  for (const url of ['/v1/me', '/v1/me/consents', '/v1/me/notifications']) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 401, url);
    assert.equal(res.json().error.code, 'AUTH_REQUIRED');
  }
});

test('member read returns the seeded row and consent history', async () => {
  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
  assert.equal(me.statusCode, 200);
  const body = me.json();
  assert.equal(body.id, MEMBER_ID);
  assert.equal(body.nickname, '고수01');
  assert.equal(body.status, 'ACTIVE');
  assert.equal(body.expertActive, false);
  assert.match(body.customerNumber, /^[0-9]+$/);

  const consents = await app.inject({ method: 'GET', url: '/v1/me/consents', headers: auth });
  assert.equal(consents.statusCode, 200);
  const kinds = consents.json().records.map((r: { kind: string }) => r.kind).sort();
  assert.deepEqual(kinds, ['PRIVACY_CONSENT', 'TERMS']);
});

test('advertising cannot be enabled without a distinct marketing consent', async () => {
  const res = await app.inject({
    method: 'PATCH', url: '/v1/me/notifications', headers: auth,
    payload: { expectedVersion: 0, advertising: true },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'MARKETING_CONSENT_REQUIRED');

  const stored = await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.notification_preferences WHERE member_id=$1 AND advertising`,
    [MEMBER_ID],
  );
  assert.equal(stored.rows[0].n, 0, 'the rejected write must not persist');
});

test('notification preference write persists and bumps the version', async () => {
  const res = await app.inject({
    method: 'PATCH', url: '/v1/me/notifications', headers: auth,
    payload: { expectedVersion: 0, chat: true },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().chat, true);
  assert.equal(res.json().version, 1);

  const reread = await app.inject({ method: 'GET', url: '/v1/me/notifications', headers: auth });
  assert.equal(reread.json().chat, true);
  assert.equal(reread.json().version, 1);

  const stale = await app.inject({
    method: 'PATCH', url: '/v1/me/notifications', headers: auth,
    payload: { expectedVersion: 0, chat: false },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'VERSION_CONFLICT');
});

test('profile nickname update persists and rejects out-of-range input', async () => {
  const ok = await app.inject({
    method: 'PATCH', url: '/v1/me/profile', headers: auth, payload: { nickname: '새닉네임' },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().nickname, '새닉네임');

  const reread = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
  assert.equal(reread.json().nickname, '새닉네임');

  const tooLong = await app.inject({
    method: 'PATCH', url: '/v1/me/profile', headers: auth, payload: { nickname: '가'.repeat(11) },
  });
  assert.equal(tooLong.statusCode, 400);

  const symbol = await app.inject({
    method: 'PATCH', url: '/v1/me/profile', headers: auth, payload: { nickname: 'bad name!' },
  });
  assert.equal(symbol.statusCode, 400);
});

test('expert activation is immediate once required profile data exists', async () => {
  const res = await app.inject({ method: 'POST', url: '/v1/me/expert', headers: auth, payload: { requested: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().expertActive, true);

  const reread = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
  assert.equal(reread.json().expertActive, true);
});

test('withdrawal revokes the session and stamps the 30-day / 1-year clocks', async () => {
  const res = await app.inject({ method: 'POST', url: '/v1/me/withdraw', headers: auth, payload: { confirmed: true } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.withdrawn, true);
  assert.equal(body.previousPrivateDataRestoredOnRejoin, false);
  assert.equal(body.rejoinResetsRetentionClock, false);

  const row = (await pool.query(
    `SELECT status, expert_active, withdrawn_at, rejoin_after, retention_until,
            rejoin_after = withdrawn_at + interval '30 days' AS rejoin_ok,
            retention_until = withdrawn_at + interval '1 year' AS retention_ok
       FROM kg_membership.members WHERE id=$1`, [MEMBER_ID])).rows[0];
  assert.equal(row.status, 'WITHDRAWN');
  assert.equal(row.expert_active, false);
  assert.equal(row.rejoin_ok, true);
  assert.equal(row.retention_ok, true);

  const revoked = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.sessions WHERE member_id=$1 AND revoked_at IS NULL`, [MEMBER_ID])).rows[0];
  assert.equal(revoked.n, 0, 'every session must be revoked on withdrawal');

  const after = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
  assert.equal(after.statusCode, 401, 'the old bearer must stop working immediately');
});

test('sealed policy content and consent events are immutable at the database level', async () => {
  await assert.rejects(
    pool.query(`UPDATE kg_membership.policy_documents SET body='변조' WHERE id=$1`, [DOC.TERMS!.id]),
    /SEALED_DOCUMENT_IMMUTABLE/,
  );
  await assert.rejects(
    pool.query(`UPDATE kg_membership.consent_events SET action='WITHDRAWN' WHERE member_id=$1`, [MEMBER_ID]),
    /CONSENT_EVENT_IMMUTABLE/,
  );
});
