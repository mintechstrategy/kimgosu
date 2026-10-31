// Explicit local SQL double: not PostgreSQL, not provider/public API evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildApp } from '../../services/backend/src/app.ts';
import type { Sql, Row } from '../../services/backend/src/app.ts';
import { currentDocuments } from '../../services/backend/src/auth.ts';
import { makePolicySnapshot, loadPolicySnapshot, policySnapshotSelect, currentDocumentsSelect, nicknameSchema, consentInputSchema } from '../../services/backend/src/policy.ts';
const require = createRequire(new URL('../../services/backend/package.json', import.meta.url));
const Ajv = require('ajv');
const contract = JSON.parse(readFileSync(new URL('../../contracts/auth-membership.v0.3.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, unicodeRegExp: true });
const compile = (schema: object) => ajv.compile({ definitions: contract.schemaDefinitions, ...schema });
const validate = (id: string, value: unknown) => { const o = contract.operations.find((o: { id: string }) => o.id === id); const v = compile(o.responses['200']); assert(v(value), id + ajv.errorsText(v.errors)); };
const time = '2030-01-01T00:00:00.000Z';
const bodyHash = (b: string) => createHash('sha256').update(b, 'utf8').digest('hex');
const doc = (kind = 'TERMS', id = '9007199254740993', more: Row = {}) => ({ id, kind, version: 'opaque/v❄', status: 'READY', title: 'TEST ONLY', body: '명시적 DB double\r\ne\u0301', bodySha256: bodyHash('명시적 DB double\r\ne\u0301'), operator: 'TEST_NOT_SERVICE_OPERATOR', effectiveAt: time, approvedAt: time, createdAt: time, canConsent: true, isCurrent: true, isDisplay: true, ...more });
const ready = () => [doc(), doc('PRIVACY_CONSENT', '9223372036854775806'), doc('PRIVACY_POLICY', '9223372036854775807')];
const row = (documents: Row[] = ready(), serverTime = time) => ({ serverTime, documents });
const payload = () => ({ consents: [{ kind: 'TERMS', version: 'opaque/v❄' }, { kind: 'PRIVACY_CONSENT', version: 'opaque/v❄' }] });
const bearer = 'Bearer ' + randomBytes(32).toString('base64url');
class SnapshotSql implements Sql {
  state: Row = row(); calls: string[] = []; events: unknown[] = []; validSession = true; status = 'ACTIVE'; rollback = 0; members = 0;
  afterSnapshot?: () => void;
  async query(text: string, values?: unknown[]) {
    this.calls.push(text); let rows: Row[] = [];
    if (text === 'LOCK TABLE kg_membership.policy_documents IN SHARE MODE') { /* SQL-double receipt only; real lock behavior is verified separately on PostgreSQL. */ }
    else if (text === policySnapshotSelect) { rows = [structuredClone(this.state)]; this.afterSnapshot?.(); }
    else if (text === currentDocumentsSelect) rows = (this.state.documents as Row[]).filter(d => d.isCurrent).map(d => ({ id: d.id, kind: d.kind, version: d.version }));
    else if (text.includes('FROM kg_membership.sessions s')) rows = this.validSession ? [{ sessionId: 'TEST_SESSION', memberId: 'TEST_MEMBER', principalId: 'TEST_PRINCIPAL', status: this.status }] : [];
    else if (text.includes('FROM kg_membership.registration_tickets')) rows = [{ ticket_digest: 'TEST_DIGEST', provider: 'google', subject_digest: 'TEST_DIGEST', phone_digest: 'TEST_DIGEST', phone_verified_at: time }];
    else if (text.includes('FROM kg_membership.social_links')) rows = [{ principal_id: 'TEST_PRINCIPAL' }];
    else if (text.startsWith('SELECT id,withdrawn_at') || text.startsWith('SELECT principal_id,withdrawn_at') || text.includes('FROM kg_membership.restrictions')) rows = [];
    else if (text.includes('FOR UPDATE')) rows = [{ id: 'TEST_MEMBER', status: this.status }];
    else if (text.startsWith('INSERT INTO kg_membership.consent_events')) this.events.push(values?.[1]);
    else if (text.startsWith('INSERT INTO kg_membership.members')) this.members++;
    else if (text.startsWith('SELECT action FROM kg_membership.consent_events')) rows = [];
    else if (text.startsWith('SELECT pg_advisory_xact_lock') || text.startsWith('INSERT INTO kg_membership.notification_preferences') || text.startsWith('UPDATE kg_membership.registration_tickets') || text.startsWith('INSERT INTO kg_membership.sessions')) { /* explicit in-memory receipt only */ }
    else throw new Error('Unexpected SQL in local double');
    return { rows, rowCount: rows.length };
  }
  async transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    const before = structuredClone(this.events); const members = this.members;
    try { return await work(this); } catch (e) { this.events = before; this.members = members; this.rollback++; throw e; }
  }
}
const urls = ['/v1/auth/config?metadata=policy-v0.3', '/v1/policies?metadata=policy-v0.3', '/v1/policies/TERMS?metadata=policy-v0.3'];

test('v0.3 all schemas compile and opt-in operation set is existing5; v0.2 contract hash unchanged', () => {
  for (const o of contract.operations) { compile(o.responses['200']); if (o.requestSchema) compile(o.requestSchema); if (o.querySchema) compile(o.querySchema); }
  assert.equal(contract.operations.length, 5);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../../contracts/auth-membership.v0.2.json', import.meta.url))).digest('hex'), contract.baseContract.sha256);
  assert.equal(contract.status, 'LOCAL_CANDIDATE_NOT_DEPLOYED_NOT_POLICY_EFFECTIVE');
});
test('source authority: verbatim original grant SQL reused inside one-statement snapshot; no new DDL', async () => {
  const old = readFileSync(new URL('baseline/services/backend/src/auth.ts', import.meta.url), 'utf8');
  const original = old.match(/sql.query\(`(SELECT DISTINCT ON\(kind\) id,kind,version[\s\S]*?ORDER BY kind,effective_at DESC,id DESC)`/)!;
  assert.equal(currentDocumentsSelect, original[1]); assert(policySnapshotSelect.includes('current_documents AS (' + currentDocumentsSelect + ')'));
  assert(policySnapshotSelect.includes('now() AS "serverTime"')); assert(!/\b(CREATE|ALTER|DELETE|UPDATE|INSERT)\b/.test(policySnapshotSelect));
  const db = new SnapshotSql(); await currentDocuments(db); assert.deepEqual(db.calls, [currentDocumentsSelect]);
});
test('metadata shared constraints equal actual nickname/consent schema and required sets', () => {
  const s = makePolicySnapshot(row()); assert.deepEqual(s.constraints.nickname, nicknameSchema); assert.deepEqual(s.constraints.consentInputs, consentInputSchema);
  assert.deepEqual(s.requirements.requiredGrantKinds, ['TERMS', 'PRIVACY_CONSENT']); assert.deepEqual(s.requirements.requiredReadyKindsForGrant, ['TERMS', 'PRIVACY_CONSENT', 'PRIVACY_POLICY']);
  assert.deepEqual(s.requirements.optionalGrantKinds, ['MARKETING']); assert.equal(s.requirements.operationsConsentRequired, false); assert.deepEqual(s.missingReadyKinds, []);
});
test('opaque bigint IDs/version and exact UTF8 CRLF/non-NFC hashes preserved', () => {
  const s = makePolicySnapshot(row()); assert.equal(s.currentDocuments[0].currentDocument?.id, '9007199254740993');
  assert.equal(s.currentDocuments[0].currentDocument?.version, 'opaque/v❄'); assert.equal(s.documents[0].bodySha256, bodyHash(s.documents[0].body));
  assert.notEqual(bodyHash(s.documents[0].body.normalize('NFC')), s.documents[0].bodySha256);
});
test('revision stable across DB query times, row order and UTC-equivalent timestamp spelling', () => {
  const a = makePolicySnapshot(row()); const b = makePolicySnapshot(row(ready().reverse(), '2030-01-01T01:00:00+01:00'));
  assert.equal(a.policyRevision, b.policyRevision); assert.equal(b.serverTime, time);
  assert.equal(a.policyRevision, makePolicySnapshot(row(ready(), '2999-01-01T00:00:00Z')).policyRevision);
});
test('revision changes for same-version body/hash, operator, title and selected ID changes', () => {
  const a = makePolicySnapshot(row()).policyRevision;
  for (const edit of [{ body: 'changed same version', bodySha256: bodyHash('changed same version') }, { operator: 'OTHER_TEST_OPERATOR' }, { title: 'OTHER_TITLE' }, { id: '9007199254740994' }]) {
    const docs = ready(); Object.assign(docs[0], edit); assert.notEqual(makePolicySnapshot(row(docs)).policyRevision, a);
  }
});
test('DRAFT-only and empty snapshot report missingReady without inventing current targets/permission', () => {
  for (const docs of [[], [doc('TERMS', '9', { status: 'DRAFT', operator: null, approvedAt: null, effectiveAt: null, canConsent: false, isCurrent: false })]]) {
    const s = makePolicySnapshot(row(docs)); assert(s.currentDocuments.every(d => d.currentDocument === null)); assert.deepEqual(s.missingReadyKinds, ['TERMS', 'PRIVACY_CONSENT', 'PRIVACY_POLICY']);
    assert.equal(s.limitations.allowedActions, 'NOT_IMPLEMENTED'); assert.equal(s.limitations.materialChangeClassification, 'NOT_IMPLEMENTED');
  }
});
test('historical READY, newer DRAFT, future READY and RETIRED do not replace SQL-selected current ID', async t => {
  const db = new SnapshotSql(); db.state = row([doc('TERMS', '300', { status: 'DRAFT', canConsent: false, isCurrent: false, isDisplay: false, version: 'draft' }),
    doc('TERMS', '301', { version: 'future', effectiveAt: '2099-01-01T00:00:00Z', canConsent: false, isCurrent: false, isDisplay: false }),
    doc('TERMS', '302', { version: 'retired', status: 'RETIRED', canConsent: false, isCurrent: false, isDisplay: false }),
    doc('TERMS', '303', { version: 'historical-ready', canConsent: true, isCurrent: false, isDisplay: false }), ...ready()]);
  const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
  const r = await app.inject(urls[2]); assert.equal(r.statusCode, 200); assert.equal(r.json().id, '9007199254740993'); validate('policy', r.json());
  const h = await app.inject('/v1/policies/TERMS?metadata=policy-v0.3&version=historical-ready'); assert.equal(h.statusCode, 200); assert.equal(h.json().isCurrent, false); assert.equal(h.json().canConsent, true);
});
test('legacy display/current tie disagreement exposed, opt-in config/default detail follow final grant ID', async t => {
  const docs = ready(); docs[0].isDisplay = false; docs.push(doc('TERMS', '8', { version: 'legacy-display', isCurrent: false }));
  const db = new SnapshotSql(); db.state = row(docs); const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
  const config = (await app.inject(urls[0])).json(); assert.equal(config.documents.find((d: Row) => d.kind === 'TERMS').version, 'opaque/v❄');
  assert.equal((await app.inject(urls[2])).json().id, '9007199254740993');
});
test('all three opted-in public endpoints return one SQL statement coherent revision, schema and no-store', async t => {
  const db = new SnapshotSql(); const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close()); let revision: string | undefined;
  for (const [i, url] of urls.entries()) { db.calls = []; const r = await app.inject(url); assert.equal(r.statusCode, 200); validate(['authConfig', 'policies', 'policy'][i], r.json());
    assert.deepEqual(db.calls, [policySnapshotSelect]); assert.equal(r.headers['cache-control'], 'no-store'); const s = r.json().policySnapshot;
    assert.equal(s.serverTime, time); assert.equal(s.cache.ttlSeconds, 0); if (revision) assert.equal(s.policyRevision, revision); revision = s.policyRevision;
  }
});
for (const [name, corrupt] of Object.entries({
  'hash mismatch': (docs: Row[]) => { docs[0].body = 'forged'; },
  'missing hash': (docs: Row[]) => { delete docs[0].bodySha256; },
  'numeric ID': (docs: Row[]) => { docs[0].id = 9007199254740992; },
  'duplicate ID': (docs: Row[]) => { docs[1].id = docs[0].id; },
  'duplicate kind-version': (docs: Row[]) => { docs.push({ ...docs[0], id: 'other', isCurrent: false, isDisplay: false }); },
  'duplicate current': (docs: Row[]) => { docs.push(doc('TERMS', 'other', { version: 'other', isDisplay: false })); },
  'missing current despite eligible': (docs: Row[]) => { docs[0].isCurrent = false; },
  'draft current': (docs: Row[]) => { docs[0].status = 'DRAFT'; docs[0].canConsent = false; },
  'missing display': (docs: Row[]) => { docs[0].isDisplay = false; },
  'missing approval': (docs: Row[]) => { docs[0].approvedAt = null; },
})) test('metadata failclosed503: ' + name, async t => {
  const db = new SnapshotSql(); const docs = ready(); corrupt(docs); db.state = row(docs); const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
  const r = await app.inject(urls[0]); assert.equal(r.statusCode, 503); assert.deepEqual(r.json(), { error: { code: 'POLICY_METADATA_UNAVAILABLE' } }); assert.equal(db.events.length, 0);
});
test('missing serverTime/invalid document timestamps or missing aggregate failclosed', async () => {
  for (const state of [{ documents: ready() }, row(ready(), 'invalid'), { serverTime: time, documents: null }]) {
    const db = new SnapshotSql(); db.state = state; await assert.rejects(loadPolicySnapshot(db), { status: 503, code: 'POLICY_METADATA_UNAVAILABLE' });
  }
});
test('clock boundary uses SQL flags, revision changes when eligibility crosses; no JS wall-clock veto', () => {
  const before = [doc('TERMS', '9', { effectiveAt: time, canConsent: false, isCurrent: false })];
  const a = makePolicySnapshot(row(before, '2029-12-31T23:59:59.999Z')); const b = makePolicySnapshot(row([doc('TERMS', '9')], time));
  assert.equal(a.currentDocuments[0].currentDocument, null); assert.equal(b.currentDocuments[0].currentDocument?.canConsent, true); assert.notEqual(a.policyRevision, b.policyRevision);
  const original = Date.now; Date.now = () => 0; try { assert.equal(makePolicySnapshot(row()).currentDocuments[0].currentDocument?.canConsent, true); } finally { Date.now = original; }
});
test('PostgreSQL trim semantics not widened by JS Unicode whitespace handling', () => {
  assert.equal(makePolicySnapshot(row([doc('TERMS', '9', { operator: '\u00a0' })])).currentDocuments[0].currentDocument?.canConsent, true);
});
test('request split revision changes observable; cache conditional header never gives304/stale snapshot', async t => {
  const db = new SnapshotSql(); const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
  const a = (await app.inject(urls[0])).json().policySnapshot; db.state = row([doc('TERMS', 'changed', { version: 'next' }), ...ready().slice(1)]);
  const r = await app.inject({ url: urls[1], headers: { 'if-none-match': a.policyRevision } }); assert.equal(r.statusCode, 200); assert.equal(r.headers.etag, undefined); assert.equal(r.headers['cache-control'], 'no-store');
  assert.notEqual(r.json().policySnapshot.policyRevision, a.policyRevision); assert.equal(db.calls.filter(c => c === policySnapshotSelect).length, 2);
});
test('positive revision-bound grant uses one snapshot/exact IDs, normal v0.2 grant uses unchanged selector', async t => {
  for (const v03 of [false, true]) {
    const db = new SnapshotSql(); const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
    const r = await app.inject({ method: 'POST', url: '/v1/me/consents', headers: { authorization: bearer }, payload: { ...payload(), ...(v03 ? { expectedPolicyRevision: makePolicySnapshot(db.state).policyRevision } : {}) } });
    assert.equal(r.statusCode, 200); assert.deepEqual(r.json(), { recorded: true }); assert.deepEqual(db.events, ['9007199254740993', '9223372036854775806']);
    assert.equal(db.calls.filter(s => s === policySnapshotSelect).length, v03 ? 1 : 0); assert.equal(db.calls.filter(s => s === currentDocumentsSelect).length, v03 ? 0 : 1);
  }
});
test('same-version body changed before grant is revision conflict and appends zero events', async t => {
  const db = new SnapshotSql(); const expectedPolicyRevision = makePolicySnapshot(db.state).policyRevision;
  const docs = ready(); docs[0].body = 'changed'; docs[0].bodySha256 = bodyHash('changed'); db.state = row(docs);
  const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close()); const r = await app.inject({ method: 'POST', url: '/v1/me/consents', headers: { authorization: bearer }, payload: { ...payload(), expectedPolicyRevision } });
  assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'POLICY_VERSION_CHANGED'); assert.deepEqual(db.events, []); assert.equal(db.rollback, 1);
});
test('revision-bound grant preserves missing-ready/required/duplicate/stale-version guard outcomes', async t => {
  for (const mode of ['readyMissing', 'requiredMissing', 'duplicate', 'stale']) {
    const db = new SnapshotSql(); let p = payload();
    if (mode === 'readyMissing') db.state = row(ready().slice(0, 2));
    if (mode === 'requiredMissing') p.consents[1] = { kind: 'MARKETING', version: 'opaque/v❄' };
    if (mode === 'duplicate') p.consents[1] = { ...p.consents[0] };
    if (mode === 'stale') p.consents[0].version = 'old';
    const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
    const r = await app.inject({ method: 'POST', url: '/v1/me/consents', headers: { authorization: bearer }, payload: { ...p, expectedPolicyRevision: makePolicySnapshot(db.state).policyRevision } });
    assert.equal(r.statusCode, mode === 'requiredMissing' || mode === 'duplicate' ? 400 : 409);
    assert.equal(r.json().error.code, mode === 'readyMissing' ? 'DOCUMENT_NOT_READY' : mode === 'stale' ? 'POLICY_VERSION_CHANGED' : 'REQUIRED_CONSENT_MISSING');
    assert.deepEqual(db.events, []);
  }
});
test('grant rejects duplicate kinds even when all required kinds supplied, no partial events', async t => {
  const db = new SnapshotSql(); const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
  const r = await app.inject({ method: 'POST', url: '/v1/me/consents', headers: { authorization: bearer }, payload: { consents: [...payload().consents, payload().consents[0]], expectedPolicyRevision: makePolicySnapshot(db.state).policyRevision } });
  assert.equal(r.statusCode, 400); assert.equal(r.json().error.code, 'INVALID_REQUEST'); assert.deepEqual(db.events, []);
});
test('optional MARKETING still optional; read-only PRIVACY_POLICY/OPERATIONS grants rejected by schema', async t => {
  const db = new SnapshotSql(); const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
  for (const kind of ['PRIVACY_POLICY', 'OPERATIONS']) {
    const r = await app.inject({ method: 'POST', url: '/v1/me/consents', headers: { authorization: bearer }, payload: { consents: [...payload().consents, { kind, version: 'opaque/v❄' }] } }); assert.equal(r.statusCode, 400);
  }
  assert.deepEqual(db.calls, []);
});
test('new metadata does not authorize anonymous/invalid sessions or client canConsent injection', async t => {
  const db = new SnapshotSql(); const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
  const r = await app.inject({ method: 'POST', url: '/v1/me/consents', payload: { ...payload(), expectedPolicyRevision: makePolicySnapshot(db.state).policyRevision } }); assert.equal(r.statusCode, 401); assert.equal(db.calls.length, 0);
  const malformed = await app.inject({ method: 'POST', url: '/v1/me/consents', headers: { authorization: bearer }, payload: { ...payload(), expectedPolicyRevision: 'bad', canConsent: true } }); assert.equal(malformed.statusCode, 400); assert.equal(db.calls.length, 0);
  db.validSession = false; assert.equal((await app.inject({ method: 'POST', url: '/v1/me/consents', headers: { authorization: bearer }, payload: payload() })).statusCode, 401); assert.equal(db.events.length, 0);
});
test('signup revision conflict rolls back provisional member; opt-in positive succeeds only on explicit double', async t => {
  for (const stale of [false, true]) {
    const db = new SnapshotSql(); const expected = makePolicySnapshot(db.state).policyRevision; if (stale) db.state = row([]);
    const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
    const r = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { registrationTicket: randomBytes(32).toString('base64url'), name: 'TEST', email: 'test@example.invalid', age14Confirmed: true, expertRequested: false, ...payload(), expectedPolicyRevision: expected } });
    assert.equal(r.statusCode, stale ? 409 : 200); assert.equal(db.members, stale ? 0 : 1); assert.equal(db.events.length, stale ? 0 : 2);
  }
});
test('existing restricted profile mutation and missing current-consent refusal retained', async t => {
  for (const restricted of [false, true]) {
    const db = new SnapshotSql(); if (restricted) db.status = 'RESTRICTED'; const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
    const r = await app.inject({ method: 'PATCH', url: '/v1/me/profile', headers: { authorization: bearer }, payload: { nickname: '고수123' } }); assert.equal(r.statusCode, 403); assert.equal(r.json().error.code, restricted ? 'ACCOUNT_RESTRICTED' : 'CONSENT_RENEWAL_REQUIRED');
  }
});
test('explicit limitation: policy edits AFTER snapshot are not fenced at commit by existing writer protocol', async t => {
  const db = new SnapshotSql(); const revision = makePolicySnapshot(db.state).policyRevision;
  db.afterSnapshot = () => { db.state = row([]); }; const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
  const r = await app.inject({ method: 'POST', url: '/v1/me/consents', headers: { authorization: bearer }, payload: { ...payload(), expectedPolicyRevision: revision } });
  assert.equal(r.statusCode, 200); assert.equal(makePolicySnapshot(row()).limitations.commitFence, false); assert.equal(db.events.length, 2);
  // Passing this characterization documents a remaining gate, not atomic commit safety.
});
test('KG-BPM-QA-001 regression: malformed aggregate/row/document structure maps to503 on GET3+grant, never500', async t => {
  for (const malformed of [null, undefined, [], 1, 'not-an-object']) {
    const db = new SnapshotSql(); const expectedPolicyRevision = makePolicySnapshot(db.state).policyRevision;
    db.state = { serverTime: time, documents: [malformed, ...ready().slice(1)] };
    const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
    for (const url of urls) {
      const r = await app.inject(url); assert.equal(r.statusCode, 503); assert.equal(r.json().error.code, 'POLICY_METADATA_UNAVAILABLE');
    }
    const r = await app.inject({ method: 'POST', url: '/v1/me/consents', headers: { authorization: bearer }, payload: { ...payload(), expectedPolicyRevision } });
    assert.equal(r.statusCode, 503); assert.equal(r.json().error.code, 'POLICY_METADATA_UNAVAILABLE'); assert.deepEqual(db.events, []);
  }
  for (const malformed of [null, undefined, [], 1, 'not-an-object']) {
    assert.throws(() => makePolicySnapshot(malformed as unknown as Row), { status: 503, code: 'POLICY_METADATA_UNAVAILABLE' });
  }
  for (const malformed of [null, undefined, {}, { rows: null }, { rows: [] }, { rows: [null] }]) {
    const db = { query: async () => malformed } as unknown as Sql;
    await assert.rejects(loadPolicySnapshot(db), { status: 503, code: 'POLICY_METADATA_UNAVAILABLE' });
  }
});

test('actual ephemeral loopback HTTP: public opted-in config/list/detail schema, clocks, fresh read and auth refusal', async t => {
  const db = new SnapshotSql(); const app = buildApp(db, 'TEST_DOUBLE'); t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  for (const [i, url] of urls.entries()) { const r = await fetch(address + url); assert.equal(r.status, 200); const b = await r.json(); validate(['authConfig', 'policies', 'policy'][i], b); assert.equal(r.headers.get('cache-control'), 'no-store'); }
  const r = await fetch(address + '/v1/me/consents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) }); assert.equal(r.status, 401);
  assert.equal(db.events.length, 0);
});
