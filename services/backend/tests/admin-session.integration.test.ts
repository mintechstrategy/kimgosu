// Operator console login (`POST /v1/admin/session`) — real PostgreSQL integration test.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest node --test tests/admin-session.integration.test.ts
//
// Loopback database only. Every row created here is removed in `after`.
//
// Covers the WS-23 acceptance criteria:
//   1. a non-admin member token is refused (403) and no operator session exists
//   2. an ADMIN member token is exchanged for an operator-scope session
//   3. without an operator session all four admin routes answer 403
//   4. the two scopes never mix (operator token is 401 on member routes)
//   5. logout revokes the session, so re-entry is refused
//   6. the ADMIN grant is re-read per request (revocation is immediate)
//   7. 5 failed exchanges lock the client for 5 minutes and are audited
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
const app = buildApp(postgresSql(pool), 'integration-admin-session', {});

const ADMIN = { id: randomUUID(), token: 'A'.repeat(43) };
const CS = { id: randomUUID(), token: 'S'.repeat(43) };
const PLAIN = { id: randomUUID(), token: 'U'.repeat(43) };
const TARGET = { id: randomUUID(), token: 'T'.repeat(43) };
const MEMBERS = [ADMIN, CS, PLAIN, TARGET];
const PRINCIPALS: string[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function seedMember(member: { id: string; token: string }, nickname: string) {
  const principalId = randomUUID();
  PRINCIPALS.push(principalId);
  await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
  await pool.query(
    `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [member.id, principalId, nickname, `${nickname}@dev.invalid`, nickname, sha(`p-${nickname}`)],
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
     VALUES($1,$2,$3,'admin-session suite fixture',now())`,
    [randomUUID(), memberId, role],
  );
}
const exchange = (sessionToken: string, remoteAddress = '10.1.0.1') =>
  app.inject({ method: 'POST', url: '/v1/admin/session', payload: { sessionToken }, remoteAddress });
const auditRows = async (action: string) =>
  (await pool.query(`SELECT actor_member_id AS "actor", target_id AS "target", reason, detail FROM kg_membership.audit_log WHERE action=$1 ORDER BY id`, [action])).rows;

before(async () => {
  await pool.query(`TRUNCATE kg_membership.audit_log, kg_membership.agreements, kg_membership.ledger_notes,
    kg_membership.ledgers, kg_membership.role_grants, kg_membership.consent_events,
    kg_membership.notification_preferences, kg_membership.sessions, kg_membership.sms_challenges,
    kg_membership.registration_tickets, kg_membership.oauth_flows, kg_membership.social_links,
    kg_membership.restrictions, kg_membership.members, kg_membership.principals CASCADE`);
  await seedMember(ADMIN, '운영자A');
  await seedMember(CS, '상담원S');
  await seedMember(PLAIN, '일반U');
  await seedMember(TARGET, '대상T');
  await grantRole(ADMIN.id, 'ADMIN');
  await grantRole(CS.id, 'CS');
});

after(async () => {
  await pool.query(`DELETE FROM kg_membership.audit_log WHERE actor_member_id = ANY($1::uuid[])`, [MEMBERS.map(m => m.id)]);
  await pool.query(`DELETE FROM kg_membership.audit_log WHERE target_type='admin_login'`);
  await pool.query(`DELETE FROM kg_membership.restrictions WHERE principal_id IN
    (SELECT principal_id FROM kg_membership.members WHERE id = ANY($1::uuid[]))`, [MEMBERS.map(m => m.id)]);
  await pool.query(`DELETE FROM kg_membership.role_grants WHERE member_id = ANY($1::uuid[])`, [MEMBERS.map(m => m.id)]);
  await pool.query(`DELETE FROM kg_membership.sessions WHERE member_id = ANY($1::uuid[])`, [MEMBERS.map(m => m.id)]);
  await pool.query(`DELETE FROM kg_membership.members WHERE id = ANY($1::uuid[])`, [MEMBERS.map(m => m.id)]);
  await pool.query(`DELETE FROM kg_membership.principals WHERE id = ANY($1::uuid[])`, [PRINCIPALS]);
  await app.close();
  await pool.end();
});

test('a non-admin member token cannot open an operator session', async () => {
  for (const member of [CS, PLAIN]) {
    const denied = await exchange(member.token, '10.1.0.2');
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, 'ADMIN_REQUIRED');
    assert.equal(denied.json().adminToken, undefined);
  }
  // CS holds a real role, but only ADMIN operates the console. No session row was
  // created for the refused members (they still have exactly their seeded login).
  const refusedSessions = (await pool.query(
    `SELECT count(*)::int AS n FROM kg_membership.sessions WHERE member_id IN ($1,$2)`,
    [CS.id, PLAIN.id],
  )).rows[0].n;
  assert.equal(refusedSessions, 2, 'only the seeded member sessions exist; no operator session was minted');

  const unknown = await exchange('Z'.repeat(43), '10.1.0.3');
  assert.equal(unknown.statusCode, 401);
  assert.equal(unknown.json().error.code, 'SESSION_INVALID');

  const deniedAudit = await auditRows('ADMIN_LOGIN_DENIED');
  assert.equal(deniedAudit.length, 2);
  assert.deepEqual(new Set(deniedAudit.map(r => r.actor)), new Set([CS.id, PLAIN.id]));
  assert.equal((await auditRows('ADMIN_LOGIN_FAILED')).length, 1, 'an unknown token is recorded without an actor');
});

