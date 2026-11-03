// WS-11 정식 소셜 로그인(kakao/naver/apple) — 실제 PostgreSQL 통합 테스트.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest \
//     node --test tests/oauth.integration.test.ts
//
// 공급자 HTTP만 scripted double이며, 라우트·트랜잭션·제약조건·세션 발급은
// 실제 DB에서 검증한다. loopback이 아닌 DB는 거부하고 truncate한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { postgresSql } from '../src/database.ts';
import type { AuthOptions } from '../src/providers.ts';
import { digest } from '../src/security.ts';

const DATABASE_URL = process.env.KG_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/kgtest';
const parsed = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('KG_TEST_DATABASE_URL must point at a loopback database; refusing to truncate a remote one');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const sql = postgresSql(pool);

const IDENTITY_KEY = 'ws11-oauth-integration-identity-key-0123456789abcdef';

interface Identity { subject: string; name?: string; email?: string }
let identity: Identity = { subject: 'ws11-subject-a', name: '김고수', email: 'ws11@example.com' };
const syntheticProvider = {
  authorize: (state: string, codeChallenge: string) =>
    `https://provider.invalid/authorize?response_type=code&state=${state}&code_challenge=${codeChallenge}`,
  exchange: async () => identity,
};
const baseOptions: AuthOptions = {
  providers: { kakao: syntheticProvider, naver: syntheticProvider, apple: syntheticProvider },
  identityKey: IDENTITY_KEY,
};
const makeApp = (options: AuthOptions = baseOptions) => buildApp(sql, 'integration-local', options);

before(async () => {
  await pool.query(`TRUNCATE kg_membership.consent_events, kg_membership.notification_preferences,
    kg_membership.sessions, kg_membership.sms_challenges, kg_membership.registration_tickets,
    kg_membership.oauth_flows, kg_membership.social_links, kg_membership.restrictions,
    kg_membership.members, kg_membership.principals CASCADE`);
});

after(async () => {
  await pool.end();
});

const startOauth = (app: ReturnType<typeof makeApp>, provider: string) =>
  app.inject({ method: 'POST', url: `/v1/auth/oauth/${provider}/start` });

const callbackOauth = (app: ReturnType<typeof makeApp>, provider: string, state: string, extra = '') =>
  app.inject({ url: `/v1/auth/oauth/${provider}/callback?state=${state}&code=synthetic-authorization-code${extra}` });

const countMembers = async () => (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.members`)).rows[0].n as number;

// --- 수용 기준 1: start가 인가 URL·state를 반환하고 flow가 DB에 남는다 -------

for (const provider of ['kakao', 'naver'] as const) {
  test(`[수용1] ${provider} start: 인가 URL + state 반환, oauth_flows에 10분 만료 flow 저장`, async t => {
    const app = makeApp(); t.after(() => app.close());
    const res = await startOauth(app, provider);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.provider, provider);
    assert.match(body.state, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(body.expiresInSeconds, 600);
    const url = new URL(body.authorizationUrl);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.searchParams.get('state'), body.state);
    assert.equal(url.searchParams.has('client_secret'), false, 'client secret must never reach the browser');

    const row = (await pool.query(
      `SELECT provider,consumed_at,
              expires_at BETWEEN now()+interval '9 minutes' AND now()+interval '11 minutes' AS window_ok
         FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(body.state)])).rows[0];
    assert.ok(row, 'the flow must be persisted');
    assert.equal(row.provider, provider);
    assert.equal(row.consumed_at, null);
    assert.equal(row.window_ok, true, 'state TTL must be 10 minutes');
  });
}

test('[수용1] apple start는 012 적용 후 인가 URL을 반환하고 apple flow를 저장한다', async t => {
  // 012_apple_provider.sql 이 oauth_flows/social_links 의 provider CHECK 에 apple 을
  // 추가했다. 이전에는 503 PROVIDER_SCHEMA_PENDING 으로 정직하게 거부했다.
  const app = makeApp(); t.after(() => app.close());
  const res = await startOauth(app, 'apple');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().provider, 'apple');
  assert.ok(new URL(res.json().authorizationUrl).searchParams.get('state'));
  const stored = (await pool.query(`SELECT consumed_at FROM kg_membership.oauth_flows WHERE state_digest=$1`,
    [digest(res.json().state)])).rows[0];
  assert.ok(stored, 'the apple flow must be persisted');
  assert.equal(stored.consumed_at, null);
});

