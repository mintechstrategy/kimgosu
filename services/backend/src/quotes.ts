import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql, Row } from './app.ts';
import type { Authenticate } from './auth.ts';
import { ApiError } from './security.ts';

/**
 * Quote flow: expert proposes -> customer accepts/rejects -> both sides confirm
 * completion. The server decides every state transition; a client-supplied
 * status/amount/confirmation flag is rejected by the request schema instead of
 * being trusted or silently dropped.
 */

const string = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength });
const idSchema = { type: 'string', format: 'uuid' };
const quoteColumns = `q.id, q.ledger_id AS "ledgerId", q.expert_member_id AS "expertMemberId",
  q.customer_member_id AS "customerMemberId", q.amount, q.schedule_at AS "scheduleAt",
  q.message, q.status, q.version::int AS version, q.expires_at AS "expiresAt",
  q.agreement_id AS "agreementId", q.created_at AS "createdAt",
  q.accepted_at AS "acceptedAt", q.rejected_at AS "rejectedAt",
  q.customer_confirmed_at AS "customerConfirmedAt", q.expert_confirmed_at AS "expertConfirmedAt",
  q.completed_at AS "completedAt"`;

async function audit(sql: Sql, actor: unknown, action: string, targetId: string, detail?: Row) {
  await sql.query(
    `INSERT INTO kg_membership.audit_log(actor_member_id,action,target_type,target_id,detail)
     VALUES($1,$2,'quote',$3,$4)`,
    [actor, action, targetId, JSON.stringify(detail ?? {})],
  );
}

async function transition(sql: Sql, quoteId: string, from: string | null, to: string, actor: unknown, note?: string) {
  await sql.query(
    `INSERT INTO kg_membership.quote_transitions(quote_id,from_status,to_status,actor_member_id,note)
     VALUES($1,$2,$3,$4,$5)`,
    [quoteId, from, to, actor, note ?? null],
  );
}

/** Participants only. A non-participant must not learn the ledger exists -> 404. */
async function participantLedger(sql: Sql, ledgerId: string, memberId: unknown) {
  const ledger = (await sql.query(
    `SELECT id, expert_member_id AS "expertMemberId", customer_member_id AS "customerMemberId"
       FROM kg_membership.ledgers WHERE id=$1`,
    [ledgerId],
  )).rows[0];
  if (!ledger) throw new ApiError(404, 'LEDGER_NOT_FOUND');
  const { expertMemberId, customerMemberId } = ledger;
  const member = String(memberId);
  if (String(expertMemberId) !== member && String(customerMemberId) !== member) throw new ApiError(404, 'LEDGER_NOT_FOUND');
  return { expertMemberId: String(expertMemberId), customerMemberId: String(customerMemberId) };
}

/**
 * Mark a PROPOSED quote EXPIRED when its deadline has passed.
 *
 * Called inside the response/complete transactions. It must NOT throw: the
 * expiry is a real state change that has to commit even though the caller's
 * request fails, so the caller returns an `expired` marker, commits, and only
 * then answers 409. Reads never write.
 */
async function expireIfDue(sql: Sql, quote: Row, actor: unknown): Promise<boolean> {
  if (quote.status !== 'PROPOSED') return false;
  if (new Date(String(quote.expiresAt)).getTime() > Date.now()) return false;
  await sql.query(
    `UPDATE kg_membership.quotes SET status='EXPIRED', version=version+1, updated_at=now()
      WHERE id=$1 AND status='PROPOSED'`,
    [quote.id],
  );
  await transition(sql, String(quote.id), 'PROPOSED', 'EXPIRED', actor, 'expires_at passed');
  await audit(sql, actor, 'QUOTE_EXPIRED', String(quote.id), {});
  return true;
}

const expired = { expired: true } as const;
const isExpired = (value: unknown): boolean => Boolean(value && typeof value === 'object' && 'expired' in value);

