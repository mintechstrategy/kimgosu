#!/usr/bin/env node
// Load the reviewed policy drafts into a database as DRAFT.
//
// DRAFT documents are never consentable: the API's canConsent predicate requires
// status='READY' AND approved_at IS NOT NULL AND effective_at<=now() AND a non-empty
// operator_name. Loading a draft therefore cannot enable signup. Promotion to READY
// is a separate, explicit act that requires the approved text and operator details.
//
//   DATABASE_URL=postgres://... node scripts/load-policy-drafts.mjs --dry-run
//   DATABASE_URL=postgres://... node scripts/load-policy-drafts.mjs
//
// Refuses to overwrite an existing (kind, version) row.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const POLICY_DIR = join(HERE, '../../../product/policies');
const VERSION = 'v0.1-draft';

const DOCUMENTS = [
  { kind: 'TERMS', file: 'TERMS-v0.1-draft.md', title: '김고수 서비스 이용약관 (검토 초안 v0.1)' },
  { kind: 'PRIVACY_CONSENT', file: 'PRIVACY-CONSENT-v0.1-draft.md', title: '개인정보 수집·이용 동의 (검토 초안 v0.1)' },
  { kind: 'PRIVACY_POLICY', file: 'PRIVACY-POLICY-v0.1-draft.md', title: '김고수 개인정보 처리방침 (검토 초안 v0.1)' },
  { kind: 'MARKETING', file: 'MARKETING-v0.1-draft.md', title: '마케팅 정보 수신 동의 (검토 초안 v0.1)' },
];

const dryRun = process.argv.includes('--dry-run');
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const loaded = [];
for (const doc of DOCUMENTS) {
  const body = await readFile(join(POLICY_DIR, doc.file), 'utf8');
  if (!body.trim()) throw new Error(`${doc.file} is empty`);
  if (!body.includes('DRAFT_NOT_EFFECTIVE')) {
    throw new Error(`${doc.file} is missing the DRAFT_NOT_EFFECTIVE marker; refusing to load`);
  }
  loaded.push({ ...doc, body, bodySha256: sha(body) });
}

if (dryRun) {
  for (const d of loaded) {
    console.log(`${d.kind.padEnd(16)} ${VERSION.padEnd(12)} ${String(Buffer.byteLength(d.body, 'utf8')).padStart(6)}B  ${d.bodySha256}`);
  }
  console.log('dry run: nothing written');
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

try {
  for (const d of loaded) {
    const existing = await pool.query(
      `SELECT id, status FROM kg_membership.policy_documents WHERE kind=$1 AND version=$2`,
      [d.kind, VERSION],
    );
    if (existing.rows[0]) {
      console.log(`${d.kind.padEnd(16)} already present (id=${existing.rows[0].id}, status=${existing.rows[0].status}) — skipped`);
      continue;
    }
    const inserted = await pool.query(
      `INSERT INTO kg_membership.policy_documents
         (kind,version,status,title,body,body_sha256,operator_name,effective_at,approved_at)
       VALUES ($1,$2,'DRAFT',$3,$4,$5,NULL,NULL,NULL)
       RETURNING id`,
      [d.kind, VERSION, d.title, d.body, d.bodySha256],
    );
    console.log(`${d.kind.padEnd(16)} inserted as DRAFT (id=${inserted.rows[0].id})`);
  }

  const check = await pool.query(
    `SELECT kind,version,status,
            (status='READY' AND approved_at IS NOT NULL AND effective_at<=now()
             AND operator_name IS NOT NULL AND length(trim(operator_name))>0) AS "canConsent"
       FROM kg_membership.policy_documents ORDER BY kind`,
  );
  console.log('\ncurrent documents:');
  for (const row of check.rows) {
    console.log(`  ${row.kind.padEnd(16)} ${row.version.padEnd(12)} ${row.status.padEnd(8)} canConsent=${row.canConsent}`);
  }
  const consentable = check.rows.filter((r) => r.canConsent).length;
  console.log(`\nconsentable documents: ${consentable} (signup stays blocked until TERMS, PRIVACY_CONSENT and PRIVACY_POLICY are READY)`);
} finally {
  await pool.end();
}
