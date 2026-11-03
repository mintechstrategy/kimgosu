// Apple 로그인 — form_post 콜백.
//
//   POST /v1/auth/oauth/apple/callback
//
// Apple 은 response_mode=form_post 로 code/id_token/state/user 를
// application/x-www-form-urlencoded 본문에 담아 POST 한다. GET 콜백(kakao/naver)과
// 달리 인가 코드를 토큰 엔드포인트와 교환하지 않고, Apple 이 서명한 id_token 을
// 직접 검증한다.
//
// 규칙
// - 서명 검증을 생략하지 않는다. Apple 공개키(JWKS)로 RS256 서명을 확인한다.
// - iss/aud/exp/nonce(sub=state) 를 모두 확인한다.
// - JWKS 조회 실패는 401 이 아니라 503 으로 구분한다(우리 쪽/공급자 일시 장애).
// - state 는 1회용이며 재사용·만료는 400 OAUTH_STATE_INVALID 다.
// - `user` 는 최초 인가에서만 오는 JSON 문자열이다. 없으면 id_token 클레임만 쓴다.
// - id_token/state/user/토큰 원문은 로그·오류 메시지·응답에 남기지 않는다.
import type { FastifyInstance } from 'fastify';
import { createPublicKey, verify } from 'node:crypto';
import type { Sql } from './app.ts';
import type { AuthOptions, ProviderIdentity } from './providers.ts';
import { ApiError, tokenSchema } from './security.ts';
import { consumeOAuthState, resolveOAuthMember } from './oauth.ts';

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';
const MAX_JWKS_BYTES = 65536;

const bodySchema = {
  type: 'object',
  required: ['id_token', 'state'],
  additionalProperties: false,
  properties: {
    id_token: { type: 'string', minLength: 1, maxLength: 8192 },
    state: tokenSchema,
    // 최초 로그인에만 존재하는 JSON 문자열(이름). 이후 로그인에는 오지 않는다.
    user: { type: 'string', minLength: 1, maxLength: 4096 },
    // Apple 이 함께 보내는 인가 코드. id_token 을 직접 검증하므로 사용하지 않는다.
    code: { type: 'string', minLength: 1, maxLength: 4096 },
  },
};

interface AppleClaims { subject: string; email?: string; name?: string }

export function registerAppleRoutes(app: FastifyInstance, db: Sql, options: AuthOptions) {
  app.post<{ Body: { id_token: string; state: string; user?: string; code?: string } }>('/v1/auth/oauth/apple/callback', {
    schema: { body: bodySchema },
  }, async (req) => {
    const provider = options.providers?.apple;
    if (!provider) throw new ApiError(503, 'PROVIDER_NOT_CONFIGURED');
    if (!options.identityKey || options.identityKey.length < 32) throw new ApiError(503, 'IDENTITY_CONFIGURATION_REQUIRED');
    if (!provider.clientId) throw new ApiError(503, 'PROVIDER_NOT_CONFIGURED');

    const { id_token: idToken, state, user } = req.body;
    // state 부터 1회용으로 소비한다. 재사용·만료·타 provider state 는 400 이다.
    if (!await consumeOAuthState(db, 'apple', state)) throw new ApiError(400, 'OAUTH_STATE_INVALID');

    const claims = await verifyAppleIdToken(idToken, state, {
      clientId: provider.clientId,
      jwksUrl: provider.jwksUrl ?? APPLE_JWKS_URL,
      issuer: provider.issuer ?? APPLE_ISSUER,
    });

    const identity: ProviderIdentity = {
      subject: claims.subject,
      email: claims.email,
      // user(최초 로그인)가 있으면 그 이름을, 없으면 id_token 클레임을 쓴다.
      name: parseAppleUserName(user) ?? claims.name,
    };
    // Apple 은 id_token 에 이름을 넣지 않는다. user 도 없으면 이름을 추측해 만들지
    // 않고 이메일 지역부만 표시명으로 쓴다(없으면 아래에서 409 PROFILE_INCOMPLETE).
    if (!identity.name && identity.email) identity.name = nameFromEmail(identity.email);

    return resolveOAuthMember(db, 'apple', identity, options.identityKey);
  });
}

