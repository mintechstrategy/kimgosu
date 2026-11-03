// 정식 소셜 로그인 (kakao / naver / apple) — authorization-code 흐름.
//
// 기존 /v1/auth/social/* 는 v0.2 계약으로 동결되어 있고, 이 파일은 WS-11이
// 추가한 정식 경로다:
//   POST /v1/auth/oauth/:provider/start     → state 발급·저장 + 인가 URL
//   GET  /v1/auth/oauth/:provider/callback  → code 교환 → 회원 조회/생성 → 세션
//
// 규칙
// - state는 1회용, TTL 10분. 콜백에서 소비한 뒤 재사용할 수 없다.
// - 같은 (provider, providerUserId) 는 하나의 회원이다. 동일인이라도 SNS
//   계정이 다르면 별도 회원(별도 customer_no)으로 취급한다.
// - 자격증명이 없는 provider는 start에서 503으로 거부한다. flow를 만들지 않는다.
// - code/token/state 원문은 로그·응답 오류 메시지에 남기지 않는다.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Sql } from './app.ts';
import type { AuthOptions, ProviderId, ProviderIdentity } from './providers.ts';
import { ApiError, challenge, digest, mac, opaque, tokenSchema } from './security.ts';
import { issueSession } from './auth.ts';

export const OAUTH_PROVIDERS = ['kakao', 'naver', 'apple'] as const;
type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];
/** PLAN 확정값: state TTL 10분. */
export const OAUTH_STATE_TTL_SECONDS = 600;

const paramsSchema = {
  type: 'object', required: ['provider'], additionalProperties: false,
  properties: { provider: { type: 'string', enum: [...OAUTH_PROVIDERS] } },
};
const querySchema = {
  type: 'object', required: ['state'], additionalProperties: false,
  properties: {
    state: tokenSchema,
    code: { type: 'string', minLength: 1, maxLength: 4096 },
    error: { type: 'string', minLength: 1, maxLength: 200 },
  },
};
/** 기존 members.nickname CHECK(1~10자)를 만족하는 기본 닉네임. */
const defaultNickname = () => '고수' + opaque().slice(0, 8).replace(/[-_]/g, 'A');

export function registerOAuthRoutes(app: FastifyInstance, db: Sql, options: AuthOptions) {
  const configured = options.providers ?? {};
  const identityKey = () => {
    if (!options.identityKey || options.identityKey.length < 32) throw new ApiError(503, 'IDENTITY_CONFIGURATION_REQUIRED');
    return options.identityKey;
  };
  const providerOf = (id: string): ProviderId => id as ProviderId;

  app.post<{ Params: { provider: OAuthProviderId } }>('/v1/auth/oauth/:provider/start', {
    schema: { params: paramsSchema },
  }, async (req) => {
    const provider = providerOf(req.params.provider);
    if (!configured[provider]) throw new ApiError(503, 'PROVIDER_NOT_CONFIGURED');
    identityKey();
    const state = opaque();
    // kakao/naver/apple authorization-code 흐름은 PKCE를 쓰지 않는다. 기존
    // oauth_flows.code_challenge는 NOT NULL이므로 검증에 쓰이지 않는 난수
    // placeholder를 저장한다. (PKCE는 /v1/auth/social/start 전용 계약)
    const codeChallenge = challenge(opaque());
    try {
      await db.query(`INSERT INTO kg_membership.oauth_flows(state_digest,provider,code_challenge,expires_at)
        VALUES($1,$2,$3,now()+ ($4::text || ' seconds')::interval)`,
        [digest(state), provider, codeChallenge, String(OAUTH_STATE_TTL_SECONDS)]);
    } catch (error) {
      // 스키마가 아직 해당 provider를 허용하지 않으면 500이 아니라 원인을 밝힌 503으로 거부한다.
      if (isProviderCheckViolation(error)) throw new ApiError(503, 'PROVIDER_SCHEMA_PENDING');
      throw error;
    }
    return {
      provider,
      authorizationUrl: configured[provider]!.authorize(state, codeChallenge),
      state,
      expiresInSeconds: OAUTH_STATE_TTL_SECONDS,
    };
  });

  app.get<{ Params: { provider: OAuthProviderId }; Querystring: { state: string; code?: string; error?: string } }>('/v1/auth/oauth/:provider/callback', { schema: { params: paramsSchema, querystring: querySchema } }, async (req) => {
      const provider = providerOf(req.params.provider);
      const { state, code, error: providerError } = req.query;
      // 잘못된 콜백으로 state를 태우지 않도록 code/error 유무를 먼저 확인한다.
      if (!code && !providerError) throw new ApiError(400, 'INVALID_REQUEST');
      if (!configured[provider]) throw new ApiError(503, 'PROVIDER_NOT_CONFIGURED');
      const key = identityKey();

      // 1회용 소비: 같은 state로 두 번 들어와도 두 번째는 아무 행도 받지 못한다.
      // provider 조건을 함께 걸어 다른 provider의 state는 소비되지 않는다.
      if (!await consumeOAuthState(db, provider, state)) throw new ApiError(401, 'OAUTH_STATE_INVALID');
      if (providerError) throw new ApiError(401, 'SOCIAL_AUTH_CANCELLED');

      const identity = await configured[provider]!.exchange(code!, state, '');
      return resolveOAuthMember(db, provider, identity, key);
    });
}

