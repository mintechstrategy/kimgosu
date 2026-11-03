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
 *   * Deletion policy (PLAN-WAVE3 WS-25, decided by the user): a member may
 *     delete only their own message. A deleted message disappears from the
 *     sender's own list, while the other participant keeps the row as a
 *     tombstone: `{ deleted: true, body: null }`. The body text is never
 *     returned to the other participant, and the audit entry records ids only,
 *     never the body. Re-deleting an already deleted message is 409
 *     `MESSAGE_ALREADY_DELETED` (deliberately chosen instead of 404 so a
 *     repeated request is distinguishable from a wrong id).
 *   * `total` counts the rows visible to the caller (own tombstones excluded),
 *     so the number never disagrees with what paging can return.
 *   * Retention / restoration of deleted bodies is OPEN and deliberately not
 *     implemented: `deleted_at` is set, the text stays in the column.
 */

const MAX_BODY_LENGTH = 2000;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// `deleted` is derived, not stored: the column is `deleted_at`. The body of a
// deleted message is replaced by null here so the text cannot leak to the other
// participant through any read path.
const messageColumns = `id, ledger_id AS "ledgerId", sender_id AS "senderId",
    CASE WHEN deleted_at IS NULL THEN body ELSE NULL END AS "body",
    (deleted_at IS NOT NULL) AS "deleted",
    created_at AS "createdAt", read_at AS "readAt", deleted_at AS "deletedAt"`;
const messageSelect = `SELECT ${messageColumns} FROM kg_membership.chat_messages`;

// Visibility for one viewer: live rows plus the *other* side's tombstones. The
// viewer's own deleted messages are excluded from their list (WS-25 policy).
const visibleTo = `(deleted_at IS NULL OR sender_id <> $2)`;

const ledgerParams = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', format: 'uuid' } } };
const messageParams = {
  type: 'object', required: ['id', 'messageId'], additionalProperties: false,
  properties: { id: { type: 'string', format: 'uuid' }, messageId: { type: 'string', format: 'uuid' } },
};

async function audit(sql: Sql, actor: unknown, action: string, targetId: string, detail: Record<string, unknown>) {
  // Ids and classification only. The message body is never written to the audit
  // log, in line with the WS-25 requirement.
  await sql.query(
    `INSERT INTO kg_membership.audit_log(actor_member_id,action,target_type,target_id,detail)
     VALUES($1,$2,'chat_message',$3,$4)`,
    [actor, action, targetId, JSON.stringify(detail)],
  );
}

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
    // The response is sent only after COMMIT: sending inside the transaction
    // would let a client read back before the row is durable (the same race that
    // makes other suites flaky).
    const message = await db.transaction(async sql => {
      await requireParticipant(sql, request.params.id, auth.memberId);
      const inserted = (await sql.query(
        `INSERT INTO kg_membership.chat_messages(id,ledger_id,sender_id,body)
         VALUES($1,$2,$3,$4)
         RETURNING ${messageColumns}`,
        [randomUUID(), request.params.id, auth.memberId, request.body.body],
      )).rows[0];
      await sql.query(`UPDATE kg_membership.ledgers SET updated_at=now() WHERE id=$1`, [request.params.id]);
      return inserted;
    });
    return reply.code(201).send(message);
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
        WHERE ledger_id=$1 AND ${visibleTo}${cursor ? ' AND (created_at, id) < ($3::timestamptz, $4::uuid)' : ''}
        ORDER BY created_at DESC, id DESC
        LIMIT $${cursor ? 5 : 3}`,
      cursor
        ? [request.params.id, auth.memberId, cursor.createdAt, cursor.id, limit + 1]
        : [request.params.id, auth.memberId, limit + 1],
    )).rows;

    // Counted with the same visibility predicate as the page query, so `total`
    // can never disagree with what paging actually returns.
    const total = Number((await db.query(
      `SELECT count(*)::int AS "total" FROM kg_membership.chat_messages
        WHERE ledger_id=$1 AND ${visibleTo}`,
      [request.params.id, auth.memberId],
    )).rows[0]?.total ?? 0);

    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;
    const last = messages[messages.length - 1];
    return { messages, total, nextCursor: hasMore && last ? String(last.id) : null };
  });

  // WS-25: a member may delete only their own message. Non-participants get the
  // same 404 LEDGER_NOT_FOUND as everywhere else in this router, so the ledger's
  // existence is not disclosed. Someone else's message is 403 (the row is known
  // to the caller already through the list).
  app.delete<{ Params: { id: string; messageId: string } }>('/v1/ledgers/:id/messages/:messageId', {
    schema: { params: messageParams },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const deleted = await db.transaction(async sql => {
      await requireParticipant(sql, request.params.id, auth.memberId);
      const message = (await sql.query(
        `SELECT id, sender_id AS "senderId", deleted_at AS "deletedAt"
           FROM kg_membership.chat_messages
          WHERE id=$1 AND ledger_id=$2
          FOR UPDATE`,
        [request.params.messageId, request.params.id],
      )).rows[0];
      if (!message) throw new ApiError(404, 'MESSAGE_NOT_FOUND');
      if (String(message.senderId) !== String(auth.memberId)) throw new ApiError(403, 'MESSAGE_NOT_OWNED');
      // Re-delete is 409 (documented choice): the id resolves, so a retry is
      // distinguished from a wrong id rather than reported as missing.
      if (message.deletedAt !== null) throw new ApiError(409, 'MESSAGE_ALREADY_DELETED');

      const row = (await sql.query(
        `UPDATE kg_membership.chat_messages SET deleted_at=now()
          WHERE id=$1 RETURNING ${messageColumns}`,
        [request.params.messageId],
      )).rows[0];
      // Ids only: the body is intentionally absent from the audit trail.
      await audit(sql, auth.memberId, 'MESSAGE_DELETED', request.params.messageId, {
        ledgerId: request.params.id,
      });
      return row;
    });
    // Sent after COMMIT so an immediate re-read cannot miss the deletion.
    return reply.code(200).send(deleted);
  });
}
