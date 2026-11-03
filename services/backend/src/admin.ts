import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql, Row } from './app.ts';
import type { Authenticate } from './auth.ts';
import { ApiError } from './security.ts';

/**
 * Operator (admin) routes: member/ledger lookup and account restriction.
 *
 * Authority is decided here on the server from `role_grants`, never from a
 * client-sent flag. A member without a live ADMIN grant gets 403 before any
 * member data is read.
 *
 * Restriction history lives in `kg_membership.restrictions` (active row while
 * `revoked_at IS NULL`); every restrict/release is also appended to
 * `kg_membership.audit_log`, which carries the operator, the reason and the
 * period. The restrictions table itself has no reason/revoker columns and this
 * work unit was not allocated a migration number, so no column was added.
 */

const body = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ body: { type: 'object', additionalProperties: false, properties, required } });
const idSchema = { type: 'string', format: 'uuid' };
const activeRestriction = (alias: string) =>
  `EXISTS(SELECT 1 FROM kg_membership.restrictions r WHERE r.principal_id=${alias}.principal_id
     AND r.revoked_at IS NULL AND r.starts_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now()))`;
const effectiveStatus = (alias: string) =>
  `CASE WHEN ${activeRestriction(alias)} THEN 'RESTRICTED' ELSE ${alias}.status END`;

async function audit(sql: Sql, actor: unknown, action: string, targetId: string, reason: string, detail: Row) {
  await sql.query(
    `INSERT INTO kg_membership.audit_log(actor_member_id,action,target_type,target_id,reason,detail)
     VALUES($1,$2,'member',$3,$4,$5)`,
    [actor, action, targetId, reason, JSON.stringify(detail)],
  );
}

/** PII is masked before it reaches the list response; the raw value never leaves the query result. */
function maskEmail(value: unknown): string | null {
  if (typeof value !== 'string' || !value.includes('@')) return null;
  const [local, domain] = value.split('@') as [string, string];
  const head = [...local].slice(0, 2).join('');
  return `${head}${'*'.repeat(Math.max(3, [...local].length - 2))}@${domain}`;
}

function cursor(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}

