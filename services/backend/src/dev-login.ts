import type { FastifyInstance } from 'fastify';
import type { Sql } from './app.ts';
import { issueSession } from './auth.ts';
import { ApiError } from './security.ts';

/**
 * Temporary tester login.
 *
 * Social providers are not connected yet, so the dev deployment exposes a fixed
 * list of 20 seeded accounts and issues a real session for the chosen one.
 *
 * Kept in its own module so the production route surface (`app.ts` + `auth.ts`)
 * stays exactly the set of operations the membership contract declares. The
 * routes below are registered only when `options.devLogin` is true, which
 * server.ts derives from `KG_DEV_LOGIN=1` AND an environment name of exactly
 * `dev` — a production boot cannot expose them.
 */
export function registerDevLoginRoutes(app: FastifyInstance, db: Sql) {
  const body = (properties: Record<string, unknown>) =>
    ({ body: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } });

  app.get('/v1/auth/dev/accounts', async () => {
    const rows = await db.query(
      `SELECT a.slot,a.role,a.label,m.nickname,m.expert_active AS "expertActive"
         FROM kg_membership.dev_test_accounts a
         JOIN kg_membership.members m ON m.id=a.member_id
        WHERE m.withdrawn_at IS NULL
        ORDER BY a.slot`,
    );
    return { temporary: true, environment: 'dev', accounts: rows.rows };
  });

  app.post<{ Body: { slot: number } }>('/v1/auth/dev/login', {
    schema: body({ slot: { type: 'integer', minimum: 1, maximum: 20 } }),
  }, async req => {
    const row = (await db.query(
      `SELECT a.member_id AS "memberId",a.role,a.label,m.nickname,m.expert_active AS "expertActive"
         FROM kg_membership.dev_test_accounts a
         JOIN kg_membership.members m ON m.id=a.member_id
        WHERE a.slot=$1 AND m.withdrawn_at IS NULL AND m.status='ACTIVE'`,
      [req.body.slot],
    )).rows[0];
    if (!row) throw new ApiError(404, 'DEV_ACCOUNT_NOT_FOUND');
    const session = await issueSession(db, row.memberId);
    return {
      temporary: true,
      session,
      member: { id: row.memberId, nickname: row.nickname, role: row.role, expertActive: row.expertActive },
    };
  });
}
