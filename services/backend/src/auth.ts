import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Sql, Row } from './app.ts';
import type { AuthOptions, ProviderId } from './providers.ts';
import { ApiError, digest, opaque, challenge, mac, tokenSchema } from './security.ts';
import { currentDocumentsSelect, requiredGrantKinds, requiredReadyKindsForGrant, consentInputSchema, nicknameSchema, revisionSchema, loadPolicySnapshot, assertPolicyRevision } from './policy.ts';
export type Authenticate = (request: FastifyRequest, reply: FastifyReply) => Promise<Row | null>;
const body = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ body: { type: 'object', additionalProperties: false, properties, required } });
const string = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength });
const documentInput = consentInputSchema;
export async function issueSession(sql: Sql, memberId: unknown, family?: unknown) {
  const accessToken = opaque(); const refreshToken = opaque();
  await sql.query(`INSERT INTO kg_membership.sessions(id,member_id,access_digest,expires_at,refresh_digest,refresh_expires_at,family_id)
    VALUES($1,$2,$3,now()+interval '15 minutes',$4,now()+interval '30 days',$5)`, [randomUUID(), memberId, digest(accessToken), digest(refreshToken), family ?? randomUUID()]);
  return { accessToken, refreshToken, tokenType: 'Bearer', expiresInSeconds: 900 };
}
export async function currentDocuments(sql: Sql) {
  return (await sql.query(currentDocumentsSelect)).rows;
}
async function recordGrants(sql: Sql, memberId: unknown, accepted: { kind: string; version: string }[], expectedPolicyRevision?: string) {
  const snapshot = expectedPolicyRevision === undefined ? null : await loadPolicySnapshot(sql);
  if (snapshot) assertPolicyRevision(snapshot, expectedPolicyRevision!);
  const docs = snapshot ? snapshot.currentDocuments.flatMap(d => d.currentDocument ? [d.currentDocument] : []) : await currentDocuments(sql);
  if (!requiredReadyKindsForGrant.every(kind => docs.some(d => d.kind === kind))) throw new ApiError(409, 'DOCUMENT_NOT_READY');
  if (!requiredGrantKinds.every(kind => accepted.some(d => d.kind === kind))) throw new ApiError(400, 'REQUIRED_CONSENT_MISSING');
  if (new Set(accepted.map(a => a.kind)).size !== accepted.length) throw new ApiError(400, 'INVALID_REQUEST');
  for (const a of accepted) {
    const d = docs.find(d => d.kind === a.kind && d.version === a.version);
    if (!d) throw new ApiError(409, 'POLICY_VERSION_CHANGED');
    await sql.query(`INSERT INTO kg_membership.consent_events(member_id,document_id,action,request_id) VALUES($1,$2,'GRANTED',$3)`, [memberId, d.id, randomUUID()]);
  }
}
async function requireCurrentConsents(sql: Sql, memberId: unknown) {
  const docs = await currentDocuments(sql);
  for (const kind of requiredGrantKinds) {
    const doc = docs.find(d => d.kind === kind);
    if (!doc) throw new ApiError(409, 'DOCUMENT_NOT_READY');
    const last = (await sql.query(`SELECT action FROM kg_membership.consent_events WHERE member_id=$1 AND document_id=$2 ORDER BY id DESC LIMIT 1`, [memberId, doc.id])).rows[0];
    if (last?.action !== 'GRANTED') throw new ApiError(403, 'CONSENT_RENEWAL_REQUIRED');
  }
}
export function registerAuthRoutes(app: FastifyInstance, db: Sql, authenticate: Authenticate, options: AuthOptions) {
  const providers = options.providers ?? {};
  const needKey = () => { if (!options.identityKey || options.identityKey.length < 32) throw new ApiError(503, 'IDENTITY_CONFIGURATION_REQUIRED'); return options.identityKey; };
  const phoneDigest = (phone: string) => mac(needKey(), 'phone', phone);
  async function ticket(sql: Sql, raw: string) {
    const row = (await sql.query(`SELECT * FROM kg_membership.registration_tickets WHERE ticket_digest=$1 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE`, [digest(raw)])).rows[0];
    if (!row) throw new ApiError(401, 'REGISTRATION_INVALID'); return row;
  }
  app.post<{ Body: { provider: ProviderId; codeChallenge: string } }>('/v1/auth/social/start', { schema: body({ provider: { type: 'string', enum: ['google', 'kakao', 'naver'] }, codeChallenge: tokenSchema }) }, async (req) => {
    const p = providers[req.body.provider]; if (!p) throw new ApiError(503, 'PROVIDER_NOT_CONFIGURED'); needKey();
    const state = opaque();
    await db.query(`INSERT INTO kg_membership.oauth_flows(state_digest,provider,code_challenge,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')`, [digest(state), req.body.provider, req.body.codeChallenge]);
    return { authorizationUrl: p.authorize(state, req.body.codeChallenge), state, expiresInSeconds: 300 };
  });
  app.post<{ Body: { provider: ProviderId; codeChallenge: string; confirmed: boolean } }>('/v1/me/social/link/start', { schema: body({ provider: { type: 'string', enum: ['google', 'kakao', 'naver'] }, codeChallenge: tokenSchema, confirmed: { const: true } }) }, async (req, reply) => {
    const auth = await authenticate(req, reply); if (!auth) return;
    if (auth.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_RESTRICTED');
    const p = providers[req.body.provider]; if (!p) throw new ApiError(503, 'PROVIDER_NOT_CONFIGURED'); needKey();
    await requireCurrentConsents(db, auth.memberId);
    const state = opaque();
    await db.query(`INSERT INTO kg_membership.oauth_flows(state_digest,provider,code_challenge,expires_at,link_member_id) VALUES($1,$2,$3,now()+interval '5 minutes',$4)`, [digest(state), req.body.provider, req.body.codeChallenge, auth.memberId]);
    return { authorizationUrl: p.authorize(state, req.body.codeChallenge), state, expiresInSeconds: 300 };
  });
  app.post<{ Body: { provider: ProviderId; state: string; code: string; codeVerifier: string } }>('/v1/auth/social/complete', { schema: body({ provider: { type: 'string', enum: ['google', 'kakao', 'naver'] }, state: tokenSchema, code: string(1, 4096), codeVerifier: { type: 'string', pattern: '^[A-Za-z0-9._~-]{43,128}$' } }) }, async (req, reply) => {
    const p = providers[req.body.provider]; if (!p) throw new ApiError(503, 'PROVIDER_NOT_CONFIGURED'); const key = needKey();
    const consumed = await db.query(`UPDATE kg_membership.oauth_flows SET consumed_at=now() WHERE state_digest=$1 AND provider=$2 AND code_challenge=$3 AND expires_at>now() AND consumed_at IS NULL RETURNING state_digest,link_member_id`, [digest(req.body.state), req.body.provider, challenge(req.body.codeVerifier)]);
    if (!consumed.rows[0]) throw new ApiError(401, 'OAUTH_FLOW_INVALID');
    const linkMemberId = consumed.rows[0].link_member_id;
    const linkingAuth = linkMemberId ? await authenticate(req, reply) : null;
    if (linkMemberId && !linkingAuth) return;
    if (linkMemberId && linkingAuth?.memberId !== linkMemberId) throw new ApiError(403, 'LINK_OWNER_MISMATCH');
    const identity = await p.exchange(req.body.code, req.body.state, req.body.codeVerifier);
    const subjectDigest = mac(key, 'social:' + req.body.provider, identity.subject);
    return db.transaction(async sql => {
      if (linkMemberId) {
        await sql.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [req.body.provider + ':' + subjectDigest]);
        const m = (await sql.query(`SELECT id,principal_id FROM kg_membership.members m WHERE id=$1 AND withdrawn_at IS NULL AND status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM kg_membership.restrictions r WHERE r.principal_id=m.principal_id AND r.revoked_at IS NULL AND r.starts_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now())) FOR UPDATE`, [linkMemberId])).rows[0];
        if (!m) throw new ApiError(403, 'ACCOUNT_RESTRICTED');
        await requireCurrentConsents(sql, linkMemberId);
        const existing = (await sql.query(`SELECT principal_id FROM kg_membership.social_links WHERE provider=$1 AND subject_digest=$2`, [req.body.provider, subjectDigest])).rows[0];
        if (existing && existing.principal_id !== m.principal_id) throw new ApiError(409, 'SOCIAL_LINK_CONFLICT');
        if (!existing) await sql.query(`INSERT INTO kg_membership.social_links(provider,subject_digest,principal_id) VALUES($1,$2,$3)`, [req.body.provider, subjectDigest, m.principal_id]);
        return { outcome: 'LINKED', provider: req.body.provider };
      }
      const member = (await sql.query(`SELECT m.id FROM kg_membership.social_links l JOIN kg_membership.members m ON m.principal_id=l.principal_id
        WHERE l.provider=$1 AND l.subject_digest=$2 AND m.withdrawn_at IS NULL FOR UPDATE OF m`, [req.body.provider, subjectDigest])).rows[0];
      if (member) return { outcome: 'AUTHENTICATED', session: await issueSession(sql, member.id) };
      const registrationTicket = opaque();
      await sql.query(`INSERT INTO kg_membership.registration_tickets(ticket_digest,provider,subject_digest,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')`, [digest(registrationTicket), req.body.provider, subjectDigest]);
      return { outcome: 'REGISTRATION_REQUIRED', registrationTicket, expiresInSeconds: 600 };
    });
  });
  app.post<{ Body: { registrationTicket: string; phone: string } }>('/v1/auth/sms/send', { schema: body({ registrationTicket: tokenSchema, phone: { type: 'string', pattern: '^010[0-9]{8}$' } }) }, async req => {
    if (!options.sms) throw new ApiError(503, 'SMS_PROVIDER_NOT_CONFIGURED'); const sms = options.sms;
    return db.transaction(async sql => {
      const t = await ticket(sql, req.body.registrationTicket); const pd = phoneDigest(req.body.phone);
      // Serialize the phone rate limit across different tickets, without storing a raw number.
      await sql.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, ['sms:' + pd]);
      const rate = (await sql.query(`SELECT count(*)::integer AS count,COALESCE(bool_or(created_at>now()-interval '60 seconds'),false) AS recent,
        now() AS "serverTime",GREATEST(max(created_at)+interval '60 seconds',CASE WHEN count(*)>=5 THEN min(created_at)+interval '1 hour' ELSE now() END) AS "retryAfter"
        FROM kg_membership.sms_challenges
        WHERE phone_digest=$1 AND created_at>now()-interval '1 hour'`, [pd])).rows[0];
      if (Number(rate?.count) >= 5 || rate?.recent === true) {
        const serverTime = new Date(String(rate.serverTime)).toISOString(); const retryAfter = new Date(String(rate.retryAfter)).toISOString();
        throw new ApiError(429, 'SMS_RATE_LIMITED', { serverTime, retryAfter, retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(retryAfter) - Date.parse(serverTime)) / 1000)) });
      }
      const existing = await sql.query(`SELECT id FROM kg_membership.members WHERE phone_digest=$1 AND withdrawn_at IS NULL`, [pd]);
      if (existing.rows[0]) throw new ApiError(409, 'PHONE_ALREADY_REGISTERED');
      await sql.query(`UPDATE kg_membership.sms_challenges SET invalidated_at=now() WHERE ticket_digest=$1 AND invalidated_at IS NULL`, [t.ticket_digest]);
      await sql.query(`UPDATE kg_membership.registration_tickets SET phone_digest=NULL,phone_verified_at=NULL WHERE ticket_digest=$1`, [t.ticket_digest]);
      const id = randomUUID(); const code = String(randomInt(0, 100000)).padStart(5, '0');
      const timing = (await sql.query(`INSERT INTO kg_membership.sms_challenges(id,ticket_digest,phone_digest,code_mac,expires_at) VALUES($1,$2,$3,$4,now()+interval '60 seconds') RETURNING now() AS "serverTime",expires_at AS "expiresAt",created_at+interval '60 seconds' AS "retryAfter"`, [id, t.ticket_digest, pd, mac(needKey(), 'sms:' + id, code)])).rows[0];
      try { await sms.send(req.body.phone, code); } catch { throw new ApiError(502, 'SMS_DELIVERY_FAILED'); }
      return { challengeId: id, expiresInSeconds: 60, codeDigits: 5, serverTime: new Date(String(timing.serverTime)).toISOString(), expiresAt: new Date(String(timing.expiresAt)).toISOString(), retryAfter: new Date(String(timing.retryAfter)).toISOString() };
    });
  });
  app.post<{ Body: { registrationTicket: string; challengeId: string; code: string } }>('/v1/auth/sms/verify', { schema: body({ registrationTicket: tokenSchema, challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^[0-9]{5}$' } }) }, async req => {
    needKey();
    const result = await db.transaction(async sql => {
      const t = await ticket(sql, req.body.registrationTicket);
      const c = (await sql.query(`SELECT * FROM kg_membership.sms_challenges WHERE id=$1 AND ticket_digest=$2 AND invalidated_at IS NULL AND verified_at IS NULL AND expires_at>now() FOR UPDATE`, [req.body.challengeId, t.ticket_digest])).rows[0];
      if (!c || Number(c.attempts) >= 5) return false;
      const valid = timingSafeEqual(Buffer.from(String(c.code_mac)), Buffer.from(mac(needKey(), 'sms:' + c.id, req.body.code)));
      await sql.query(`UPDATE kg_membership.sms_challenges SET attempts=attempts+1,verified_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1`, [c.id, valid]);
      if (valid) await sql.query(`UPDATE kg_membership.registration_tickets SET phone_digest=$2,phone_verified_at=now() WHERE ticket_digest=$1`, [t.ticket_digest, c.phone_digest]);
      return valid;
    });
    if (!result) throw new ApiError(400, 'SMS_CODE_INVALID_OR_EXPIRED'); return { verified: true };
  });
  app.post<{ Body: { registrationTicket: string; name: string; email: string; age14Confirmed: boolean; expertRequested: boolean; consents: { kind: string; version: string }[]; expectedPolicyRevision?: string } }>('/v1/auth/signup', { schema: body({ registrationTicket: tokenSchema, name: string(1, 100), email: { type: 'string', maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' }, age14Confirmed: { const: true }, expertRequested: { type: 'boolean' }, consents: documentInput, expectedPolicyRevision: revisionSchema }, ['registrationTicket', 'name', 'email', 'age14Confirmed', 'expertRequested', 'consents']) }, async req => {
    return db.transaction(async sql => {
      // Fence policy DML before ticket/member/advisory locks; held through commit/rollback.
      await sql.query('LOCK TABLE kg_membership.policy_documents IN SHARE MODE');
      const t = await ticket(sql, req.body.registrationTicket);
      if (!t.phone_digest || !t.phone_verified_at) throw new ApiError(409, 'PHONE_VERIFICATION_REQUIRED');
      if (!req.body.name.trim()) throw new ApiError(400, 'INVALID_REQUEST');
      await sql.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [t.provider + ':' + t.subject_digest]);
      let principalId = (await sql.query(`SELECT principal_id FROM kg_membership.social_links WHERE provider=$1 AND subject_digest=$2`, [t.provider, t.subject_digest])).rows[0]?.principal_id;
      if (!principalId) {
        principalId = randomUUID(); await sql.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
        await sql.query(`INSERT INTO kg_membership.social_links(provider,subject_digest,principal_id) VALUES($1,$2,$3)`, [t.provider, t.subject_digest, principalId]);
      }
      await sql.query(`SELECT id FROM kg_membership.principals WHERE id=$1 FOR UPDATE`, [principalId]);
      await sql.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, ['signup-phone:' + t.phone_digest]);
      const old = (await sql.query(`SELECT id,withdrawn_at,rejoin_after>now() AS waiting,rejoin_after AS "rejoinAfter",now() AS "serverTime" FROM kg_membership.members WHERE principal_id=$1 ORDER BY created_at DESC,id DESC`, [principalId])).rows;
      if (old.some(m => !m.withdrawn_at)) throw new ApiError(409, 'ALREADY_REGISTERED');
      const rejectWaiting = (members: Row[]) => {
        const waiting = members.filter(m => m.waiting).sort((a, b) => new Date(String(b.rejoinAfter)).getTime() - new Date(String(a.rejoinAfter)).getTime());
        if (waiting[0]) throw new ApiError(409, 'REJOIN_WAIT_REQUIRED', { rejoinAfter: new Date(String(waiting[0].rejoinAfter)).toISOString(), serverTime: new Date(String(waiting[0].serverTime)).toISOString() });
      };
      rejectWaiting(old);
      const phone = (await sql.query(`SELECT principal_id,withdrawn_at,rejoin_after>now() AS waiting,rejoin_after AS "rejoinAfter",now() AS "serverTime" FROM kg_membership.members WHERE phone_digest=$1`, [t.phone_digest])).rows;
      if (phone.some(m => !m.withdrawn_at)) throw new ApiError(409, 'PHONE_ALREADY_REGISTERED');
      if (phone.some(m => m.principal_id !== principalId)) throw new ApiError(409, 'IDENTITY_RECOVERY_REQUIRED');
      rejectWaiting(phone);
      const restricted = (await sql.query(`SELECT id FROM kg_membership.restrictions WHERE principal_id=$1 AND revoked_at IS NULL AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())`, [principalId])).rows.length > 0;
      const memberId = randomUUID();
      await sql.query(`INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,status,expert_active,phone_digest,age14_confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())`, [memberId, principalId, req.body.name.trim(), req.body.email, '고수' + opaque().slice(0, 8).replace(/[-_]/g, 'A'), 'ACTIVE', req.body.expertRequested && !restricted, t.phone_digest]);
      await recordGrants(sql, memberId, req.body.consents, req.body.expectedPolicyRevision);
      await sql.query(`INSERT INTO kg_membership.notification_preferences(member_id) VALUES($1)`, [memberId]);
      await sql.query(`UPDATE kg_membership.registration_tickets SET consumed_at=now() WHERE ticket_digest=$1`, [t.ticket_digest]);
      return { outcome: 'REGISTERED', session: await issueSession(sql, memberId) };
    });
  });
  app.post<{ Body: { refreshToken: string } }>('/v1/auth/refresh', { schema: body({ refreshToken: tokenSchema }) }, async req => {
    const result = await db.transaction(async sql => {
      const hint = (await sql.query(`SELECT member_id FROM kg_membership.sessions WHERE refresh_digest=$1`, [digest(req.body.refreshToken)])).rows[0];
      if (!hint) return null;
      await sql.query(`SELECT id FROM kg_membership.members WHERE id=$1 FOR UPDATE`, [hint.member_id]);
      const s = (await sql.query(`SELECT s.*,m.withdrawn_at FROM kg_membership.sessions s JOIN kg_membership.members m ON m.id=s.member_id WHERE refresh_digest=$1 FOR UPDATE OF s`, [digest(req.body.refreshToken)])).rows[0];
      if (!s || s.withdrawn_at || !s.refresh_expires_at || new Date(String(s.refresh_expires_at)).getTime() <= Date.now()) return null;
      if (s.revoked_at) { await sql.query(`UPDATE kg_membership.sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1`, [s.family_id]); return null; }
      await sql.query(`UPDATE kg_membership.sessions SET revoked_at=now() WHERE id=$1`, [s.id]);
      return issueSession(sql, s.member_id, s.family_id);
    });
    if (!result) throw new ApiError(401, 'SESSION_INVALID'); return result;
  });
  app.post<{ Body: { consents: { kind: string; version: string }[]; expectedPolicyRevision?: string } }>('/v1/me/consents', { schema: body({ consents: documentInput, expectedPolicyRevision: revisionSchema }, ['consents']) }, async (req, reply) => {
    const auth = await authenticate(req, reply); if (!auth) return;
    return db.transaction(async sql => {
      // Read the original selector/snapshot in a new statement after this SHARE fence.
      await sql.query('LOCK TABLE kg_membership.policy_documents IN SHARE MODE');
      const m = (await sql.query(`SELECT id FROM kg_membership.members WHERE id=$1 AND withdrawn_at IS NULL FOR UPDATE`, [auth.memberId])).rows[0]; if (!m) throw new ApiError(401, 'SESSION_INVALID');
      await recordGrants(sql, auth.memberId, req.body.consents, req.body.expectedPolicyRevision); return { recorded: true };
    });
  });
  app.post<{ Body: { kind: string } }>('/v1/me/consents/withdraw', { schema: body({ kind: { type: 'string', enum: ['TERMS', 'PRIVACY_CONSENT', 'MARKETING'] } }) }, async (req, reply) => {
    const auth = await authenticate(req, reply); if (!auth) return;
    if (req.body.kind !== 'MARKETING') throw new ApiError(409, 'WITHDRAWAL_CONFIRMATION_REQUIRED');
    return db.transaction(async sql => {
      const m = (await sql.query(`SELECT id FROM kg_membership.members WHERE id=$1 AND withdrawn_at IS NULL FOR UPDATE`, [auth.memberId])).rows[0]; if (!m) throw new ApiError(401, 'SESSION_INVALID');
      const last = (await sql.query(`SELECT e.document_id,e.action FROM kg_membership.consent_events e JOIN kg_membership.policy_documents d ON d.id=e.document_id WHERE e.member_id=$1 AND d.kind='MARKETING' ORDER BY e.id DESC LIMIT 1`, [auth.memberId])).rows[0];
      if (last && last.action !== 'WITHDRAWN') await sql.query(`INSERT INTO kg_membership.consent_events(member_id,document_id,action,request_id) VALUES($1,$2,'WITHDRAWN',$3)`, [auth.memberId, last.document_id, randomUUID()]);
      await sql.query(`UPDATE kg_membership.notification_preferences SET advertising=false,version=version+1,updated_at=now() WHERE member_id=$1`, [auth.memberId]);
      return { withdrawn: true };
    });
  });
  app.post<{ Body: { confirmed: boolean } }>('/v1/me/withdraw', { schema: body({ confirmed: { const: true } }) }, async (req, reply) => {
    const auth = await authenticate(req, reply); if (!auth) return;
    return db.transaction(async sql => {
      const m = (await sql.query(`SELECT id FROM kg_membership.members WHERE id=$1 AND withdrawn_at IS NULL FOR UPDATE`, [auth.memberId])).rows[0]; if (!m) throw new ApiError(401, 'SESSION_INVALID');
      const r = await sql.query(`UPDATE kg_membership.members SET status='WITHDRAWN',expert_active=false,withdrawn_at=now(),rejoin_after=now()+interval '30 days',retention_until=now()+interval '1 year' WHERE id=$1 RETURNING withdrawn_at AS "withdrawnAt",rejoin_after AS "rejoinAfter",retention_until AS "retentionUntil"`, [auth.memberId]);
      await sql.query(`UPDATE kg_membership.sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE member_id=$1`, [auth.memberId]);
      await sql.query(`UPDATE kg_membership.notification_preferences SET advertising=false,chat=false,comment=false,quote=false,inquiry=false,version=version+1 WHERE member_id=$1`, [auth.memberId]);
      return { withdrawn: true, ...r.rows[0], previousPrivateDataRestoredOnRejoin: false, rejoinResetsRetentionClock: false };
    });
  });
  app.patch<{ Body: { nickname: string } }>('/v1/me/profile', { schema: body({ nickname: nicknameSchema }) }, async (req, reply) => {
    const auth = await authenticate(req, reply); if (!auth) return;
    if (auth.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_RESTRICTED');
    await requireCurrentConsents(db, auth.memberId);
    const r = await db.query(`UPDATE kg_membership.members SET nickname=$2 WHERE id=$1 AND withdrawn_at IS NULL AND status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM kg_membership.restrictions r WHERE r.principal_id=kg_membership.members.principal_id AND r.revoked_at IS NULL AND r.starts_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now())) RETURNING nickname`, [auth.memberId, req.body.nickname]);
    if (!r.rows[0]) throw new ApiError(403, 'ACCOUNT_RESTRICTED'); return r.rows[0];
  });
  app.post<{ Body: { requested: boolean } }>('/v1/me/expert', { schema: body({ requested: { const: true } }) }, async (req, reply) => {
    const auth = await authenticate(req, reply); if (!auth) return;
    if (auth.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_RESTRICTED');
    await requireCurrentConsents(db, auth.memberId);
    const r = await db.query(`UPDATE kg_membership.members SET expert_active=true WHERE id=$1 AND withdrawn_at IS NULL AND status='ACTIVE' AND length(trim(name))>0 AND length(email)>2 AND phone_digest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM kg_membership.restrictions r WHERE r.principal_id=kg_membership.members.principal_id AND r.revoked_at IS NULL AND r.starts_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now())) RETURNING expert_active AS "expertActive"`, [auth.memberId]);
    if (!r.rows[0]) throw new ApiError(403, 'ACCOUNT_RESTRICTED_OR_PROFILE_INCOMPLETE'); return r.rows[0];
  });
}
