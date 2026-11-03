// WS-12 회원가입 완성 — real-PostgreSQL integration test.
//
// Covers the two things this work extends:
//   1. the operator path that can turn DRAFT policy documents into READY
//      (never automatic), and
//   2. the readiness-gated registration endpoint `POST /v1/auth/register`
//      (required consent -> principal/member -> consent_events -> session),
//      plus consent withdrawal and its notification effect.
//
// Everything runs against a real loopback PostgreSQL with the real migrations and
// real Fastify routes. Only the social provider HTTP is a scripted double.
// The test seeds its own policy version and members, and deletes exactly those
// rows again in `after()`; the final assertions prove nothing was left behind.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest \
//     node --test tests/register.integration.test.ts

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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

const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const sql = postgresSql(pool);

const IDENTITY_KEY = 'ws12-integration-identity-key-0123456789abcdef';
const VERSION = `ws12-${randomUUID().slice(0, 8)}`;
const DOC: Record<string, { id: string; version: string }> = {};

const ADMIN = { member: randomUUID(), principal: randomUUID(), token: opaque() };
const OPERATOR = { member: randomUUID(), principal: randomUUID(), token: opaque() };

const syntheticProvider = {
  authorize: (state: string, codeChallenge: string) => `https://provider.invalid/authorize?state=${state}&code_challenge=${codeChallenge}`,
  exchange: async () => ({ subject: 'ws12-unused-subject' }),
};
const readyOptions: AuthOptions = {
  providers: { kakao: syntheticProvider, naver: syntheticProvider, google: syntheticProvider },
  sms: { send: async () => {} },
  identityKey: IDENTITY_KEY,
};
const readyApp = buildApp(sql, 'integration-register', readyOptions);
const unconfiguredApp = buildApp(sql, 'integration-register', {});

const bearer = (token: string) => ({ authorization: 'Bearer ' + token });

const createdMembers: string[] = [];
const createdTickets: string[] = [];

async function seedMember(account: { member: string; principal: string; token: string }, nickname: string, admin: boolean) {
  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [account.principal]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [account.member, account.principal, nickname, `${account.member.slice(0, 8)}@example.com`, nickname, sha(`phone-${account.member}`)],
  );
  await pool.query(
    `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
     VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`,
    [randomUUID(), account.member, digest(account.token), digest('refresh-' + account.token), randomUUID()],
  );
  if (admin) {
    await pool.query(
      `INSERT INTO kg_membership.role_grants(id,member_id,role_id,reason) VALUES($1,$2,'ADMIN','WS-12 통합테스트 관리자')`,
      [randomUUID(), account.member],
    );
  }
}

async function seedDraft(kind: string, body: string) {
  const result = await pool.query(
    `INSERT INTO kg_membership.policy_documents(kind,version,status,title,body,body_sha256)
     VALUES($1,$2,'DRAFT',$3,$4,$5) RETURNING id`,
    [kind, VERSION, `${kind} ${VERSION}`, body, sha(body)],
  );
  DOC[kind] = { id: String(result.rows[0].id), version: VERSION };
}

/** A verified registration ticket, exactly the shape /v1/auth/sms/verify leaves behind. */
async function issueRegistrationTicket(subject: string, phone: string) {
  const raw = opaque();
  const phoneDigest = sha(phone);
  await pool.query(
    `INSERT INTO kg_membership.registration_tickets(ticket_digest,provider,subject_digest,expires_at,phone_digest,phone_verified_at)
     VALUES($1,'kakao',$2,now()+interval '10 minutes',$3,now())`,
    [digest(raw), digest(`subject:${subject}`), phoneDigest],
  );
  createdTickets.push(digest(`subject:${subject}`));
  return { raw, phoneDigest };
}

const registrationBody = (ticket: string, consents: { kind: string; version: string }[]) => ({
  registrationTicket: ticket,
  name: '김고수',
  email: 'ws12@example.invalid',
  age14Confirmed: true as const,
  expertRequested: false,
  consents,
});

