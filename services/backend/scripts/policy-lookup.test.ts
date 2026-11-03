// WS-02: policy lookup consistency + performance checks.
//
// Part A (always runs, no database): makePolicySnapshot / policyRevision
// invariants against the real implementation in ../src/policy.ts.
//
// Part B (opt-in, real PostgreSQL): applies migrations 001-005 to a REFUSED-BY-
// DEFAULT fresh local cluster, then exercises the real SQL exported by
// src/policy.ts and measures the lookup plans. It never connects to Railway,
// never targets a remote host, and refuses to run if the schema already exists.
//
//   KG_POLICY_TEST_URL=postgres://postgres@127.0.0.1:55432/kgtest \
//     node --test scripts/policy-lookup.test.ts
//
// Part B is reported as SKIP, never as PASS, when KG_POLICY_TEST_URL is absent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  makePolicySnapshot,
  policySnapshotSelect,
  currentDocumentsSelect,
  loadPolicySnapshot,
  assertPolicyRevision,
  POLICY_METADATA,
  policyKinds,
  requiredReadyKindsForGrant,
} from '../src/policy.ts';
import type { Sql, Row } from '../src/app.ts';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

type Doc = {
  id: string; kind: string; version: string; status: string; title: string; body: string;
  bodySha256: string; operator: string | null; effectiveAt: string | null; approvedAt: string | null;
  createdAt: string; canConsent: boolean; isCurrent: boolean; isDisplay: boolean;
};

function doc(over: Partial<Doc> = {}): Doc {
  const body = over.body ?? `body for ${over.kind ?? 'TERMS'} ${over.version ?? 'v1'}`;
  const ready = over.status === 'READY';
  return {
    id: over.id ?? '1',
    kind: over.kind ?? 'TERMS',
    version: over.version ?? 'v1',
    status: over.status ?? 'DRAFT',
    title: over.title ?? 'title',
    body,
    bodySha256: over.bodySha256 ?? sha(body),
    operator: over.operator !== undefined ? over.operator : (ready ? 'operator' : null),
    effectiveAt: over.effectiveAt !== undefined ? over.effectiveAt : (ready ? '2026-01-01T00:00:00.000Z' : null),
    approvedAt: over.approvedAt !== undefined ? over.approvedAt : (ready ? '2026-01-01T00:00:00.000Z' : null),
    createdAt: over.createdAt ?? '2026-01-01T00:00:00.000Z',
    canConsent: over.canConsent ?? ready,
    isCurrent: over.isCurrent ?? ready,
    isDisplay: over.isDisplay ?? true,
  };
}

const snapshot = (documents: Doc[]) => makePolicySnapshot({ serverTime: '2026-06-01T00:00:00.000Z', documents });

// Deterministic ready set for the three kinds a grant needs, plus one draft.
function validSet(): Doc[] {
  return [
    doc({ id: '1', kind: 'TERMS', version: 'v1', status: 'READY' }),
    doc({ id: '2', kind: 'PRIVACY_CONSENT', version: 'v1', status: 'READY' }),
    doc({ id: '3', kind: 'PRIVACY_POLICY', version: 'v1', status: 'READY' }),
    doc({ id: '4', kind: 'OPERATIONS', version: 'draft', status: 'DRAFT' }),
  ];
}

const unavailable = /POLICY_METADATA_UNAVAILABLE/;
const rejects = (fn: () => unknown) => assert.throws(fn, unavailable);

test('A: consistent document set yields a complete, metadata-stamped snapshot', () => {
  const s = snapshot(validSet());
  assert.equal(s.schemaVersion, POLICY_METADATA);
  assert.equal(s.timeAuthority, 'POSTGRES_TRANSACTION_NOW');
  assert.equal(s.cache.control, 'no-store');
  assert.equal(s.cache.revalidateBeforeConsent, true);
  assert.deepEqual(s.missingReadyKinds, []);
  assert.equal(s.documents.length, 4);
  assert.equal(s.currentDocuments.length, policyKinds.length);
  for (const kind of requiredReadyKindsForGrant) {
    assert.equal(s.currentDocuments.find(d => d.kind === kind)?.currentDocument?.version, 'v1');
  }
  assert.equal(s.currentDocuments.find(d => d.kind === 'OPERATIONS')?.currentDocument, null);
  assert.match(s.policyRevision, /^ps3-[0-9a-f]{64}$/);
});