/** state를 1회용으로 소비한다. 소비에 성공하면 true, 재사용/만료/타 provider면 false. */
export async function consumeOAuthState(db: Sql, provider: ProviderId, state: string): Promise<boolean> {
  const consumed = await db.query(`UPDATE kg_membership.oauth_flows SET consumed_at=now()
    WHERE state_digest=$1 AND provider=$2 AND expires_at>now() AND consumed_at IS NULL
    RETURNING state_digest,link_member_id`, [digest(state), provider]);
  return Boolean(consumed.rows[0]);
}

/**
 * 검증된 소셜 신원으로 회원을 조회하거나 새로 만든 뒤 세션을 발급한다.
 * GET 콜백(kakao/naver)과 Apple POST 콜백이 같은 규칙을 공유한다.
 */
export async function resolveOAuthMember(db: Sql, provider: ProviderId, identity: ProviderIdentity, key: string) {
  const subjectDigest = mac(key, 'social:' + provider, identity.subject);
  return db.transaction(async sql => {
    await sql.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [provider + ':' + subjectDigest]);

    const existing = (await sql.query(`SELECT m.id,m.customer_no::text AS "customerNumber",m.status,
        CASE WHEN EXISTS(SELECT 1 FROM kg_membership.restrictions r WHERE r.principal_id=m.principal_id
          AND r.revoked_at IS NULL AND r.starts_at<=now() AND (r.ends_at IS NULL OR r.ends_at>now()))
          THEN 'RESTRICTED' ELSE m.status END AS "effectiveStatus"
      FROM kg_membership.social_links l JOIN kg_membership.members m ON m.principal_id=l.principal_id
      WHERE l.provider=$1 AND l.subject_digest=$2 AND m.withdrawn_at IS NULL FOR UPDATE OF m`,
      [provider, subjectDigest])).rows[0];
    if (existing) {
      // 재로그인: 새 회원을 만들지 않고 기존 회원에 세션만 발급한다.
      return oauthResult('AUTHENTICATED', provider, existing.id, existing.customerNumber, existing.effectiveStatus,
        await issueSession(sql, existing.id));
    }

    let principalId = (await sql.query(`SELECT principal_id FROM kg_membership.social_links WHERE provider=$1 AND subject_digest=$2`,
      [provider, subjectDigest])).rows[0]?.principal_id as string | undefined;
    if (!principalId) {
      principalId = randomUUID();
      await sql.query(`INSERT INTO kg_membership.principals(id) VALUES($1)`, [principalId]);
      try {
        await sql.query(`INSERT INTO kg_membership.social_links(provider,subject_digest,principal_id) VALUES($1,$2,$3)`,
          [provider, subjectDigest, principalId]);
      } catch (linkError) {
        if (isProviderCheckViolation(linkError)) throw new ApiError(503, 'PROVIDER_SCHEMA_PENDING');
        throw linkError;
      }
    } else {
      await sql.query(`SELECT id FROM kg_membership.principals WHERE id=$1 FOR UPDATE`, [principalId]);
      const withdrawn = (await sql.query(`SELECT rejoin_after>now() AS waiting,rejoin_after AS "rejoinAfter",now() AS "serverTime"
        FROM kg_membership.members WHERE principal_id=$1 AND withdrawn_at IS NOT NULL ORDER BY withdrawn_at DESC LIMIT 1`,
        [principalId])).rows[0];
      if (withdrawn?.waiting) {
        throw new ApiError(409, 'REJOIN_WAIT_REQUIRED', {
          rejoinAfter: new Date(String(withdrawn.rejoinAfter)).toISOString(),
          serverTime: new Date(String(withdrawn.serverTime)).toISOString(),
        });
      }
    }

    // 프로필이 없으면 회원 행을 만들 수 없다. 추측으로 채우지 않고 필요한
    // 항목만 알려 거부한다.
    const name = identity.name?.trim(); const email = identity.email?.trim();
    if (!name || !email || name.length > 100 || email.length < 3 || email.length > 254) {
      throw new ApiError(409, 'PROFILE_INCOMPLETE');
    }
    const memberId = randomUUID();
    await sql.query(`INSERT INTO kg_membership.members(id,principal_id,name,email,nickname,status,expert_active)
      VALUES($1,$2,$3,$4,$5,'ACTIVE',false)`, [memberId, principalId, name, email, defaultNickname()]);
    await sql.query(`INSERT INTO kg_membership.notification_preferences(member_id) VALUES($1)`, [memberId]);
    const created = (await sql.query(`SELECT customer_no::text AS "customerNumber" FROM kg_membership.members WHERE id=$1`,
      [memberId])).rows[0];
    return oauthResult('REGISTERED', provider, memberId, created.customerNumber, 'ACTIVE',
      await issueSession(sql, memberId));
  });
}

function oauthResult(outcome: 'AUTHENTICATED' | 'REGISTERED', provider: ProviderId, memberId: unknown, customerNumber: unknown, status: unknown, session: unknown) {
  return {
    outcome,
    provider,
    member: { id: String(memberId), customerNumber: String(customerNumber), status: String(status) },
    session: session as { accessToken: string; refreshToken: string; tokenType: string; expiresInSeconds: number },
  };
}

/** oauth_flows/social_links 의 provider CHECK 제약 위반(23514)만 식별한다. */
function isProviderCheckViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, constraint } = error as { code?: string; constraint?: string };
  return code === '23514' && (constraint === 'oauth_flows_provider_check' || constraint === 'social_links_provider_check');
}