before(async () => {
  await pool.query(`TRUNCATE kg_membership.audit_log, kg_membership.agreements, kg_membership.ledger_notes,
    kg_membership.ledgers, kg_membership.role_grants, kg_membership.consent_events,
    kg_membership.notification_preferences, kg_membership.sessions, kg_membership.sms_challenges,
    kg_membership.registration_tickets, kg_membership.oauth_flows, kg_membership.social_links,
    kg_membership.restrictions, kg_membership.members, kg_membership.principals,
    kg_membership.policy_documents CASCADE`);

  await seedDraft('TERMS', `${VERSION} 이용약관 본문`);
  await seedDraft('PRIVACY_CONSENT', `${VERSION} 개인정보 수집·이용 동의 본문`);
  await seedDraft('PRIVACY_POLICY', `${VERSION} 개인정보 처리방침 본문`);
  await seedDraft('MARKETING', `${VERSION} 마케팅 정보 수신 동의 본문`);
  await seedDraft('OPERATIONS', `${VERSION} 서비스 운영정책 본문`);

  await seedMember(ADMIN, '관리자01', true);
  await seedMember(OPERATOR, '운영자02', false);
});

async function cleanup() {
  const principals: string[] = createdMembers.length > 0
    ? (await pool.query(`SELECT principal_id FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [createdMembers])).rows.map(r => String(r.principal_id))
    : [];
  if (createdMembers.length > 0) {
    await pool.query(`DELETE FROM kg_membership.consent_events WHERE member_id = ANY($1::uuid[])`, [createdMembers]);
    await pool.query(`DELETE FROM kg_membership.notification_preferences WHERE member_id = ANY($1::uuid[])`, [createdMembers]);
    await pool.query(`DELETE FROM kg_membership.sessions WHERE member_id = ANY($1::uuid[])`, [createdMembers]);
    await pool.query(`DELETE FROM kg_membership.social_links WHERE principal_id = ANY($1::uuid[])`, [principals]);
    await pool.query(`DELETE FROM kg_membership.audit_log WHERE actor_member_id = ANY($1::uuid[])`, [createdMembers]);
  }
  await pool.query(`DELETE FROM kg_membership.audit_log WHERE target_type='policy_document'
    AND target_id IN (SELECT id::text FROM kg_membership.policy_documents WHERE version=$1)`, [VERSION]);
  await pool.query(`DELETE FROM kg_membership.consent_events WHERE document_id IN
    (SELECT id FROM kg_membership.policy_documents WHERE version=$1)`, [VERSION]);
  await pool.query(`DELETE FROM kg_membership.policy_documents WHERE version=$1`, [VERSION]);
  if (createdTickets.length > 0) {
    await pool.query(`DELETE FROM kg_membership.registration_tickets WHERE subject_digest = ANY($1::char(64)[])`, [createdTickets]);
  }
  await pool.query(`DELETE FROM kg_membership.sessions WHERE member_id = ANY($1::uuid[])`, [[ADMIN.member, OPERATOR.member]]);
  await pool.query(`DELETE FROM kg_membership.role_grants WHERE member_id = ANY($1::uuid[])`, [[ADMIN.member, OPERATOR.member]]);
  if (createdMembers.length > 0) {
    await pool.query(`DELETE FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [createdMembers]);
    await pool.query(`DELETE FROM kg_membership.principals WHERE id = ANY($1::uuid[])`, [principals]);
  }
  await pool.query(`DELETE FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [[ADMIN.member, OPERATOR.member]]);
  await pool.query(`DELETE FROM kg_membership.principals WHERE id = ANY($1::uuid[])`, [[ADMIN.principal, OPERATOR.principal]]);
}

after(async () => {
  await cleanup();
  await readyApp.close();
  await unconfiguredApp.close();
  await pool.end();
});

// ---------------------------------------------------------------------------
// 1. DRAFT 상태에서는 가입이 열리지 않는다 (409 + 이유)
// ---------------------------------------------------------------------------
test('정책이 DRAFT이면 signupReady=false이고 가입은 409로 차단된다', async () => {
  const config = await readyApp.inject({ url: '/v1/auth/config' });
  assert.equal(config.statusCode, 200);
  assert.equal(config.json().signupReady, false, 'DRAFT 정책으로 가입이 열리면 안 된다');
  assert.ok(config.json().documents.every((d: { status: string }) => d.status === 'DRAFT'));

  const { raw } = await issueRegistrationTicket('draft-subject', '01090000001');
  const attempt = await readyApp.inject({
    method: 'POST', url: '/v1/auth/register',
    payload: registrationBody(raw, [{ kind: 'TERMS', version: VERSION }, { kind: 'PRIVACY_CONSENT', version: VERSION }]),
  });
  assert.equal(attempt.statusCode, 409);
  assert.equal(attempt.json().error.code, 'SIGNUP_NOT_READY');
  assert.ok(attempt.json().error.reasons.includes('POLICY_NOT_READY'), JSON.stringify(attempt.json()));
  assert.deepEqual(attempt.json().error.missingDocumentKinds.sort(), ['PRIVACY_CONSENT', 'PRIVACY_POLICY', 'TERMS'].sort());

  const members = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.social_links WHERE subject_digest=$1`,
    [digest('subject:draft-subject')],
  )).rows[0];
  assert.equal(members.n, 0, '차단된 가입은 principal/social link를 만들지 않는다');
});

