import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Row, Sql } from './app.ts';
import type { Authenticate } from './auth.ts';

/**
 * Shared backend kernel (PLAN-WAVE5 WS-31).
 *
 * Only the pieces that were repeated in at least three modules live here. The
 * error envelope, the audit_log append and the "session -> ACTIVE member" guard
 * are each emitted by every route module, so a copy per module had become the
 * way an individual route could silently drift from the API contract.
 */

/** The one shape of an error body. `extra` carries ApiError metadata (retryAfter, attemptsRemaining, ...). */
export const errorBody = (code: string, extra: Record<string, unknown> = {}) => ({ error: { code, ...extra } });

export const fail = (reply: FastifyReply, status: number, code: string, extra: Record<string, unknown> = {}) =>
  reply.code(status).send(errorBody(code, extra));

export async function audit(
  db: Sql, actor: unknown, action: string, targetType: string, targetId: string,
  reason: string | null = null, detail: Row = {},
) {
  await db.query(
    `INSERT INTO kg_membership.audit_log(actor_member_id,action,target_type,target_id,reason,detail)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [actor, action, targetType, targetId, reason, JSON.stringify(detail)],
  );
}

/** Session -> ACTIVE member. A restricted or withdrawn member gets 403 ACCOUNT_RESTRICTED. */
export function requireActiveMember(authenticate: Authenticate) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<Row | null> => {
    const auth = await authenticate(request, reply);
    if (!auth) return null;
    if (auth.status !== 'ACTIVE') { fail(reply, 403, 'ACCOUNT_RESTRICTED'); return null; }
    return auth;
  };
}
