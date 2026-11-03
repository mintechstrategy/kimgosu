import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql, Row } from './app.ts';
import type { Authenticate } from './auth.ts';
import { ApiError } from './security.ts';
import { audit, requireActiveMember } from './kernel.ts';

/**
 * Quote flow: expert proposes -> customer accepts/rejects -> both sides confirm
 * completion. The server decides every state transition; a client-supplied
 * status/amount/confirmation flag is rejected by the request schema instead of
 * being trusted or silently dropped.
 */

const string = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength });
const idSchema = { type: 'string', format: 'uuid' };
const quoteColumns = `q.id, q.ledger_id AS "ledgerId", q.expert_member_id AS "expertMemberId",
  q.customer_member_id AS "customerMemberId", q.amount, q.price_type AS "priceType",
  q.vat_included AS "vatIncluded", q.hourly_rate AS "hourlyRate", q.schedule_at AS "scheduleAt",
  q.message, q.status, q.version::int AS version, q.expires_at AS "expiresAt",
  q.agreement_id AS "agreementId", q.created_at AS "createdAt",
  q.accepted_at AS "acceptedAt", q.rejected_at AS "rejectedAt",
  q.customer_confirmed_at AS "customerConfirmedAt", q.expert_confirmed_at AS "expertConfirmedAt",
  q.completed_at AS "completedAt"`;

/**
 * User-confirmed quote terms (wave 3):
 *   - VAT is quoted separately by default; `vatIncluded` records the exception.
 *   - Prices are either hourly or a total; the two must stay distinguishable.
 *   - A quote is valid 7 days by default and never longer than 30 days.
 *
 * Amounts are computed on the server from the stored `amount` only. A client
 * that sends its own derived total/VAT numbers is rejected by the request
 * schema, not trusted.
 */
export const VAT_RATE = 0.1;
export const QUOTE_DEFAULT_TTL_DAYS = 7;
export const QUOTE_MAX_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;

type Amounts = { supplyAmount: number; vatAmount: number; totalAmount: number };

/** `amount` is authoritative. vatIncluded=false -> amount is the VAT-exclusive
 *  supply price ("부가세 별도"); true -> amount is the final payable total. */
export function quoteAmounts(amount: number, vatIncluded: boolean): Amounts {
  if (vatIncluded) {
    const supplyAmount = Math.round(amount / (1 + VAT_RATE));
    return { supplyAmount, vatAmount: amount - supplyAmount, totalAmount: amount };
  }
  const vatAmount = Math.round(amount * VAT_RATE);
  return { supplyAmount: amount, vatAmount, totalAmount: amount + vatAmount };
}

function present(row: Row): Row {
  const amount = Number(row.amount);
  const vatIncluded = row.vatIncluded === true;
  return {
    ...row,
    amount,
    priceType: String(row.priceType),
    vatIncluded,
    hourlyRate: row.hourlyRate === null || row.hourlyRate === undefined ? null : Number(row.hourlyRate),
    currency: 'KRW',
    vatRate: VAT_RATE,
    ...quoteAmounts(amount, vatIncluded),
  };
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
  await audit(sql, actor, 'QUOTE_EXPIRED', 'quote', String(quote.id));
  return true;
}

const expired = { expired: true } as const;
const isExpired = (value: unknown): boolean => Boolean(value && typeof value === 'object' && 'expired' in value);