test('공급자·본인확인 설정이 없어도 가입은 409이며 이유가 전부 응답에 있다', async () => {
  const { raw } = await issueRegistrationTicket('unconfigured-subject', '01090000002');
  const attempt = await unconfiguredApp.inject({
    method: 'POST', url: '/v1/auth/register',
    payload: registrationBody(raw, [{ kind: 'TERMS', version: VERSION }, { kind: 'PRIVACY_CONSENT', version: VERSION }]),
  });
  assert.equal(attempt.statusCode, 409);
  const reasons: string[] = attempt.json().error.reasons;
  for (const expected of ['IDENTITY_CONFIGURATION_REQUIRED', 'SMS_PROVIDER_NOT_CONFIGURED', 'SOCIAL_PROVIDER_NOT_CONFIGURED']) {
    assert.ok(reasons.includes(expected), `missing reason ${expected}: ${JSON.stringify(reasons)}`);
  }
});

// ---------------------------------------------------------------------------
// 2. 관리자 READY 전환 경로 (자동 전환 없음)
// ---------------------------------------------------------------------------
test('비관리자는 정책을 승격할 수 없다 (403)', async () => {
  const attempt = await readyApp.inject({
    method: 'POST', url: '/v1/admin/policies/promote', headers: bearer(OPERATOR.token),
    payload: { version: VERSION, operator: '민테크놀로지', effectiveAt: '2026-11-01T00:00:00+09:00', approvedAt: '2026-11-01T00:00:00+09:00', reason: '권한 없는 승격 시도', confirmed: true },
  });
  assert.equal(attempt.statusCode, 403);
  assert.equal(attempt.json().error.code, 'ADMIN_REQUIRED');

  const anonymous = await readyApp.inject({
    method: 'POST', url: '/v1/admin/policies/promote',
    payload: { version: VERSION, operator: '민테크놀로지', effectiveAt: '2026-11-01T00:00:00+09:00', approvedAt: '2026-11-01T00:00:00+09:00', reason: '익명 승격 시도', confirmed: true },
  });
  assert.equal(anonymous.statusCode, 401);

  const statuses = (await pool.query(`SELECT DISTINCT status FROM kg_membership.policy_documents WHERE version=$1`, [VERSION])).rows;
  assert.deepEqual(statuses.map(r => r.status), ['DRAFT'], '거부된 요청은 문서를 바꾸지 않는다');
});

