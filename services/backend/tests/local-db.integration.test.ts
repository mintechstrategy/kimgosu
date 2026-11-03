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
import { ApiError, digest, mac, challenge, opaque } from '../src/security.ts';
import type { AuthOptions } from '../src/providers.ts';

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

  // --- WS-01 합성 계정 (세션/소셜 경로 시험용) -----------------------------
  for (const account of [WS01.b, WS01.c, WS01.r, WS01.w]) {
    await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [account.principal]);
    const withdrawnAt = account === WS01.w ? new Date() : null;
    await pool.query(
      `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest,status,withdrawn_at,rejoin_after,retention_until)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,
              CASE WHEN $8::timestamptz IS NULL THEN NULL ELSE $8::timestamptz + interval '30 days' END,
              CASE WHEN $8::timestamptz IS NULL THEN NULL ELSE $8::timestamptz + interval '1 year' END)`,
      [account.member, account.principal, '합성회원', `${account.member.slice(0, 8)}@example.com`, '합성01',
        account.phone, withdrawnAt ? 'WITHDRAWN' : 'ACTIVE', withdrawnAt],
    );
    for (const kind of ['TERMS', 'PRIVACY_CONSENT']) {
      await pool.query(
        `INSERT INTO kg_membership.consent_events(member_id,document_id,action,request_id) VALUES($1,$2,'GRANTED',$3)`,
        [account.member, DOC[kind]!.id, randomUUID()],
      );
    }
  }
  // 유효 제재 중인 계정: 로그인은 되지만 변경 업무는 서버가 거절해야 한다.
  await pool.query(
    `INSERT INTO kg_membership.restrictions(id,principal_id,reason,starts_at) VALUES($1,$2,'합성 제재',now()-interval '1 hour')`,
    [randomUUID(), WS01.r.principal],
  );
  // 이미 연결된 소셜 신원: B의 카카오·구글, R의 카카오.
  for (const [provider, subject, principal] of [
    ['kakao', SUBJECT.b, WS01.b.principal],
    ['google', SUBJECT.b, WS01.b.principal],
    ['kakao', SUBJECT.r, WS01.r.principal],
  ] as const) {
    await pool.query(
      `INSERT INTO kg_membership.social_links(provider,subject_digest,principal_id) VALUES($1,$2,$3)`,
      [provider, subjectDigest(provider, subject), principal],
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

// ===========================================================================
// WS-01 — 세션 만료·재인증·중복 로그인, 소셜 취소/실패/계정 충돌 경로
//
// 계약 정본: contracts/auth-membership.v0.2.json
//   socialStart / socialComplete / refresh / logout / me 의 errors[] 와
//   semantics[] 를 그대로 판정 기준으로 쓴다. (v0.3은 정책 metadata 전용)
//
// 이 블록은 실제 PostgreSQL 스키마와 실제 Fastify 라우트를 사용한다.
// 공급자(구글/카카오/네이버) HTTP만 scripted double이며, 네트워크는 쓰지 않는다.
// 모든 시나리오는 이 파일 안에서만 유지되는 합성 계정/토큰이다.
// ===========================================================================

const WS01_KEY = 'ws01-integration-identity-key-0123456789abcdef';
const WS01 = {
  b: { member: randomUUID(), principal: randomUUID(), phone: sha('01011112222') },
  c: { member: randomUUID(), principal: randomUUID(), phone: sha('01033334444') },
  r: { member: randomUUID(), principal: randomUUID(), phone: sha('01055556666') },
  w: { member: randomUUID(), principal: randomUUID(), phone: sha('01077778888') },
};
const SUBJECT = { b: 'subject-b', c: 'subject-c', r: 'subject-r', fresh: 'subject-fresh', fresh2: 'subject-fresh2' };
const subjectDigest = (provider: string, subject: string) => mac(WS01_KEY, 'social:' + provider, subject);

let exchangeBehaviour: () => Promise<{ subject: string }> = async () => ({ subject: SUBJECT.fresh });
const syntheticProvider = {
  authorize: (state: string, codeChallenge: string) => `https://provider.invalid/authorize?state=${state}&code_challenge=${codeChallenge}`,
  exchange: async (_code: string, _state: string, _verifier: string) => exchangeBehaviour(),
};
const ws01Options: AuthOptions = {
  providers: { kakao: syntheticProvider, google: syntheticProvider, naver: syntheticProvider },
  identityKey: WS01_KEY,
};
const makeApp = (options: AuthOptions = ws01Options) => buildApp(sql, 'integration-local', options);
const bearerOf = (token: string) => ({ authorization: `Bearer ${token}` });

async function seedSession(memberId: string, options: {
  accessExpiresInMs?: number; refreshExpiresInMs?: number; familyId?: string; revoked?: boolean;
} = {}) {
  const access = opaque(); const refresh = opaque(); const familyId = options.familyId ?? randomUUID();
  await pool.query(
    `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id,revoked_at)
     VALUES($1,$2,$3, now() + ($4::text || ' milliseconds')::interval, $5, now() + ($6::text || ' milliseconds')::interval, $7, $8)`,
    [randomUUID(), memberId, digest(access), String(options.accessExpiresInMs ?? 900_000), digest(refresh),
      String(options.refreshExpiresInMs ?? 2_592_000_000), familyId, options.revoked ? new Date() : null],
  );
  return { access, refresh, familyId };
}

async function startFlow(app: ReturnType<typeof makeApp>, provider = 'kakao', bearer?: string) {
  const verifier = opaque();
  const payload: Record<string, unknown> = { provider, codeChallenge: challenge(verifier) };
  if (bearer) payload.confirmed = true;
  const res = await app.inject({
    method: 'POST', url: bearer ? '/v1/me/social/link/start' : '/v1/auth/social/start',
    headers: bearer ? bearerOf(bearer) : {}, payload,
  });
  return { res, verifier };
}

async function completeFlow(app: ReturnType<typeof makeApp>, provider: string, state: string, verifier: string, bearer?: string) {
  return app.inject({
    method: 'POST', url: '/v1/auth/social/complete', headers: bearer ? bearerOf(bearer) : {},
    payload: { provider, state, code: 'synthetic-authorization-code', codeVerifier: verifier },
  });
}

const assertSession = (session: Record<string, unknown>) => {
  assert.match(String(session.accessToken), /^[A-Za-z0-9_-]{43}$/);
  assert.match(String(session.refreshToken), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(session.tokenType, 'Bearer');
  assert.equal(session.expiresInSeconds, 900);
};

// --- 세션 만료 / 재인증 -----------------------------------------------------

test('만료된 access 토큰은 401 SESSION_INVALID로 거절된다 (me.errors)', async t => {
  const app = makeApp(); t.after(() => app.close());
  const expired = await seedSession(WS01.b.member, { accessExpiresInMs: -1000 });
  const res = await app.inject({ url: '/v1/me', headers: bearerOf(expired.access) });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'SESSION_INVALID');

  const unknown = await app.inject({ url: '/v1/me', headers: bearerOf(opaque()) });
  assert.equal(unknown.statusCode, 401);
  assert.equal(unknown.json().error.code, 'SESSION_INVALID');

  const anonymous = await app.inject({ url: '/v1/me' });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().error.code, 'AUTH_REQUIRED');
});

test('만료 판정은 서버 시각이 한다 — DB expires_at 변경 즉시 401', async t => {
  const app = makeApp(); t.after(() => app.close());
  const live = await seedSession(WS01.b.member, { accessExpiresInMs: 60_000 });
  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(live.access) })).statusCode, 200);

  await pool.query(`UPDATE kg_membership.sessions SET expires_at=now()-interval '1 second' WHERE access_digest=$1`, [digest(live.access)]);
  const expired = await app.inject({ url: '/v1/me', headers: bearerOf(live.access) });
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.json().error.code, 'SESSION_INVALID');
});

