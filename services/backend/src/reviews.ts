import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from './app.ts';
import type { Authenticate } from './auth.ts';
import { ApiError } from './security.ts';
import { audit, fail, requireActiveMember } from './kernel.ts';
import { notify } from './notifications.ts';

const idSchema = { type: 'string', format: 'uuid' };
const params = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } };
const string = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength });

const reviewSelect = `SELECT r.id, r.ledger_id AS "ledgerId", r.author_id AS "authorId", r.target_id AS "targetId",
  r.rating, r.body, r.created_at AS "createdAt", r.hidden_at AS "hiddenAt"`;

/**
 * Public read projection (WS-26): the author's nickname is the only identity
 * information that leaves the server. author/target member ids, e-mail and
 * phone are not selected at all, so they cannot leak through a later edit of
 * the response object.
 */
const publicReviewSelect = `SELECT r.id, r.rating, r.body, r.created_at AS "createdAt",
  m.nickname AS "authorNickname"`;

/** Reviews may be written until `agreements.completed_at + 30 days` (WS-26). */
const REVIEW_WINDOW_DAYS = 30;

/** Parse a string query value already pattern-checked by the route schema. */
function count(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new ApiError(400, 'INVALID_REQUEST');
  return value;
}

export function registerReviewRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  const requireMember = requireActiveMember(authenticate);

  // Write a review for the counterpart of a ledger.
  // Eligibility is decided by the server: the author must be a ledger
  // participant AND a COMPLETED agreement must exist for that same ledger.
  // WS-26 adds the time window: the latest COMPLETED agreement must have
  // completed within REVIEW_WINDOW_DAYS (30). A closed window is a 403
  // REVIEW_WINDOW_CLOSED, distinct from REVIEW_NOT_ELIGIBLE (never completed).
  app.post<{ Params: { id: string }; Body: { rating: number; body?: string } }>('/v1/ledgers/:id/reviews', {
    schema: {
      params,
      body: {
        type: 'object', additionalProperties: false, required: ['rating'],
        properties: { rating: { type: 'integer', minimum: 1, maximum: 5 }, body: string(1, 2000) },
      },
    },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    return db.transaction(async sql => {
      const ledger = (await sql.query(
        `SELECT expert_member_id AS "expertMemberId", customer_member_id AS "customerMemberId", status
           FROM kg_membership.ledgers WHERE id=$1 FOR UPDATE`,
        [request.params.id],
      )).rows[0];
      if (!ledger) throw new ApiError(404, 'LEDGER_NOT_FOUND');

      const pair = [String(ledger.expertMemberId), String(ledger.customerMemberId)];
      const me = String(auth.memberId);
      if (!pair.includes(me)) throw new ApiError(403, 'NOT_A_PARTICIPANT');
      // WS-71: 취소된 거래에는 후기를 쓸 수 없다. 완료 이력이 남아 있어도 마찬가지다.
      if (ledger.status === 'CANCELLED') throw new ApiError(409, 'LEDGER_CANCELLED');
      const targetId = pair.find(id => id !== me)!;

      const completed = (await sql.query(
        `SELECT (completed_at > now() - make_interval(days => $4::int)) AS "withinWindow"
           FROM kg_membership.agreements
          WHERE ledger_id=$1 AND status='COMPLETED'
            AND ((requester_member_id=$2 AND counterpart_member_id=$3)
              OR (requester_member_id=$3 AND counterpart_member_id=$2))
          ORDER BY completed_at DESC
          LIMIT 1`,
        [request.params.id, me, targetId, REVIEW_WINDOW_DAYS],
      )).rows[0];
      if (!completed) throw new ApiError(403, 'REVIEW_NOT_ELIGIBLE');
      // The window is measured on the server's clock against the stored
      // completed_at; a client-supplied date is never consulted.
      if (completed.withinWindow !== true) throw new ApiError(403, 'REVIEW_WINDOW_CLOSED');

      const duplicate = (await sql.query(
        `SELECT 1 FROM kg_membership.reviews WHERE ledger_id=$1 AND author_id=$2`,
        [request.params.id, me],
      )).rows[0];
      if (duplicate) throw new ApiError(409, 'REVIEW_EXISTS');

      const review = (await sql.query(
        `INSERT INTO kg_membership.reviews(id,ledger_id,author_id,target_id,rating,body)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (ledger_id, author_id) DO NOTHING
         RETURNING id, ledger_id AS "ledgerId", author_id AS "authorId", target_id AS "targetId",
                   rating, body, created_at AS "createdAt"`,
        [randomUUID(), request.params.id, me, targetId, request.body.rating, request.body.body ?? null],
      )).rows[0];
      if (!review) throw new ApiError(409, 'REVIEW_EXISTS');

      await audit(sql, me, 'REVIEW_CREATED', 'review', String(review.id), undefined,
        { ledgerId: request.params.id, targetId, rating: request.body.rating });
      await notify(sql, {
        memberId: targetId, kind: 'REVIEW',
        title: '새 후기가 등록되었습니다',
        body: '받은 후기를 확인해보세요.',
        ledgerId: request.params.id,
      });
      return reply.code(201).send(review);
    });
  });

  // Public list of reviews a member has received.
  // WS-26: the projection is nickname-only (publicReviewSelect). Author and
  // target member ids, e-mail and phone are never selected for this route.
  // NOTE: `:id` is the expert's member id. The dedicated expert profile table
  // (migration 008, WS-13) is not part of this branch, so no lookup against it
  // is assumed here. If WS-13 lands, this route may switch to profile ids; that
  // decision is recorded as OPEN in the WS-16 result.
  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>('/v1/experts/:id/reviews', {
    schema: {
      params,
      // Query values arrive as strings (the app runs with ajv coerceTypes:false),
      // so they are pattern-checked here and range-checked below.
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { limit: { type: 'string', pattern: '^[0-9]{1,3}$' }, offset: { type: 'string', pattern: '^[0-9]{1,6}$' } },
      },
    },
  }, async (request, reply) => {
    const target = (await db.query(
      `SELECT id FROM kg_membership.members WHERE id=$1 AND withdrawn_at IS NULL`,
      [request.params.id],
    )).rows[0];
    if (!target) return fail(reply, 404, 'EXPERT_NOT_FOUND');

    const limit = count(request.query.limit, 20, 1, 50);
    const offset = count(request.query.offset, 0, 0, 100000);
    const reviews = await db.query(
      `${publicReviewSelect}
         FROM kg_membership.reviews r JOIN kg_membership.members m ON m.id=r.author_id
        WHERE r.target_id=$1 AND r.hidden_at IS NULL
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $2 OFFSET $3`,
      [request.params.id, limit, offset],
    );
    const summary = (await db.query(
      `SELECT count(*)::int AS "count", avg(rating)::float8 AS "average",
              count(*) FILTER (WHERE rating=1)::int AS "rating1",
              count(*) FILTER (WHERE rating=2)::int AS "rating2",
              count(*) FILTER (WHERE rating=3)::int AS "rating3",
              count(*) FILTER (WHERE rating=4)::int AS "rating4",
              count(*) FILTER (WHERE rating=5)::int AS "rating5"
         FROM kg_membership.reviews WHERE target_id=$1 AND hidden_at IS NULL`,
      [request.params.id],
    )).rows[0]!;
    return {
      reviews: reviews.rows,
      summary: {
        count: Number(summary.count),
        average: summary.average === null ? null : Number(Number(summary.average).toFixed(2)),
        distribution: { '1': Number(summary.rating1), '2': Number(summary.rating2), '3': Number(summary.rating3), '4': Number(summary.rating4), '5': Number(summary.rating5) },
      },
      pagination: { limit, offset, total: Number(summary.count) },
    };
  });

  // Reviews I wrote and reviews I received. The author keeps visibility of
  // their own hidden row (hiddenAt is set); received lists hide moderated rows.
  app.get('/v1/me/reviews', async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const written = await db.query(
      `${reviewSelect}
         FROM kg_membership.reviews r
        WHERE r.author_id=$1 ORDER BY r.created_at DESC, r.id DESC`,
      [auth.memberId],
    );
    const received = await db.query(
      `${reviewSelect}
         FROM kg_membership.reviews r
        WHERE r.target_id=$1 AND r.hidden_at IS NULL ORDER BY r.created_at DESC, r.id DESC`,
      [auth.memberId],
    );
    const summary = (await db.query(
      `SELECT count(*)::int AS "count", avg(rating)::float8 AS "average"
         FROM kg_membership.reviews WHERE target_id=$1 AND hidden_at IS NULL`,
      [auth.memberId],
    )).rows[0]!;
    return {
      written: written.rows,
      received: received.rows,
      receivedSummary: {
        count: Number(summary.count),
        average: summary.average === null ? null : Number(Number(summary.average).toFixed(2)),
      },
    };
  });
}
