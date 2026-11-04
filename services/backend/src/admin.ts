import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from './app.ts';
import { requireAdminScope } from './admin-session.ts';
import { ApiError } from './security.ts';
import { audit, fail } from './kernel.ts';

/**
 * Operator (admin) routes: member/ledger lookup and account restriction.
 *
 * Authority is decided here on the server, never from a client-sent flag, and
 * requires an operator-scope session (`adm_…`) whose owner holds a live ADMIN
 * `role_grants` row — both re-read on every request. A member session token gets
 * 403 ADMIN_SESSION_REQUIRED (scope), an admin session without a live grant gets
 * 403 ADMIN_REQUIRED (role); neither reads member data first.
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

// Reporting days follow the operator's day (KST, fixed +09:00), not UTC: a trade
// at 08:00 KST belongs to that date, not to the UTC date 23:00 the previous day.
const KST_OFFSET = '+09:00';
const dayStart = (day: string) => new Date(`${day}T00:00:00${KST_OFFSET}`).toISOString();
/** The schema pattern only checks the shape: 2026-02-31 is shaped right but is not a date. */
const isRealDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
};
const shiftDay = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Default window is the last 7 days; the trend always shows at most 7 days of it. */
function statsRange(from: string | undefined, to: string | undefined) {
  const toDay = to ?? todayKst();
  const fromDay = from ?? shiftDay(toDay, -6);
  if (!isRealDay(fromDay) || !isRealDay(toDay) || fromDay > toDay) return null;
  const lastSeven = shiftDay(toDay, -6);
  // `end` is the first instant of the day after `to`, so the whole `to` day is inside the period.
  return { from: fromDay, to: toDay, start: dayStart(fromDay), end: dayStart(shiftDay(toDay, 1)), trendFrom: lastSeven > fromDay ? lastSeven : fromDay };
}