test('재인증: refresh는 새 세션을 발급하고 이전 토큰을 단회 폐기한다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const seeded = await seedSession(WS01.b.member);

  const refreshed = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: seeded.refresh } });
  assert.equal(refreshed.statusCode, 200);
  assertSession(refreshed.json());

  const rotated = refreshed.json();
  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(rotated.accessToken) })).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(seeded.access) })).statusCode, 401, 'rotated-away access must stop working');

  const stored = (await pool.query(
    `SELECT revoked_at FROM kg_membership.sessions WHERE access_digest=$1`, [digest(seeded.access)])).rows[0];
  assert.ok(stored.revoked_at, 'the rotated row must be revoked in the database');
});

test('중복/유실 refresh 재전송은 family 전체를 폐기한다 (refresh.semantics)', async t => {
  const app = makeApp(); t.after(() => app.close());
  const seeded = await seedSession(WS01.b.member);

  const first = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: seeded.refresh } });
  assert.equal(first.statusCode, 200);

  const replay = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: seeded.refresh } });
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.json().error.code, 'SESSION_INVALID');

  const successor = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: first.json().refreshToken } });
  assert.equal(successor.statusCode, 401, 'the freshly issued refresh token must die with the family');
  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(first.json().accessToken) })).statusCode, 401);

  const alive = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.sessions WHERE family_id=$1 AND revoked_at IS NULL`, [seeded.familyId])).rows[0];
  assert.equal(alive.n, 0, 'no live session may remain in the replayed family');
});

test('만료된 refresh는 401이며 같은 family의 다른 세션을 폐기하지 않는다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const familyId = randomUUID();
  const stale = await seedSession(WS01.b.member, { refreshExpiresInMs: -1000, familyId });
  const healthy = await seedSession(WS01.b.member, { familyId });

  const res = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: stale.refresh } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'SESSION_INVALID');
  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(healthy.access) })).statusCode, 200, 'expiry alone is not replay evidence');

  const row = (await pool.query(`SELECT revoked_at FROM kg_membership.sessions WHERE access_digest=$1`, [digest(healthy.access)])).rows[0];
  assert.equal(row.revoked_at, null);
});

test('중복 로그인(기기 2대)은 독립 세션이며 logout은 호출 세션만 폐기한다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const device1 = await seedSession(WS01.b.member);
  const device2 = await seedSession(WS01.b.member);
  assert.notEqual(device1.familyId, device2.familyId, 'each login gets its own token family');

  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(device1.access) })).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(device2.access) })).statusCode, 200);

  const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearerOf(device1.access) });
  assert.equal(logout.statusCode, 200);
  assert.equal(logout.json().loggedOut, true);

  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(device1.access) })).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(device2.access) })).statusCode, 200, 'logout must not sign out the other device');

  const relogout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearerOf(device1.access) });
  assert.equal(relogout.statusCode, 401);
  assert.equal(relogout.json().error.code, 'SESSION_INVALID');

  const staleRefresh = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: device1.refresh } });
  assert.equal(staleRefresh.statusCode, 401, 'a logged-out refresh token must not re-authenticate');
});

test('탈퇴 회원의 남은 세션은 즉시 401이 된다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const seeded = await seedSession(WS01.w.member);
  const res = await app.inject({ url: '/v1/me', headers: bearerOf(seeded.access) });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'SESSION_INVALID');
  const refreshed = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: seeded.refresh } });
  assert.equal(refreshed.statusCode, 401);
});

// --- 소셜 로그인 취소 / 실패 / 계정 충돌 ------------------------------------

test('social start는 PKCE 결합 state를 5분 만료로 저장한다 (StartResponse)', async t => {
  const app = makeApp(); t.after(() => app.close());
  const { res, verifier } = await startFlow(app);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.match(body.authorizationUrl, /^https:\/\//);
  assert.match(body.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(body.expiresInSeconds, 300);

  const row = (await pool.query(
    `SELECT provider,code_challenge,consumed_at,
            expires_at BETWEEN now()+interval '4 minutes' AND now()+interval '6 minutes' AS window_ok
       FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(body.state)])).rows[0];
  assert.equal(row.provider, 'kakao');
  assert.equal(row.code_challenge, challenge(verifier));
  assert.equal(row.consumed_at, null);
  assert.equal(row.window_ok, true);
});

