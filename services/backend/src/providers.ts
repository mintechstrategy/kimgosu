import { createPublicKey, verify } from 'node:crypto';
import { ApiError } from './security.ts';
export type ProviderId = 'google' | 'kakao' | 'naver' | 'apple';
export interface ProviderIdentity { subject: string; name?: string; email?: string }
export interface OAuthProvider {
  authorize(state: string, codeChallenge: string): string;
  exchange(code: string, state: string, verifier: string): Promise<ProviderIdentity>;
}
export interface SmsDelivery { send(phone: string, code: string): Promise<void> }
export interface AuthOptions {
  providers?: Partial<Record<ProviderId, OAuthProvider>>;
  sms?: SmsDelivery;
  identityKey?: string;
  corsOrigins?: string[];
  // Temporary login for testers while no social provider is connected.
  // Only ever enabled on the dev deployment; server.ts gates it on the
  // Railway environment name so a production boot cannot expose it.
  devLogin?: boolean;
}
interface Endpoint { authorize: string; token: string; scope: string; jwks?: string; issuer?: string }
const endpoints: Record<ProviderId, Endpoint> = {
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuer: 'https://accounts.google.com', scope: 'openid email profile' },
  kakao: { authorize: 'https://kauth.kakao.com/oauth/authorize', token: 'https://kauth.kakao.com/oauth/token', scope: 'profile_nickname account_email' },
  naver: { authorize: 'https://nid.naver.com/oauth2.0/authorize', token: 'https://nid.naver.com/oauth2.0/token', scope: '' },
  apple: { authorize: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token', jwks: 'https://appleid.apple.com/auth/keys', issuer: 'https://appleid.apple.com', scope: 'name email' },
};
async function jsonRequest(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(7000), redirect: 'error' });
    if (!r.ok || Number(r.headers.get('content-length') ?? 0) > 65536) throw new Error();
    const text = await r.text(); if (text.length > 65536) throw new Error();
    // Kakao's service user ID is an integer64. Preserve it as text before JSON number rounding.
    const json: unknown = JSON.parse(text.replace(/("id"\s*:\s*)([0-9]+)(?=\s*[,}])/g, '$1"$2"')); if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error();
    return json as Record<string, unknown>;
  } catch { throw new ApiError(502, 'PROVIDER_UNAVAILABLE'); }
}
// RS256 id_token verification against the provider's published JWKS. Used by
// Google and Apple, which both return an OpenID Connect id_token.
async function idTokenClaims(idToken: string, endpoint: { jwks: string; issuer: string }, clientId: string, nonce: string) {
  try {
    const parts = idToken.split('.'); if (parts.length !== 3) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error();
    const jwks = await jsonRequest(endpoint.jwks);
    const key = (jwks.keys as JsonWebKey[]).find(k => (k as JsonWebKey & { kid?: string }).kid === header.kid && k.kty === 'RSA');
    if (!key || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key: key as import('node:crypto').JsonWebKey, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error();
    const now = Date.now() / 1000;
    const issuers = endpoint.issuer === 'https://accounts.google.com' ? ['accounts.google.com', 'https://accounts.google.com'] : [endpoint.issuer];
    if (!issuers.includes(claims.iss) || claims.aud !== clientId || (claims.azp !== undefined && claims.azp !== clientId) || claims.nonce !== nonce || typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.iat !== 'number' || claims.iat > now + 60 || typeof claims.sub !== 'string' || !claims.sub) throw new Error();
    return { subject: String(claims.sub), email: typeof claims.email === 'string' ? claims.email : undefined };
  } catch { throw new ApiError(401, 'SOCIAL_AUTH_FAILED'); }
}
const optionalString = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
// Enabled only by explicit runtime opt-in AND complete configuration. No fake provider success.
export function configuredProviders(env: NodeJS.ProcessEnv): Partial<Record<ProviderId, OAuthProvider>> {
  const result: Partial<Record<ProviderId, OAuthProvider>> = {};
  for (const id of ['google', 'kakao', 'naver', 'apple'] as const) {
    const prefix = 'KG_OAUTH_' + id.toUpperCase();
    const clientId = env[prefix + '_CLIENT_ID']; const secret = env[prefix + '_CLIENT_SECRET']; const redirect = env[prefix + '_REDIRECT_URI'];
    if (env[prefix + '_ENABLED'] !== 'true' || !clientId || !secret || !redirect) continue;
    let uri: URL; try { uri = new URL(redirect); } catch { continue; }
    if (uri.protocol !== 'https:' || uri.hostname !== 'dev-kimgosu.mintech.ai' || uri.username || uri.password || uri.hash) continue;
    result[id] = realProvider(id, clientId, secret, redirect);
  }
  return result;
}
export function realProvider(id: ProviderId, clientId: string, clientSecret: string, redirectUri: string): OAuthProvider {
  const endpoint = endpoints[id];
  return {
    authorize(state, codeChallenge) {
      const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state });
      if (endpoint.scope) q.set('scope', endpoint.scope);
      if (id === 'google') { q.set('nonce', state); q.set('code_challenge', codeChallenge); q.set('code_challenge_method', 'S256'); }
      // Apple has no PKCE support for the authorization-code flow and requires
      // form_post so the code never lands in a browser history URL.
      if (id === 'apple') { q.set('nonce', state); q.set('response_mode', 'form_post'); }
      return endpoint.authorize + '?' + q;
    },
    async exchange(code, state, verifier) {
      const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
      if (id === 'google') body.set('code_verifier', verifier);
      if (id === 'naver') body.set('state', state);
      const token = await jsonRequest(endpoint.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (typeof token.access_token !== 'string' || token.error) throw new ApiError(401, 'SOCIAL_AUTH_FAILED');
      if (id === 'google' || id === 'apple') {
        if (typeof token.id_token !== 'string') throw new ApiError(401, 'SOCIAL_AUTH_FAILED');
        const claims = await idTokenClaims(token.id_token, { jwks: endpoint.jwks!, issuer: endpoint.issuer! }, clientId, state);
        // Apple only returns the display name on first authorization; it is
        // never part of the id_token, so absence is normal and not guessed.
        return { subject: claims.subject, email: claims.email };
      }
      const profile = await jsonRequest(id === 'kakao' ? 'https://kapi.kakao.com/v2/user/me' : 'https://openapi.naver.com/v1/nid/me', { headers: { Authorization: 'Bearer ' + token.access_token } });
      const subject = id === 'kakao' ? profile.id : (profile.response as Record<string, unknown> | undefined)?.id;
      if ((id === 'naver' && profile.resultcode !== '00') || !['string', 'number'].includes(typeof subject) || !String(subject)) throw new ApiError(401, 'SOCIAL_AUTH_FAILED');
      if (id === 'kakao') {
        const account = (profile.kakao_account ?? {}) as Record<string, unknown>;
        const kakaoProfile = (account.profile ?? {}) as Record<string, unknown>;
        return { subject: String(subject), name: optionalString(kakaoProfile.nickname), email: optionalString(account.email) };
      }
      const response = (profile.response ?? {}) as Record<string, unknown>;
      return { subject: String(subject), name: optionalString(response.nickname), email: optionalString(response.email) };
    },
  };
}
