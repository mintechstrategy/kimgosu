import { createHash, createHmac, randomBytes } from 'node:crypto';
export class ApiError extends Error {
  readonly status: number; readonly code: string;
  readonly metadata: { serverTime?: string; retryAfter?: string; retryAfterSeconds?: number; rejoinAfter?: string; attemptsRemaining?: number };
  constructor(status: number, code: string, metadata: ApiError['metadata'] = {}) { super(code); this.status = status; this.code = code; this.metadata = metadata; }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const opaque = () => randomBytes(32).toString('base64url');
export const challenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
export const mac = (key: string, context: string, value: string) => createHmac('sha256', key).update(context + '\0' + value).digest('hex');
export const tokenSchema = { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' };
/**
 * Operator console scope marker.
 *
 * An admin session token is a normal `sessions` row whose bearer string carries
 * this prefix. The prefix is the *only* scope marker: the database schema has no
 * scope column and this work unit was not allocated a migration number, so the
 * scope is carried in the token itself and re-checked against `role_grants` on
 * every request. A member session token is refused on admin routes (403) and an
 * admin token is refused on member routes (401), so the two scopes never mix.
 */
export const ADMIN_SESSION_PREFIX = 'adm_';
export const isAdminSessionToken = (value: string) => value.startsWith(ADMIN_SESSION_PREFIX);
/** Untruncated bearer-token shape: 32+ chars so `adm_` + 43-char opaque fits. */
export const bearerTokenPattern = /^[A-Za-z0-9_-]{32,256}$/;
