import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { buildApp } from './app.ts';
import type { Sql, Row } from './app.ts';

// Explicit unit double, not Railway/real-provider evidence.
class UnitSql implements Sql {
  calls: { text: string; values?: unknown[] }[] = [];
  validSession = true;
  marketing = false;
  status = 'ACTIVE';
  version = 0;
  rollbackCount = 0;
  readonly member = randomUUID();
  readonly session = randomUUID();
  async query(text: string, values?: unknown[]) {
    this.calls.push({ text, values });
    let rows: Row[] = [];
    if (text.includes('FROM kg_membership.sessions s')) rows = this.validSession ? [{ sessionId: this.session, memberId: this.member, status: this.status }] : [];
    else if (text.includes('FOR UPDATE')) rows = [{ id: this.member, status: this.status }];
    else if (text.includes("d.kind='MARKETING'")) rows = this.marketing ? [{ action: 'GRANTED' }] : [];
    else if (text.startsWith('UPDATE kg_membership.notification_preferences')) {
      if (Number(values?.[6]) === this.version) rows = [{ advertising: values?.[1] ?? false, chat: values?.[2] ?? false, version: String(++this.version) }];
    } else if (text.startsWith('UPDATE kg_membership.sessions')) this.validSession = false;
    else if (text.includes('FROM kg_membership.policy_documents')) rows = [{ kind: 'OPERATIONS', version: 'draft-v0.3', status: 'DRAFT', title: '검토 초안', body: '시행 문서 아님', canConsent: false }];
    return { rows, rowCount: rows.length };
  }
  async transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    const before = this.version;
    try { return await work(this); } catch (error) { this.version = before; this.rollbackCount++; throw error; }
  }
}
const bearer = () => 'Bearer ' + randomBytes(32).toString('base64url');

test('public config truthfully blocks unconnected providers/SMS and draft signup', async t => {
  const db = new UnitSql(); const app = buildApp(db, 'unit-only'); t.after(() => app.close());
  const r = await app.inject('/v1/auth/config'); assert.equal(r.statusCode, 200); assert.equal(r.headers['cache-control'], 'no-store');
  const body = r.json(); assert.equal(body.signupReady, false); assert.equal(body.sms.available, false);
  assert(body.providers.every((p: { enabled: boolean }) => p.enabled === false)); assert.deepEqual(body.requiredFields, ['name', 'email']);
  assert.equal(body.rejoinWaitDays, 30); assert.equal(body.retention.calendarYears, 1); assert.equal(body.retention.rejoinResetsClock, false);
});
test('draft document is readable but cannot be treated as consent-ready', async t => {
  const app = buildApp(new UnitSql(), 'unit-only'); t.after(() => app.close());
  const r = await app.inject('/v1/policies/OPERATIONS'); assert.equal(r.statusCode, 200); assert.equal(r.json().status, 'DRAFT'); assert.equal(r.json().canConsent, false);
});
test('unknown policy kind is rejected before SQL', async t => {
  const db = new UnitSql(); const app = buildApp(db, 'unit-only'); t.after(() => app.close());
  assert.equal((await app.inject('/v1/policies/NOT_A_DOCUMENT')).statusCode, 400); assert.equal(db.calls.length, 0);
});
test('anonymous private routes and logout never query member data', async t => {
  const db = new UnitSql(); const app = buildApp(db, 'unit-only'); t.after(() => app.close());
  for (const url of ['/v1/me', '/v1/me/consents', '/v1/me/notifications']) assert.equal((await app.inject(url)).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/logout' })).statusCode, 401); assert.equal(db.calls.length, 0);
});
test('only access digest is sent to session SQL, never raw bearer', async t => {
  const db = new UnitSql(); const app = buildApp(db, 'unit-only'); t.after(() => app.close()); const authorization = bearer();
  await app.inject({ url: '/v1/me', headers: { authorization } });
  assert.equal(db.calls[0].values?.[0], createHash('sha256').update(authorization.slice(7)).digest('hex'));
  assert(!JSON.stringify(db.calls).includes(authorization.slice(7)));
});
test('advertising ON without distinct marketing consent rolls back', async t => {
  const db = new UnitSql(); const app = buildApp(db, 'unit-only'); t.after(() => app.close());
  const r = await app.inject({ method: 'PATCH', url: '/v1/me/notifications', headers: { authorization: bearer() }, payload: { expectedVersion: 0, advertising: true } });
  assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'MARKETING_CONSENT_REQUIRED'); assert.equal(db.rollbackCount, 1); assert.equal(db.version, 0);
});
test('advertising OFF changes preference, not marketing consent, with numeric wire version', async t => {
  const db = new UnitSql(); db.marketing = true; const app = buildApp(db, 'unit-only'); t.after(() => app.close());
  const r = await app.inject({ method: 'PATCH', url: '/v1/me/notifications', headers: { authorization: bearer() }, payload: { expectedVersion: 0, advertising: false } });
  assert.equal(r.statusCode, 200); assert.equal(r.json().advertising, false); assert.equal(r.json().version, 1); assert.equal(db.marketing, true);
  assert(!db.calls.some(c => /(?:INSERT INTO|UPDATE) kg_membership.consent_events/.test(c.text)));
});
test('stale preference version is a conflict, not silent overwrite', async t => {
  const db = new UnitSql(); const app = buildApp(db, 'unit-only'); t.after(() => app.close());
  const r = await app.inject({ method: 'PATCH', url: '/v1/me/notifications', headers: { authorization: bearer() }, payload: { expectedVersion: 99, chat: true } });
  assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'VERSION_CONFLICT'); assert.equal(db.rollbackCount, 1);
});
test('client member id cannot redirect a private update', async t => {
  const db = new UnitSql(); const app = buildApp(db, 'unit-only'); t.after(() => app.close());
  const r = await app.inject({ method: 'PATCH', url: '/v1/me/notifications', headers: { authorization: bearer() }, payload: { expectedVersion: 0, chat: true, memberId: randomUUID() } });
  assert.equal(r.statusCode, 400); assert.equal(db.calls.length, 0);
});
test('restricted account cannot change notification preferences', async t => {
  const db = new UnitSql(); db.status = 'RESTRICTED'; const app = buildApp(db, 'unit-only'); t.after(() => app.close());
  const r = await app.inject({ method: 'PATCH', url: '/v1/me/notifications', headers: { authorization: bearer() }, payload: { expectedVersion: 0, chat: true } });
  assert.equal(r.statusCode, 403); assert.equal(db.version, 0);
});
test('logout revokes the same session; subsequent private read is refused', async t => {
  const db = new UnitSql(); const app = buildApp(db, 'unit-only'); t.after(() => app.close()); const authorization = bearer();
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { authorization } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/me', headers: { authorization } })).statusCode, 401);
});
test('database exception detail is withheld from public responses', async t => {
  const db = new UnitSql(); db.query = async () => { throw new Error('INTERNAL_UNIT_SENTINEL'); };
  const app = buildApp(db, 'unit-only'); t.after(() => app.close()); const r = await app.inject('/v1/policies');
  assert.equal(r.statusCode, 500); assert(!r.body.includes('INTERNAL_UNIT_SENTINEL')); assert.equal(r.json().error.code, 'INTERNAL_ERROR');
});
