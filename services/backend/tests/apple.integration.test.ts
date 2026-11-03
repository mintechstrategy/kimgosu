// WS-21 Apple 로그인(POST form_post 콜백) — 실제 PostgreSQL 통합 테스트.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest \
//     node --test tests/apple.integration.test.ts
//
// Apple 의 id_token 서명 검증은 실제 RSA 키로 검증한다. JWKS 는 로컬 HTTP 서버가
// 제공하며, 공급자 HTTP 만 대체하고 라우트·state 소비·트랜잭션·제약조건·세션은
// 실제 DB 에서 확인한다. loopback 이 아닌 DB 는 거부하고 truncate 한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { postgresSql } from '../src/database.ts';
import type { AuthOptions } from '../src/providers.ts';
import { realProvider } from '../src/providers.ts';
import { digest } from '../src/security.ts';

const DATABASE_URL = process.env.KG_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/kgtest';
const parsed = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('KG_TEST_DATABASE_URL must point at a loopback database; refusing to truncate a remote one');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const sql = postgresSql(pool);

const IDENTITY_KEY = 'ws21-apple-integration-identity-key-0123456789abcdef';
const CLIENT_ID = 'ai.mintech.kimgosu.web';
const KID = 'ws21-test-key';
const ISSUER = 'https://appleid.apple.com';

// --- 실제 RS256 키 + 로컬 JWKS 서버 ---------------------------------------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: forgedPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
const jwksBody = JSON.stringify({ keys: [publicJwk] });

let jwksPort = 0;
const jwksServer = createServer((req, res) => {
  if (req.url === '/auth/keys') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(jwksBody);
    return;
  }
  res.writeHead(404); res.end();
});
const jwksUrl = () => `http://127.0.0.1:${jwksPort}/auth/keys`;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function makeIdToken(claims: Record<string, unknown>, options: { kid?: string; key?: typeof privateKey; alg?: string } = {}): string {
  const header = { alg: options.alg ?? 'RS256', kid: options.kid ?? KID, typ: 'JWT' };
  const signingInput = b64(header) + '.' + b64(claims);
  if (header.alg !== 'RS256') return signingInput + '.' + 'Zm9yZ2Vk';
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signingInput), options.key ?? privateKey).toString('base64url');
  return signingInput + '.' + signature;
}

const now = () => Math.floor(Date.now() / 1000);
const claimsFor = (state: string, overrides: Record<string, unknown> = {}) => ({
  iss: ISSUER, aud: CLIENT_ID, sub: 'ws21-apple-subject-a',
  iat: now() - 5, exp: now() + 300, nonce: state,
  email: 'ws21-apple@example.invalid', email_verified: 'true',
  ...overrides,
});

const appleProvider = {
  authorize: (state: string) => `https://appleid.apple.com/auth/authorize?response_mode=form_post&state=${state}&nonce=${state}`,
  exchange: async () => { throw new Error('Apple POST callback must not use the code exchange'); },
  clientId: CLIENT_ID,
  jwksUrl: '',
  issuer: ISSUER,
};
const optionsWith = (overrides: Partial<AuthOptions> = {}): AuthOptions => ({
  identityKey: IDENTITY_KEY,
  providers: { apple: { ...appleProvider, jwksUrl: jwksUrl() } },
  ...overrides,
});
const makeApp = (options: AuthOptions = optionsWith()) => buildApp(sql, 'integration-local', options);

const startApple = (app: ReturnType<typeof makeApp>) =>
  app.inject({ method: 'POST', url: '/v1/auth/oauth/apple/start' });

const formPost = (app: ReturnType<typeof makeApp>, fields: Record<string, string>) =>
  app.inject({
    method: 'POST', url: '/v1/auth/oauth/apple/callback',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });

