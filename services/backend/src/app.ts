import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from './security.ts';
import { registerAuthRoutes } from './auth.ts';
import type { AuthOptions } from './providers.ts';
import { POLICY_METADATA, loadPolicySnapshot, requiredReadyKindsForGrant } from './policy.ts';

export type Row = Record<string, unknown>;
export interface Sql {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
}
const kinds = ['TERMS', 'PRIVACY_CONSENT', 'PRIVACY_POLICY', 'MARKETING', 'OPERATIONS'];
const channels = ['advertising', 'chat', 'comment', 'quote', 'inquiry'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const policySelect = `SELECT kind,version,status,title,body,body_sha256 AS "bodySha256",
  operator_name AS "operator",effective_at AS "effectiveAt",
  (status='READY' AND approved_at IS NOT NULL AND effective_at<=now() AND operator_name IS NOT NULL AND length(trim(operator_name))>0) AS "canConsent"
  FROM kg_membership.policy_documents`;

export function buildApp(db: Sql, release: string, options: AuthOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 16384, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const throttleSalt = randomBytes(32).toString('hex');
  const throttle = new Map<string, { start: number; count: number }>();
  const corsOrigins = new Set(['https://dev-kimgosu.mintech.ai', ...(options.corsOrigins ?? []).filter(o => /^http:\/\/(localhost|127\.0\.0\.1):[0-9]{2,5}$/.test(o))]);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Vary', 'Origin').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    if (request.headers.origin) {
      if (!corsOrigins.has(request.headers.origin)) return reply.code(403).send({ error: { code: 'ORIGIN_NOT_ALLOWED' } });
      reply.header('Access-Control-Allow-Origin', request.headers.origin).header('Access-Control-Expose-Headers', 'Date, Retry-After, X-Server-Time');
    }
    if (request.method === 'POST' && request.url.startsWith('/v1/auth/')) {
      const now = Date.now();
      for (const [key, value] of throttle) if (now - value.start >= 60000) throttle.delete(key);
      const key = hash(throttleSalt + request.ip);
      const rate = throttle.get(key) ?? { start: now, count: 0 };
      if (rate.count >= 60 || (!throttle.has(key) && throttle.size >= 10000)) return reply.header('Retry-After', '60').code(429).send({ error: { code: 'AUTH_RATE_LIMITED' } });
      rate.count++; throttle.set(key, rate);
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Server-Time', new Date().toISOString());
    return payload;
  });
  app.options('/*', async (request, reply) => {
    const method = request.headers['access-control-request-method'];
    const headers = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(v => v.trim()).filter(Boolean);
    if (!['GET', 'POST', 'PATCH'].includes(String(method)) || headers.some(h => !['authorization', 'content-type', 'cache-control'].includes(h))) return reply.code(403).send({ error: { code: 'CORS_PREFLIGHT_DENIED' } });
    return reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS').header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Cache-Control').code(204).send();
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      if (error.metadata.retryAfterSeconds !== undefined) reply.header('Retry-After', String(error.metadata.retryAfterSeconds));
      return reply.code(error.status).send({ error: { code: error.code, ...error.metadata } });
    }
    if (error && typeof error === 'object' && 'validation' in error && error.validation) return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
    if (error && typeof error === 'object' && 'statusCode' in error && [400, 413, 415].includes(Number(error.statusCode))) return reply.code(Number(error.statusCode)).send({ error: { code: 'INVALID_REQUEST' } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR' } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'ROUTE_NOT_FOUND' } }));
  const fail = (reply: FastifyReply, status: number, code: string) => reply.code(status).send({ error: { code } });
  async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const raw = request.headers.authorization;
    if (typeof raw !== 'string' || !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(raw)) { fail(reply, 401, 'AUTH_REQUIRED'); return null; }
    const result = await db.query(`SELECT s.id AS "sessionId",m.id AS "memberId",m.principal_id AS "principalId",CASE WHEN EXISTS(SELECT 1 FROM kg_membership.restrictions r WHERE r.principal_id=m.principal_id AND r.revoked_at IS NULL AND r.starts_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now())) THEN 'RESTRICTED' ELSE m.status END AS status
      FROM kg_membership.sessions s JOIN kg_membership.members m ON m.id=s.member_id
      WHERE s.access_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND m.withdrawn_at IS NULL`, [hash(raw.slice(7))]);
    if (!result.rows[0]) { fail(reply, 401, 'SESSION_INVALID'); return null; }
    return result.rows[0];
  }
  app.get('/health', async () => ({ status: 'ok', scope: 'membership-development', release }));
  // Only the exact supported opt-in activates its strict query contract.
  // Absent/unknown/array metadata retains the existing non-opted-in legacy path.
  const policyOptInQuery = { schema: { querystring: {
    type: 'object',
    if: { required: ['metadata'], properties: { metadata: { const: POLICY_METADATA } } },
    then: { required: ['metadata'], additionalProperties: false, properties: { metadata: { type: 'string', const: POLICY_METADATA } } },
  } } };
  app.get('/v1/auth/config', policyOptInQuery, async (request) => {
    const snapshot = (request.query as { metadata?: string }).metadata === POLICY_METADATA ? await loadPolicySnapshot(db) : null;
    const documents = snapshot ? { rows: snapshot.currentDocuments.flatMap(slot => {
      const d = snapshot.documents.find(d => d.id === slot.currentDocument?.id) ?? snapshot.documents.find(d => d.kind === slot.kind && d.isDisplay);
      return d ? [{ kind: d.kind, version: d.version, status: d.status, canConsent: d.canConsent }] : [];
    }) } : await db.query(`SELECT DISTINCT ON(kind) kind,version,status,
      (status='READY' AND approved_at IS NOT NULL AND effective_at<=now() AND operator_name IS NOT NULL AND length(trim(operator_name))>0) AS "canConsent"
      FROM kg_membership.policy_documents ORDER BY kind,(status='READY' AND approved_at IS NOT NULL AND effective_at<=now()) DESC,effective_at DESC NULLS LAST,created_at DESC,id DESC`);
    const configured = options.providers ?? {};
    const identityReady = Boolean(options.identityKey && options.identityKey.length >= 32);
    const docsReady = requiredReadyKindsForGrant.every(kind => documents.rows.some(d => d.kind === kind && d.canConsent === true));
    return { release, signupReady: docsReady && identityReady && Boolean(options.sms) && Object.keys(configured).length > 0, providers: (['kakao', 'naver', 'google'] as const).map(id => ({ id, enabled: Boolean(configured[id]) && identityReady, ...(!configured[id] || !identityReady ? { reason: 'PROVIDER_INTEGRATION_NOT_CONNECTED' } : {}) })),
      sms: { available: Boolean(options.sms) && identityReady, codeDigits: 5, expiresInSeconds: 60, phonePattern: '^010[0-9]{8}$' },
      requiredFields: ['name', 'email'], minimumAgeAcknowledgement: 14, collectsGender: false, collectsAgeGroup: false,
      rejoinWaitDays: 30, retention: { purpose: '거래상대방 보호', startsAt: 'WITHDRAWAL_CONFIRMED', calendarYears: 1, rejoinResetsClock: false },
      documents: documents.rows, ...(snapshot ? { policySnapshot: snapshot } : {}) };
  });
  app.get('/v1/policies', policyOptInQuery, async (request) => {
    if ((request.query as { metadata?: string }).metadata === POLICY_METADATA) {
      const snapshot = await loadPolicySnapshot(db);
      return { documents: snapshot.documents, policySnapshot: snapshot };
    }
    return { documents: (await db.query(`${policySelect} ORDER BY kind,created_at DESC,id DESC`)).rows };
  });
  app.get<{ Params: { kind: string }; Querystring: { version?: string; metadata?: string } }>('/v1/policies/:kind', {
    schema: { params: { type: 'object', required: ['kind'], additionalProperties: false, properties: { kind: { type: 'string', enum: kinds } } },
      querystring: { type: 'object', additionalProperties: false, properties: { version: { type: 'string', minLength: 1, maxLength: 100 }, metadata: { const: POLICY_METADATA, type: 'string' } } } },
  }, async (request, reply) => {
    if (request.query.metadata === POLICY_METADATA) {
      const snapshot = await loadPolicySnapshot(db);
      const kind = request.params.kind;
      const currentId = snapshot.currentDocuments.find(d => d.kind === kind)?.currentDocument?.id;
      const document = request.query.version !== undefined ? snapshot.documents.find(d => d.kind === kind && d.version === request.query.version) :
        snapshot.documents.find(d => d.id === currentId) ?? snapshot.documents.find(d => d.kind === kind && d.isDisplay);
      return document ? { ...document, policySnapshot: snapshot } : fail(reply, 404, 'DOCUMENT_PREPARING');
    }
    const result = await db.query(`${policySelect} WHERE kind=$1 AND ($2::text IS NULL OR version=$2)
      ORDER BY (status='READY' AND approved_at IS NOT NULL AND effective_at<=now()) DESC,effective_at DESC NULLS LAST,created_at DESC,id DESC LIMIT 1`, [request.params.kind, request.query.version ?? null]);
    return result.rows[0] ?? fail(reply, 404, 'DOCUMENT_PREPARING');
  });
  app.get('/v1/me', async (request, reply) => {
    const auth = await authenticate(request, reply); if (!auth) return;
    const result = await db.query(`SELECT id,customer_no::text AS "customerNumber",name,email,nickname,status,
      expert_active AS "expertActive",created_at AS "createdAt" FROM kg_membership.members WHERE id=$1 AND withdrawn_at IS NULL`, [auth.memberId]);
    return result.rows[0] ? { ...result.rows[0], status: auth.status } : fail(reply, 401, 'SESSION_INVALID');
  });
  app.get('/v1/me/consents', async (request, reply) => {
    const auth = await authenticate(request, reply); if (!auth) return;
    const result = await db.query(`SELECT DISTINCT ON(d.kind) d.kind,d.title,d.version,e.action AS status,e.recorded_at AS "recordedAt"
      FROM kg_membership.consent_events e JOIN kg_membership.policy_documents d ON d.id=e.document_id
      WHERE e.member_id=$1 ORDER BY d.kind,e.id DESC`, [auth.memberId]);
    return { records: result.rows };
  });
  app.get('/v1/me/notifications', async (request, reply) => {
    const auth = await authenticate(request, reply); if (!auth) return;
    const result = await db.query(`SELECT advertising,chat,comment,quote,inquiry,version FROM kg_membership.notification_preferences WHERE member_id=$1`, [auth.memberId]);
    return result.rows[0] ? { ...result.rows[0], version: Number(result.rows[0].version) } : { advertising: false, chat: false, comment: false, quote: false, inquiry: false, version: 0 };
  });
  app.patch<{ Body: { expectedVersion: number; advertising?: boolean; chat?: boolean; comment?: boolean; quote?: boolean; inquiry?: boolean } }>('/v1/me/notifications', {
    schema: { body: { type: 'object', required: ['expectedVersion'], minProperties: 2, additionalProperties: false,
      properties: { expectedVersion: { type: 'integer', minimum: 0 }, ...Object.fromEntries(channels.map(k => [k, { type: 'boolean' }])) } } },
  }, async (request, reply) => {
    const auth = await authenticate(request, reply); if (!auth) return;
    if (auth.status !== 'ACTIVE') return fail(reply, 403, 'ACCOUNT_RESTRICTED');
    return db.transaction(async sql => {
      const member = await sql.query(`SELECT id,CASE WHEN EXISTS(SELECT 1 FROM kg_membership.restrictions r WHERE r.principal_id=m.principal_id AND r.revoked_at IS NULL AND r.starts_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now())) THEN 'RESTRICTED' ELSE m.status END AS status FROM kg_membership.members m WHERE id=$1 AND withdrawn_at IS NULL FOR UPDATE`, [auth.memberId]);
      if (member.rows[0]?.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_RESTRICTED');
      if (request.body.advertising === true) {
        const consent = await sql.query(`SELECT e.action FROM kg_membership.consent_events e JOIN kg_membership.policy_documents d ON d.id=e.document_id
          WHERE e.member_id=$1 AND d.kind='MARKETING' AND d.id=(SELECT id FROM kg_membership.policy_documents WHERE kind='MARKETING' AND status='READY' AND approved_at IS NOT NULL AND effective_at<=now() AND operator_name IS NOT NULL AND length(trim(operator_name))>0 ORDER BY effective_at DESC,id DESC LIMIT 1) ORDER BY e.id DESC LIMIT 1`, [auth.memberId]);
        if (consent.rows[0]?.action !== 'GRANTED') throw new ApiError(409, 'MARKETING_CONSENT_REQUIRED');
      }
      await sql.query(`INSERT INTO kg_membership.notification_preferences(member_id,version) VALUES($1,0) ON CONFLICT DO NOTHING`, [auth.memberId]);
      const values = channels.map(k => request.body[k as keyof typeof request.body] ?? null);
      const result = await sql.query(`UPDATE kg_membership.notification_preferences SET
        advertising=COALESCE($2,advertising),chat=COALESCE($3,chat),comment=COALESCE($4,comment),quote=COALESCE($5,quote),inquiry=COALESCE($6,inquiry),version=version+1,updated_at=now()
        WHERE member_id=$1 AND version=$7 RETURNING advertising,chat,comment,quote,inquiry,version`, [auth.memberId, ...values, request.body.expectedVersion]);
      if (!result.rows[0]) throw new ApiError(409, 'VERSION_CONFLICT');
      return { ...result.rows[0], version: Number(result.rows[0].version) };
    });
  });
  app.post('/v1/auth/logout', async (request, reply) => {
    const auth = await authenticate(request, reply); if (!auth) return;
    await db.query(`UPDATE kg_membership.sessions SET revoked_at=now() WHERE id=$1 AND member_id=$2 AND revoked_at IS NULL`, [auth.sessionId, auth.memberId]);
    return { loggedOut: true };
  });
  registerAuthRoutes(app, db, authenticate, options);
  return app;
}