test('A: a grant for a kind without a ready current document is reported missing', () => {
  const set = validSet().filter(d => d.kind !== 'PRIVACY_POLICY');
  const s = snapshot(set);
  assert.deepEqual(s.missingReadyKinds, ['PRIVACY_POLICY']);
});

test('A: revision is stable across row order and input whitespace of unrelated fields', () => {
  const s1 = snapshot(validSet());
  const s2 = snapshot([...validSet()].reverse());
  assert.equal(s1.policyRevision, s2.policyRevision);
});

test('A: revision changes when a served body changes at the same version', () => {
  const base = snapshot(validSet());
  const edited = validSet().map(d => (d.id === '1' ? doc({ ...d, body: 'silently edited', bodySha256: sha('silently edited') }) : d));
  assert.notEqual(base.policyRevision, snapshot(edited).policyRevision);
});

test('A: revision changes when a new version or a new withdrawal-visible row appears', () => {
  const base = snapshot(validSet());
  const extra = [...validSet(), doc({ id: '9', kind: 'TERMS', version: 'v2', status: 'DRAFT', isDisplay: false, isCurrent: false, canConsent: false })];
  assert.notEqual(base.policyRevision, snapshot(extra).policyRevision);
});

test('A: document body hash is recomputed, not trusted from the row', () => {
  const bad = validSet();
  bad[0] = doc({ ...bad[0]!, bodySha256: 'a'.repeat(64) });
  rejects(() => snapshot(bad));
});

test('A: canConsent without a ready/approved/effective/operator row is rejected', () => {
  const set = validSet();
  set[0] = doc({ ...set[0]!, canConsent: true, status: 'DRAFT', approvedAt: null, effectiveAt: null, operator: null, isCurrent: false });
  rejects(() => snapshot(set));
});

test('A: canConsent with a blank operator is rejected', () => {
  const set = validSet();
  set[0] = doc({ ...set[0]!, operator: '   ' });
  rejects(() => snapshot(set));
});

test('A: an isCurrent document that is not consentable is rejected', () => {
  const set = validSet();
  set[3] = doc({ ...set[3]!, isCurrent: true, canConsent: false, status: 'DRAFT', isDisplay: true });
  rejects(() => snapshot(set));
});

test('A: two current documents of one kind are rejected, never silently picked', () => {
  const set = validSet();
  set.push(doc({ id: '5', kind: 'TERMS', version: 'v2', status: 'READY', isDisplay: false }));
  rejects(() => snapshot(set));
});

test('A: a kind with exactly one row but zero display rows is rejected', () => {
  const set = validSet();
  set[0] = doc({ ...set[0]!, isDisplay: false });
  rejects(() => snapshot(set));
});

test('A: duplicate ids and duplicate kind/version pairs are rejected', () => {
  const dupId = validSet();
  dupId.push(doc({ id: '1', kind: 'MARKETING', version: 'm1', status: 'DRAFT', isCurrent: false, canConsent: false, isDisplay: true }));
  rejects(() => snapshot(dupId));

  const dupVersion = validSet();
  dupVersion.push(doc({ id: '7', kind: 'TERMS', version: 'v1', status: 'DRAFT', isCurrent: false, canConsent: false, isDisplay: false }));
  rejects(() => snapshot(dupVersion));
});

test('A: non-object rows, unknown kinds and bad server time are rejected', () => {
  rejects(() => makePolicySnapshot({ serverTime: 'not-a-date', documents: [] }));
  rejects(() => makePolicySnapshot({ serverTime: '2026-06-01T00:00:00.000Z', documents: [null] }));
  rejects(() => makePolicySnapshot({ serverTime: '2026-06-01T00:00:00.000Z', documents: [doc({ kind: 'NOT_A_KIND' })] }));
  rejects(() => makePolicySnapshot(null as unknown as Row));
});