const countMembers = async () => (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.members`)).rows[0].n as number;
const memberByName = async (email: string) => (await pool.query(`SELECT id,name,email FROM kg_membership.members WHERE email=$1`, [email])).rows[0];

before(async () => {
  await new Promise<void>(resolve => jwksServer.listen(0, '127.0.0.1', () => resolve()));
  jwksPort = (jwksServer.address() as AddressInfo).port;
  await pool.query(`TRUNCATE kg_membership.consent_events, kg_membership.notification_preferences,
    kg_membership.sessions, kg_membership.sms_challenges, kg_membership.registration_tickets,
    kg_membership.oauth_flows, kg_membership.social_links, kg_membership.restrictions,
    kg_membership.members, kg_membership.principals CASCADE`);
});

after(async () => {
  await new Promise<void>(resolve => jwksServer.close(() => resolve()));
  await pool.end();
});

// --- 수용 기준 1: 012 적용 후 apple start 가 503 이 아니라 인가 URL 을 반환 -----

test('[수용1] apple start 는 200 + 인가 URL + state 를 반환하고 oauth_flows 에 apple flow 를 저장한다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const res = await startApple(app);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.provider, 'apple');
  assert.match(body.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(body.expiresInSeconds, 600);
  const url = new URL(body.authorizationUrl);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.searchParams.get('state'), body.state);
  assert.equal(url.searchParams.get('nonce'), body.state);

  const row = (await pool.query(`SELECT provider,consumed_at,
      expires_at BETWEEN now()+interval '9 minutes' AND now()+interval '11 minutes' AS window_ok
    FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(body.state)])).rows[0];
  assert.ok(row, 'the apple flow must be persisted (012 widened the provider CHECK)');
  assert.equal(row.provider, 'apple');
  assert.equal(row.consumed_at, null);
  assert.equal(row.window_ok, true);
});

test('[수용1] 실제 apple provider 는 form_post 인가 URL 을 만든다(response_mode/nonce)', () => {
  const provider = realProvider('apple', CLIENT_ID, 'synthetic-secret', 'https://dev-kimgosu.mintech.ai/v1/auth/oauth/apple/callback');
  const url = new URL(provider.authorize('S'.repeat(43), 'C'.repeat(43)));
  assert.equal(url.origin + url.pathname, 'https://appleid.apple.com/auth/authorize');
  assert.equal(url.searchParams.get('response_mode'), 'form_post');
  assert.equal(url.searchParams.get('nonce'), 'S'.repeat(43));
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.has('client_secret'), false);
});

// --- 수용 기준 2: user 가 있을 때 name 저장, 없을 때도 로그인 ----------------

