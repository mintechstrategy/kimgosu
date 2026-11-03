import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from './app.ts';
import { ApiError, ADMIN_SESSION_PREFIX, bearerTokenPattern, digest, isAdminSessionToken, opaque } from './security.ts';

/**
 * Operator console sessions (`POST /v1/admin/session`).
 *
 * The console never accepts a pasted server token from a human: an operator
 * proves identity with a real social/member login, and only then is a dedicated
 * admin-scope session minted. Two rules are enforced here and re-checked on
 * every admin request (`requireAdminScope`):
 *
 *  1. scope   — the bearer string must carry `adm_`. A member session token gets
 *               403 on admin routes; an admin token gets 401 on member routes.
 *  2. grant   — a live `role_grants` ADMIN row is required at issue time *and*
 *               on every call, so a revoked operator loses access immediately.
 *
 * The schema has no session-scope column and this work unit was allocated no
 * migration number, so the scope lives in the token prefix and every admin route
 * re-reads `sessions` + `role_grants`. Admin sessions are short lived
 * (2 hours), never refresh, and are revoked on logout.
 *
 * Brute-force limit: 5 failed exchanges per client within 15 minutes locks the
 * client for 5 minutes. State is per-process memory (no schema change), and
 * every failure/lock/issue/logout is appended to `audit_log` — the persistent
 * record survives a process restart even though the counter does not.
 */
export const ADMIN_SESSION_TTL_SECONDS = 7200;
export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_LOCK_SECONDS = 300;
export const LOGIN_WINDOW_SECONDS = 900;

export interface LoginLimiter {
  /** Returns the remaining lock time in seconds, or 0 when the client may try. */
  lockedFor(key: string): number;
  /** Records one failure; returns the remaining attempts before the lock applies. */
  fail(key: string): { attemptsRemaining: number; lockedForSeconds: number };
  /** Clears the failure counter after a successful exchange. */
  succeed(key: string): void;
}

/** In-memory attempt counter. Deterministic clock injection keeps it testable. */
export function createLoginLimiter(
  options: { maxFailures?: number; lockSeconds?: number; windowSeconds?: number; now?: () => number } = {},
): LoginLimiter {
  const maxFailures = options.maxFailures ?? MAX_LOGIN_FAILURES;
  const lockMs = (options.lockSeconds ?? LOGIN_LOCK_SECONDS) * 1000;
  const windowMs = (options.windowSeconds ?? LOGIN_WINDOW_SECONDS) * 1000;
  const now = options.now ?? Date.now;
  const attempts = new Map<string, { failures: number; firstAt: number; lockedUntil: number }>();

  const prune = (at: number) => {
    for (const [key, value] of attempts) {
      if (value.lockedUntil > at) continue;
      if (at - value.firstAt >= windowMs) attempts.delete(key);
    }
    if (attempts.size > 10000) attempts.clear();
  };

  return {
    lockedFor(key) {
      const at = now(); prune(at);
      const row = attempts.get(key);
      return row && row.lockedUntil > at ? Math.ceil((row.lockedUntil - at) / 1000) : 0;
    },
    fail(key) {
      const at = now(); prune(at);
      const row = attempts.get(key) ?? { failures: 0, firstAt: at, lockedUntil: 0 };
      if (row.lockedUntil > at) return { attemptsRemaining: 0, lockedForSeconds: Math.ceil((row.lockedUntil - at) / 1000) };
      row.failures += 1;
      if (row.failures >= maxFailures) {
        row.failures = 0; row.firstAt = at; row.lockedUntil = at + lockMs;
        attempts.set(key, row);
        return { attemptsRemaining: 0, lockedForSeconds: Math.ceil(lockMs / 1000) };
      }
      attempts.set(key, row);
      return { attemptsRemaining: maxFailures - row.failures, lockedForSeconds: 0 };
    },
    succeed(key) { attempts.delete(key); },
  };
}