export function registerQuoteRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  const requireMember = requireActiveMember(authenticate);

  // Propose a quote. Only the ledger's expert may price their own customer.
  app.post<{
    Params: { id: string };
    Body: {
      amount: number; message: string; expiresAt?: string; scheduleAt?: string;
      priceType?: 'HOURLY' | 'TOTAL'; vatIncluded?: boolean; hourlyRate?: number;
    };
  }>(
    '/v1/ledgers/:id/quotes', {
      schema: {
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
        body: {
          type: 'object', additionalProperties: false, required: ['amount', 'message'],
          properties: {
            amount: { type: 'integer', minimum: 1, maximum: 2147483647 },
            message: string(1, 2000),
            // Optional: the server applies the 7-day default when omitted.
            expiresAt: { type: 'string', format: 'date-time' },
            scheduleAt: { type: 'string', format: 'date-time' },
            priceType: { type: 'string', enum: ['HOURLY', 'TOTAL'] },
            vatIncluded: { type: 'boolean' },
            hourlyRate: { type: 'integer', minimum: 1, maximum: 2147483647 },
          },
        },
      },
    }, async (request, reply) => {
      const auth = await requireMember(request, reply); if (!auth) return;
      const priceType = request.body.priceType ?? 'TOTAL';
      const vatIncluded = request.body.vatIncluded ?? false;
      // Hourly and total pricing must not be conflated: an hourly quote without
      // a rate is unreadable, and a total quote must not carry a stray rate.
      if (priceType === 'HOURLY' && request.body.hourlyRate === undefined) throw new ApiError(400, 'HOURLY_RATE_REQUIRED');
      if (priceType === 'TOTAL' && request.body.hourlyRate !== undefined) throw new ApiError(400, 'HOURLY_RATE_NOT_ALLOWED');

      const now = Date.now();
      const expiresAt = request.body.expiresAt === undefined
        ? new Date(now + QUOTE_DEFAULT_TTL_DAYS * DAY_MS)
        : new Date(request.body.expiresAt);
      // User-confirmed TTL: 7 days by default, 30 days maximum, and never in
      // the past (a 1-minute floor also keeps expires_at > created_at from
      // failing on a clock race instead of returning a clean 400).
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now + MIN_TTL_MS) throw new ApiError(400, 'INVALID_EXPIRY');
      if (expiresAt.getTime() > now + QUOTE_MAX_TTL_DAYS * DAY_MS) throw new ApiError(400, 'EXPIRY_EXCEEDS_MAX_TTL');

      const quote = await db.transaction(async sql => {
        const ledger = await participantLedger(sql, request.params.id, auth.memberId);
        if (ledger.expertMemberId !== String(auth.memberId)) throw new ApiError(403, 'EXPERT_ONLY');
        const id = randomUUID();
        const created = (await sql.query(
          `INSERT INTO kg_membership.quotes(id,ledger_id,expert_member_id,customer_member_id,amount,
             price_type,vat_included,hourly_rate,schedule_at,message,expires_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${quoteColumns.replace(/q\./g, '')}`,
          [id, request.params.id, auth.memberId, ledger.customerMemberId, request.body.amount,
            priceType, vatIncluded, request.body.hourlyRate ?? null,
            request.body.scheduleAt ?? null, request.body.message, expiresAt.toISOString()],
        )).rows[0];
        await transition(sql, id, null, 'PROPOSED', auth.memberId);
        await audit(sql, auth.memberId, 'QUOTE_PROPOSED', 'quote', id, null, {
          ledgerId: request.params.id, amount: request.body.amount, priceType, vatIncluded,
        });
        return present(created);
      });
      return reply.code(201).send(quote);
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
    return { quotes: rows.rows.map(present) };
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
          await audit(sql, auth.memberId, 'QUOTE_REJECTED', 'quote', String(quote.id));
          return present(rejected);
        }

        // accept: materialise the wave-1 agreement so review eligibility keeps one basis.
        const agreementId = randomUUID();
        const agreed = quoteAmounts(Number(quote.amount), quote.vatIncluded === true);
        const summary = `견적 수락: ${agreed.totalAmount.toLocaleString('en-US')}원 (${quote.vatIncluded === true ? '부가세 포함' : '부가세 별도'})`;
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
        await audit(sql, auth.memberId, 'QUOTE_ACCEPTED', 'quote', String(quote.id), null, { agreementId: String(agreement.id) });
        return present(accepted);
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
      await audit(sql, auth.memberId, 'QUOTE_COMPLETION_CONFIRMED', 'quote', String(quote.id), null, { side: mine });

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
        await audit(sql, auth.memberId, 'QUOTE_COMPLETED', 'quote', String(quote.id), null, { agreementId: String(quote.agreementId) });
      }

      return present((await sql.query(
        `SELECT ${quoteColumns} FROM kg_membership.quotes q WHERE q.id=$1`,
        [request.params.id],
      )).rows[0]);
    });
    if (isExpired(outcome)) throw new ApiError(409, 'QUOTE_EXPIRED');
    return outcome;
  });
}