test('[수용2] user(최초 로그인)가 있으면 이름을 파싱해 회원을 만들고 세션을 발급한다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const state = (await startApple(app)).json().state;
  const user = JSON.stringify({ name: { firstName: 'Minsoo', lastName: 'Kim' }, email: 'ws21-apple@example.invalid' });
  const res = await formPost(app, {
    id_token: makeIdToken(claimsFor(state, { sub: 'ws21-apple-subject-user' })),
    state,
    user,
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
  const body = res.json();
  assert.equal(body.outcome, 'REGISTERED');
  assert.equal(body.provider, 'apple');
  assert.ok(body.session.accessToken);

  const member = await memberByName('ws21-apple@example.invalid');
  assert.ok(member, 'the member must be persisted');
  assert.equal(member.id, body.member.id);
  assert.equal(member.name, 'Minsoo Kim', 'the Apple user.name block must be stored as the display name');

  const link = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.social_links WHERE provider='apple'`)).rows[0].n;
  assert.equal(link, 1, 'social_links must accept provider=apple');

  const me = await app.inject({ url: '/v1/me', headers: { authorization: 'Bearer ' + body.session.accessToken } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().name, 'Minsoo Kim');
});

test('[수용2] user 가 없는 재로그인도 새 회원 없이 로그인되고 저장된 이름이 유지된다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const before = await countMembers();
  const state = (await startApple(app)).json().state;
  const res = await formPost(app, {
    id_token: makeIdToken(claimsFor(state, { sub: 'ws21-apple-subject-user' })),
    state,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, 'AUTHENTICATED');
  assert.equal(await countMembers(), before, 'relogin must not create a second member');
  assert.equal((await memberByName('ws21-apple@example.invalid')).name, 'Minsoo Kim');
});

test('[수용2] user 없는 최초 로그인도 실패하지 않고 이메일 지역부를 표시명으로 쓴다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const state = (await startApple(app)).json().state;
  const res = await formPost(app, {
    id_token: makeIdToken(claimsFor(state, { sub: 'ws21-apple-subject-nouser', email: 'plainuser@example.invalid' })),
    state,
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
  assert.equal(res.json().outcome, 'REGISTERED');
  assert.equal((await memberByName('plainuser@example.invalid')).name, 'plainuser');
});

// --- 수용 기준 3: 위조 id_token 은 401 ---------------------------------------

test('[수용3] 다른 키로 서명한 id_token(같은 kid)은 401 로 거부되고 회원이 생기지 않는다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const before = await countMembers();
  const state = (await startApple(app)).json().state;
  const res = await formPost(app, {
    id_token: makeIdToken(claimsFor(state, { sub: 'ws21-forged-subject' }), { key: forgedPrivateKey }),
    state,
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'SOCIAL_AUTH_FAILED');
  assert.equal(await countMembers(), before, 'a forged token must not create a member');
});

test('[수용3] JWKS 에 없는 kid / alg=none / 서명 없는 토큰은 모두 401 이다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const before = await countMembers();
  const cases: [string, (state: string) => string][] = [
    ['unknown kid', state => makeIdToken(claimsFor(state, { sub: 'ws21-unknown-kid' }), { kid: 'not-published' })],
    ['alg none', state => makeIdToken(claimsFor(state, { sub: 'ws21-alg-none' }), { alg: 'none' })],
    ['not a jwt', () => 'header.payload'],
  ];
  for (const [label, build] of cases) {
    const state = (await startApple(app)).json().state;
    const res = await formPost(app, { id_token: build(state), state });
    assert.equal(res.statusCode, 401, label + ' -> ' + JSON.stringify(res.json()));
    assert.equal(res.json().error.code, 'SOCIAL_AUTH_FAILED', label);
  }
  assert.equal(await countMembers(), before);
});

test('[수용3] 클레임 불일치(aud/iss/exp/nonce)는 각각 401 이다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const variants: [string, (state: string) => Record<string, unknown>][] = [
    ['wrong aud', state => claimsFor(state, { aud: 'ai.mintech.other' })],
    ['wrong iss', state => claimsFor(state, { iss: 'https://accounts.google.com' })],
    ['expired', state => claimsFor(state, { iat: now() - 600, exp: now() - 60 })],
    ['nonce mismatch', () => claimsFor('Z'.repeat(43))],
    ['missing sub', state => claimsFor(state, { sub: '' })],
  ];
  for (const [label, build] of variants) {
    const state = (await startApple(app)).json().state;
    const res = await formPost(app, { id_token: makeIdToken(build(state)), state });
    assert.equal(res.statusCode, 401, label + ' -> ' + JSON.stringify(res.json()));
    assert.equal(res.json().error.code, 'SOCIAL_AUTH_FAILED', label);
  }
});

// --- 수용 기준 4: state 재사용·만료는 400 ------------------------------------

test('[수용4] 같은 state 재사용은 400 OAUTH_STATE_INVALID 이고 두 번째 로그인은 없다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const state = (await startApple(app)).json().state;
  const idToken = makeIdToken(claimsFor(state, { sub: 'ws21-replay-subject', email: 'replay@example.invalid' }));

  const first = await formPost(app, { id_token: idToken, state });
  assert.equal(first.statusCode, 200);
  const second = await formPost(app, { id_token: idToken, state });
  assert.equal(second.statusCode, 400);
  assert.equal(second.json().error.code, 'OAUTH_STATE_INVALID');

  const consumed = (await pool.query(`SELECT consumed_at FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(state)])).rows[0];
  assert.ok(consumed.consumed_at);
});

test('[수용4] 만료된 state 는 400 이다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const state = 'E'.repeat(43);
  await pool.query(`INSERT INTO kg_membership.oauth_flows(state_digest,provider,code_challenge,expires_at)
    VALUES($1,'apple',$2,now()-interval '1 second')`, [digest(state), 'F'.repeat(43)]);
  const res = await formPost(app, { id_token: makeIdToken(claimsFor(state)), state });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'OAUTH_STATE_INVALID');
});