test('an ADMIN member session is exchanged for a dedicated operator session', async () => {
  const ok = await exchange(ADMIN.token, '10.1.0.4');
  assert.equal(ok.statusCode, 201);
  const body = ok.json();
  assert.match(body.adminToken, /^adm_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(body.adminToken, ADMIN.token, 'the member token is never handed back as the operator token');
  assert.equal(body.tokenType, 'Bearer');
  assert.equal(body.expiresInSeconds, 7200);
  assert.ok(Date.parse(body.expiresAt) > Date.now());
  assert.equal(body.operator.memberId, ADMIN.id);
  assert.equal(body.operator.nickname, '운영자A');

  // The operator token is stored as a digest, exactly like a member session.
  const stored = (await pool.query(`SELECT access_digest FROM kg_membership.sessions WHERE member_id=$1 AND access_digest=$2`, [ADMIN.id, sha(body.adminToken)])).rows[0];
  assert.ok(stored, 'the operator session exists as a real sessions row keyed by token digest');
  const raw = await pool.query(`SELECT 1 FROM kg_membership.sessions WHERE access_digest=$1`, [body.adminToken]);
  assert.equal(raw.rows.length, 0, 'the raw operator token is never stored');

  const issued = await auditRows('ADMIN_SESSION_ISSUED');
  assert.equal(issued.length, 1);
  assert.equal(issued[0].actor, ADMIN.id);

  // The operator session identifies itself.
  const info = await app.inject({ method: 'GET', url: '/v1/admin/session', headers: auth(body.adminToken) });
  assert.equal(info.statusCode, 200);
  assert.equal(info.json().operator.customerNumber.length > 0, true);
  assert.equal(typeof info.json().expiresAt, 'string');
});

test('admin routes require the operator scope, not just a role', async () => {
  const routes: Array<[string, string]> = [
    ['GET', '/v1/admin/members'],
    ['GET', `/v1/admin/members/${TARGET.id}`],
    ['POST', `/v1/admin/members/${TARGET.id}/restrict`],
    ['POST', `/v1/admin/members/${TARGET.id}/release`],
  ];
  // The ADMIN member token carries the right role but the wrong scope.
  for (const [method, url] of routes) {
    const response = await app.inject({
      method: method as 'GET' | 'POST', url, headers: auth(ADMIN.token),
      ...(method === 'POST' ? { payload: { reason: '권한 시도' } } : {}),
    });
    assert.equal(response.statusCode, 403, `${method} ${url} must refuse a member session`);
    assert.equal(response.json().error.code, 'ADMIN_SESSION_REQUIRED');
  }
  for (const [method, url] of routes) {
    const response = await app.inject({
      method: method as 'GET' | 'POST', url, headers: auth(CS.token),
      ...(method === 'POST' ? { payload: { reason: '권한 시도' } } : {}),
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, 'ADMIN_SESSION_REQUIRED');
  }
  const anonymous = await app.inject({ method: 'GET', url: '/v1/admin/members' });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().error.code, 'AUTH_REQUIRED');
});

test('the two scopes never mix in either direction', async () => {
  const operator = (await exchange(ADMIN.token, '10.1.0.5')).json().adminToken;
  const list = await app.inject({ method: 'GET', url: '/v1/admin/members', headers: auth(operator) });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().total, 4);

  // An operator token is not a member session.
  for (const [method, url] of [['GET', '/v1/me'], ['GET', '/v1/me/consents'], ['POST', '/v1/auth/logout']] as const) {
    const response = await app.inject({ method, url, headers: auth(operator) });
    assert.equal(response.statusCode, 401, `${method} ${url} must not accept an operator session`);
    assert.equal(response.json().error.code, 'SESSION_INVALID');
  }
  // ...and the operator token cannot be exchanged again.
  const again = await exchange(operator, '10.1.0.6');
  assert.equal(again.statusCode, 400);
  assert.equal(again.json().error.code, 'INVALID_REQUEST');
});

