#!/usr/bin/env node
// Seed the 20 temporary test accounts (10 regular users, 10 expert-mode users).
//
// Development only. Refuses to run unless the deployment environment name is
// exactly 'dev' or the operator explicitly passes --i-know-this-is-dev, so a
// production database cannot be seeded by accident.
//
//   DATABASE_URL=... node scripts/seed-dev-test-accounts.mjs --i-know-this-is-dev

import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

const sha = (v) => createHash('sha256').update(v, 'utf8').digest('hex');
const confirmed = process.argv.includes('--i-know-this-is-dev');
if (!confirmed && process.env.RAILWAY_ENVIRONMENT_NAME !== 'dev') {
  console.error('error: refusing to seed test accounts outside the dev environment (pass --i-know-this-is-dev to override)');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('error: DATABASE_URL is required');
  process.exit(2);
}

const ACCOUNTS = [
  ...Array.from({ length: 10 }, (_, i) => ({ slot: i + 1, role: 'USER', name: `일반 사용자 ${String(i + 1).padStart(2, '0')}`, expert: false })),
  ...Array.from({ length: 10 }, (_, i) => ({ slot: i + 11, role: 'EXPERT', name: `고수 ${String(i + 1).padStart(2, '0')}`, expert: true })),
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const created = [];
const reused = [];

try {
  for (const account of ACCOUNTS) {
    const existing = await pool.query(
      `SELECT member_id FROM kg_membership.dev_test_accounts WHERE slot=$1`,
      [account.slot],
    );
    if (existing.rows[0]) {
      reused.push(account.slot);
      continue;
    }

    const principalId = randomUUID();
    const memberId = randomUUID();
    const nickname = `테스트${String(account.slot).padStart(2, '0')}`;

    await pool.query('BEGIN');
    try {
      await pool.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
      await pool.query(
        `INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,phone_digest,expert_active)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [memberId, principalId, account.name, `test${String(account.slot).padStart(2, '0')}@dev.invalid`, nickname,
          sha(`0100000${String(account.slot).padStart(4, '0')}`), account.expert],
      );
      await pool.query(
        `INSERT INTO kg_membership.dev_test_accounts(slot,role,label,member_id) VALUES($1,$2,$3,$4)`,
        [account.slot, account.role, account.name, memberId],
      );
      await pool.query('COMMIT');
      created.push(account.slot);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  const all = await pool.query(
    `SELECT a.slot,a.role,a.label,m.nickname,m.expert_active AS "expertActive"
       FROM kg_membership.dev_test_accounts a JOIN kg_membership.members m ON m.id=a.member_id
      ORDER BY a.slot`,
  );
  console.log(`created ${created.length}, reused ${reused.length}`);
  for (const row of all.rows) {
    console.log(`  ${String(row.slot).padStart(2)} ${row.role.padEnd(6)} ${row.label.padEnd(14)} ${row.nickname} expert=${row.expertActive}`);
  }
} finally {
  await pool.end();
}