test('[수용4] 다른 provider(kakao)의 state 를 apple 콜백에 쓰면 400 이고 그 flow 는 소비되지 않는다', async t => {
  const kakao = { authorize: (state: string) => `https://provider.invalid/authorize?state=${state}`, exchange: async () => ({ subject: 'x', name: 'x', email: 'x@example.invalid' }) };
  const app = makeApp({ identityKey: IDENTITY_KEY, providers: { kakao, apple: { ...appleProvider, jwksUrl: jwksUrl() } } });
  t.after(() => app.close());

  const state = (await app.inject({ method: 'POST', url: '/v1/auth/oauth/kakao/start' })).json().state;
  const res = await formPost(app, { id_token: makeIdToken(claimsFor(state)), state });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'OAUTH_STATE_INVALID');
  const row = (await pool.query(`SELECT provider,consumed_at FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(state)])).rows[0];
  assert.equal(row.provider, 'kakao');
  assert.equal(row.consumed_at, null, 'a mismatched provider must not burn the flow');
});

// --- JWKS 조회 실패는 503 ---------------------------------------------------

test('JWKS 조회 실패는 401 이 아니라 503 APPLE_JWKS_UNAVAILABLE 이다', async t => {
  const app = makeApp({ identityKey: IDENTITY_KEY, providers: { apple: { ...appleProvider, jwksUrl: 'http://127.0.0.1:1/auth/keys' } } });
  t.after(() => app.close());
  const before = await countMembers();
  const state = (await startApple(app)).json().state;
  const res = await formPost(app, { id_token: makeIdToken(claimsFor(state, { sub: 'ws21-jwks-down' })), state });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'APPLE_JWKS_UNAVAILABLE');
  assert.equal(await countMembers(), before);
});

// --- 설정·형식 오류 ---------------------------------------------------------

test('apple 자격증명이 없으면 POST 콜백은 503 PROVIDER_NOT_CONFIGURED 이다', async t => {
  const app = makeApp({ identityKey: IDENTITY_KEY, providers: {} }); t.after(() => app.close());
  const res = await formPost(app, { id_token: 'a.b.c', state: 'S'.repeat(43) });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'PROVIDER_NOT_CONFIGURED');
});

test('state/id_token 이 빠진 요청은 400 INVALID_REQUEST 이고 flow 를 소비하지 않는다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const state = (await startApple(app)).json().state;
  const missingToken = await formPost(app, { state });
  assert.equal(missingToken.statusCode, 400);
  assert.equal(missingToken.json().error.code, 'INVALID_REQUEST');

  const row = (await pool.query(`SELECT consumed_at FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(state)])).rows[0];
  assert.equal(row.consumed_at, null, 'schema-invalid requests must not consume the flow');
});

test('user JSON 이 깨져 있으면 400 이고 회원을 만들지 않는다', async t => {
  const app = makeApp(); t.after(() => app.close());
  const before = await countMembers();
  const state = (await startApple(app)).json().state;
  const res = await formPost(app, { id_token: makeIdToken(claimsFor(state, { sub: 'ws21-bad-user' })), state, user: '{not-json' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_REQUEST');
  assert.equal(await countMembers(), before);
});

test('form_post 본문은 charset 파라미터를 허용하고 중복 필드는 400 으로 거부한다', async t => {
  const app = makeApp(); t.after(() => app.close());

  // Apple 은 charset 파라미터를 붙여 보낼 수 있다. 같은 media type 이므로 파서가 받아야 한다.
  const state = (await startApple(app)).json().state;
  const withCharset = await app.inject({
    method: 'POST', url: '/v1/auth/oauth/apple/callback',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    payload: new URLSearchParams({ id_token: makeIdToken(claimsFor(state, { sub: 'ws21-charset', email: 'charset@example.invalid' })), state }).toString(),
  });
  assert.equal(withCharset.statusCode, 200, JSON.stringify(withCharset.json()));

  // 중복 state 는 어느 값이 진짜인지 모호하므로 받아들이지 않는다(flow 미소비).
  const dupState = (await startApple(app)).json().state;
  const duplicated = await app.inject({
    method: 'POST', url: '/v1/auth/oauth/apple/callback',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: `state=${dupState}&state=${dupState}&id_token=x.y.z`,
  });
  assert.equal(duplicated.statusCode, 400);
  assert.equal(duplicated.json().error.code, 'INVALID_REQUEST');
  const row = (await pool.query(`SELECT consumed_at FROM kg_membership.oauth_flows WHERE state_digest=$1`, [digest(dupState)])).rows[0];
  assert.equal(row.consumed_at, null);
});

// --- kakao/naver 회귀(이 파일 범위의 최소 확인) ------------------------------

test('kakao GET 콜백은 이 변경 후에도 그대로 동작한다', async t => {
  const kakao = { authorize: (state: string) => `https://provider.invalid/authorize?state=${state}`, exchange: async () => ({ subject: 'ws21-kakao-subject', name: '카카오', email: 'kakao@example.invalid' }) };
  const app = makeApp({ identityKey: IDENTITY_KEY, providers: { kakao, apple: { ...appleProvider, jwksUrl: jwksUrl() } } });
  t.after(() => app.close());
  const state = (await app.inject({ method: 'POST', url: '/v1/auth/oauth/kakao/start' })).json().state;
  const res = await app.inject({ url: `/v1/auth/oauth/kakao/callback?state=${state}&code=synthetic` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, 'REGISTERED');
  assert.equal(res.json().provider, 'kakao');
});
