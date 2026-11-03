/**
 * Admin console API client.
 *
 * The bearer token is held in this closure only. It is never written to
 * localStorage, sessionStorage, cookies, the URL or a log. A console reload
 * therefore requires re-entering the token.
 */

export type MemberStatus = 'ACTIVE' | 'RESTRICTED' | 'WITHDRAWN';

export interface AdminMemberRow {
  id: string; customerNumber: string; name: string; nickname: string;
  emailMasked: string | null; phoneMasked: string | null; status: MemberStatus;
  expertActive: boolean; createdAt: string; withdrawnAt: string | null;
}
export interface AdminMemberDetailRow extends AdminMemberRow {
  email: string | null; rejoinAfter: string | null; retentionUntil: string | null;
}
export interface MemberPage { page: number; limit: number; total: number; totalPages: number; members: AdminMemberRow[] }
export interface RestrictionRow { id: string; reason: string; startsAt: string; endsAt: string | null; revokedAt: string | null; active: boolean; releaseReason?: string | null }
export interface ConsentRow { kind: string; title: string; version: string; status: 'GRANTED' | 'WITHDRAWN'; recordedAt: string }
export interface LedgerRow {
  id: string; displayName: string | null; createdAt: string; updatedAt: string;
  role: 'EXPERT' | 'CUSTOMER'; counterpartId: string; counterpartNickname: string;
  counterpartNumber: string; agreementCount: number; completedAgreements: number;
}
export interface RoleRow { id: string; role: string; reason: string; startsAt: string; endsAt: string | null; revokedAt: string | null }
export interface MemberDetail { member: AdminMemberDetailRow; restrictions: RestrictionRow[]; consents: ConsentRow[]; ledgers: LedgerRow[]; roles: RoleRow[] }

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.name = 'AdminApiError'; this.status = status; this.code = code; }
}

const invalid = (): never => { throw new AdminApiError(502, 'INVALID_RESPONSE'); };
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const str = (v: unknown): string => typeof v === 'string' ? v : invalid();
const nullable = (v: unknown): string | null => v === null ? null : str(v);
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : invalid();
const count = (v: unknown): number => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : invalid();

export const ADMIN_ERROR_CODES = [
  'ADMIN_REQUIRED', 'AUTH_REQUIRED', 'SESSION_INVALID', 'MEMBER_NOT_FOUND', 'MEMBER_WITHDRAWN',
  'ALREADY_RESTRICTED', 'NOT_RESTRICTED', 'INVALID_REQUEST', 'ROUTE_NOT_FOUND',
] as const;