export function registerAdminRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    const auth = await authenticate(request, reply);
    if (!auth) return null;
    const grant = await db.query(
      `SELECT 1 FROM kg_membership.role_grants g
        WHERE g.member_id=$1 AND g.role_id='ADMIN' AND g.revoked_at IS NULL
          AND g.starts_at<=now() AND (g.ends_at IS NULL OR g.ends_at>now())`,
      [auth.memberId],
    );
    if (!grant.rows[0]) { reply.code(403).send({ error: { code: 'ADMIN_REQUIRED' } }); return null; }
    return auth;
  }

  app.get<{ Querystring: { query?: string; status?: string; page?: string; limit?: string } }>('/v1/admin/members', {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          query: { type: 'string', maxLength: 100 },
          status: { type: 'string', enum: ['ACTIVE', 'RESTRICTED', 'WITHDRAWN'] },
          page: { type: 'string', pattern: '^[0-9]{1,6}$' },
          limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
        },
      },
    },
  }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const page = cursor(request.query.page, 1, 1, 100000);
    const limit = cursor(request.query.limit, 20, 1, 100);
    const raw = request.query.query?.trim() ?? '';
    const search = raw.length === 0 ? null : raw.replace(/[\\%_]/g, c => '\\' + c);
    const status = request.query.status ?? null;
    const where = `WHERE ($1::text IS NULL OR m.name ILIKE '%'||$1||'%' OR m.nickname ILIKE '%'||$1||'%'
        OR m.email ILIKE '%'||$1||'%' OR m.customer_no::text = $1)
      AND ($2::text IS NULL OR ${effectiveStatus('m')} = $2)`;
    const total = Number((await db.query(`SELECT count(*)::int AS count FROM kg_membership.members m ${where}`, [search, status])).rows[0]?.count ?? 0);
    const rows = await db.query(
      `SELECT m.id, m.customer_no::text AS "customerNumber", m.name, m.nickname, m.email,
              m.phone_masked AS "phoneMasked",
              ${effectiveStatus('m')} AS status, m.expert_active AS "expertActive",
              m.created_at AS "createdAt", m.withdrawn_at AS "withdrawnAt"
         FROM kg_membership.members m ${where}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3 OFFSET $4`,
      [search, status, limit, (page - 1) * limit],
    );
    return {
      page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)),
      members: rows.rows.map(row => ({
        id: row.id, customerNumber: row.customerNumber, name: row.name, nickname: row.nickname,
        emailMasked: maskEmail(row.email), phoneMasked: row.phoneMasked ?? null, status: row.status,
        expertActive: row.expertActive, createdAt: row.createdAt, withdrawnAt: row.withdrawnAt,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/v1/admin/members/:id', {
    schema: { params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } } },
  }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const member = (await db.query(
      `SELECT m.id, m.customer_no::text AS "customerNumber", m.name, m.nickname, m.email,
              m.phone_masked AS "phoneMasked",
              ${effectiveStatus('m')} AS status, m.expert_active AS "expertActive",
              m.created_at AS "createdAt", m.withdrawn_at AS "withdrawnAt",
              m.rejoin_after AS "rejoinAfter", m.retention_until AS "retentionUntil"
         FROM kg_membership.members m WHERE m.id=$1`,
      [request.params.id],
    )).rows[0];
    if (!member) return reply.code(404).send({ error: { code: 'MEMBER_NOT_FOUND' } });
    const restrictions = (await db.query(
      `SELECT r.id, r.reason, r.starts_at AS "startsAt", r.ends_at AS "endsAt", r.revoked_at AS "revokedAt",
              (r.revoked_at IS NULL AND r.starts_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now())) AS active,
              (SELECT a.reason FROM kg_membership.audit_log a
                WHERE a.action='MEMBER_RELEASED' AND a.target_type='member' AND a.target_id=$1::text
                  AND a.detail->>'restrictionId'=r.id::text
                ORDER BY a.id DESC LIMIT 1) AS "releaseReason"
         FROM kg_membership.restrictions r
        WHERE r.principal_id=(SELECT principal_id FROM kg_membership.members WHERE id=$1::uuid)
        ORDER BY r.starts_at DESC, r.id`,
      [request.params.id],
    )).rows;
    const consents = (await db.query(
      `SELECT DISTINCT ON(d.kind) d.kind, d.title, d.version, e.action AS status, e.recorded_at AS "recordedAt"
         FROM kg_membership.consent_events e JOIN kg_membership.policy_documents d ON d.id=e.document_id
        WHERE e.member_id=$1 ORDER BY d.kind, e.id DESC`,
      [request.params.id],
    )).rows;
    const ledgers = (await db.query(
      `SELECT l.id, l.display_name AS "displayName", l.created_at AS "createdAt", l.updated_at AS "updatedAt",
              CASE WHEN l.expert_member_id=$1 THEN 'EXPERT' ELSE 'CUSTOMER' END AS role,
              other.id AS "counterpartId", other.nickname AS "counterpartNickname",
              other.customer_no::text AS "counterpartNumber",
              (SELECT count(*)::int FROM kg_membership.agreements a WHERE a.ledger_id=l.id) AS "agreementCount",
              (SELECT count(*)::int FROM kg_membership.agreements a WHERE a.ledger_id=l.id AND a.status='COMPLETED') AS "completedAgreements"
         FROM kg_membership.ledgers l
         JOIN kg_membership.members other
           ON other.id = CASE WHEN l.expert_member_id=$1 THEN l.customer_member_id ELSE l.expert_member_id END
        WHERE l.expert_member_id=$1 OR l.customer_member_id=$1
        ORDER BY l.updated_at DESC LIMIT 50`,
      [request.params.id],
    )).rows;
    const roles = (await db.query(
      `SELECT g.id, g.role_id AS role, g.reason, g.starts_at AS "startsAt", g.ends_at AS "endsAt",
              g.revoked_at AS "revokedAt"
         FROM kg_membership.role_grants g WHERE g.member_id=$1 ORDER BY g.created_at DESC`,
      [request.params.id],
    )).rows;
    return { member: { ...member, emailMasked: maskEmail(member.email), phoneMasked: member.phoneMasked ?? null }, restrictions, consents, ledgers, roles };
  });

  app.post<{ Params: { id: string }; Body: { reason: string; endsAt?: string } }>('/v1/admin/members/:id/restrict', {
    schema: {
      params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
      ...body({ reason: { type: 'string', minLength: 2, maxLength: 500 }, endsAt: { type: 'string', format: 'date-time' } }, ['reason']),
    },
  }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    return db.transaction(async sql => {
      const member = (await sql.query(
        `SELECT id, principal_id AS "principalId", withdrawn_at AS "withdrawnAt" FROM kg_membership.members WHERE id=$1 FOR UPDATE`,
        [request.params.id],
      )).rows[0];
      if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND');
      if (member.withdrawnAt) throw new ApiError(409, 'MEMBER_WITHDRAWN');
      const live = (await sql.query(
        `SELECT id FROM kg_membership.restrictions
          WHERE principal_id=$1 AND revoked_at IS NULL AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())`,
        [member.principalId],
      )).rows[0];
      if (live) throw new ApiError(409, 'ALREADY_RESTRICTED');
      const endsAt = request.body.endsAt ?? null;
      if (endsAt !== null && !(Date.parse(endsAt) > Date.now())) throw new ApiError(400, 'INVALID_REQUEST');
      const created = (await sql.query(
        `INSERT INTO kg_membership.restrictions(id,principal_id,reason,starts_at,ends_at)
         VALUES($1,$2,$3,now(),$4)
         RETURNING id, reason, starts_at AS "startsAt", ends_at AS "endsAt", revoked_at AS "revokedAt"`,
        [randomUUID(), member.principalId, request.body.reason.trim(), endsAt],
      )).rows[0];
      await audit(sql, auth.memberId, 'MEMBER_RESTRICTED', request.params.id, request.body.reason.trim(),
        { restrictionId: created.id, endsAt });
      return reply.code(201).send({ ...created, memberId: request.params.id, status: 'RESTRICTED' });
    });
  });

  app.post<{ Params: { id: string }; Body: { reason: string } }>('/v1/admin/members/:id/release', {
    schema: {
      params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
      ...body({ reason: { type: 'string', minLength: 2, maxLength: 500 } }, ['reason']),
    },
  }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    return db.transaction(async sql => {
      const member = (await sql.query(
        `SELECT id, principal_id AS "principalId" FROM kg_membership.members WHERE id=$1 FOR UPDATE`,
        [request.params.id],
      )).rows[0];
      if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND');
      const live = (await sql.query(
        `SELECT id FROM kg_membership.restrictions
          WHERE principal_id=$1 AND revoked_at IS NULL AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())
          FOR UPDATE`,
        [member.principalId],
      )).rows[0];
      if (!live) throw new ApiError(409, 'NOT_RESTRICTED');
      const released = (await sql.query(
        `UPDATE kg_membership.restrictions SET revoked_at=now() WHERE id=$1
         RETURNING id, revoked_at AS "revokedAt"`,
        [live.id],
      )).rows[0];
      await audit(sql, auth.memberId, 'MEMBER_RELEASED', request.params.id, request.body.reason.trim(),
        { restrictionId: live.id });
      return { released: true, restrictionId: released.id, revokedAt: released.revokedAt, memberId: request.params.id };
    });
  });
}