test('미구성 provider는 flow를 만들기 전에 503 PROVIDER_NOT_CONFIGURED로 거절한다', async t => {
  const kakaoOnly = makeApp({ providers: { kakao: syntheticProvider }, identityKey: WS01_KEY });
  t.after(() => kakaoOnly.close());
  const before = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.oauth_flows`)).rows[0].n;
  const res = await kakaoOnly.inject({ method: 'POST', url: '/v1/auth/social/start', payload: { provider: 'naver', codeChallenge: challenge(opaque()) } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'PROVIDER_NOT_CONFIGURED');
  const after = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.oauth_flows`)).rows[0].n;
  assert.equal(after, before, 'a refused provider must not leave a half-started flow');
});

test('identity key가 없으면 503 IDENTITY_CONFIGURATION_REQUIRED', async t => {
  const noKey = makeApp({ providers: { kakao: syntheticProvider } });
  t.after(() => noKey.close());
  const res = await noKey.inject({ method: 'POST', url: '/v1/auth/social/start', payload: { provider: 'kakao', codeChallenge: challenge(opaque()) } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'IDENTITY_CONFIGURATION_REQUIRED');
});

test('사용자가 취소했거나 만료된 flow는 401 OAUTH_FLOW_INVALID (재사용 불가)', async t => {
  const app = makeApp(); t.after(() => app.close());
  const unknown = await completeFlow(app, 'kakao', opaque(), opaque());
  assert.equal(unknown.statusCode, 401);
  assert.equal(unknown.json().error.code, 'OAUTH_FLOW_INVALID');

  const abandonedState = opaque(); const abandonedVerifier = opaque();
  await pool.query(
    `INSERT INTO kg_membership.oauth_flows(state_digest,provider,code_challenge,expires_at)
     VALUES($1,'kakao',$2,now()-interval '1 second')`,
    [digest(abandonedState), challenge(abandonedVerifier)],
  );
  const expired = await completeFlow(app, 'kakao', abandonedState, abandonedVerifier);
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.json().error.code, 'OAUTH_FLOW_INVALID', 'cancelled/expired flows must not be completable');
});

