/**
 * Operator login client — the pre-session half of the console.
 *
 * It does two jobs, both strictly server-decided:
 *
 *  1. reads `/v1/auth/config` so the login screen can say *honestly* whether a
 *     social provider is connected (no fake "로그인 준비 중" button);
 *  2. lists the dev-only tester accounts and exchanges one for a real member
 *     session, which the console then hands to `POST /v1/admin/session`.
 *
 * Nothing here decides authority: an account that is not an ADMIN is refused by
 * the server with 403 when it tries to open an operator session. No token is
 * stored anywhere but the calling closure's memory.
 */
import { AdminApiError, assertApprovedApiOrigin } from './api.ts';

export type LoginProviderId = 'kakao' | 'naver' | 'google';
export interface LoginProvider { id: LoginProviderId; connected: boolean; reason?: string }
export interface DevAccount { slot: number; role: string; label: string; nickname: string; expertActive: boolean }

const PROVIDERS: LoginProviderId[] = ['kakao', 'naver', 'google'];
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : (() => { throw new AdminApiError(502, 'INVALID_RESPONSE'); })();
const str = (v: unknown): string => typeof v === 'string' ? v : (() => { throw new AdminApiError(502, 'INVALID_RESPONSE'); })();

export function createAdminLoginClient(baseUrl: string, transport: typeof fetch = fetch, timeoutMs = 10000) {
  const origin = assertApprovedApiOrigin(baseUrl);

  async function send(path: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; payload: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json', 'Cache-Control': 'no-store' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await transport(origin.origin + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new AdminApiError(502, 'INVALID_RESPONSE'); }
      return { status: response.status, payload };
    } catch (e) {
      if (e instanceof AdminApiError) throw e;
      throw new AdminApiError(0, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }

  return {
    /** Which social logins the server can actually complete right now. */
    async providers(): Promise<LoginProvider[]> {
      const { status, payload } = await send('/v1/auth/config', 'GET');
      if (status !== 200) throw new AdminApiError(status, 'CONFIG_UNAVAILABLE');
      const rows = obj(payload).providers;
      if (!Array.isArray(rows)) throw new AdminApiError(502, 'INVALID_RESPONSE');
      const byId = new Map<string, LoginProvider>();
      for (const row of rows) {
        const d = obj(row);
        const id = str(d.id);
        if (!(PROVIDERS as string[]).includes(id)) continue;
        byId.set(id, { id: id as LoginProviderId, connected: d.enabled === true, ...(typeof d.reason === 'string' ? { reason: d.reason } : {}) });
      }
      // A provider the server did not mention is not connected; never assume.
      return PROVIDERS.map(id => byId.get(id) ?? { id, connected: false, reason: 'PROVIDER_INTEGRATION_NOT_CONNECTED' });
    },

    /** Dev-only tester accounts. Returns [] when the deployment does not expose them. */
    async devAccounts(): Promise<DevAccount[]> {
      const { status, payload } = await send('/v1/auth/dev/accounts', 'GET');
      if (status === 404) return [];
      if (status !== 200) throw new AdminApiError(status, 'DEV_ACCOUNTS_UNAVAILABLE');
      const rows = obj(payload).accounts;
      if (!Array.isArray(rows)) throw new AdminApiError(502, 'INVALID_RESPONSE');
      return rows.map(row => {
        const d = obj(row);
        if (!Number.isSafeInteger(d.slot) || (d.slot as number) < 1) throw new AdminApiError(502, 'INVALID_RESPONSE');
        return {
          slot: d.slot as number,
          role: str(d.role),
          label: str(d.label),
          nickname: str(d.nickname),
          expertActive: d.expertActive === true,
        };
      });
    },

    /** Tester login: a real member session issued by the server for one seeded account. */
    async devLogin(slot: number): Promise<string> {
      // Slots run to 30 (migration 017); 21 is the seeded ADMIN account, the only
      // slot that can open an operator session.
      if (!Number.isSafeInteger(slot) || slot < 1 || slot > 30) throw new AdminApiError(400, 'INVALID_REQUEST');
      const { status, payload } = await send('/v1/auth/dev/login', 'POST', { slot });
      if (status !== 200) {
        const code = status === 429 ? 'AUTH_RATE_LIMITED' : status === 404 ? 'DEV_ACCOUNT_NOT_FOUND' : 'LOGIN_FAILED';
        throw new AdminApiError(status, code);
      }
      const session = obj(obj(payload).session);
      const token = str(session.accessToken);
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new AdminApiError(502, 'INVALID_RESPONSE');
      return token;
    },
  };
}
export type AdminLoginClient = ReturnType<typeof createAdminLoginClient>;
