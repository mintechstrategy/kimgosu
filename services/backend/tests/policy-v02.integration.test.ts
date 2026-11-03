// WS-22: policy v0.2 load + read-back against real PostgreSQL.
//
// Runs the real loader (scripts/load-policy-drafts.mjs --version v0.2) and then
// reads the rows back through the real Fastify app, so a mismatch between the
// files, the hashes and the API response fails loudly.
//
// Refuses anything that is not a loopback database; it truncates
// policy_documents there. Never point KG_TEST_DATABASE_URL at Railway.
//
//   KG_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/kgtest \
//     node --test tests/policy-v02.integration.test.ts

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { postgresSql } from '../src/database.ts';

const DATABASE_URL = process.env.KG_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/kgtest';
const parsed = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('KG_TEST_DATABASE_URL must point at a loopback database; refusing to truncate a remote one');
}

const POLICIES = fileURLToPath(new URL('../../../records/product/policies/', import.meta.url));
const LOADER = fileURLToPath(new URL('../scripts/load-policy-drafts.mjs', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(POLICIES + 'MANIFEST.json', 'utf8'));
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const V02 = {
  TERMS: 'TERMS-v0.2.md',
  PRIVACY_CONSENT: 'PRIVACY-CONSENT-v0.2.md',
  PRIVACY_POLICY: 'PRIVACY-POLICY-v0.2.md',
  MARKETING: 'MARKETING-v0.2.md',
} as const;
const V01 = {
  TERMS: 'TERMS-v0.1-draft.md',
  PRIVACY_CONSENT: 'PRIVACY-CONSENT-v0.1-draft.md',
  PRIVACY_POLICY: 'PRIVACY-POLICY-v0.1-draft.md',
  MARKETING: 'MARKETING-v0.1-draft.md',
} as const;
const BUSINESS_INFO = ['민테크놀로지', '권민택', '549-87-02902', '경기도 양주시 덕정길 81', 'customer@mintech.ai'];

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
const app = buildApp(postgresSql(pool), 'ws22-test', {});

function load(version: string) {
  return spawnSync(process.execPath, [LOADER, '--version', version], {
    env: { ...process.env, DATABASE_URL },
    encoding: 'utf8',
  });
}

before(async () => {
  await pool.query('TRUNCATE kg_membership.policy_documents CASCADE');
});

after(async () => {
  await app.close();
  await pool.end();
});

test('v0.1-draft and v0.2 load as DRAFT and are readable through GET /v1/policies', async () => {
  for (const version of ['v0.1-draft', 'v0.2']) {
    const result = load(version);
    assert.equal(result.status, 0, `loader failed for ${version}:\n${result.stdout}\n${result.stderr}`);
    const inserted = result.stdout.split('\n').filter(line => line.includes('inserted as DRAFT')).length;
    assert.equal(inserted, 4, `expected 4 ${version} rows inserted, loader said:\n${result.stdout}`);
  }

  const response = await app.inject({ method: 'GET', url: '/v1/policies' });
  assert.equal(response.statusCode, 200);
  const documents = response.json().documents as Array<Record<string, unknown>>;

  for (const [kind, file] of Object.entries(V02)) {
    const body = readFileSync(POLICIES + file, 'utf8');
    const row = documents.find(d => d.kind === kind && d.version === 'v0.2');
    assert.ok(row, `${kind} v0.2 must be returned by GET /v1/policies`);
    assert.equal(row.status, 'DRAFT', `${kind} v0.2 must load as DRAFT`);
    assert.equal(row.canConsent, false, `${kind} v0.2 must not be consentable before promotion`);
    assert.equal(row.bodySha256, sha(body), `${kind} v0.2 bodySha256 must match the file`);
    assert.equal(row.body, body, `${kind} v0.2 body must round-trip byte-identically`);
    for (const needle of BUSINESS_INFO) {
      assert.ok(String(row.body).includes(needle), `${kind} v0.2 body is missing business info: ${needle}`);
    }
    // The privacy officer contact belongs in the privacy documents (and the terms'
    // supplementary provisions); the optional marketing consent does not carry it.
    if (kind !== 'MARKETING') {
      assert.ok(String(row.body).includes('kwon.mt@mintech.ai'), `${kind} v0.2 body is missing the privacy officer contact`);
    }
  }

  for (const [kind, file] of Object.entries(V01)) {
    const body = readFileSync(POLICIES + file, 'utf8');
    const row = documents.find(d => d.kind === kind && d.version === 'v0.1-draft');
    assert.ok(row, `${kind} v0.1-draft must still be returned`);
    assert.equal(row.bodySha256, sha(body), `${kind} v0.1-draft content must be unchanged`);
  }
});

test('v0.2 hashes in MANIFEST.json match the files on disk', () => {
  const v02 = (MANIFEST as { 'v0.2'?: { documents?: Array<{ kind: string; file: string; sha256: string; bytes: number }> } })['v0.2'];
  assert.ok(v02?.documents, 'MANIFEST.json must describe the v0.2 set');
  assert.equal(v02.documents.length, 4);
  for (const doc of v02.documents) {
    const body = readFileSync(POLICIES + doc.file, 'utf8');
    assert.equal(sha(body), doc.sha256, `${doc.file} sha256 in MANIFEST.json must match the file`);
    assert.equal(Buffer.byteLength(body, 'utf8'), doc.bytes, `${doc.file} bytes in MANIFEST.json must match the file`);
  }
  const v01 = (MANIFEST as { documents?: Array<{ kind: string; file: string; sha256: string }> }).documents;
  assert.ok(v01, 'MANIFEST.json must still describe the v0.1 set');
  for (const doc of v01!) {
    const body = readFileSync(POLICIES + doc.file, 'utf8');
    assert.equal(sha(body), doc.sha256, `${doc.file} v0.1 sha256 must be unchanged`);
  }
});

test('the loader refuses an unknown version and never promotes', async () => {
  const unknown = load('v9.9');
  assert.notEqual(unknown.status, 0, 'an unknown --version must fail');
  assert.match(unknown.stderr, /unknown --version/);

  const rows = await pool.query(
    `SELECT DISTINCT status FROM kg_membership.policy_documents WHERE version='v0.2'`,
  );
  assert.deepEqual(rows.rows.map(r => r.status), ['DRAFT'], 'loading must not change the status');
});