export function registerAdminRoutes(app: FastifyInstance, db: Sql) {
  // Operator scope + live ADMIN grant; both re-read per request.
  const requireAdmin = (request: FastifyRequest, reply: FastifyReply) => requireAdminScope(db, request, reply);

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
    if (!member) return fail(reply, 404, 'MEMBER_NOT_FOUND');
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
      await audit(sql, auth.memberId, 'MEMBER_RESTRICTED', 'member', request.params.id, request.body.reason.trim(),
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
      await audit(sql, auth.memberId, 'MEMBER_RELEASED', 'member', request.params.id, request.body.reason.trim(),
        { restrictionId: live.id });
      return { released: true, restrictionId: released.id, revokedAt: released.revokedAt, memberId: request.params.id };
    });
  });

  /**
   * Operator dashboard (WS-72).
   *
   * One trade is one agreement: the completion rate therefore shares its
   * denominator with the trade count (agreements requested in the period, of
   * which COMPLETED). Every figure is aggregated here — the console renders the
   * numbers it is given and never recounts them.
   *
   * Reports come from kg_membership.reports (WS-61, migration 021).
   */
  app.get<{ Querystring: { from?: string; to?: string } }>('/v1/admin/stats', {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          from: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
          to: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
        },
      },
    },
  }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const range = statsRange(request.query.from, request.query.to);
    if (!range) return fail(reply, 400, 'INVALID_REQUEST');
    // `range.end` is the first instant of the day after `to`, so the whole `to`
    // day is inside the period.
    const bounds = [range.start, range.end];
    const totalsRow = (await db.query(
      `SELECT
         (SELECT count(*)::int FROM kg_membership.agreements WHERE requested_at >= $1 AND requested_at < $2) AS trades,
         (SELECT count(*)::int FROM kg_membership.agreements WHERE status='COMPLETED' AND requested_at >= $1 AND requested_at < $2) AS completed,
         (SELECT count(*)::int FROM kg_membership.reports WHERE created_at >= $1 AND created_at < $2) AS reports,
         (SELECT count(*)::int FROM kg_membership.members WHERE created_at >= $1 AND created_at < $2) AS "newMembers"`,
      bounds,
    )).rows[0]!;
    const daily = (await db.query(
      `WITH day AS (
         SELECT generate_series($1::date, $2::date, interval '1 day')::date AS d
       ), bounds AS (
         SELECT d, (d::timestamp AT TIME ZONE 'Asia/Seoul') AS starts, ((d + 1)::timestamp AT TIME ZONE 'Asia/Seoul') AS ends FROM day
       )
       SELECT to_char(b.d, 'YYYY-MM-DD') AS date,
         (SELECT count(*)::int FROM kg_membership.agreements a WHERE a.requested_at >= b.starts AND a.requested_at < b.ends) AS trades,
         (SELECT count(*)::int FROM kg_membership.agreements a WHERE a.status='COMPLETED' AND a.requested_at >= b.starts AND a.requested_at < b.ends) AS completed,
         (SELECT count(*)::int FROM kg_membership.reports r WHERE r.created_at >= b.starts AND r.created_at < b.ends) AS reports,
         (SELECT count(*)::int FROM kg_membership.members m WHERE m.created_at >= b.starts AND m.created_at < b.ends) AS "newMembers"
       FROM bounds b ORDER BY b.d`,
      [range.trendFrom, range.to],
    )).rows;
    const trades = Number(totalsRow.trades);
    const completed = Number(totalsRow.completed);
    return {
      from: range.from,
      to: range.to,
      totals: {
        trades,
        completed,
        // Percentage with one decimal, so the console prints the server's number
        // instead of dividing two figures itself.
        completionRate: trades > 0 ? Math.round((completed / trades) * 1000) / 10 : 0,
        reports: Number(totalsRow.reports),
        newMembers: Number(totalsRow.newMembers),
      },
      daily: daily.map(row => ({
        date: row.date, trades: Number(row.trades), completed: Number(row.completed),
        reports: Number(row.reports), newMembers: Number(row.newMembers),
      })),
    };
  });

  /**
   * Review moderation list (WS-56). Without it an operator cannot find the
   * review id the hide/unhide routes take; the public list filters hidden rows
   * out, so moderation needs its own read path. Nickname is the only author
   * identity exposed, matching the public projection.
   */
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/v1/admin/reviews', {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
          offset: { type: 'string', pattern: '^[0-9]{1,6}$' },
        },
      },
    },
  }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    const limit = cursor(request.query.limit, 50, 1, 100);
    const offset = cursor(request.query.offset, 0, 0, 100000);
    const total = Number((await db.query('SELECT count(*)::int AS count FROM kg_membership.reviews')).rows[0]?.count ?? 0);
    const rows = await db.query(
      `SELECT r.id, m.nickname AS "authorNickname", r.rating, r.body, r.created_at AS "createdAt",
              r.hidden_at AS "hiddenAt", r.hidden_reason AS "hiddenReason"
         FROM kg_membership.reviews r
         JOIN kg_membership.members m ON m.id = r.author_id
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return { reviews: rows.rows, total, limit, offset };
  });

  /**
   * Review moderation (WS-26, migration 014).
   *
   * Hiding is operator-only and never deletes: `hidden_at`/`hidden_reason` are
   * set, the row stays, and the public list already filters on `hidden_at IS
   * NULL`. Both actions require an explicit reason because audit_log keeps why
   * the row was taken off the public list — and for unhide, why it was put back.
   */
  app.post<{ Params: { id: string }; Body: { reason: string } }>('/v1/admin/reviews/:id/hide', {
    schema: {
      params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
      ...body({ reason: { type: 'string', minLength: 2, maxLength: 500 } }, ['reason']),
    },
  }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    return db.transaction(async sql => {
      const review = (await sql.query(
        `SELECT id, hidden_at AS "hiddenAt" FROM kg_membership.reviews WHERE id=$1 FOR UPDATE`,
        [request.params.id],
      )).rows[0];
      if (!review) throw new ApiError(404, 'REVIEW_NOT_FOUND');
      if (review.hiddenAt) throw new ApiError(409, 'REVIEW_ALREADY_HIDDEN');
      const reason = request.body.reason.trim();
      if (reason.length < 2) throw new ApiError(400, 'INVALID_REQUEST');
      const hidden = (await sql.query(
        `UPDATE kg_membership.reviews SET hidden_at=now(), hidden_reason=$2 WHERE id=$1
         RETURNING id, hidden_at AS "hiddenAt", hidden_reason AS "hiddenReason"`,
        [request.params.id, reason],
      )).rows[0];
      await audit(sql, auth.memberId, 'REVIEW_HIDDEN', 'review', String(hidden!.id), reason, { hidden: true });
      return { ...hidden, hidden: true };
    });
  });

  app.post<{ Params: { id: string }; Body: { reason: string } }>('/v1/admin/reviews/:id/unhide', {
    schema: {
      params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
      ...body({ reason: { type: 'string', minLength: 2, maxLength: 500 } }, ['reason']),
    },
  }, async (request, reply) => {
    const auth = await requireAdmin(request, reply); if (!auth) return;
    return db.transaction(async sql => {
      const review = (await sql.query(
        `SELECT id, hidden_at AS "hiddenAt", hidden_reason AS "hiddenReason"
           FROM kg_membership.reviews WHERE id=$1 FOR UPDATE`,
        [request.params.id],
      )).rows[0];
      if (!review) throw new ApiError(404, 'REVIEW_NOT_FOUND');
      if (!review.hiddenAt) throw new ApiError(409, 'REVIEW_NOT_HIDDEN');
      const reason = request.body.reason.trim();
      if (reason.length < 2) throw new ApiError(400, 'INVALID_REQUEST');
      const visible = (await sql.query(
        `UPDATE kg_membership.reviews SET hidden_at=NULL, hidden_reason=NULL WHERE id=$1
         RETURNING id, hidden_at AS "hiddenAt", hidden_reason AS "hiddenReason"`,
        [request.params.id],
      )).rows[0];
      await audit(sql, auth.memberId, 'REVIEW_UNHIDDEN', 'review', String(review.id), reason,
        { hidden: false, previousHiddenReason: review.hiddenReason ?? null });
      return { ...visible, hidden: false };
    });
  });
}
