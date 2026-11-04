import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from './app.ts';
import type { Authenticate } from './auth.ts';
import { ApiError } from './security.ts';
import { audit, fail, requireActiveMember } from './kernel.ts';

const body = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ body: { type: 'object', additionalProperties: false, properties, required } });
const string = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength });
const idSchema = { type: 'string', format: 'uuid' };

/** 거래 취소 사유. 서버가 허용 목록을 소유하고 앱은 이 코드만 고른다. */
const CANCEL_REASON_CODES = ['SCHEDULE', 'PRICE', 'SCOPE_CHANGED', 'OTHER'] as const;

/**
 * Review eligibility: a review may only be written for a pair that has a
 * COMPLETED bilateral agreement recorded in their shared ledger.
 * This is the user-confirmed rule (option b), not a self-reported trade flag.
 */
export async function reviewEligible(sql: Sql, memberA: unknown, memberB: unknown): Promise<boolean> {
  const result = await sql.query(
    `SELECT 1 FROM kg_membership.agreements a
       JOIN kg_membership.ledgers l ON l.id = a.ledger_id
      WHERE a.status = 'COMPLETED'
        AND ((a.requester_member_id = $1 AND a.counterpart_member_id = $2)
          OR (a.requester_member_id = $2 AND a.counterpart_member_id = $1))
      LIMIT 1`,
    [memberA, memberB],
  );
  return Boolean(result.rows[0]);
}