// --- 수용 기준 2: state 재사용·만료·provider 불일치 거부 --------------------

test('[수용2] 소비된 state 재사용은 401 OAUTH_STATE_INVALID', async t => {
  const app = makeApp(); t.after(() => app.close());
  const started = await startOauth(app, 'kakao');
  const state = started.json().state;
  identity = { subject: 'ws11-replay-subject', name: '재사용', email: 'replay@example.com' };

  const first = await callbackOauth(app, 'kakao', state);
  assert.equal(first.statusCode, 200);

  const replay = await callbackOauth(app, 'kakao', state);
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.json().error.code, 'OAUTH_STATE_INVALID');

  const consumed = (await pool.query(`SELECT consumed_at FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(state)])).rows[0];
  assert.ok(consumed.consumed_at, 'the flow must be marked consumed in the database');
});

test('[수용2] 만료된 state는 401 OAUTH_STATE_INVALID', async t => {
  const app = makeApp(); t.after(() => app.close());
  const state = 'E'.repeat(43);
  await pool.query(`INSERT INTO kg_membership.oauth_flows(state_digest,provider,code_challenge,expires_at)
    VALUES($1,'kakao',$2,now()-interval '1 second')`, [digest(state), 'F'.repeat(43)]);
  const res = await callbackOauth(app, 'kakao', state);
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'OAUTH_STATE_INVALID');
});

test('[수용2] provider 불일치 콜백은 401이며 다른 provider의 flow를 소비하지 않는다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const started = await startOauth(app, 'kakao');
  const state = started.json().state;

  const mismatched = await callbackOauth(app, 'naver', state);
  assert.equal(mismatched.statusCode, 401);
  assert.equal(mismatched.json().error.code, 'OAUTH_STATE_INVALID');

  const untouched = (await pool.query(`SELECT consumed_at,provider FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(state)])).rows[0];
  assert.equal(untouched.consumed_at, null, 'a mismatched provider must not burn the flow');
  assert.equal(untouched.provider, 'kakao');

  identity = { subject: 'ws11-mismatch-subject', name: '불일치', email: 'mismatch@example.com' };
  const correct = await callbackOauth(app, 'kakao', state);
  assert.equal(correct.statusCode, 200, 'the rightful provider can still complete the flow');
});

// --- 수용 기준 3: 미설정 provider는 503, auth/config는 connected:false ------

test('[수용3] 자격증명 미설정 provider는 503 PROVIDER_NOT_CONFIGURED, auth/config는 connected:false로 일치', async t => {
  const app = makeApp({}); t.after(() => app.close());

  const config = await app.inject({ url: '/v1/auth/config' });
  assert.equal(config.statusCode, 200);
  const providers = config.json().oauth.providers as { id: string; connected: boolean }[];
  assert.deepEqual(providers.map(p => p.id).sort(), ['apple', 'kakao', 'naver']);
  assert.ok(providers.every(p => p.connected === false), 'no credential is configured in this test');
  assert.equal(config.json().oauth.stateTtlSeconds, 600);

  const before = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.oauth_flows`)).rows[0].n;
  for (const provider of ['kakao', 'naver', 'apple']) {
    const res = await startOauth(app, provider);
    assert.equal(res.statusCode, 503, provider);
    assert.equal(res.json().error.code, 'PROVIDER_NOT_CONFIGURED', provider);
  }
  const stored = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.oauth_flows`)).rows[0].n;
  assert.equal(stored, before, 'a refused provider must not create a flow');
});

test('[수용3] 자격증명이 있으면 auth/config가 connected:true를 노출한다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const config = await app.inject({ url: '/v1/auth/config' });
  const providers = config.json().oauth.providers as { id: string; connected: boolean }[];
  assert.deepEqual(providers.map(p => [p.id, p.connected]), [['kakao', true], ['naver', true], ['apple', true]]);
});

// --- 수용 기준 4: 같은 (provider, providerUserId) 재로그인은 새 회원을 만들지 않는다