export function registerQuoteRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  const requireMember = async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return null;
    if (auth.status !== 'ACTIVE') { reply.code(403).send({ error: { code: 'ACCOUNT_RESTRICTED' } }); return null; }
    return auth;
  };

  // Propose a quote. Only the ledger's expert may price their own customer.
  app.post<{ Params: { id: string }; Body: { amount: number; message: string; expiresAt: string; scheduleAt?: string } }>(
    '/v1/ledgers/:id/quotes', {
      schema: {
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
        body: {
          type: 'object', additionalProperties: false, required: ['amount', 'message', 'expiresAt'],
          properties: {
            amount: { type: 'integer', minimum: 1, maximum: 2147483647 },
            message: string(1, 2000),
            expiresAt: { type: 'string', format: 'date-time' },
            scheduleAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    }, async (request, reply) => {
      const auth = await requireMember(request, reply); if (!auth) return;
      return db.transaction(async sql => {
        const ledger = await participantLedger(sql, request.params.id, auth.memberId);
        if (ledger.expertMemberId !== String(auth.memberId)) throw new ApiError(403, 'EXPERT_ONLY');
        const expiresAt = new Date(request.body.expiresAt);
        // Quote TTL beyond "must be in the future" is not a confirmed policy, so
        // only a 1-minute floor is enforced (also keeps expires_at > created_at
        // from failing on a clock-race instead of returning a clean 400).
        if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() + 60_000) throw new ApiError(400, 'INVALID_EXPIRY');
        const id = randomUUID();
        const created = (await sql.query(
          `INSERT INTO kg_membership.quotes(id,ledger_id,expert_member_id,customer_member_id,amount,
             schedule_at,message,expires_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${quoteColumns.replace(/q\./g, '')}`,
          [id, request.params.id, auth.memberId, ledger.customerMemberId, request.body.amount,
            request.body.scheduleAt ?? null, request.body.message, expiresAt.toISOString()],
        )).rows[0];
        await transition(sql, id, null, 'PROPOSED', auth.memberId);
        await audit(sql, auth.memberId, 'QUOTE_PROPOSED', id, { ledgerId: request.params.id, amount: request.body.amount });
        return reply.code(201).send(created);
      });
    });

  // List a ledger's quotes. Participants only, newest first, bounded page.
  app.get<{ Params: { id: string }; Querystring: { limit?: number } }>('/v1/ledgers/:id/quotes', {
    schema: {
      params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
      querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    await participantLedger(db, request.params.id, auth.memberId);
    const rows = await db.query(
      `SELECT ${quoteColumns},
              CASE WHEN q.status='PROPOSED' AND q.expires_at<=now() THEN 'EXPIRED' ELSE q.status END AS "effectiveStatus"
         FROM kg_membership.quotes q
        WHERE q.ledger_id=$1
        ORDER BY q.created_at DESC, q.id DESC
        LIMIT $2`,
      [request.params.id, request.query.limit ?? 50],
    );
    return { quotes: rows.rows };
  });

  // Customer accepts or rejects. The state machine, not the client, decides.
  app.post<{ Params: { id: string }; Body: { action: 'accept' | 'reject'; expectedVersion: number } }>(
    '/v1/quotes/:id/respond', {
      schema: {
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
        body: {
          type: 'object', additionalProperties: false, required: ['action', 'expectedVersion'],
          properties: {
            action: { type: 'string', enum: ['accept', 'reject'] },
            expectedVersion: { type: 'integer', minimum: 1 },
          },
        },
      },
    }, async (request, reply) => {
      const auth = await requireMember(request, reply); if (!auth) return;
      const outcome = await db.transaction(async sql => {
        const quote = (await sql.query(
          `SELECT ${quoteColumns} FROM kg_membership.quotes q WHERE q.id=$1 FOR UPDATE`,
          [request.params.id],
        )).rows[0];
        if (!quote) throw new ApiError(404, 'QUOTE_NOT_FOUND');
        const participants = await participantLedger(sql, String(quote.ledgerId), auth.memberId);
        if (participants.customerMemberId !== String(auth.memberId)) throw new ApiError(403, 'CUSTOMER_ONLY');
        if (await expireIfDue(sql, quote, auth.memberId)) return expired;
        if (Number(quote.version) !== request.body.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT');
        if (quote.status !== 'PROPOSED') throw new ApiError(409, 'INVALID_TRANSITION');

        if (request.body.action === 'reject') {
          const rejected = (await sql.query(
            `UPDATE kg_membership.quotes SET status='REJECTED', version=version+1, rejected_at=now(), updated_at=now()
              WHERE id=$1 AND status='PROPOSED' AND version=$2 RETURNING ${quoteColumns.replace(/q\./g, '')}`,
            [request.params.id, request.body.expectedVersion],
          )).rows[0];
          if (!rejected) throw new ApiError(409, 'VERSION_CONFLICT');
          await transition(sql, String(quote.id), 'PROPOSED', 'REJECTED', auth.memberId);
          await audit(sql, auth.memberId, 'QUOTE_REJECTED', String(quote.id), {});
          return rejected;
        }

        // accept: materialise the wave-1 agreement so review eligibility keeps one basis.
        const agreementId = randomUUID();
        const summary = `견적 수락: ${Number(quote.amount).toLocaleString('en-US')}원`;
        const agreement = (await sql.query(
          `INSERT INTO kg_membership.agreements(id,ledger_id,requester_member_id,counterpart_member_id,summary,status,accepted_at)
           VALUES($1,$2,$3,$4,$5,'ACCEPTED',now()) RETURNING id`,
          [agreementId, quote.ledgerId, quote.expertMemberId, quote.customerMemberId, summary],
        )).rows[0];
        const accepted = (await sql.query(
          `UPDATE kg_membership.quotes SET status='ACCEPTED', version=version+1, accepted_at=now(),
             agreement_id=$2, updated_at=now()
            WHERE id=$1 AND status='PROPOSED' AND version=$3 RETURNING ${quoteColumns.replace(/q\./g, '')}`,
          [request.params.id, agreement.id, request.body.expectedVersion],
        )).rows[0];
        if (!accepted) throw new ApiError(409, 'VERSION_CONFLICT');
        await transition(sql, String(quote.id), 'PROPOSED', 'ACCEPTED', auth.memberId);
        await audit(sql, auth.memberId, 'QUOTE_ACCEPTED', String(quote.id), { agreementId: String(agreement.id) });
        return accepted;
      });
      if (isExpired(outcome)) throw new ApiError(409, 'QUOTE_EXPIRED');
      return outcome;
    });

  // Completion confirmation. One side confirms; the quote stays ACCEPTED until
  // BOTH sides have confirmed (user-confirmed "양측확인"), then COMPLETED.
  app.post<{ Params: { id: string }; Body: { expectedVersion: number } }>('/v1/quotes/:id/complete', {
    schema: {
      params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
      body: { type: 'object', additionalProperties: false, required: ['expectedVersion'], properties: { expectedVersion: { type: 'integer', minimum: 1 } } },
    },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const outcome = await db.transaction(async sql => {
      const quote = (await sql.query(
        `SELECT ${quoteColumns} FROM kg_membership.quotes q WHERE q.id=$1 FOR UPDATE`,
        [request.params.id],
      )).rows[0];
      if (!quote) throw new ApiError(404, 'QUOTE_NOT_FOUND');
      const participants = await participantLedger(sql, String(quote.ledgerId), auth.memberId);
      if (await expireIfDue(sql, quote, auth.memberId)) return expired;
      if (Number(quote.version) !== request.body.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT');
      if (quote.status !== 'ACCEPTED') throw new ApiError(409, 'INVALID_TRANSITION');

      const member = String(auth.memberId);
      const mine = member === participants.customerMemberId ? 'customer_confirmed_at' : 'expert_confirmed_at';
      if (quote[mine === 'customer_confirmed_at' ? 'customerConfirmedAt' : 'expertConfirmedAt']) {
        throw new ApiError(409, 'ALREADY_CONFIRMED');
      }
      await sql.query(
        `UPDATE kg_membership.quotes SET ${mine}=now(), version=version+1, updated_at=now() WHERE id=$1`,
        [request.params.id],
      );
      await audit(sql, auth.memberId, 'QUOTE_COMPLETION_CONFIRMED', String(quote.id), { side: mine });

      const both = (await sql.query(
        `SELECT customer_confirmed_at IS NOT NULL AND expert_confirmed_at IS NOT NULL AS both
           FROM kg_membership.quotes WHERE id=$1`,
        [request.params.id],
      )).rows[0]?.both === true;

      if (both) {
        await sql.query(
          `UPDATE kg_membership.quotes SET status='COMPLETED', version=version+1, completed_at=now(), updated_at=now()
            WHERE id=$1 AND status='ACCEPTED'`,
          [request.params.id],
        );
        await sql.query(
          `UPDATE kg_membership.agreements SET status='COMPLETED', version=version+1, completed_at=now()
            WHERE id=$1 AND status='ACCEPTED'`,
          [quote.agreementId],
        );
        await transition(sql, String(quote.id), 'ACCEPTED', 'COMPLETED', auth.memberId, 'both parties confirmed');
        await audit(sql, auth.memberId, 'QUOTE_COMPLETED', String(quote.id), { agreementId: String(quote.agreementId) });
      }

      return (await sql.query(
        `SELECT ${quoteColumns} FROM kg_membership.quotes q WHERE q.id=$1`,
        [request.params.id],
      )).rows[0];
    });
    if (isExpired(outcome)) throw new ApiError(409, 'QUOTE_EXPIRED');
    return outcome;
  });
}