test('logout revokes the operator session so re-entry is refused', async () => {
  const operator = (await exchange(ADMIN.token, '10.1.0.7')).json().adminToken;
  assert.equal((await app.inject({ method: 'POST', url: '/v1/admin/session/logout', headers: auth(operator) })).statusCode, 200);

  const after = await app.inject({ method: 'GET', url: '/v1/admin/session', headers: auth(operator) });
  assert.equal(after.statusCode, 401);
  assert.equal(after.json().error.code, 'SESSION_INVALID');
  const list = await app.inject({ method: 'GET', url: '/v1/admin/members', headers: auth(operator) });
  assert.equal(list.statusCode, 401);
  assert.equal(list.json().error.code, 'SESSION_INVALID');

  const loggedOut = await auditRows('ADMIN_SESSION_LOGGED_OUT');
  assert.ok(loggedOut.length >= 1);
});

test('a revoked ADMIN grant closes an already issued operator session', async () => {
  const operator = (await exchange(ADMIN.token, '10.1.0.8')).json().adminToken;
  assert.equal((await app.inject({ method: 'GET', url: '/v1/admin/members', headers: auth(operator) })).statusCode, 200);

  await pool.query(`UPDATE kg_membership.role_grants SET revoked_at=now(), revoked_by=$1, revoke_reason='revoked by suite'
    WHERE member_id=$2 AND role_id='ADMIN' AND revoked_at IS NULL`, [ADMIN.id, ADMIN.id]);
  try {
    const denied = await app.inject({ method: 'GET', url: '/v1/admin/members', headers: auth(operator) });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, 'ADMIN_REQUIRED');
    // A new operator session cannot be minted without the grant either.
    assert.equal((await exchange(ADMIN.token, '10.1.0.9')).statusCode, 403);
  } finally {
    await pool.query(`UPDATE kg_membership.role_grants SET revoked_at=NULL, revoked_by=NULL, revoke_reason=NULL
      WHERE member_id=$1 AND role_id='ADMIN'`, [ADMIN.id]);
  }
});

test('an expired operator session is refused', async () => {
  const operator = (await exchange(ADMIN.token, '10.1.0.10')).json().adminToken;
  await pool.query(`UPDATE kg_membership.sessions SET expires_at=now()-interval '1 second' WHERE access_digest=$1`, [sha(operator)]);
  const expired = await app.inject({ method: 'GET', url: '/v1/admin/members', headers: auth(operator) });
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.json().error.code, 'SESSION_INVALID');
});

test('five failed exchanges lock the client and are audited', async () => {
  const client = '10.9.9.9';
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await exchange('Q'.repeat(43), client);
    assert.equal(response.statusCode, 401);
    const remaining = response.json().error.attemptsRemaining;
    if (attempt < 5) assert.equal(remaining, 5 - attempt);
    else {
      assert.equal(remaining, 0);
      assert.ok(response.json().error.retryAfterSeconds >= 1, 'the fifth failure starts the lock');
    }
  }
  const locked = await exchange('Q'.repeat(43), client);
  assert.equal(locked.statusCode, 429);
  assert.equal(locked.json().error.code, 'ADMIN_LOGIN_LOCKED');
  assert.ok(locked.json().error.retryAfterSeconds > 0);
  assert.equal(locked.headers['retry-after'], String(locked.json().error.retryAfterSeconds));

  // A valid operator login from a locked client is refused too — the lock is on the client.
  const validButLocked = await exchange(ADMIN.token, client);
  assert.equal(validButLocked.statusCode, 429);

  const failures = await auditRows('ADMIN_LOGIN_FAILED');
  assert.ok(failures.length >= 5, 'every failed exchange is audited');
  assert.ok((await auditRows('ADMIN_LOGIN_BLOCKED')).length >= 1, 'attempts refused by the active lock are audited');

  // Other clients are unaffected by this lock.
  assert.equal((await exchange(ADMIN.token, '10.9.9.10')).statusCode, 201);
});
