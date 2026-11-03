import type { FastifyInstance } from 'fastify';
import type { Sql } from './app.ts';
import type { Authenticate } from './auth.ts';
import { ApiError } from './security.ts';
import { audit } from './kernel.ts';

const body = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ body: { type: 'object', additionalProperties: false, properties, required } });
const string = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength });

export function registerAdminPolicyRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate) {
  /**
   * DRAFT -> READY for a whole policy version, the only supported promotion
   * direction. The 004 integrity trigger seals the row on this transition, so
   * it is one-way: an already-READY row is refused rather than re-promoted,
   * and the operator/timestamps must be supplied explicitly.
   *
   * Promotion is never automatic. This is an operator action: the business
   * details behind operator/effectiveAt/approvedAt are a user decision.
   */
  app.post<{ Body: { version: string; operator: string; effectiveAt: string; approvedAt: string; reason: string; confirmed: true } }>(
    '/v1/admin/policies/promote',
    {
      schema: body({
        version: string(1, 100),
        operator: string(1, 200),
        effectiveAt: { type: 'string', minLength: 20, maxLength: 40 },
        approvedAt: { type: 'string', minLength: 20, maxLength: 40 },
        reason: string(2, 500),
        confirmed: { const: true },
      }),
    },
    async (request, reply) => {
      const auth = await authenticate(request, reply); if (!auth) return;
      if (auth.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_RESTRICTED');
      const admin = (await db.query(
        `SELECT 1 FROM kg_membership.role_grants g
          WHERE g.member_id=$1 AND g.role_id='ADMIN' AND g.revoked_at IS NULL
            AND g.starts_at<=now() AND (g.ends_at IS NULL OR g.ends_at>now()) LIMIT 1`,
        [auth.memberId],
      )).rows[0];
      if (!admin) throw new ApiError(403, 'ADMIN_REQUIRED');

      const effectiveAt = new Date(request.body.effectiveAt);
      const approvedAt = new Date(request.body.approvedAt);
      if (!Number.isFinite(effectiveAt.getTime()) || !Number.isFinite(approvedAt.getTime())) throw new ApiError(400, 'INVALID_REQUEST');
      const operator = request.body.operator.trim();
      if (!operator) throw new ApiError(400, 'INVALID_REQUEST');

      return db.transaction(async sql => {
        const documents = (await sql.query(
          `SELECT id,kind,version,status FROM kg_membership.policy_documents WHERE version=$1 ORDER BY kind FOR UPDATE`,
          [request.body.version],
        )).rows;
        if (!documents.length) throw new ApiError(404, 'POLICY_NOT_FOUND');
        if (documents.some(d => d.status !== 'DRAFT')) throw new ApiError(409, 'POLICY_NOT_DRAFT');

        const promoted = [];
        for (const document of documents) {
          const row = (await sql.query(
            `UPDATE kg_membership.policy_documents
                SET status='READY', operator_name=$2, effective_at=$3, approved_at=$4
              WHERE id=$1 AND status='DRAFT'
              RETURNING id,kind,version,status,operator_name AS operator,
                effective_at AS "effectiveAt",approved_at AS "approvedAt",
                (status='READY' AND approved_at IS NOT NULL AND effective_at<=now()
                 AND operator_name IS NOT NULL AND length(trim(operator_name))>0) AS "canConsent"`,
            [document.id, operator, effectiveAt, approvedAt],
          )).rows[0];
          if (!row) throw new ApiError(409, 'POLICY_NOT_DRAFT');
          await audit(sql, auth.memberId, 'POLICY_PROMOTED', 'policy_document', String(row.id), request.body.reason, {
            kind: row.kind, version: row.version, operator, effectiveAt: effectiveAt.toISOString(), approvedAt: approvedAt.toISOString(),
          });
          promoted.push(row);
        }
        return { promoted };
      });
    },
  );
}
