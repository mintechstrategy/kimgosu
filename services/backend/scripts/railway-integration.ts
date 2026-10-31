// Executed only inside the exact approved Railway development PostgreSQL container.
// Real PostgreSQL + real loopback HTTP; provider/SMS doubles are explicitly test-only.
// Positive policy fixtures exist only in a transaction-local isolated schema, then ROLLBACK.
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { issueSession } from '../src/auth.ts';
import { digest, opaque, challenge, mac } from '../src/security.ts';
import type { Sql, Row } from '../src/app.ts';
import { postgresSql } from '../src/database.ts';

if (process.env.RAILWAY_PROJECT_ID !== '95b52b2c-e1c0-45da-909b-d7989ce08a90' || process.env.RAILWAY_ENVIRONMENT_ID !== 'a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18' || process.env.RAILWAY_SERVICE_ID !== 'eb0fec52-b955-4671-8f59-67a46fc1479d') throw new Error('exact development DB service required');
const pool = new pg.Pool({ host: '/var/run/postgresql', user: process.env.PGUSER ?? 'postgres', database: process.env.PGDATABASE ?? 'railway', password: process.env.PGPASSWORD, max: 4, statement_timeout: 10000 });
pool.on('error', () => {});
const client = await pool.connect();
let count = 0; const labels: string[] = []; const check = (label: string, condition: unknown) => { if (!condition) throw new Error('CHECK_FAILED:' + label); count++; labels.push(label); console.log(JSON.stringify({ check: label, status: 'PASS' })); };
const key = opaque();
let isolatedApp: ReturnType<typeof buildApp> | undefined;
let coreApp: ReturnType<typeof buildApp> | undefined;
const schema = 'kg_auth_test_' + randomUUID().replaceAll('-', '');
const rewrite = (text: string) => text.replaceAll('kg_membership', schema);
let savepoint = 0;
const isolated: Sql = {
  async query(text, values) { const r = await client.query(rewrite(text), values); return { rows: r.rows as Row[], rowCount: r.rowCount }; },
  async transaction(work) {
    const name = 'api_' + (++savepoint); await client.query('SAVEPOINT ' + name);
    try { const value = await work(isolated); await client.query('RELEASE SAVEPOINT ' + name); return value; }
    catch (error) { await client.query('ROLLBACK TO SAVEPOINT ' + name); await client.query('RELEASE SAVEPOINT ' + name); throw error; }
  },
};
const authHeader = (token: string) => ({ authorization: 'Bearer ' + token });
async function request(base: string, method: string, path: string, payload?: unknown, access?: string, extraHeaders?: Record<string, string>) {
  const r = await fetch(base + path, { method, headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...(access ? authHeader(access) : {}), ...extraHeaders }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  const text = await r.text(); return { status: r.status, data: text ? JSON.parse(text) : null, headers: r.headers };
}
try {
  await client.query("SET log_statement='none'; SET log_min_error_statement='panic'; BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
  for (const file of ['001_membership.sql', '002_auth_lifecycle.sql', '003_explicit_social_link.sql']) {
    let ddl = await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8');
    ddl = rewrite(ddl).replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
    await client.query(ddl);
  }
  await client.query('SET LOCAL ROLE kg_dev_runtime');
  let delivered = ''; let deliveryFail = false;
  let providerSubject = 'isolated-synthetic-subject';
  const provider = { authorize(state: string) { return 'https://provider.invalid/authorize?state=' + state; }, async exchange() { return { subject: providerSubject }; } };
  isolatedApp = buildApp(isolated, 'KG-AUTH-BACKEND-01-isolated-real-postgres', { identityKey: key, providers: { google: provider, naver: provider }, sms: { async send(_phone, code) { if (deliveryFail) throw new Error('synthetic failure'); delivered = code; } } });
  const base = await isolatedApp.listen({ host: '127.0.0.1', port: 0 });
  const call = (method: string, path: string, payload?: unknown, access?: string) => request(base, method, path, payload, access);
  let r = await call('GET', '/v1/auth/config'); check('isolated_draft_config_not_signup_ready', r.status === 200 && r.data.signupReady === false);
  const verifier = opaque(); r = await call('POST', '/v1/auth/social/start', { provider: 'google', codeChallenge: challenge(verifier) });
  const state = r.data.state; check('test_provider_start_real_db_state', r.status === 200 && Boolean(state));
  r = await call('POST', '/v1/auth/social/complete', { provider: 'google', state, code: opaque(), codeVerifier: opaque() }); check('pkce_mismatch_rejected', r.status === 401);
  r = await call('POST', '/v1/auth/social/complete', { provider: 'google', state, code: opaque(), codeVerifier: verifier });
  const ticket = r.data.registrationTicket; check('test_provider_verified_ticket_created', r.status === 200 && r.data.outcome === 'REGISTRATION_REQUIRED');
  r = await call('POST', '/v1/auth/social/complete', { provider: 'google', state, code: opaque(), codeVerifier: verifier }); check('oauth_state_replay_rejected', r.status === 401);
  const signup = { registrationTicket: ticket, name: '합성회원', email: 'synthetic@membership.invalid', age14Confirmed: true, expertRequested: true, consents: [{ kind: 'TERMS', version: 'test-only' }, { kind: 'PRIVACY_CONSENT', version: 'test-only' }] };
  r = await call('POST', '/v1/auth/signup', signup); check('unverified_phone_rejected', r.status === 409 && r.data.error.code === 'PHONE_VERIFICATION_REQUIRED');
  const phone = '010' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  r = await call('POST', '/v1/auth/sms/send', { registrationTicket: ticket, phone }); const smsId = r.data.challengeId;
  check('test_sms_delivery_creates_real_challenge_5digits_60seconds', r.status === 200 && delivered.length === 5 && r.data.expiresInSeconds === 60);
  r = await call('POST', '/v1/auth/sms/send', { registrationTicket: ticket, phone }); check('sms_resend_rate_limited', r.status === 429);
  r = await call('POST', '/v1/auth/sms/verify', { registrationTicket: ticket, challengeId: smsId, code: delivered === '00000' ? '11111' : '00000' });
  check('wrong_sms_attempt_persisted', r.status === 400 && Number((await isolated.query('SELECT attempts FROM kg_membership.sms_challenges WHERE id=$1', [smsId])).rows[0]?.attempts) === 1);
  r = await call('POST', '/v1/auth/sms/verify', { registrationTicket: ticket, challengeId: smsId, code: delivered }); check('test_sms_verifies_real_db_phone_digest', r.status === 200);
  r = await call('POST', '/v1/auth/signup', signup); check('unapproved_policies_reject_and_rollback_member', r.status === 409 && r.data.error.code === 'DOCUMENT_NOT_READY' && Number((await isolated.query('SELECT count(*) AS n FROM kg_membership.members')).rows[0].n) === 0);
  for (const kind of ['TERMS', 'PRIVACY_CONSENT', 'PRIVACY_POLICY', 'MARKETING']) await isolated.query(`INSERT INTO kg_membership.policy_documents(kind,version,status,title,body,body_sha256,operator_name,effective_at,approved_at) VALUES($1,'test-only','READY','TEST ONLY - NOT A REAL POLICY','isolated synthetic fixture',$2,'TEST FIXTURE',now()-interval '1 minute',now())`, [kind, digest('isolated synthetic fixture')]);
  r = await call('POST', '/v1/auth/signup', { ...signup, age14Confirmed: false }); check('under14_acknowledgement_rejected', r.status === 400);
  r = await call('POST', '/v1/auth/signup', { ...signup, email: '' }); check('required_email_rejected', r.status === 400);
  r = await call('POST', '/v1/auth/signup', { ...signup, consents: [...signup.consents, { kind: 'TERMS', version: 'test-only' }] }); check('duplicate_consent_rejected_and_rollback', r.status === 400);
  r = await call('POST', '/v1/auth/signup', signup); let session = r.data.session; check('isolated_signup_real_postgres_http_success', r.status === 200 && r.data.outcome === 'REGISTERED');
  r = await call('POST', '/v1/auth/signup', signup); check('registration_ticket_replay_rejected', r.status === 401);
  r = await call('GET', '/v1/me', undefined, session.accessToken); const member = r.data;
  check('signup_member_requery_new_number_auto_nickname_expert_immediate', r.status === 200 && member.expertActive === true && typeof member.customerNumber === 'string' && Array.from(member.nickname).length <= 10);
  check('age14_acknowledgement_timestamp_persisted_without_birthdate', Boolean((await isolated.query('SELECT age14_confirmed_at FROM kg_membership.members WHERE id=$1', [member.id])).rows[0].age14_confirmed_at));
  check('social_link_start_requires_session', (await call('POST', '/v1/me/social/link/start', { provider: 'naver', codeChallenge: challenge(opaque()), confirmed: true })).status === 401);
  check('social_link_requires_explicit_confirmation', (await call('POST', '/v1/me/social/link/start', { provider: 'naver', codeChallenge: challenge(opaque()), confirmed: false }, session.accessToken)).status === 400);
  const otherPrincipal = randomUUID(); const otherMember = randomUUID();
  await isolated.query('INSERT INTO kg_membership.principals(id) VALUES($1)', [otherPrincipal]);
  await isolated.query(`INSERT INTO kg_membership.members(id,principal_id,name,email,nickname) VALUES($1,$2,'별도합성','synthetic-other@membership.invalid','별도고수')`, [otherMember, otherPrincipal]);
  const otherSession = await issueSession(isolated, otherMember);
  let linkVerifier = opaque();
  r = await call('POST', '/v1/me/social/link/start', { provider: 'naver', codeChallenge: challenge(linkVerifier), confirmed: true }, session.accessToken);
  check('link_flow_bound_to_member_not_caller_id', (await call('POST', '/v1/auth/social/complete', { provider: 'naver', state: r.data.state, code: opaque(), codeVerifier: linkVerifier }, otherSession.accessToken)).status === 403);
  linkVerifier = opaque();
  r = await call('POST', '/v1/me/social/link/start', { provider: 'naver', codeChallenge: challenge(linkVerifier), confirmed: true }, session.accessToken);
  r = await call('POST', '/v1/auth/social/complete', { provider: 'naver', state: r.data.state, code: opaque(), codeVerifier: linkVerifier }, session.accessToken);
  check('explicit_dual_ownership_social_link_real_db', r.status === 200 && r.data.outcome === 'LINKED');
  providerSubject = 'already-owned-by-other-principal';
  await isolated.query(`INSERT INTO kg_membership.social_links(provider,subject_digest,principal_id) VALUES('naver',$1,$2)`, [mac(key, 'social:naver', providerSubject), otherPrincipal]);
  linkVerifier = opaque();
  r = await call('POST', '/v1/me/social/link/start', { provider: 'naver', codeChallenge: challenge(linkVerifier), confirmed: true }, session.accessToken);
  r = await call('POST', '/v1/auth/social/complete', { provider: 'naver', state: r.data.state, code: opaque(), codeVerifier: linkVerifier }, session.accessToken);
  check('social_link_conflict_never_auto_merges_principals', r.status === 409 && r.data.error.code === 'SOCIAL_LINK_CONFLICT' && (await isolated.query('SELECT principal_id FROM kg_membership.members WHERE id=$1', [otherMember])).rows[0].principal_id === otherPrincipal);
  providerSubject = 'isolated-synthetic-subject';
  const loginVerifier = opaque();
  r = await call('POST', '/v1/auth/social/start', { provider: 'google', codeChallenge: challenge(loginVerifier) });
  r = await call('POST', '/v1/auth/social/complete', { provider: 'google', state: r.data.state, code: opaque(), codeVerifier: loginVerifier });
  check('existing_social_login_issues_session_for_same_member', r.status === 200 && r.data.outcome === 'AUTHENTICATED' && (await call('GET', '/v1/me', undefined, r.data.session.accessToken)).data.id === member.id);
  r = await call('GET', '/v1/me/consents', undefined, session.accessToken); check('optional_marketing_declined_signup_still_succeeds', r.status === 200 && r.data.records.length === 2 && !r.data.records.some((d: Row) => d.kind === 'MARKETING'));
  r = await call('PATCH', '/v1/me/profile', { nickname: '열한글자이상닉네임입니다' }, session.accessToken); check('nickname_over10_rejected', r.status === 400);
  r = await call('PATCH', '/v1/me/profile', { nickname: '고수 님' }, session.accessToken); check('nickname_space_rejected', r.status === 400);
  r = await call('PATCH', '/v1/me/profile', { nickname: '새고수123' }, session.accessToken); check('nickname_change_real_db_success', r.status === 200);
  r = await call('PATCH', '/v1/me/notifications', { expectedVersion: 1, advertising: true }, session.accessToken); check('advertising_without_marketing_denied', r.status === 409);
  r = await call('POST', '/v1/me/consents', { consents: [...signup.consents, { kind: 'MARKETING', version: 'test-only' }] }, session.accessToken); check('distinct_marketing_grant_recorded', r.status === 200);
  r = await call('PATCH', '/v1/me/notifications', { expectedVersion: 1, advertising: true }, session.accessToken); check('advertising_on_after_consent', r.status === 200);
  r = await call('PATCH', '/v1/me/notifications', { expectedVersion: 2, advertising: false }, session.accessToken);
  const grants = await call('GET', '/v1/me/consents', undefined, session.accessToken); check('advertising_off_preserves_marketing_grant', r.status === 200 && grants.data.records.some((d: Row) => d.kind === 'MARKETING' && d.status === 'GRANTED'));
  await isolated.query(`INSERT INTO kg_membership.policy_documents(kind,version,status,title,body,body_sha256,operator_name,effective_at,approved_at) VALUES('MARKETING','test-only-v2','READY','TEST ONLY','isolated synthetic fixture',$1,'TEST FIXTURE',now(),now())`, [digest('isolated synthetic fixture')]);
  r = await call('PATCH', '/v1/me/notifications', { expectedVersion: 3, advertising: true }, session.accessToken);
  check('advertising_new_marketing_version_requires_current_grant', r.status === 409 && r.data.error.code === 'MARKETING_CONSENT_REQUIRED');
  r = await call('POST', '/v1/me/consents/withdraw', { kind: 'MARKETING' }, session.accessToken); check('marketing_withdrawal_persisted', r.status === 200 && (await call('GET', '/v1/me/consents', undefined, session.accessToken)).data.records.some((d: Row) => d.kind === 'MARKETING' && d.status === 'WITHDRAWN'));
  r = await call('POST', '/v1/me/consents/withdraw', { kind: 'TERMS' }, session.accessToken); check('essential_withdrawal_requires_explicit_account_confirmation', r.status === 409);
  await isolated.query(`INSERT INTO kg_membership.policy_documents(kind,version,status,title,body,body_sha256,operator_name,effective_at,approved_at) VALUES('TERMS','test-only-v2','READY','TEST ONLY','isolated synthetic fixture',$1,'TEST FIXTURE',now(),now())`, [digest('isolated synthetic fixture')]);
  r = await call('POST', '/v1/me/expert', { requested: true }, session.accessToken); check('policy_change_blocks_protected_write_until_reconsent', r.status === 403 && r.data.error.code === 'CONSENT_RENEWAL_REQUIRED');
  signup.consents[0].version = 'test-only-v2';
  r = await call('POST', '/v1/me/consents', { consents: signup.consents }, session.accessToken); check('new_policy_version_reconsent_persisted', r.status === 200);
  const oldAccess = session.accessToken; const oldRefresh = session.refreshToken;
  r = await call('POST', '/v1/auth/refresh', { refreshToken: oldRefresh }); session = r.data; check('refresh_rotates_session', r.status === 200);
  check('old_access_after_rotation_rejected', (await call('GET', '/v1/me', undefined, oldAccess)).status === 401);
  check('refresh_replay_denied', (await call('POST', '/v1/auth/refresh', { refreshToken: oldRefresh })).status === 401);
  check('refresh_replay_revokes_descendant_family', (await call('GET', '/v1/me', undefined, session.accessToken)).status === 401);
  session = await issueSession(isolated, member.id);
  check('withdraw_requires_true_confirmation', (await call('POST', '/v1/me/withdraw', { confirmed: false }, session.accessToken)).status === 400);
  r = await call('POST', '/v1/me/withdraw', { confirmed: true }, session.accessToken); check('withdrawal_real_db_retention_fields', r.status === 200 && r.data.rejoinResetsRetentionClock === false);
  check('all_old_member_sessions_rejected', (await call('GET', '/v1/me', undefined, session.accessToken)).status === 401);
  const original = (await isolated.query('SELECT * FROM kg_membership.members WHERE id=$1', [member.id])).rows[0];
  const principalId = original.principal_id;
  async function newTicket() { const raw = opaque(); const link = (await isolated.query('SELECT provider,subject_digest FROM kg_membership.social_links WHERE principal_id=$1', [principalId])).rows[0]; await isolated.query(`INSERT INTO kg_membership.registration_tickets(ticket_digest,provider,subject_digest,expires_at,phone_digest,phone_verified_at) VALUES($1,$2,$3,now()+interval '10 minutes',$4,now())`, [digest(raw), link.provider, link.subject_digest, original.phone_digest]); return raw; }
  signup.registrationTicket = await newTicket();
  r = await call('POST', '/v1/auth/signup', signup); check('rejoin_within30days_rejected', r.status === 409 && r.data.error.code === 'REJOIN_WAIT_REQUIRED');
  // Approved synthetic time-boundary fixture only; no existing member is changed.
  await isolated.query(`UPDATE kg_membership.members SET withdrawn_at=now()-interval '30 days',rejoin_after=now(),retention_until=(now()-interval '30 days')+interval '1 year' WHERE id=$1`, [member.id]);
  const beforeRetention = String((await isolated.query('SELECT retention_until FROM kg_membership.members WHERE id=$1', [member.id])).rows[0].retention_until);
  await isolated.query(`INSERT INTO kg_membership.restrictions(id,principal_id,reason,starts_at,ends_at) VALUES($1,$2,'TEST ONLY',now()-interval '1 day',now()+interval '1 day')`, [randomUUID(), principalId]);
  r = await call('POST', '/v1/auth/signup', signup); session = r.data.session; check('rejoin_at30day_boundary_succeeds', r.status === 200);
  r = await call('GET', '/v1/me', undefined, session.accessToken); const rejoined = r.data;
  check('rejoin_allocates_new_member_and_customer_number', rejoined.id !== member.id && rejoined.customerNumber !== member.customerNumber);
  check('active_restriction_inherited', rejoined.status === 'RESTRICTED' && rejoined.expertActive === false);
  check('restricted_profile_write_denied', (await call('PATCH', '/v1/me/profile', { nickname: '거부고수' }, session.accessToken)).status === 403);
  check('old_private_path_not_exposed', (await call('GET', '/v1/members/' + member.id, undefined, session.accessToken)).status === 404);
  const oldRetention = (await isolated.query('SELECT retention_until FROM kg_membership.members WHERE id=$1', [member.id])).rows[0].retention_until;
  check('rejoin_does_not_extend_old_retention_clock', beforeRetention === String(oldRetention));
  await isolated.query(`UPDATE kg_membership.restrictions SET ends_at=now()-interval '1 second' WHERE principal_id=$1`, [principalId]);
  check('expired_restriction_not_permanent', (await call('GET', '/v1/me', undefined, session.accessToken)).data.status === 'ACTIVE');
  check('new_member_has_fresh_notification_preferences', (await call('GET', '/v1/me/notifications', undefined, session.accessToken)).data.version === 1);
  check('logout_revokes_session', (await call('POST', '/v1/auth/logout', undefined, session.accessToken)).status === 200 && (await call('GET', '/v1/me', undefined, session.accessToken)).status === 401);
  // SMS resend invalidates prior code, expiry, max attempts, and delivery failure rollback.
  const extraTicket = await newTicket();
  r = await call('POST', '/v1/auth/sms/send', { registrationTicket: extraTicket, phone: '010' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0') });
  const expiredId = r.data.challengeId;
  await isolated.query(`UPDATE kg_membership.sms_challenges SET expires_at=now()-interval '1 second' WHERE id=$1`, [expiredId]);
  check('expired_sms_rejected', (await call('POST', '/v1/auth/sms/verify', { registrationTicket: extraTicket, challengeId: expiredId, code: delivered })).status === 400);
  await isolated.query(`UPDATE kg_membership.sms_challenges SET created_at=now()-interval '61 seconds' WHERE id=$1`, [expiredId]);
  const pd = (await isolated.query('SELECT phone_digest FROM kg_membership.sms_challenges WHERE id=$1', [expiredId])).rows[0].phone_digest;
  // Send a new, distinct phone on this ticket; the previous challenge must become invalidated.
  r = await call('POST', '/v1/auth/sms/send', { registrationTicket: extraTicket, phone: '010' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0') });
  check('resend_invalidates_previous_challenge', r.status === 200 && Boolean((await isolated.query('SELECT invalidated_at FROM kg_membership.sms_challenges WHERE id=$1', [expiredId])).rows[0].invalidated_at));
  const lockId = r.data.challengeId;
  for (let attempt = 0; attempt < 5; attempt++) await call('POST', '/v1/auth/sms/verify', { registrationTicket: extraTicket, challengeId: lockId, code: delivered === '00000' ? '11111' : '00000' });
  check('sms_five_attempt_lockout', (await call('POST', '/v1/auth/sms/verify', { registrationTicket: extraTicket, challengeId: lockId, code: delivered })).status === 400);
  const failTicket = await newTicket(); deliveryFail = true;
  const beforeSms = Number((await isolated.query('SELECT count(*) AS n FROM kg_membership.sms_challenges')).rows[0].n);
  r = await call('POST', '/v1/auth/sms/send', { registrationTicket: failTicket, phone: '010' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0') });
  check('sms_delivery_failure_rolls_back_challenge', r.status === 502 && Number((await isolated.query('SELECT count(*) AS n FROM kg_membership.sms_challenges')).rows[0].n) === beforeSms);
  await isolatedApp.close(); isolatedApp = undefined;
  await client.query('ROLLBACK');
  check('isolated_schema_and_fake_ready_documents_rolled_back', (await client.query('SELECT to_regnamespace($1) AS schema', [schema])).rows[0].schema === null);
  client.release();

  // Committed synthetic fixture in actual kg_membership: genuine pool/row-lock concurrency.
  // No real policy altered; create only this run's members, then retain them WITHDRAWN/revoke sessions.
  const runtime = new pg.Pool({ host: '/var/run/postgresql', user: process.env.PGUSER ?? 'postgres', database: process.env.PGDATABASE ?? 'railway', password: process.env.PGPASSWORD, max: 4, statement_timeout: 10000 });
  runtime.on('connect', c => { void c.query("SET log_statement='none'; SET log_min_error_statement='panic'; SET ROLE kg_dev_runtime"); });
  const db = postgresSql(runtime); const p1 = randomUUID(); const p2 = randomUUID(); const m1 = randomUUID(); const m2 = randomUUID();
  let a: Awaited<ReturnType<typeof issueSession>>; let b: Awaited<ReturnType<typeof issueSession>>;
  await db.transaction(async sql => {
    for (const [p, m] of [[p1, m1], [p2, m2]]) {
      await sql.query('INSERT INTO kg_membership.principals(id) VALUES($1)', [p]);
      await sql.query(`INSERT INTO kg_membership.members(id,principal_id,name,email,nickname) VALUES($1,$2,'합성검증','synthetic@membership.invalid','합성고수')`, [m, p]);
      await sql.query('INSERT INTO kg_membership.notification_preferences(member_id) VALUES($1)', [m]);
    }
    a = await issueSession(sql, m1); b = await issueSession(sql, m2);
  });
  coreApp = buildApp(db, 'KG-AUTH-BACKEND-01-actual-membership-schema');
  const coreBase = await coreApp.listen({ host: '127.0.0.1', port: 0 });
  try {
    r = await request(coreBase, 'GET', '/v1/auth/config'); check('actual_schema_provider_sms_signup_remain_disabled', !r.data.signupReady && !r.data.sms.available && r.data.providers.every((p: Row) => p.enabled === false));
    r = await request(coreBase, 'GET', '/v1/policies/OPERATIONS'); check('actual_operations_document_still_draft', r.status === 200 && r.data.status === 'DRAFT' && r.data.canConsent === false);
    check('actual_runtime_role_is_least_privilege', (await db.query('SELECT current_user AS role')).rows[0].role === 'kg_dev_runtime');
    check('actual_synthetic_member_requery', (await request(coreBase, 'GET', '/v1/me', undefined, a!.accessToken)).data.id === m1);
    const concurrent = await Promise.all([request(coreBase, 'PATCH', '/v1/me/notifications', { expectedVersion: 1, chat: true }, a!.accessToken), request(coreBase, 'PATCH', '/v1/me/notifications', { expectedVersion: 1, quote: true }, a!.accessToken)]);
    check('real_pool_concurrent_expected_version_one_winner_one409', concurrent.map(v => v.status).sort().join(',') === '200,409');
    r = await request(coreBase, 'GET', '/v1/me/notifications', undefined, a!.accessToken); check('actual_persisted_preference_version2', r.status === 200 && r.data.version === 2);
    r = await request(coreBase, 'GET', '/v1/me/notifications', undefined, b!.accessToken); check('other_member_preference_not_modified', r.data.version === 1 && !r.data.chat && !r.data.quote);
    check('other_member_id_injection_rejected', (await request(coreBase, 'PATCH', '/v1/me/notifications', { expectedVersion: 2, chat: true, memberId: m2 }, a!.accessToken)).status === 400);
    check('other_member_query_cannot_redirect_private_read', (await request(coreBase, 'GET', '/v1/me?memberId=' + m2, undefined, a!.accessToken)).data.id === m1);
    check('cors_exact_web_preflight', (await request(coreBase, 'OPTIONS', '/v1/me', undefined, undefined, { Origin: 'https://dev-kimgosu.mintech.ai', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' })).status === 204);
    check('cors_evil_origin_denied', (await request(coreBase, 'GET', '/health', undefined, undefined, { Origin: 'https://evil.invalid' })).status === 403);
    check('real_default_oauth_failclosed', (await request(coreBase, 'POST', '/v1/auth/social/start', { provider: 'google', codeChallenge: challenge(opaque()) })).status === 503);
    check('real_default_sms_failclosed', (await request(coreBase, 'POST', '/v1/auth/sms/send', { registrationTicket: opaque(), phone: '01000000000' })).status === 503);
    r = await request(coreBase, 'POST', '/v1/auth/refresh', { refreshToken: a!.refreshToken });
    a = r.data; check('actual_schema_refresh_rotation', r.status === 200);
    const races = await Promise.all([request(coreBase, 'POST', '/v1/me/withdraw', { confirmed: true }, a!.accessToken), request(coreBase, 'POST', '/v1/auth/refresh', { refreshToken: a!.refreshToken })]);
    check('withdraw_refresh_race_no500', races.every(v => [200, 401].includes(v.status)));
    check('withdrawn_old_access_refused_real_schema', (await request(coreBase, 'GET', '/v1/me', undefined, a!.accessToken)).status === 401);
  } finally {
    // Scope-specific, non-destructive cleanup: no DELETE/DROP, no other member touched.
    await db.transaction(async sql => {
      for (const m of [m1, m2]) {
        await sql.query(`UPDATE kg_membership.members SET status='WITHDRAWN',expert_active=false,withdrawn_at=COALESCE(withdrawn_at,now()),rejoin_after=COALESCE(rejoin_after,now()+interval '30 days'),retention_until=COALESCE(retention_until,now()+interval '1 year') WHERE id=$1`, [m]);
        await sql.query('UPDATE kg_membership.sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE member_id=$1', [m]);
        await sql.query('UPDATE kg_membership.notification_preferences SET advertising=false,chat=false,comment=false,quote=false,inquiry=false WHERE member_id=$1', [m]);
      }
    });
    const cleanup = (await db.query(`SELECT count(*)::integer AS retained,count(*) FILTER (WHERE withdrawn_at IS NOT NULL)::integer AS withdrawn FROM kg_membership.members WHERE id=ANY($1::uuid[])`, [[m1, m2]])).rows[0];
    const active = (await db.query('SELECT count(*)::integer AS n FROM kg_membership.sessions WHERE member_id=ANY($1::uuid[]) AND revoked_at IS NULL', [[m1, m2]])).rows[0];
    check('real_fixture_cleanup_readback_two_retained_withdrawn_zero_active_sessions', cleanup.retained === 2 && cleanup.withdrawn === 2 && active.n === 0);
    await coreApp.close(); coreApp = undefined; await runtime.end();
  }
  console.log(JSON.stringify({ task: 'KG-AUTH-BACKEND-01', status: 'PASS', at: new Date().toISOString(), checks: count, labels, realDatabase: true, actualHttp: true, externalOAuth: 'NOT_RUN', externalSms: 'NOT_RUN', positiveSignupPolicyFixtures: 'ISOLATED_SCHEMA_OUTER_TRANSACTION_ROLLED_BACK', committedSyntheticMembersRetainedWithdrawn: 2, existingDataDeleted: false }));
} catch (error) {
  // Never print pg details, request bodies, tokens, codes or assertion actual/expected objects.
  console.error(JSON.stringify({ task: 'KG-AUTH-BACKEND-01', status: 'FAIL', checksCompleted: count, reason: error instanceof Error && error.message.startsWith('CHECK_FAILED:') ? error.message : 'integration_error_details_withheld', errorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined }));
  process.exitCode = 1;
} finally {
  if (isolatedApp) await isolatedApp.close(); if (coreApp) await coreApp.close();
  try { await client.query('ROLLBACK'); client.release(); } catch {}
  await pool.end();
}