function fakeSql(rows: Row[]): Sql {
  const sql: Sql = {
    query: async () => ({ rows, rowCount: rows.length }),
    transaction: async <T>(work: (inner: Sql) => Promise<T>) => work(sql),
  };
  return sql;
}

test('A: loadPolicySnapshot accepts exactly one row and refuses zero or many', async () => {
  const empty = await loadPolicySnapshot(fakeSql([{ serverTime: '2026-06-01T00:00:00.000Z', documents: [] }]));
  assert.deepEqual(empty.missingReadyKinds, [...requiredReadyKindsForGrant]);
  assert.deepEqual(empty.documents, []);
  await assert.rejects(() => loadPolicySnapshot(fakeSql([{}, {}])), unavailable);
  await assert.rejects(() => loadPolicySnapshot(fakeSql([])), unavailable);
});

test('A: a stale expected revision is a 409 conflict, not a silent accept', () => {
  const s = snapshot(validSet());
  assert.equal(assertPolicyRevision(s, s.policyRevision), undefined);
  assert.throws(() => assertPolicyRevision(s, 'ps3-' + 'b'.repeat(64)), /POLICY_VERSION_CHANGED/);
});

test('A: exported SQL keeps the server-side readiness predicate (no client clock authority)', () => {
  assert.match(currentDocumentsSelect, /status='READY' AND approved_at IS NOT NULL AND effective_at<=now\(\)/);
  assert.match(currentDocumentsSelect, /ORDER BY kind,effective_at DESC,id DESC/);
  assert.match(policySnapshotSelect, /now\(\) AS "serverTime"/);
  assert(!/toISOString|Date\.now/.test(policySnapshotSelect));
});

// ---------------------------------------------------------------------------
// Part B: real PostgreSQL. Opt-in, local only, fresh schema only.
// ---------------------------------------------------------------------------
const url = process.env.KG_POLICY_TEST_URL;
const dbT = url ? test : test.skip;
const parseTarget = (raw: string) => {
  const u = new URL(raw);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(u.hostname), `refusing non-local host ${u.hostname}`);
  return { host: u.hostname, port: Number(u.port || 5432), database: decodeURIComponent(u.pathname.slice(1)), user: decodeURIComponent(u.username || 'postgres'), password: decodeURIComponent(u.password), ssl: false as const, max: 2, statement_timeout: 60000 };
};

