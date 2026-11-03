import type { FastifyInstance } from 'fastify';
import type { Sql, Row } from './app.ts';
import type { AuthOptions } from './providers.ts';
import { finalizeRegistration, type RegistrationInput } from './auth.ts';
import { consentInputSchema, requiredReadyKindsForGrant, revisionSchema } from './policy.ts';
import { tokenSchema } from './security.ts';

const body = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ body: { type: 'object', additionalProperties: false, properties, required } });
const string = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength });

// Same display selector /v1/auth/config has always used: the consentable
// document per kind is the newest effective READY one, else the newest row.
export const readinessDocumentsSelect = `SELECT DISTINCT ON(kind) kind,version,status,
  (status='READY' AND approved_at IS NOT NULL AND effective_at<=now() AND operator_name IS NOT NULL AND length(trim(operator_name))>0) AS "canConsent"
  FROM kg_membership.policy_documents ORDER BY kind,(status='READY' AND approved_at IS NOT NULL AND effective_at<=now()) DESC,effective_at DESC NULLS LAST,created_at DESC,id DESC`;

export async function readinessDocuments(sql: Sql) {
  return (await sql.query(readinessDocumentsSelect)).rows;
}

/**
 * One readiness predicate for both /v1/auth/config and POST /v1/auth/register,
 * so the advertised state and the enforced state cannot disagree. The reasons
 * are the only thing exposed; missing inputs never become a silent default.
 */
export function registrationReadiness(documents: Row[], options: AuthOptions) {
  const configured = options.providers ?? {};
  const identityReady = Boolean(options.identityKey && options.identityKey.length >= 32);
  const missingDocumentKinds = requiredReadyKindsForGrant.filter(
    kind => !documents.some(d => d.kind === kind && d.canConsent === true),
  );
  const reasons: string[] = [];
  if (missingDocumentKinds.length > 0) reasons.push('POLICY_NOT_READY');
  if (!identityReady) reasons.push('IDENTITY_CONFIGURATION_REQUIRED');
  if (!options.sms) reasons.push('SMS_PROVIDER_NOT_CONFIGURED');
  if (Object.keys(configured).length === 0) reasons.push('SOCIAL_PROVIDER_NOT_CONFIGURED');
  return { signupReady: reasons.length === 0, reasons, missingDocumentKinds: [...missingDocumentKinds] };
}

export function registerRegisterRoutes(app: FastifyInstance, db: Sql, options: AuthOptions) {
  // Contract-compatible body with /v1/auth/signup, but gated on the exact
  // readiness /v1/auth/config advertises. When policies are still DRAFT (or a
  // provider/identity/SMS input is missing) registration is refused with the
  // reasons instead of failing later inside the write path.
  app.post<{ Body: RegistrationInput & { age14Confirmed: true } }>('/v1/auth/register', {
    schema: body({
      registrationTicket: tokenSchema,
      name: string(1, 100),
      email: { type: 'string', maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
      age14Confirmed: { const: true },
      expertRequested: { type: 'boolean' },
      consents: consentInputSchema,
      expectedPolicyRevision: revisionSchema,
    }, ['registrationTicket', 'name', 'email', 'age14Confirmed', 'expertRequested', 'consents']),
  }, async (request, reply) => {
    const readiness = registrationReadiness(await readinessDocuments(db), options);
    if (!readiness.signupReady) {
      return reply.code(409).send({
        error: { code: 'SIGNUP_NOT_READY', reasons: readiness.reasons, missingDocumentKinds: readiness.missingDocumentKinds },
      });
    }
    return db.transaction(sql => finalizeRegistration(sql, request.body));
  });
}