/** Apple form_post 의 `user` 필드에서 표시명을 뽑는다. 형식이 깨졌으면 400. */
function parseAppleUserName(user: string | undefined): string | undefined {
  if (!user) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(user); } catch { throw new ApiError(400, 'INVALID_REQUEST'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError(400, 'INVALID_REQUEST');
  const name = (parsed as { name?: unknown }).name;
  if (!name || typeof name !== 'object' || Array.isArray(name)) return undefined;
  const { firstName, lastName } = name as { firstName?: unknown; lastName?: unknown };
  const parts = [firstName, lastName].filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean);
  const joined = parts.join(' ').trim();
  return joined ? joined.slice(0, 100) : undefined;
}

/** 이메일 지역부를 표시명으로 쓴다(추측 생성이 아니라 입력값의 부분 사용). */
function nameFromEmail(email: string): string | undefined {
  const local = email.split('@')[0]?.trim();
  return local ? local.slice(0, 100) : undefined;
}

/**
 * Apple id_token(RS256 JWT) 검증.
 * 서명 실패·클레임 불일치는 401, JWKS 조회 실패는 503 이다.
 */
export async function verifyAppleIdToken(
  idToken: string,
  nonce: string,
  config: { clientId: string; jwksUrl?: string; issuer?: string },
): Promise<AppleClaims> {
  const jwksUrl = config.jwksUrl ?? APPLE_JWKS_URL;
  const issuer = config.issuer ?? APPLE_ISSUER;
  assertSafeJwksUrl(jwksUrl);

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new ApiError(401, 'SOCIAL_AUTH_FAILED');
  let header: { alg?: unknown; kid?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch { throw new ApiError(401, 'SOCIAL_AUTH_FAILED'); }
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new ApiError(401, 'SOCIAL_AUTH_FAILED');

  const jwks = await fetchJwks(jwksUrl);
  const key = (jwks.keys as JsonWebKey[]).find(k => (k as JsonWebKey & { kid?: string }).kid === header.kid && k.kty === 'RSA');
  if (!key) throw new ApiError(401, 'SOCIAL_AUTH_FAILED');

  let signatureOk = false;
  try {
    signatureOk = verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]),
      createPublicKey({ key: key as import('node:crypto').JsonWebKey, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  } catch { signatureOk = false; }
  if (!signatureOk) throw new ApiError(401, 'SOCIAL_AUTH_FAILED');

  const now = Date.now() / 1000;
  const aud = claims.aud;
  const audienceOk = aud === config.clientId || (Array.isArray(aud) && aud.includes(config.clientId));
  const azpOk = claims.azp === undefined || claims.azp === config.clientId;
  const expOk = typeof claims.exp === 'number' && claims.exp > now;
  const iatOk = typeof claims.iat === 'number' && claims.iat <= now + 60;
  const subOk = typeof claims.sub === 'string' && claims.sub.length > 0;
  if (claims.iss !== issuer || !audienceOk || !azpOk || !expOk || !iatOk || !subOk) throw new ApiError(401, 'SOCIAL_AUTH_FAILED');
  if (claims.nonce !== nonce) throw new ApiError(401, 'SOCIAL_AUTH_FAILED');

  const email = typeof claims.email === 'string' && claims.email.trim() ? claims.email.trim() : undefined;
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : undefined;
  return { subject: String(claims.sub), email, name };
}

/** JWKS 는 https 만, 테스트 편의를 위해 루프백 http 만 예외로 허용한다. */
function assertSafeJwksUrl(raw: string): void {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiError(503, 'APPLE_JWKS_UNAVAILABLE'); }
  if (url.username || url.password || url.hash) throw new ApiError(503, 'APPLE_JWKS_UNAVAILABLE');
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return;
  throw new ApiError(503, 'APPLE_JWKS_UNAVAILABLE');
}

/** JWKS 조회 실패(네트워크·비200·비JSON·과대 응답)는 503 이다. */
async function fetchJwks(url: string): Promise<{ keys: JsonWebKey[] }> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: 'error', headers: { accept: 'application/json' } });
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (!response.ok || declared > MAX_JWKS_BYTES) throw new Error();
    text = await response.text();
    if (text.length > MAX_JWKS_BYTES) throw new Error();
  } catch { throw new ApiError(503, 'APPLE_JWKS_UNAVAILABLE'); }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ApiError(503, 'APPLE_JWKS_UNAVAILABLE'); }
  const keys = (parsed as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys) || keys.length === 0) throw new ApiError(503, 'APPLE_JWKS_UNAVAILABLE');
  return { keys: keys as JsonWebKey[] };
}
