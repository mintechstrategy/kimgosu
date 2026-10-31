import pg from 'pg';
import type { Sql, Row } from './app.ts';
export function postgresSql(pool: pg.Pool): Sql {
  return {
    async query(text, values) { const r = await pool.query(text, values); return { rows: r.rows as Row[], rowCount: r.rowCount }; },
    async transaction(work) {
      const client = await pool.connect();
      const tx: Sql = {
        async query(text, values) { const r = await client.query(text, values); return { rows: r.rows as Row[], rowCount: r.rowCount }; },
        async transaction() { throw new Error('nested transaction not supported'); },
      };
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
        const value = await work(tx); await client.query('COMMIT'); return value;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
export function requireDevelopment(env: NodeJS.ProcessEnv) {
  if (env.RAILWAY_PROJECT_ID !== '95b52b2c-e1c0-45da-909b-d7989ce08a90' || env.RAILWAY_ENVIRONMENT_ID !== 'a1b5a11e-88a1-417e-84bc-2bbb2ba0fc18') throw new Error('development environment required');
  let database: URL;
  try { database = new URL(env.DATABASE_URL ?? ''); } catch { throw new Error('private development DB required'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname.endsWith('.railway.internal') || database.searchParams.has('host') || database.searchParams.has('hostaddr')) throw new Error('private development DB required');
}