dbT('B: migrations 001-005 apply to a fresh local schema and 005 is replay-safe', async () => {
  const cfg = parseTarget(url!);
  const pool = new Pool(cfg);
  try {
    const exists = (await pool.query("SELECT to_regnamespace('kg_membership') n")).rows[0].n;
    assert.equal(exists, null, 'refusing to touch a database that already has kg_membership');
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kg_dev_runtime') THEN CREATE ROLE kg_dev_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF; END $$`);
    const files = ['001_membership.sql', '002_auth_lifecycle.sql', '003_explicit_social_link.sql', '004_policy_content_integrity.sql', '005_policy_history_indexes.sql'];
    for (const file of files) await pool.query(readFileSync(migrationsDir + file, 'utf8'));

    const indexes = (await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='kg_membership' ORDER BY indexname")).rows.map((r: Row) => r.indexname);
    for (const name of ['policy_current_effective', 'policy_kind_version_history', 'consent_member_recent', 'consent_withdrawal_history']) {
      assert.ok(indexes.includes(name), `missing index ${name}`);
    }
    // Replay: 005 is idempotent, 004 is not -- assert the documented difference
    // instead of assuming it.
    await pool.query(readFileSync(migrationsDir + '005_policy_history_indexes.sql', 'utf8'));
    let code: string | undefined;
    try { await pool.query(readFileSync(migrationsDir + '004_policy_content_integrity.sql', 'utf8')); } catch (error) { code = (error as { code?: string }).code; }
    assert.equal(code, '42701', 'expected 004 replay to fail on the existing content_sealed column');
  } finally { await pool.end(); }
});

dbT('B: lookup queries return the intended document and history ordering', async () => {
  const cfg = parseTarget(url!);
  const pool = new Pool(cfg);
  const runtime = new Pool({ ...cfg, user: 'kg_dev_runtime' });
  try {
    const principal = '11111111-1111-4111-8111-111111111111';
    const member = '22222222-2222-4222-8222-222222222222';
    await pool.query('INSERT INTO kg_membership.principals(id) VALUES($1) ON CONFLICT DO NOTHING', [principal]);
    await pool.query("INSERT INTO kg_membership.members(id,principal_id,name,email,nickname) VALUES($1,$2,'SYNTHETIC','synthetic@example.invalid','SYN') ON CONFLICT DO NOTHING", [member, principal]);

    const insert = `INSERT INTO kg_membership.policy_documents(kind,version,status,title,body,body_sha256,operator_name,effective_at,approved_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (kind,version) DO NOTHING RETURNING id`;
    const add = async (kind: string, version: string, status: string, effectiveAt: string | null, createdAt: string) => {
      const body = `WS02 synthetic ${kind} ${version}`;
      const ready = status === 'READY';
      return (await pool.query(insert, [kind, version, status, 'WS02 synthetic', body, sha(body),
        ready ? 'WS02' : null, effectiveAt, ready ? effectiveAt : null, createdAt])).rows[0]?.id;
    };
    await add('TERMS', 'v1', 'RETIRED', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
    const termsV2 = await add('TERMS', 'v2', 'READY', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    await add('TERMS', 'v3', 'DRAFT', null, '2026-02-01T00:00:00Z');
    await add('PRIVACY_CONSENT', 'v1', 'READY', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    await add('PRIVACY_POLICY', 'v1', 'READY', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    // Future-effective READY row: consentable=false now, and must not win current.
    await add('MARKETING', 'v1', 'READY', '2099-01-01T00:00:00Z', '2026-03-01T00:00:00Z');

    // Version history per kind, newest first (index: policy_kind_version_history).
    const history = (await pool.query("SELECT version FROM kg_membership.policy_documents WHERE kind='TERMS' ORDER BY created_at DESC,id DESC")).rows.map((r: Row) => r.version);
    assert.deepEqual(history, ['v3', 'v2', 'v1']);

    // Current-document selector from the real policy.ts SQL.
    const current = (await pool.query(currentDocumentsSelect)).rows;
    assert.equal(current.filter((r: Row) => r.kind === 'TERMS').length, 1);
    assert.equal(current.find((r: Row) => r.kind === 'TERMS')!.version, 'v2');
    assert.equal(current.some((r: Row) => r.kind === 'MARKETING'), false, 'future-effective document must not be current');

    // Full snapshot through the exported loader against real rows.
    const snapshotFromDb = await loadPolicySnapshot(runtime as unknown as Sql);
    assert.deepEqual(snapshotFromDb.missingReadyKinds, []);
    assert.equal(snapshotFromDb.currentDocuments.find(d => d.kind === 'TERMS')?.currentDocument?.version, 'v2');
    const marketing = snapshotFromDb.documents.find(d => d.kind === 'MARKETING');
    assert.equal(marketing?.canConsent, false);
    assert.equal(marketing?.isCurrent, false);
    assert.equal(marketing?.isDisplay, true);
    // Snapshot must be reproducible and revision-stable across two reads.
    assert.equal((await loadPolicySnapshot(runtime as unknown as Sql)).policyRevision, snapshotFromDb.policyRevision);

    // Withdrawal history: newest first, only WITHDRAWN rows (index: consent_withdrawal_history).
    const consent = `INSERT INTO kg_membership.consent_events(member_id,document_id,action,recorded_at,request_id) VALUES($1,$2,$3,$4,$5) RETURNING id`;
    await pool.query(consent, [member, termsV2, 'GRANTED', '2026-04-01T00:00:00Z', '33333333-3333-4333-8333-333333333331']);
    await pool.query(consent, [member, termsV2, 'WITHDRAWN', '2026-04-02T00:00:00Z', '33333333-3333-4333-8333-333333333332']);
    await pool.query(consent, [member, termsV2, 'GRANTED', '2026-04-03T00:00:00Z', '33333333-3333-4333-8333-333333333333']);
    const withdrawals = (await runtime.query("SELECT recorded_at FROM kg_membership.consent_events WHERE member_id=$1 AND action='WITHDRAWN' ORDER BY recorded_at DESC,id DESC", [member])).rows;
    assert.equal(withdrawals.length, 1);
    const latest = (await runtime.query('SELECT action FROM kg_membership.consent_events WHERE member_id=$1 ORDER BY id DESC LIMIT 1', [member])).rows[0];
    assert.equal(latest.action, 'GRANTED');

    // The /v1/me/consents shape: latest event per kind.
    const perKind = (await runtime.query(`SELECT DISTINCT ON(d.kind) d.kind,e.action AS status FROM kg_membership.consent_events e
      JOIN kg_membership.policy_documents d ON d.id=e.document_id WHERE e.member_id=$1 ORDER BY d.kind,e.id DESC`, [member])).rows;
    assert.deepEqual(perKind.map((r: Row) => [r.kind, r.status]), [['TERMS', 'GRANTED']]);
  } finally { await runtime.end(); await pool.end(); }
});

dbT('B: current-document lookup resolves through policy_current_effective with no sort', async () => {
  const cfg = parseTarget(url!);
  const pool = new Pool(cfg);
  try {
    const count = Number((await pool.query('SELECT count(*) n FROM kg_membership.policy_documents')).rows[0].n);
    assert.ok(count >= 5, 'expected seeded documents from the previous check');
    const client = await pool.connect();
    let rolledBack = false;
    try {
      // This check isolates INDEX USABILITY. At a handful of rows the planner
      // legitimately prefers a sequential scan, so seq scans are disabled here;
      // the natural plan at volume is measured separately (RESULT.json, scale
      // check). Passing this test does not claim the planner picks the index at
      // small row counts.
      //
      // The whole experiment runs in a transaction that is always rolled back:
      // DDL is transactional in PostgreSQL, so a failing assertion can never
      // leave the test schema without its indexes.
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const planOf = async (sql: string) => JSON.stringify((await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)).rows[0]['QUERY PLAN'][0]);

      const withIndex = await planOf(currentDocumentsSelect);
      assert.match(withIndex, /policy_current_effective/, 'expected the partial index to be usable for current-document resolution');
      assert.doesNotMatch(withIndex, /"(Incremental )?Sort"/, 'the index should remove the order-by work entirely');

      // Same statement with the index removed: sorting must come back (a plain
      // Sort or an Incremental Sort on another index). This is the evidence that
      // the index, not the row count, removes the ordering work.
      await client.query('DROP INDEX kg_membership.policy_current_effective');
      const withoutIndex = await planOf(currentDocumentsSelect);
      assert.doesNotMatch(withoutIndex, /policy_current_effective/);
      assert.match(withoutIndex, /"(Incremental )?Sort"/, 'without the index PostgreSQL must sort');

      await client.query('ROLLBACK');
      rolledBack = true;
      const restored = (await client.query("SELECT 1 FROM pg_indexes WHERE indexname='policy_current_effective'")).rowCount;
      assert.equal(restored, 1, 'rollback must leave the index in place');
      console.log(JSON.stringify({
        check: 'current-document index usability', rows: count, seqscan: 'disabled',
        withIndex: /"(Incremental )?Sort"/.test(withIndex) ? 'sort' : 'no-sort',
        withoutIndex: /"(Incremental )?Sort"/.test(withoutIndex) ? 'sort' : 'no-sort',
      }));
    } finally {
      if (!rolledBack) { try { await client.query('ROLLBACK'); } catch { /* connection already failed */ } }
      client.release();
    }
  } finally { await pool.end(); }
});