export interface AdminScope {
  sessionId: string; memberId: string; nickname: string; customerNumber: string; expiresAt: string;
}
export type AdminScopeResult =
  | { status: 'OK'; scope: AdminScope }
  | { status: 'NO_AUTH' } | { status: 'WRONG_SCOPE' } | { status: 'SESSION_INVALID' } | { status: 'NOT_ADMIN' };

const liveAdminGrant = `SELECT 1 FROM kg_membership.role_grants g
   WHERE g.member_id=$1 AND g.role_id='ADMIN' AND g.revoked_at IS NULL
     AND g.starts_at<=now() AND (g.ends_at IS NULL OR g.ends_at>now())`;

const sessionLookup = `SELECT s.id AS "sessionId", s.expires_at AS "expiresAt", m.id AS "memberId",
    m.nickname, m.customer_no::text AS "customerNumber"
  FROM kg_membership.sessions s JOIN kg_membership.members m ON m.id=s.member_id
  WHERE s.access_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND m.withdrawn_at IS NULL`;

/** Scope + grant check shared by every admin route. Never trusts a client flag. */
export async function resolveAdminScope(db: Sql, authorization: unknown): Promise<AdminScopeResult> {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || !bearerTokenPattern.test(authorization.slice(7))) {
    return { status: 'NO_AUTH' };
  }
  const token = authorization.slice(7);
  if (!isAdminSessionToken(token)) return { status: 'WRONG_SCOPE' };
  const session = (await db.query(sessionLookup, [digest(token)])).rows[0];
  if (!session) return { status: 'SESSION_INVALID' };
  if (!(await db.query(liveAdminGrant, [session.memberId])).rows[0]) return { status: 'NOT_ADMIN' };
  return {
    status: 'OK',
    scope: {
      sessionId: String(session.sessionId), memberId: String(session.memberId), nickname: String(session.nickname),
      customerNumber: String(session.customerNumber), expiresAt: new Date(String(session.expiresAt)).toISOString(),
    },
  };
}

/** Admin routes refuse with a specific code per failure so the console can react. */
export async function requireAdminScope(db: Sql, request: FastifyRequest, reply: FastifyReply): Promise<AdminScope | null> {
  const result = await resolveAdminScope(db, request.headers.authorization);
  if (result.status === 'OK') return result.scope;
  if (result.status === 'NO_AUTH') reply.code(401).send({ error: { code: 'AUTH_REQUIRED' } });
  else if (result.status === 'WRONG_SCOPE') reply.code(403).send({ error: { code: 'ADMIN_SESSION_REQUIRED' } });
  else if (result.status === 'SESSION_INVALID') reply.code(401).send({ error: { code: 'SESSION_INVALID' } });
  else reply.code(403).send({ error: { code: 'ADMIN_REQUIRED' } });
  return null;
}

const body = (properties: Record<string, unknown>) =>
  ({ body: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } });

async function audit(sql: Sql, actor: string | null, action: string, targetType: string, targetId: string, reason: string | null, detail: Record<string, unknown>) {
  await sql.query(
    `INSERT INTO kg_membership.audit_log(actor_member_id,action,target_type,target_id,reason,detail)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [actor, action, targetType, targetId, reason, JSON.stringify(detail)],
  );
}

export function registerAdminSessionRoutes(
  app: FastifyInstance, db: Sql,
  options: { limiter?: LoginLimiter; clientSalt?: string } = {},
) {
  const limiter = options.limiter ?? createLoginLimiter();
  const salt = options.clientSalt ?? randomUUID();
  // The raw client address is never stored or logged; only a salted digest is used as the key.
  const clientKey = (request: FastifyRequest) => digest(salt + ':' + (request.ip ?? 'unknown'));

  app.post<{ Body: { sessionToken: string } }>('/v1/admin/session', {
    schema: body({ sessionToken: { type: 'string', pattern: '^[A-Za-z0-9_-]{32,256}$' } }),
  }, async (request, reply) => {
    const key = clientKey(request);
    const locked = limiter.lockedFor(key);
    if (locked > 0) {
      await db.query(
        `INSERT INTO kg_membership.audit_log(actor_member_id,action,target_type,target_id,reason,detail)
         VALUES(NULL,'ADMIN_LOGIN_BLOCKED','admin_login',$1,'LOCK_ACTIVE',$2)`,
        [key, JSON.stringify({ retryAfterSeconds: locked })],
      );
      throw new ApiError(429, 'ADMIN_LOGIN_LOCKED', { retryAfterSeconds: locked });
    }
    // An admin token is not a member session; it must never be exchangeable again.
    if (isAdminSessionToken(request.body.sessionToken)) throw new ApiError(400, 'INVALID_REQUEST');

    const session = (await db.query(
      `SELECT s.id AS "sessionId", m.id AS "memberId", m.nickname, m.customer_no::text AS "customerNumber"
         FROM kg_membership.sessions s JOIN kg_membership.members m ON m.id=s.member_id
        WHERE s.access_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND m.withdrawn_at IS NULL`,
      [digest(request.body.sessionToken)],
    )).rows[0];

    if (!session) {
      const failure = limiter.fail(key);
      await audit(db, null, 'ADMIN_LOGIN_FAILED', 'admin_login', key, 'SESSION_INVALID',
        { attemptsRemaining: failure.attemptsRemaining, lockedForSeconds: failure.lockedForSeconds });
      throw new ApiError(401, 'SESSION_INVALID', failure.lockedForSeconds > 0
        ? { attemptsRemaining: 0, retryAfterSeconds: failure.lockedForSeconds }
        : { attemptsRemaining: failure.attemptsRemaining });
    }

    const grant = (await db.query(liveAdminGrant, [session.memberId])).rows[0];
    if (!grant) {
      const failure = limiter.fail(key);
      await audit(db, String(session.memberId), 'ADMIN_LOGIN_DENIED', 'admin_login', key, 'ADMIN_REQUIRED',
        { attemptsRemaining: failure.attemptsRemaining, lockedForSeconds: failure.lockedForSeconds });
      throw new ApiError(403, 'ADMIN_REQUIRED', failure.lockedForSeconds > 0
        ? { attemptsRemaining: 0, retryAfterSeconds: failure.lockedForSeconds }
        : { attemptsRemaining: failure.attemptsRemaining });
    }

    const adminToken = ADMIN_SESSION_PREFIX + opaque();
    const issued = await db.transaction(async sql => {
      const row = (await sql.query(
        `INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at)
         VALUES($1,$2,$3,now()+($4::text || ' seconds')::interval)
         RETURNING id, expires_at AS "expiresAt"`,
        [randomUUID(), session.memberId, digest(adminToken), String(ADMIN_SESSION_TTL_SECONDS)],
      )).rows[0];
      await audit(sql, String(session.memberId), 'ADMIN_SESSION_ISSUED', 'admin_session', String(row.id), null,
        { expiresAt: new Date(String(row.expiresAt)).toISOString() });
      return row;
    });
    limiter.succeed(key);
    return reply.code(201).send({
      adminToken,
      tokenType: 'Bearer',
      expiresInSeconds: ADMIN_SESSION_TTL_SECONDS,
      expiresAt: new Date(String(issued.expiresAt)).toISOString(),
      operator: { memberId: String(session.memberId), nickname: String(session.nickname), customerNumber: String(session.customerNumber) },
    });
  });

  app.get('/v1/admin/session', async (request, reply) => {
    const scope = await requireAdminScope(db, request, reply);
    if (!scope) return;
    return { operator: { memberId: scope.memberId, nickname: scope.nickname, customerNumber: scope.customerNumber }, expiresAt: scope.expiresAt };
  });

  app.post('/v1/admin/session/logout', async (request, reply) => {
    const scope = await requireAdminScope(db, request, reply);
    if (!scope) return;
    await db.transaction(async sql => {
      await sql.query(`UPDATE kg_membership.sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, [scope.sessionId]);
      await audit(sql, scope.memberId, 'ADMIN_SESSION_LOGGED_OUT', 'admin_session', scope.sessionId, null, {});
    });
    return { loggedOut: true };
  });
}
