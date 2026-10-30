import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { buildApp } from './app.ts';
import { UUID } from './store.ts';
import type { Store, RecordValue } from './store.ts';

const env = process.env;
if (env.RAILWAY_PROJECT_ID !== '95b52b2c-e1c0-45da-909b-d7989ce08a90' ||
    env.RAILWAY_ENVIRONMENT_ID !== 'a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18') throw new Error('dev-only guard');
const url = new URL(env.DATABASE_URL ?? '');
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.railway.internal')) throw new Error('private DB required');
const run = env.SAMPLE_RUN_ID ?? '';
const owner = env.SAMPLE_OWNER_ID ?? '';
const digest = env.SAMPLE_TOKEN_SHA256 ?? '';
const expiresAt = Number(env.SAMPLE_EXPIRES_AT);
if (![run, owner].every(value => new RegExp(UUID).test(value)) || !/^[a-f0-9]{64}$/.test(digest) || !Number.isFinite(expiresAt)) throw new Error('diagnostic configuration required');
const namespace = `kg-devdb-129-${run}`;
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
pool.on('error', () => { console.error('database connection error (details redacted)'); });
const role = await pool.query('SELECT current_user AS role');
if (role.rows[0].role !== 'kg_dev_runtime') { await pool.end(); throw new Error('least privilege role required'); }
const store: Store = {
  async create(id, message) {
    const result = await pool.query<RecordValue>(`INSERT INTO kg_dev_slice.registrations(namespace,owner_id,kind,id,input)
      VALUES ($1,$2,'quote',$3,$4::json) ON CONFLICT DO NOTHING
      RETURNING id,input->>'message' AS message,version`, [namespace, owner, id, JSON.stringify({ diagnostic: 'KG-ENV-SAMPLE-01', message })]);
    return result.rows[0] ?? null;
  },
  async read(id) {
    const result = await pool.query<RecordValue>(`SELECT id,input->>'message' AS message,version FROM kg_dev_slice.registrations
      WHERE namespace=$1 AND owner_id=$2 AND kind='quote' AND id=$3 AND synthetic=true`, [namespace, owner, id]);
    return result.rows[0] ?? null;
  },
};
const release = JSON.parse(await readFile(new URL('../release.json', import.meta.url), 'utf8')).id as string;
const app = buildApp(store, digest, { tokenIsHash: true, expiresAt, release });
await app.listen({ host: '0.0.0.0', port: Number(env.PORT ?? 8080) });
console.log(JSON.stringify({ status: 'listening', scope: 'diagnostic-only', release }));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); await pool.end(); });
