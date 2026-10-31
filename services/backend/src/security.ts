import { createHash, createHmac, randomBytes } from 'node:crypto';
export class ApiError extends Error {
  readonly status: number; readonly code: string;
  readonly metadata: { serverTime?: string; retryAfter?: string; retryAfterSeconds?: number; rejoinAfter?: string };
  constructor(status: number, code: string, metadata: ApiError['metadata'] = {}) { super(code); this.status = status; this.code = code; this.metadata = metadata; }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const opaque = () => randomBytes(32).toString('base64url');
export const challenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
export const mac = (key: string, context: string, value: string) => createHmac('sha256', key).update(context + '\0' + value).digest('hex');
export const tokenSchema = { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' };