test('[수용4] 같은 (provider, subject) 재로그인은 회원을 늘리지 않고 새 세션만 발급한다', async t => {
  const app = makeApp(); t.after(() => app.close());
  identity = { subject: 'ws11-relogin-subject', name: '재로그인', email: 'relogin@example.com' };

  const first = await startOauth(app, 'naver');
  const firstDone = await callbackOauth(app, 'naver', first.json().state);
  assert.equal(firstDone.statusCode, 200);
  assert.equal(firstDone.json().outcome, 'REGISTERED');
  const memberId = firstDone.json().member.id;
  const membersAfterFirst = await countMembers();

  const second = await startOauth(app, 'naver');
  const secondDone = await callbackOauth(app, 'naver', second.json().state);
  assert.equal(secondDone.statusCode, 200);
  assert.equal(secondDone.json().outcome, 'AUTHENTICATED');
  assert.equal(secondDone.json().member.id, memberId);
  assert.equal(await countMembers(), membersAfterFirst, 'relogin must not create a second member');
  assert.notEqual(secondDone.json().session.accessToken, firstDone.json().session.accessToken);

  const me = await app.inject({ url: '/v1/me', headers: { authorization: 'Bearer ' + secondDone.json().session.accessToken } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().id, memberId);
});

test('[수용4] 같은 사람이라도 SNS 계정이 다르면 별도 회원(별도 고객번호)이다', async t => {
  const app = makeApp(); t.after(() => app.close());
  identity = { subject: 'ws11-person-kakao', name: '동일인', email: 'same@example.com' };
  const viaKakao = await callbackOauth(app, 'kakao', (await startOauth(app, 'kakao')).json().state);
  assert.equal(viaKakao.statusCode, 200);

  // 같은 이메일이어도 다른 provider/subject면 다른 회원이다.
  identity = { subject: 'ws11-person-naver', name: '동일인', email: 'same@example.com' };
  const viaNaver = await callbackOauth(app, 'naver', (await startOauth(app, 'naver')).json().state);
  assert.equal(viaNaver.statusCode, 200);

  assert.notEqual(viaKakao.json().member.id, viaNaver.json().member.id);
  assert.notEqual(viaKakao.json().member.customerNumber, viaNaver.json().member.customerNumber);
});

// --- 부가 경로: 취소, 프로필 부재, 미래 재가입 대기 -------------------------

test('사용자 취소(error 파라미터)는 401 SOCIAL_AUTH_CANCELLED이고 state는 소모된다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const state = (await startOauth(app, 'kakao')).json().state;
  const res = await app.inject({ url: `/v1/auth/oauth/kakao/callback?state=${state}&error=access_denied` });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'SOCIAL_AUTH_CANCELLED');

  const row = (await pool.query(`SELECT consumed_at FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(state)])).rows[0];
  assert.ok(row.consumed_at);

  const retry = await callbackOauth(app, 'kakao', state);
  assert.equal(retry.statusCode, 401);
  assert.equal(retry.json().error.code, 'OAUTH_STATE_INVALID');
});

test('provider가 프로필을 주지 않으면 회원을 임의 생성하지 않고 409 PROFILE_INCOMPLETE', async t => {
  const app = makeApp(); t.after(() => app.close());
  const before = await countMembers();
  identity = { subject: 'ws11-no-profile-subject' };
  const res = await callbackOauth(app, 'kakao', (await startOauth(app, 'kakao')).json().state);
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'PROFILE_INCOMPLETE');
  assert.equal(await countMembers(), before, 'incomplete profile must not create a member');
  identity = { subject: 'ws11-subject-a', name: '김고수', email: 'ws11@example.com' };
});

test('탈퇴 대기 중인 소셜 신원은 409 REJOIN_WAIT_REQUIRED로 거부된다', async t => {
  const app = makeApp(); t.after(() => app.close());
  identity = { subject: 'ws11-withdrawn-subject', name: '탈퇴자', email: 'withdrawn@example.com' };
  const first = await callbackOauth(app, 'kakao', (await startOauth(app, 'kakao')).json().state);
  assert.equal(first.statusCode, 200);
  const memberId = first.json().member.id;

  await pool.query(`UPDATE kg_membership.members SET status='WITHDRAWN',withdrawn_at=now(),
    rejoin_after=now()+interval '30 days',retention_until=now()+interval '1 year' WHERE id=$1`, [memberId]);

  const second = await callbackOauth(app, 'kakao', (await startOauth(app, 'kakao')).json().state);
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, 'REJOIN_WAIT_REQUIRED');
  assert.ok(second.json().error.rejoinAfter);
  assert.ok(second.json().error.serverTime);
});

test('잘못된 provider 경로 값은 flow를 만들기 전에 400으로 거부된다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const before = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.oauth_flows`)).rows[0].n;
  const res = await startOauth(app, 'google');
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_REQUEST');
  const afterCount = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.oauth_flows`)).rows[0].n;
  assert.equal(afterCount, before);
});