test('관리자 승격은 DRAFT→READY를 실제로 반영하고 감사 기록을 남긴다', async () => {
  const promoted = await readyApp.inject({
    method: 'POST', url: '/v1/admin/policies/promote', headers: bearer(ADMIN.token),
    payload: { version: VERSION, operator: '민테크놀로지', effectiveAt: '2026-11-01T00:00:00+09:00', approvedAt: '2026-11-01T00:00:00+09:00', reason: 'WS-12 통합테스트 승격', confirmed: true },
  });
  assert.equal(promoted.statusCode, 200, promoted.body);
  const rows = promoted.json().promoted;
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r: { status: string; canConsent: boolean }) => r.status === 'READY' && r.canConsent === true));

  // 재조회: DB와 공개 정책 API가 같은 상태를 보여준다.
  const stored = (await pool.query(
    `SELECT kind,status,operator_name,effective_at IS NOT NULL AS eff,approved_at IS NOT NULL AS appr
       FROM kg_membership.policy_documents WHERE version=$1 ORDER BY kind`, [VERSION],
  )).rows;
  assert.equal(stored.length, 5);
  assert.ok(stored.every(r => r.status === 'READY' && r.operator_name === '민테크놀로지' && r.eff && r.appr));

  const publicList = await readyApp.inject({ url: '/v1/policies' });
  const publicRows = publicList.json().documents.filter((d: { version: string }) => d.version === VERSION);
  assert.equal(publicRows.length, 5);
  assert.ok(publicRows.every((d: { status: string; canConsent: boolean }) => d.status === 'READY' && d.canConsent === true));

  const audit = (await pool.query(
    `SELECT actor_member_id,action,reason,detail FROM kg_membership.audit_log
      WHERE action='POLICY_PROMOTED' AND target_id IN (SELECT id::text FROM kg_membership.policy_documents WHERE version=$1)`,
    [VERSION],
  )).rows;
  assert.equal(audit.length, 5);
  assert.ok(audit.every(r => r.actor_member_id === ADMIN.member && r.reason === 'WS-12 통합테스트 승격'));
  assert.ok(audit.every(r => r.detail.version === VERSION));

  const config = await readyApp.inject({ url: '/v1/auth/config' });
  assert.equal(config.json().signupReady, true, '설정이 전부 준비되면 signupReady가 true가 된다');

  const again = await readyApp.inject({
    method: 'POST', url: '/v1/admin/policies/promote', headers: bearer(ADMIN.token),
    payload: { version: VERSION, operator: '민테크놀로지', effectiveAt: '2026-11-01T00:00:00+09:00', approvedAt: '2026-11-01T00:00:00+09:00', reason: '중복 승격 시도', confirmed: true },
  });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'POLICY_NOT_DRAFT');
});

// ---------------------------------------------------------------------------
// 3. 가입: 필수 동의 검증 / 실제 3개 테이블 기록 / 세션
// ---------------------------------------------------------------------------
const CUSTOMER = { subject: 'ws12-customer', phone: '01090000010' };
let customerTicket = '';
let customerToken = '';
let customerMemberId = '';

