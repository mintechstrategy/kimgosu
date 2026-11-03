import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from './app.ts';
import type { Authenticate } from './auth.ts';
import { ApiError } from './security.ts';

/**
 * Ledger chat: participants of a ledger exchange messages stored on the server.
 *
 * Contract decisions taken here (see migrations/010_chat_messages.sql):
 *   * Participation is decided by the ledger row, never by a client flag. A
 *     non-participant gets 404 LEDGER_NOT_FOUND so the ledger's existence is not
 *     revealed.
 *   * Ordering is (created_at DESC, id DESC). `id` is the tiebreak, so two rows
 *     written in the same millisecond still have a total order.
 *   * `before` is the id of the last message already seen on the previous page.
 *     The server resolves that id inside the same ledger and returns strictly
 *     older rows using a tuple comparison; this makes paging free of duplicates
 *     and gaps.
 *   * Deletion policy is undecided (F5 conflict) => the column exists and is
 *     returned as `deletedAt`, but nothing in this router writes or filters on
 *     it. Making `deleted_at` hide content would be an unapproved policy.
 */

const MAX_BODY_LENGTH = 2000;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const messageSelect = `SELECT id, ledger_id AS "ledgerId", sender_id AS "senderId", body,
    created_at AS "createdAt", read_at AS "readAt", deleted_at AS "deletedAt"
  FROM kg_membership.chat_messages`;

const ledgerParams = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', format: 'uuid' } } };

export function registerChatRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  const requireMember = async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return null;
    if (auth.status !== 'ACTIVE') { reply.code(403).send({ error: { code: 'ACCOUNT_RESTRICTED' } }); return null; }
    return auth;
  };

  const requireParticipant = async (sql: Sql, ledgerId: string, memberId: unknown) => {
    const ledger = (await sql.query(
      `SELECT id FROM kg_membership.ledgers
        WHERE id=$1 AND (expert_member_id=$2 OR customer_member_id=$2)`,
      [ledgerId, memberId],
    )).rows[0];
    if (!ledger) throw new ApiError(404, 'LEDGER_NOT_FOUND');
    return ledger;
  };

  app.post<{ Params: { id: string }; Body: { body: string } }>('/v1/ledgers/:id/messages', {
    schema: {
      params: ledgerParams,
      body: {
        type: 'object', additionalProperties: false, required: ['body'],
        properties: { body: { type: 'string', minLength: 1, maxLength: MAX_BODY_LENGTH } },
      },
    },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    // A body of only whitespace passes minLength but violates the table's
    // trim() CHECK, so it is refused here as a client error instead of a 500.
    if (!request.body.body.trim()) throw new ApiError(400, 'MESSAGE_BODY_INVALID');
    return db.transaction(async sql => {
      await requireParticipant(sql, request.params.id, auth.memberId);
      const message = (await sql.query(
        `INSERT INTO kg_membership.chat_messages(id,ledger_id,sender_id,body)
         VALUES($1,$2,$3,$4)
         RETURNING id, ledger_id AS "ledgerId", sender_id AS "senderId", body,
                   created_at AS "createdAt", read_at AS "readAt", deleted_at AS "deletedAt"`,
        [randomUUID(), request.params.id, auth.memberId, request.body.body],
      )).rows[0];
      await sql.query(`UPDATE kg_membership.ledgers SET updated_at=now() WHERE id=$1`, [request.params.id]);
      return reply.code(201).send(message);
    });
  });

  app.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>('/v1/ledgers/:id/messages', {
    schema: {
      params: ledgerParams,
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          // Querystring values arrive as strings (coerceTypes is off), so the
          // numeric upper bound is checked in the handler rather than here.
          before: { type: 'string', format: 'uuid' },
          limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
        },
      },
    },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const limit = request.query.limit === undefined ? DEFAULT_LIMIT : Number(request.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new ApiError(400, 'INVALID_LIMIT');

    await requireParticipant(db, request.params.id, auth.memberId);

    let cursor: { createdAt: unknown; id: string } | undefined;
    if (request.query.before !== undefined) {
      const row = (await db.query(
        `SELECT created_at AS "createdAt", id FROM kg_membership.chat_messages WHERE id=$1 AND ledger_id=$2`,
        [request.query.before, request.params.id],
      )).rows[0];
      // A cursor from another ledger (or a deleted/unknown id) would silently
      // reposition the page, so it is refused rather than ignored.
      if (!row) throw new ApiError(400, 'INVALID_CURSOR');
      cursor = { createdAt: row.createdAt, id: String(row.id) };
    }

    const rows = (await db.query(
      `${messageSelect}
        WHERE ledger_id=$1${cursor ? ' AND (created_at, id) < ($2::timestamptz, $3::uuid)' : ''}
        ORDER BY created_at DESC, id DESC
        LIMIT $${cursor ? 4 : 2}`,
      cursor
        ? [request.params.id, cursor.createdAt, cursor.id, limit + 1]
        : [request.params.id, limit + 1],
    )).rows;

    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;
    const last = messages[messages.length - 1];
    return { messages, nextCursor: hasMore && last ? String(last.id) : null };
  });
}