export function registerLedgerRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  const requireMember = requireActiveMember(authenticate);

  app.get('/v1/me/roles', async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const member = (await db.query(
      `SELECT expert_active AS "expertActive" FROM kg_membership.members WHERE id=$1 AND withdrawn_at IS NULL`,
      [auth.memberId],
    )).rows[0];
    if (!member) throw new ApiError(401, 'SESSION_INVALID');
    const grants = await db.query(
      `SELECT g.role_id AS role, g.starts_at AS "startsAt", g.ends_at AS "endsAt"
         FROM kg_membership.role_grants g
        WHERE g.member_id=$1 AND g.revoked_at IS NULL
          AND g.starts_at<=now() AND (g.ends_at IS NULL OR g.ends_at>now())`,
      [auth.memberId],
    );
    const roles = ['USER', ...(member.expertActive ? ['EXPERT'] : []), ...grants.rows.map(r => String(r.role))];
    return { roles: [...new Set(roles)], grants: grants.rows };
  });

  // 고객이 고수에게 거래를 시작하는 유일한 경로. 같은 상대와는 원장이 하나뿐이므로
  // 두 번째 요청은 새로 만들지 않고 기존 원장을 돌려준다(스팸·중복 방지).
  app.post<{ Body: { expertId: string; displayName?: string } }>('/v1/ledgers', {
    schema: body({ expertId: idSchema, displayName: string(1, 50) }, ['expertId']),
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    if (request.body.expertId === auth.memberId) throw new ApiError(400, 'SELF_LEDGER_NOT_ALLOWED');

    const expert = (await db.query(
      `SELECT 1 FROM kg_membership.members WHERE id=$1 AND expert_active AND withdrawn_at IS NULL`,
      [request.body.expertId],
    )).rows[0];
    if (!expert) throw new ApiError(404, 'EXPERT_NOT_FOUND');

    const inserted = (await db.query(
      `INSERT INTO kg_membership.ledgers(id,expert_member_id,customer_member_id,display_name)
       VALUES($1,$2,$3,$4) ON CONFLICT (expert_member_id,customer_member_id) DO NOTHING
       RETURNING id, created_at AS "createdAt"`,
      [randomUUID(), request.body.expertId, auth.memberId, request.body.displayName ?? null],
    )).rows[0];

    if (!inserted) {
      const existing = (await db.query(
        `SELECT id, created_at AS "createdAt" FROM kg_membership.ledgers
          WHERE expert_member_id=$1 AND customer_member_id=$2`,
        [request.body.expertId, auth.memberId],
      )).rows[0];
      return reply.code(200).send({ id: existing.id, createdAt: existing.createdAt, created: false });
    }

    await audit(db, auth.memberId, 'LEDGER_OPENED', 'ledger', String(inserted.id), undefined, { expertId: request.body.expertId });
    return reply.code(201).send({ id: inserted.id, createdAt: inserted.createdAt, created: true });
  });

  // Ledgers are owned by the expert. A customer never lists other people's ledgers.
  app.get('/v1/ledgers', async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const rows = await db.query(
      `SELECT l.id, l.customer_member_id AS "customerMemberId", m.customer_no::text AS "customerNumber",
              COALESCE(l.display_name, m.nickname) AS "displayName",
              l.created_at AS "createdAt", l.updated_at AS "updatedAt",
              (SELECT count(*)::int FROM kg_membership.ledger_notes n WHERE n.ledger_id=l.id AND n.purged_at IS NULL) AS "noteCount",
              (SELECT count(*)::int FROM kg_membership.agreements a WHERE a.ledger_id=l.id AND a.status='COMPLETED') AS "completedAgreements"
         FROM kg_membership.ledgers l
         JOIN kg_membership.members m ON m.id=l.customer_member_id
        WHERE l.expert_member_id=$1
        ORDER BY l.updated_at DESC`,
      [auth.memberId],
    );
    return { ledgers: rows.rows };
  });

  app.get<{ Params: { id: string } }>('/v1/ledgers/:id', {
    schema: { params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } } },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const ledger = (await db.query(
      `SELECT l.id, l.customer_member_id AS "customerMemberId", m.customer_no::text AS "customerNumber",
              COALESCE(l.display_name, m.nickname) AS "displayName", l.created_at AS "createdAt", l.updated_at AS "updatedAt"
         FROM kg_membership.ledgers l JOIN kg_membership.members m ON m.id=l.customer_member_id
        WHERE l.id=$1 AND l.expert_member_id=$2`,
      [request.params.id, auth.memberId],
    )).rows[0];
    if (!ledger) return fail(reply, 404, 'LEDGER_NOT_FOUND');
    const notes = await db.query(
      `SELECT id, body, created_at AS "createdAt" FROM kg_membership.ledger_notes
        WHERE ledger_id=$1 AND purged_at IS NULL ORDER BY created_at DESC`,
      [request.params.id],
    );
    const agreements = await db.query(
      `SELECT id, summary, status, version::int AS version, requested_at AS "requestedAt", accepted_at AS "acceptedAt",
              completed_at AS "completedAt", requester_member_id AS "requesterMemberId"
         FROM kg_membership.agreements WHERE ledger_id=$1 ORDER BY requested_at DESC`,
      [request.params.id],
    );
    return { ledger, notes: notes.rows, agreements: agreements.rows };
  });

  app.post<{ Params: { id: string }; Body: { body: string } }>('/v1/ledgers/:id/notes', {
    schema: {
      params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
      ...body({ body: string(1, 2000) }),
    },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const owned = (await db.query(
      `SELECT 1 FROM kg_membership.ledgers WHERE id=$1 AND expert_member_id=$2`,
      [request.params.id, auth.memberId],
    )).rows[0];
    if (!owned) return fail(reply, 404, 'LEDGER_NOT_FOUND');
    const note = (await db.query(
      `INSERT INTO kg_membership.ledger_notes(id,ledger_id,author_member_id,body)
       VALUES($1,$2,$3,$4) RETURNING id, body, created_at AS "createdAt"`,
      [randomUUID(), request.params.id, auth.memberId, request.body.body],
    )).rows[0];
    await db.query(`UPDATE kg_membership.ledgers SET updated_at=now() WHERE id=$1`, [request.params.id]);
    return reply.code(201).send(note);
  });

  // Agreement: request -> accept (counterpart) -> complete (either party).
  app.post<{ Body: { ledgerId: string; summary: string } }>('/v1/agreements', {
    schema: body({ ledgerId: idSchema, summary: string(1, 500) }),
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    return db.transaction(async sql => {
      const ledger = (await sql.query(
        `SELECT expert_member_id AS "expertMemberId", customer_member_id AS "customerMemberId"
           FROM kg_membership.ledgers WHERE id=$1 FOR UPDATE`,
        [request.body.ledgerId],
      )).rows[0];
      if (!ledger) throw new ApiError(404, 'LEDGER_NOT_FOUND');
      const pair = [String(ledger.expertMemberId), String(ledger.customerMemberId)];
      if (!pair.includes(String(auth.memberId))) throw new ApiError(403, 'NOT_A_PARTICIPANT');
      const counterpart = pair.find(id => id !== String(auth.memberId))!;
      const agreement = (await sql.query(
        `INSERT INTO kg_membership.agreements(id,ledger_id,requester_member_id,counterpart_member_id,summary)
         VALUES($1,$2,$3,$4,$5) RETURNING id, status, version::int AS version, requested_at AS "requestedAt"`,
        [randomUUID(), request.body.ledgerId, auth.memberId, counterpart, request.body.summary],
      )).rows[0];
      await audit(sql, auth.memberId, 'AGREEMENT_REQUESTED', 'agreement', String(agreement.id), undefined,
        { ledgerId: request.body.ledgerId });
      return reply.code(201).send(agreement);
    });
  });

  for (const [action, next, stamp] of [['accept', 'ACCEPTED', 'accepted_at'], ['complete', 'COMPLETED', 'completed_at']] as const) {
    app.post<{ Params: { id: string }; Body: { expectedVersion: number } }>(`/v1/agreements/:id/${action}`, {
      schema: {
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } },
        ...body({ expectedVersion: { type: 'integer', minimum: 1 } }),
      },
    }, async (request, reply) => {
      const auth = await requireMember(request, reply); if (!auth) return;
      return db.transaction(async sql => {
        const current = (await sql.query(
          `SELECT id, requester_member_id AS "requesterMemberId", counterpart_member_id AS "counterpartMemberId",
                  status, version::int AS version FROM kg_membership.agreements WHERE id=$1 FOR UPDATE`,
          [request.params.id],
        )).rows[0];
        if (!current) throw new ApiError(404, 'AGREEMENT_NOT_FOUND');

        // accept: only the counterpart. complete: either party, after acceptance.
        if (action === 'accept' && String(current.counterpartMemberId) !== String(auth.memberId)) {
          throw new ApiError(403, 'NOT_COUNTERPART');
        }
        if (action === 'complete' && ![String(current.requesterMemberId), String(current.counterpartMemberId)].includes(String(auth.memberId))) {
          throw new ApiError(403, 'NOT_A_PARTICIPANT');
        }
        if (Number(current.version) !== request.body.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT');
        const from = action === 'accept' ? 'REQUESTED' : 'ACCEPTED';
        if (current.status !== from) throw new ApiError(409, 'INVALID_TRANSITION');

        const updated = (await sql.query(
          `UPDATE kg_membership.agreements
              SET status=$2, version=version+1, ${stamp}=now()
            WHERE id=$1 AND version=$3 AND status=$4
            RETURNING id, status, version::int AS version, requested_at AS "requestedAt",
                      accepted_at AS "acceptedAt", completed_at AS "completedAt"`,
          [request.params.id, next, request.body.expectedVersion, from],
        )).rows[0];
        if (!updated) throw new ApiError(409, 'VERSION_CONFLICT');
        await audit(sql, auth.memberId, `AGREEMENT_${next}`, 'agreement', String(request.params.id));
        return updated;
      });
    });
  }

  // ── 거래 취소 (WS-71) ──────────────────────────────────────────────────────
  // 취소는 두 당사자의 합의로만 성립한다. 호출자가 요청자가 아니면 같은
  // 엔드포인트가 곧 "수락"이 되며, 어느 쪽인지는 서버가 현재 상태로 판정한다.
  // 클라이언트는 상태를 보내지 않고 사유 코드만 고른다.
  const cancelParams = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } };
  // $2 = 호출자 member id. requestedByMe는 표시용 파생값이다.
  const cancelProjection = `status, (cancel_requested_by = $2) AS "requestedByMe",
      cancel_requested_at AS "requestedAt", cancel_reason_code AS "reasonCode",
      cancel_reason_detail AS "detail", cancelled_at AS "cancelledAt"`;
  // 비당사자에게는 원장의 존재 자체를 알리지 않는다(채팅·메모와 같은 규칙).
  const participant = `(expert_member_id = $2 OR customer_member_id = $2)`;

  app.get<{ Params: { id: string } }>('/v1/ledgers/:id/cancel', {
    schema: { params: cancelParams },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    const row = (await db.query(
      `SELECT ${cancelProjection} FROM kg_membership.ledgers WHERE id=$1 AND ${participant}`,
      [request.params.id, auth.memberId],
    )).rows[0];
    if (!row) return fail(reply, 404, 'LEDGER_NOT_FOUND');
    return row;
  });

  app.post<{ Params: { id: string }; Body: { reasonCode?: string; detail?: string } }>('/v1/ledgers/:id/cancel', {
    schema: {
      params: cancelParams,
      // reasonCode는 요청을 만들 때만 필요하다(수락 호출은 사유를 다시 보내지 않는다).
      body: {
        type: 'object', additionalProperties: false,
        properties: { reasonCode: { type: 'string', enum: [...CANCEL_REASON_CODES] }, detail: string(1, 500) },
      },
    },
  }, async (request, reply) => {
    const auth = await requireMember(request, reply); if (!auth) return;
    return db.transaction(async sql => {
      const current = (await sql.query(
        `SELECT ${cancelProjection} FROM kg_membership.ledgers WHERE id=$1 AND ${participant} FOR UPDATE`,
        [request.params.id, auth.memberId],
      )).rows[0];
      if (!current) throw new ApiError(404, 'LEDGER_NOT_FOUND');

      if (current.status === 'CANCELLED') throw new ApiError(409, 'ALREADY_CANCELLED');

      if (current.status === 'CANCEL_REQUESTED') {
        if (current.requestedByMe === true) throw new ApiError(409, 'CANCEL_ALREADY_REQUESTED');
        const cancelled = (await sql.query(
          `UPDATE kg_membership.ledgers
              SET status='CANCELLED', cancelled_at=now(), updated_at=now()
            WHERE id=$1 AND status='CANCEL_REQUESTED'
            RETURNING ${cancelProjection}`,
          [request.params.id, auth.memberId],
        )).rows[0];
        if (!cancelled) throw new ApiError(409, 'INVALID_TRANSITION');
        await audit(sql, auth.memberId, 'LEDGER_CANCELLED', 'ledger', String(request.params.id),
          String(current.reasonCode), { accepted: true });
        return cancelled;
      }

      // 완료된 거래는 취소할 수 없다. 완료 판정은 agreements가 유일한 근거다.
      const completed = (await sql.query(
        `SELECT 1 FROM kg_membership.agreements WHERE ledger_id=$1 AND status='COMPLETED' LIMIT 1`,
        [request.params.id],
      )).rows[0];
      if (completed) throw new ApiError(409, 'LEDGER_COMPLETED');
      if (!request.body.reasonCode) throw new ApiError(400, 'REASON_REQUIRED');

      const requested = (await sql.query(
        `UPDATE kg_membership.ledgers
            SET status='CANCEL_REQUESTED', cancel_requested_by=$2, cancel_requested_at=now(),
                cancel_reason_code=$3, cancel_reason_detail=$4, updated_at=now()
          WHERE id=$1 AND status='ACTIVE'
          RETURNING ${cancelProjection}`,
        [request.params.id, auth.memberId, request.body.reasonCode, request.body.detail ?? null],
      )).rows[0];
      if (!requested) throw new ApiError(409, 'INVALID_TRANSITION');
      await audit(sql, auth.memberId, 'LEDGER_CANCEL_REQUESTED', 'ledger', String(request.params.id),
        request.body.reasonCode, { detail: request.body.detail ?? null });
      return requested;
    });
  });
}
