import pg from 'pg';
import { buildApp } from './app.ts';
import { postgresSql, requireDevelopment } from './database.ts';
import { configuredProviders } from './providers.ts';

requireDevelopment(process.env);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
pool.on('error', () => { console.error('database connection unavailable; details withheld'); });
const identity = await pool.query('SELECT current_user AS role').catch(async () => { await pool.end(); throw new Error('database connection unavailable; details withheld'); });
if (identity.rows[0].role !== 'kg_dev_runtime') { await pool.end(); throw new Error('least privilege runtime role required'); }
const release = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.KG_RELEASE_SHA ?? 'UNVERSIONED-DEVELOPMENT';
const app = buildApp(postgresSql(pool), release, {
  providers: configuredProviders(process.env),
  identityKey: process.env.KG_IDENTITY_HMAC_KEY,
  corsOrigins: (process.env.KG_CORS_LOCAL_ORIGINS ?? '').split(',').filter(Boolean),
  // No SMS provider is selected/approved. No adapter is wired and no SMS is sent.
});
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) });
console.log(JSON.stringify({ status: 'listening', scope: 'membership-development', release }));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); await pool.end(); });