test('필수 동의가 빠지면 400이고 아무 행도 생기지 않는다', async () => {
  const { raw } = await issueRegistrationTicket(CUSTOMER.subject, CUSTOMER.phone);
  customerTicket = raw;

  const missing = await readyApp.inject({
    method: 'POST', url: '/v1/auth/register',
    payload: registrationBody(raw, [{ kind: 'TERMS', version: VERSION }, { kind: 'MARKETING', version: VERSION }]),
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, 'REQUIRED_CONSENT_MISSING');

  const staleVersion = await readyApp.inject({
    method: 'POST', url: '/v1/auth/register',
    payload: registrationBody(raw, [{ kind: 'TERMS', version: 'v-does-not-exist' }, { kind: 'PRIVACY_CONSENT', version: VERSION }]),
  });
  assert.equal(staleVersion.statusCode, 409);
  assert.equal(staleVersion.json().error.code, 'POLICY_VERSION_CHANGED');

  const counted = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.social_links WHERE subject_digest=$1`,
    [digest(`subject:${CUSTOMER.subject}`)],
  )).rows[0];
  assert.equal(counted.n, 0);
});

test('마케팅을 뺀 가입은 통과하고 members/principals/consent_events에 실제 행이 생긴다', async () => {
  const res = await readyApp.inject({
    method: 'POST', url: '/v1/auth/register',
    payload: registrationBody(customerTicket, [{ kind: 'TERMS', version: VERSION }, { kind: 'PRIVACY_CONSENT', version: VERSION }]),
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().outcome, 'REGISTERED');
  assert.match(res.json().session.accessToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(res.json().session.tokenType, 'Bearer');
  assert.equal(res.json().session.expiresInSeconds, 900);
  customerToken = res.json().session.accessToken;

  // 3개 테이블 실제 행 확인 (재조회)
  const social = (await pool.query(
    `SELECT principal_id FROM kg_membership.social_links WHERE provider='kakao' AND subject_digest=$1`,
    [digest(`subject:${CUSTOMER.subject}`)],
  )).rows[0];
  assert.ok(social, 'principal/social link must exist');

  const member = (await pool.query(
    `SELECT id,name,email,status,expert_active FROM kg_membership.members WHERE principal_id=$1 AND withdrawn_at IS NULL`,
    [social.principal_id],
  )).rows[0];
  assert.ok(member, 'member must exist');
  assert.equal(member.name, '김고수');
  assert.equal(member.status, 'ACTIVE');
  assert.equal(member.expert_active, false);
  customerMemberId = member.id;
  createdMembers.push(member.id);

  const events = (await pool.query(
    `SELECT d.kind,e.action FROM kg_membership.consent_events e
       JOIN kg_membership.policy_documents d ON d.id=e.document_id
      WHERE e.member_id=$1 ORDER BY e.id`, [customerMemberId],
  )).rows;
  assert.deepEqual(events.map(e => e.kind).sort(), ['PRIVACY_CONSENT', 'TERMS']);
  assert.ok(events.every(e => e.action === 'GRANTED'));

  // principals 행 자체도 실제로 존재해야 한다(3개 테이블 확인).
  const principalRow = (await pool.query(
    `SELECT id FROM kg_membership.principals WHERE id=$1`, [social.principal_id],
  )).rows[0];
  assert.ok(principalRow, 'principals row must exist');

  const ticket = (await pool.query(
    `SELECT consumed_at FROM kg_membership.registration_tickets WHERE ticket_digest=$1`, [digest(customerTicket)],
  )).rows[0];
  assert.ok(ticket.consumed_at, 'the registration ticket must be consumed');

  // 세션 재사용: 실제로 발급한 토큰으로 /v1/me 조회
  const me = await readyApp.inject({ url: '/v1/me', headers: bearer(customerToken) });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().name, '김고수');
  assert.equal(me.json().status, 'ACTIVE');
  assert.match(String(me.json().customerNumber), /^[0-9]+$/);

  const consents = await readyApp.inject({ url: '/v1/me/consents', headers: bearer(customerToken) });
  const kinds = consents.json().records.map((r: { kind: string }) => r.kind).sort();
  assert.deepEqual(kinds, ['PRIVACY_CONSENT', 'TERMS'], '마케팅 미동의 시 MARKETING 이력이 없어야 한다');

  const notifications = await readyApp.inject({ url: '/v1/me/notifications', headers: bearer(customerToken) });
  // notification_preferences.version starts at 1 (001_membership.sql DEFAULT 1).
  assert.deepEqual(notifications.json(), { advertising: false, chat: false, comment: false, quote: false, inquiry: false, version: 1 });
});

test('소비된 가입 티켓 재사용은 401이며 회원이 중복 생성되지 않는다', async () => {
  const again = await readyApp.inject({
    method: 'POST', url: '/v1/auth/register',
    payload: registrationBody(customerTicket, [{ kind: 'TERMS', version: VERSION }, { kind: 'PRIVACY_CONSENT', version: VERSION }]),
  });
  assert.equal(again.statusCode, 401);
  assert.equal(again.json().error.code, 'REGISTRATION_INVALID');

  const members = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.members WHERE phone_digest=$1`, [sha(CUSTOMER.phone)],
  )).rows[0];
  assert.equal(members.n, 1);
});

