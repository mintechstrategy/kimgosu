#!/usr/bin/env node
// Promote reviewed policy drafts from DRAFT to READY.
//
// THIS IS A ONE-WAY DOOR. The 004 integrity trigger seals a document the moment it
// stops being DRAFT: body, title, version, operator_name, effective_at, approved_at and
// created_at become immutable, and content_sealed itself cannot be changed. Corrections
// after this point require a new (kind, version) row — the existing row cannot be edited.
//
// Because of that, every invocation prints the exact rows it will seal and requires
// --confirm. The operator name and timestamps must be supplied by the user; this script
// never invents them.
//
//   node scripts/promote-policy-drafts.mjs \
//     --version v0.1-draft \
//     --operator "mintech" \
//     --effective 2026-11-03T00:00:00+09:00 \
//     --approved 2026-11-03T12:01:00+09:00 \
//     --confirm

import pg from 'pg';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const version = arg('version');
const operator = arg('operator');
const effective = arg('effective');
const approved = arg('approved');
const confirmed = args.includes('--confirm');

const fail = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

if (!version) fail('--version is required');
if (!operator || !operator.trim()) fail('--operator is required');
for (const [name, value] of [['effective', effective], ['approved', approved]]) {
  if (!value) fail(`--${name} is required`);
  if (!Number.isFinite(Date.parse(value))) fail(`--${name} is not a parseable timestamp: ${value}`);
}
if (!confirmed) {
  console.log('dry run — pass --confirm to actually promote (this seals the documents permanently)');
}

if (!process.env.DATABASE_URL) fail('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

try {
  const pending = await pool.query(
    `SELECT id, kind, version, status, title, body_sha256 AS "bodySha256"
       FROM kg_membership.policy_documents
      WHERE version=$1 ORDER BY kind`,
    [version],
  );
  if (pending.rows.length === 0) fail(`no documents found with version=${version} (already promoted?)`);

  const notDraft = pending.rows.filter((r) => r.status !== 'DRAFT');
  if (notDraft.length > 0) {
    fail(`refusing: ${notDraft.map((r) => `${r.kind}(${r.status})`).join(', ')} is not DRAFT`);
  }

  console.log(`promoting ${pending.rows.length} document(s) from ${version}:`);
  for (const row of pending.rows) {
    console.log(`  ${row.kind.padEnd(16)} id=${row.id} ${row.bodySha256.slice(0, 12)}… ${row.title}`);
  }
  console.log(`  operator_name : ${operator}`);
  console.log(`  effective_at  : ${effective}`);
  console.log(`  approved_at   : ${approved}`);

  if (!confirmed) {
    console.log('\nnothing written. re-run with --confirm to promote.');
    process.exit(0);
  }

  await pool.query(
    `UPDATE kg_membership.policy_documents
        SET status='READY', operator_name=$2, effective_at=$3, approved_at=$4
      WHERE version=$1 AND status='DRAFT'`,
    [version, operator, effective, approved],
  );

  const after = await pool.query(
    `SELECT kind, version, status, operator_name AS "operator",
            effective_at AS "effectiveAt", approved_at AS "approvedAt",
            content_sealed AS "sealed",
            (status='READY' AND approved_at IS NOT NULL AND effective_at<=now()
             AND operator_name IS NOT NULL AND length(trim(operator_name))>0) AS "canConsent"
       FROM kg_membership.policy_documents ORDER BY kind`,
  );
  console.log('\nresult:');
  for (const row of after.rows) {
    console.log(`  ${row.kind.padEnd(16)} ${row.version.padEnd(12)} ${row.status.padEnd(8)} canConsent=${String(row.canConsent).padEnd(5)} sealed=${row.sealed}`);
  }
  const consentable = after.rows.filter((r) => r.canConsent).length;
  console.log(`\nconsentable: ${consentable}`);
  if (consentable === 0) console.log('WARNING: still zero consentable documents — check spans/operator');
} finally {
  await pool.end();
}
