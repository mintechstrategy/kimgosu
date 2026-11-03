#!/usr/bin/env node
// Prove that promoted policy documents are sealed: an ordinary content UPDATE must be
// rejected by the 004 integrity trigger. Read-only apart from the deliberately failing
// UPDATE, which changes nothing when the guard is working.
//
//   ./scripts/dev-db.sh node services/backend/scripts/verify-policy-seal.mjs --version v0.1-draft

import pg from 'pg';

const args = process.argv.slice(2);
const i = args.indexOf('--version');
const version = i === -1 ? null : args[i + 1];
if (!version) { console.error('error: --version is required'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('error: DATABASE_URL is required'); process.exit(2); }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let failed = false;
try {
  const rows = await pool.query(
    `SELECT kind,status,content_sealed FROM kg_membership.policy_documents WHERE version=$1 ORDER BY kind`,
    [version],
  );
  if (rows.rows.length === 0) { console.error(`error: no documents with version=${version}`); process.exit(2); }
  for (const r of rows.rows) {
    console.log(`${r.kind.padEnd(16)} status=${r.status.padEnd(6)} sealed=${r.content_sealed}`);
    if (r.status !== 'DRAFT' && !r.content_sealed) { console.log(`  FAIL: ${r.kind} is ${r.status} but not sealed`); failed = true; }
  }

  for (const probe of [
    { label: 'body', sql: `UPDATE kg_membership.policy_documents SET body=body||'x' WHERE version=$1 AND kind='TERMS'` },
    { label: 'operator', sql: `UPDATE kg_membership.policy_documents SET operator_name='other' WHERE version=$1 AND kind='TERMS'` },
    { label: 'unseal', sql: `UPDATE kg_membership.policy_documents SET content_sealed=false WHERE version=$1 AND kind='TERMS'` },
  ]) {
    try {
      await pool.query(probe.sql, [version]);
      console.log(`TAMPER ${probe.label.padEnd(9)}: SUCCEEDED  <-- guard did NOT hold`);
      failed = true;
    } catch (e) {
      console.log(`TAMPER ${probe.label.padEnd(9)}: REJECTED   ${e.message}`);
    }
  }
} finally {
  await pool.end();
}
console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS (all tamper attempts rejected)');
process.exit(failed ? 1 : 0);