// ---------------------------------------------------------------------------
// 4. 마케팅 동의 → 알림 허용 → 철회 → 알림 중단 + 철회 이력
// ---------------------------------------------------------------------------
test('마케팅 동의 후 철회하면 알림이 꺼지고 /v1/me/consents가 철회를 반환한다', async () => {
  const { raw } = await issueRegistrationTicket('ws12-marketing', '01090000020');
  const registered = await readyApp.inject({
    method: 'POST', url: '/v1/auth/register',
    payload: registrationBody(raw, [
      { kind: 'TERMS', version: VERSION }, { kind: 'PRIVACY_CONSENT', version: VERSION }, { kind: 'MARKETING', version: VERSION },
    ]),
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const token = registered.json().session.accessToken;
  const member = (await pool.query(
    `SELECT id FROM kg_membership.members WHERE phone_digest=$1`, [sha('01090000020')],
  )).rows[0];
  createdMembers.push(member.id);

  // 동의만으로 광고성 알림이 켜지지는 않는다 (별도 옵트인 필요).
  const before = await readyApp.inject({ url: '/v1/me/notifications', headers: bearer(token) });
  assert.equal(before.json().advertising, false);

  const optedIn = await readyApp.inject({
    method: 'PATCH', url: '/v1/me/notifications', headers: bearer(token),
    payload: { expectedVersion: before.json().version, advertising: true },
  });
  assert.equal(optedIn.statusCode, 200, optedIn.body);
  assert.equal(optedIn.json().advertising, true);

  const withdrawn = await readyApp.inject({
    method: 'POST', url: '/v1/me/consents/withdraw', headers: bearer(token), payload: { kind: 'MARKETING' },
  });
  assert.equal(withdrawn.statusCode, 200);
  assert.equal(withdrawn.json().withdrawn, true);

  const after = await readyApp.inject({ url: '/v1/me/notifications', headers: bearer(token) });
  assert.equal(after.json().advertising, false, '철회 후 광고성 알림은 꺼져 있어야 한다');

  const consents = await readyApp.inject({ url: '/v1/me/consents', headers: bearer(token) });
  const marketing = consents.json().records.find((r: { kind: string }) => r.kind === 'MARKETING');
  assert.ok(marketing, 'MARKETING 이력이 보여야 한다');
  assert.equal(marketing.status, 'WITHDRAWN', JSON.stringify(consents.json().records));

  const events = (await pool.query(
    `SELECT e.action FROM kg_membership.consent_events e JOIN kg_membership.policy_documents d ON d.id=e.document_id
      WHERE e.member_id=$1 AND d.kind='MARKETING' ORDER BY e.id`, [member.id],
  )).rows.map(r => r.action);
  assert.deepEqual(events, ['GRANTED', 'WITHDRAWN']);

  const reOptIn = await readyApp.inject({
    method: 'PATCH', url: '/v1/me/notifications', headers: bearer(token),
    payload: { expectedVersion: optedIn.json().version, advertising: true },
  });
  assert.equal(reOptIn.statusCode, 409);
  assert.equal(reOptIn.json().error.code, 'MARKETING_CONSENT_REQUIRED');
});

// ---------------------------------------------------------------------------
// 5. 정리 확인 — 이 테스트가 만든 행이 남아 있지 않다
// ---------------------------------------------------------------------------
test('테스트가 만든 정책·회원 데이터가 남지 않는다', async () => {
  await cleanup();
  const docs = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.policy_documents WHERE version=$1`, [VERSION])).rows[0];
  assert.equal(docs.n, 0);
  const tickets = (await pool.query(`SELECT count(*)::int AS n FROM kg_membership.registration_tickets WHERE provider='kakao'`)).rows[0];
  assert.equal(tickets.n, 0);
  const leftover = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.members WHERE phone_digest = ANY($1::char(64)[])`,
    [[sha(CUSTOMER.phone), sha('01090000020')]],
  )).rows[0];
  assert.equal(leftover.n, 0);
  assert.ok(customerMemberId.length > 0);
});