export function createAdminApi(baseUrl: string, transport: typeof fetch = fetch, timeoutMs = 10000) {
  const origin = new URL(baseUrl);
  if (origin.origin !== 'https://api-dev-kimgosu.mintech.ai' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname))) {
    throw new Error('UNAPPROVED_API_ORIGIN');
  }
  if (origin.pathname !== '/' || origin.search || origin.hash) throw new Error('INVALID_API_BASE');

  let session: string | undefined;
  const setToken = (value: string) => { if (!/^[A-Za-z0-9_-]{32,256}$/.test(value)) throw new AdminApiError(400, 'INVALID_TOKEN'); session = value; };
  const clearToken = () => { session = undefined; };

  async function request(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<unknown> {
    if (!session) throw new AdminApiError(401, 'AUTH_REQUIRED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json', 'Cache-Control': 'no-store', Authorization: `Bearer ${session}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await transport(origin.origin + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new AdminApiError(502, 'INVALID_RESPONSE'); }
      if (!response.ok) {
        const envelope = obj(payload).error;
        const code = envelope && typeof envelope === 'object' ? str((envelope as Record<string, unknown>).code) : invalid();
        throw new AdminApiError(response.status, (ADMIN_ERROR_CODES as readonly string[]).includes(code) ? code : 'REQUEST_FAILED');
      }
      return payload;
    } catch (e) {
      if (e instanceof AdminApiError) throw e;
      throw new AdminApiError(0, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }

  const readRow = (value: unknown): AdminMemberRow => {
    const d = obj(value);
    const status = str(d.status);
    if (!['ACTIVE', 'RESTRICTED', 'WITHDRAWN'].includes(status)) return invalid();
    return {
      id: str(d.id), customerNumber: str(d.customerNumber), name: str(d.name), nickname: str(d.nickname),
      emailMasked: nullable(d.emailMasked), phoneMasked: nullable(d.phoneMasked), status: status as MemberStatus,
      expertActive: d.expertActive === true, createdAt: str(d.createdAt), withdrawnAt: nullable(d.withdrawnAt),
    };
  };
  const readDetailRow = (value: unknown): AdminMemberDetailRow => {
    const base = readRow(value); const d = obj(value);
    return { ...base, email: nullable(d.email), rejoinAfter: nullable(d.rejoinAfter), retentionUntil: nullable(d.retentionUntil) };
  };
  const readRestriction = (value: unknown): RestrictionRow => {
    const d = obj(value);
    return { id: str(d.id), reason: str(d.reason), startsAt: str(d.startsAt), endsAt: nullable(d.endsAt), revokedAt: nullable(d.revokedAt), active: d.active === true, releaseReason: nullable(d.releaseReason ?? null) };
  };

  return {
    setToken, clearToken,
    hasToken: () => session !== undefined,
    async members(params: { query?: string; status?: MemberStatus | ''; page?: number; limit?: number }): Promise<MemberPage> {
      const search = new URLSearchParams();
      if (params.query?.trim()) search.set('query', params.query.trim());
      if (params.status) search.set('status', params.status);
      search.set('page', String(params.page ?? 1));
      search.set('limit', String(params.limit ?? 20));
      const d = obj(await request('/v1/admin/members?' + search.toString()));
      return { page: count(d.page), limit: count(d.limit), total: count(d.total), totalPages: count(d.totalPages), members: list(d.members).map(v => readRow(v)) };
    },
    async member(id: string): Promise<MemberDetail> {
      const d = obj(await request('/v1/admin/members/' + encodeURIComponent(id)));
      return {
        member: readDetailRow(d.member),
        restrictions: list(d.restrictions).map(readRestriction),
        consents: list(d.consents).map(v => { const c = obj(v); const s = str(c.status); if (!['GRANTED', 'WITHDRAWN'].includes(s)) return invalid(); return { kind: str(c.kind), title: str(c.title), version: str(c.version), status: s as 'GRANTED' | 'WITHDRAWN', recordedAt: str(c.recordedAt) }; }),
        ledgers: list(d.ledgers).map(v => { const l = obj(v); return { id: str(l.id), displayName: nullable(l.displayName), createdAt: str(l.createdAt), updatedAt: str(l.updatedAt), role: l.role === 'EXPERT' ? 'EXPERT' as const : 'CUSTOMER' as const, counterpartId: str(l.counterpartId), counterpartNickname: str(l.counterpartNickname), counterpartNumber: str(l.counterpartNumber), agreementCount: count(l.agreementCount), completedAgreements: count(l.completedAgreements) }; }),
        roles: list(d.roles).map(v => { const r = obj(v); return { id: str(r.id), role: str(r.role), reason: str(r.reason), startsAt: str(r.startsAt), endsAt: nullable(r.endsAt), revokedAt: nullable(r.revokedAt) }; }),
      };
    },
    async restrict(id: string, input: { reason: string; endsAt?: string }): Promise<RestrictionRow> {
      const payload: Record<string, string> = { reason: input.reason };
      if (input.endsAt) payload.endsAt = input.endsAt;
      const d = obj(await request('/v1/admin/members/' + encodeURIComponent(id) + '/restrict', 'POST', payload));
      return readRestriction(d);
    },
    async release(id: string, reason: string): Promise<{ released: boolean; restrictionId: string; revokedAt: string }> {
      const d = obj(await request('/v1/admin/members/' + encodeURIComponent(id) + '/release', 'POST', { reason }));
      if (d.released !== true) return invalid();
      return { released: true, restrictionId: str(d.restrictionId), revokedAt: str(d.revokedAt) };
    },
  };
}
export type AdminApi = ReturnType<typeof createAdminApi>;