test('PKCE verifier 불일치는 flow를 소모하지 않고, 올바른 verifier로만 완료된다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const { res, verifier } = await startFlow(app);
  const state = res.json().state;

  const wrong = await completeFlow(app, 'kakao', state, opaque());
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json().error.code, 'OAUTH_FLOW_INVALID');
  const untouched = (await pool.query(
    `SELECT consumed_at FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(state)])).rows[0];
  assert.equal(untouched.consumed_at, null, 'a rejected verifier must not burn the pending flow');

  exchangeBehaviour = async () => ({ subject: SUBJECT.fresh });
  const ok = await completeFlow(app, 'kakao', state, verifier);
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.equal(body.outcome, 'REGISTRATION_REQUIRED');
  assert.match(body.registrationTicket, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(body.expiresInSeconds, 600);
});

test('소모된 state는 재전송해도 401 OAUTH_FLOW_INVALID (중복 callback 차단)', async t => {
  const app = makeApp(); t.after(() => app.close());
  const { res, verifier } = await startFlow(app);
  const state = res.json().state;
  exchangeBehaviour = async () => ({ subject: SUBJECT.fresh2 });
  assert.equal((await completeFlow(app, 'kakao', state, verifier)).statusCode, 200);

  const replay = await completeFlow(app, 'kakao', state, verifier);
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.json().error.code, 'OAUTH_FLOW_INVALID');
});

test('공급자 인증 실패는 401 SOCIAL_AUTH_FAILED이고 state는 소모된다', async t => {
  const app = makeApp(); t.after(() => app.close());
  exchangeBehaviour = async () => { throw new ApiError(401, 'SOCIAL_AUTH_FAILED'); };
  t.after(() => { exchangeBehaviour = async () => ({ subject: SUBJECT.fresh }); });

  const { res, verifier } = await startFlow(app);
  const state = res.json().state;
  const failed = await completeFlow(app, 'kakao', state, verifier);
  assert.equal(failed.statusCode, 401);
  assert.equal(failed.json().error.code, 'SOCIAL_AUTH_FAILED');

  const replay = await completeFlow(app, 'kakao', state, verifier);
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.json().error.code, 'OAUTH_FLOW_INVALID', 'a failed exchange must require a fresh start');
});

test('공급자 장애는 502 PROVIDER_UNAVAILABLE로 구분된다', async t => {
  const app = makeApp(); t.after(() => app.close());
  exchangeBehaviour = async () => { throw new ApiError(502, 'PROVIDER_UNAVAILABLE'); };
  t.after(() => { exchangeBehaviour = async () => ({ subject: SUBJECT.fresh }); });

  const { res, verifier } = await startFlow(app);
  const failed = await completeFlow(app, 'kakao', res.json().state, verifier);
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.json().error.code, 'PROVIDER_UNAVAILABLE');
});

test('기존 소셜 신원은 AUTHENTICATED로 세션을 발급한다', async t => {
  const app = makeApp(); t.after(() => app.close());
  exchangeBehaviour = async () => ({ subject: SUBJECT.b });
  t.after(() => { exchangeBehaviour = async () => ({ subject: SUBJECT.fresh }); });

  const { res, verifier } = await startFlow(app);
  const done = await completeFlow(app, 'kakao', res.json().state, verifier);
  assert.equal(done.statusCode, 200);
  const body = done.json();
  assert.equal(body.outcome, 'AUTHENTICATED');
  assertSession(body.session);

  const me = await app.inject({ url: '/v1/me', headers: bearerOf(body.session.accessToken) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().id, WS01.b.member);
});

test('중복 로그인: 같은 계정 두 번 로그인해도 세션이 서로 독립적이다', async t => {
  const app = makeApp(); t.after(() => app.close());
  exchangeBehaviour = async () => ({ subject: SUBJECT.b });
  t.after(() => { exchangeBehaviour = async () => ({ subject: SUBJECT.fresh }); });

  const a = await startFlow(app); const loginA = await completeFlow(app, 'kakao', a.res.json().state, a.verifier);
  const b = await startFlow(app); const loginB = await completeFlow(app, 'kakao', b.res.json().state, b.verifier);
  assert.equal(loginA.statusCode, 200); assert.equal(loginB.statusCode, 200);
  assert.notEqual(loginA.json().session.accessToken, loginB.json().session.accessToken);

  const family = (token: string) => pool.query(
    `SELECT family_id FROM kg_membership.sessions WHERE access_digest=$1`, [digest(token)]).then(r => r.rows[0].family_id);
  assert.notEqual(await family(loginA.json().session.accessToken), await family(loginB.json().session.accessToken));

  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(loginA.json().session.accessToken) })).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/me', headers: bearerOf(loginB.json().session.accessToken) })).statusCode, 200);
});

test('유효 제재 계정은 로그인은 되지만(RESTRICTED) 소셜 연결 시작은 403', async t => {
  const app = makeApp(); t.after(() => app.close());
  exchangeBehaviour = async () => ({ subject: SUBJECT.r });
  t.after(() => { exchangeBehaviour = async () => ({ subject: SUBJECT.fresh }); });

  const started = await startFlow(app);
  const done = await completeFlow(app, 'kakao', started.res.json().state, started.verifier);
  assert.equal(done.statusCode, 200, 'socialComplete.semantics: a restricted member may still authenticate');
  const access = done.json().session.accessToken;

  const me = await app.inject({ url: '/v1/me', headers: bearerOf(access) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().status, 'RESTRICTED');

  const link = await startFlow(app, 'kakao', access);
  assert.equal(link.res.statusCode, 403);
  assert.equal(link.res.json().error.code, 'ACCOUNT_RESTRICTED');
});

test('연결 flow의 소유자 불일치는 403 LINK_OWNER_MISMATCH이고 state는 소모된다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const bSession = await seedSession(WS01.b.member);
  const cSession = await seedSession(WS01.c.member);

  const started = await startFlow(app, 'google', bSession.access);
  assert.equal(started.res.statusCode, 200);

  const wrongOwner = await completeFlow(app, 'google', started.res.json().state, started.verifier, cSession.access);
  assert.equal(wrongOwner.statusCode, 403);
  assert.equal(wrongOwner.json().error.code, 'LINK_OWNER_MISMATCH');

  const retry = await completeFlow(app, 'google', started.res.json().state, started.verifier, bSession.access);
  assert.equal(retry.statusCode, 401, 'the consumed state cannot be replayed by the rightful owner either');
  assert.equal(retry.json().error.code, 'OAUTH_FLOW_INVALID');
});

test('연결 flow에 bearer가 없으면 401 AUTH_REQUIRED이고 state는 소모된다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const bSession = await seedSession(WS01.b.member);
  const started = await startFlow(app, 'google', bSession.access);

  const anonymous = await completeFlow(app, 'google', started.res.json().state, started.verifier);
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().error.code, 'AUTH_REQUIRED');

  const later = await completeFlow(app, 'google', started.res.json().state, started.verifier, bSession.access);
  assert.equal(later.statusCode, 401);
  assert.equal(later.json().error.code, 'OAUTH_FLOW_INVALID');
});

test('다른 계정이 이미 소유한 소셜 신원 연결은 409 SOCIAL_LINK_CONFLICT', async t => {
  const app = makeApp(); t.after(() => app.close());
  exchangeBehaviour = async () => ({ subject: SUBJECT.b });
  t.after(() => { exchangeBehaviour = async () => ({ subject: SUBJECT.fresh }); });

  const cSession = await seedSession(WS01.c.member);
  const started = await startFlow(app, 'google', cSession.access);
  assert.equal(started.res.statusCode, 200);

  const conflict = await completeFlow(app, 'google', started.res.json().state, started.verifier, cSession.access);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'SOCIAL_LINK_CONFLICT');

  const links = (await pool.query(
    `SELECT principal_id FROM kg_membership.social_links WHERE provider='google' AND subject_digest=$1`,
    [subjectDigest('google', SUBJECT.b)])).rows;
  assert.equal(links.length, 1, 'a conflicting link must not be added');
  assert.equal(links[0].principal_id, WS01.b.principal, 'the original owner keeps the identity');
});

test('연결 성공은 LINKED로 응답하고 DB에 남으며, 같은 계정 재연결은 멱등이다', async t => {
  const app = makeApp(); t.after(() => app.close());
  exchangeBehaviour = async () => ({ subject: SUBJECT.fresh2 });
  t.after(() => { exchangeBehaviour = async () => ({ subject: SUBJECT.fresh }); });

  const cSession = await seedSession(WS01.c.member);
  const first = await startFlow(app, 'google', cSession.access);
  const linked = await completeFlow(app, 'google', first.res.json().state, first.verifier, cSession.access);
  assert.equal(linked.statusCode, 200);
  assert.equal(linked.json().outcome, 'LINKED');
  assert.equal(linked.json().provider, 'google');

  const stored = (await pool.query(
    `SELECT principal_id FROM kg_membership.social_links WHERE provider='google' AND subject_digest=$1`,
    [subjectDigest('google', SUBJECT.fresh2)])).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].principal_id, WS01.c.principal);

  const again = await startFlow(app, 'google', cSession.access);
  const relinked = await completeFlow(app, 'google', again.res.json().state, again.verifier, cSession.access);
  assert.equal(relinked.statusCode, 200);
  assert.equal(relinked.json().outcome, 'LINKED');
});
