/**
 * Admin console API client.
 *
 * The operator token is held in this closure only. It is never written to
 * localStorage, sessionStorage, cookies, the URL or a log. A console reload
 * therefore returns to the login screen.
 *
 * The console never accepts a pasted server token from a human: `login()` sends
 * the member session obtained through a real login to `POST /v1/admin/session`
 * and only keeps the operator-scope token the server mints for an ADMIN.
 */

import {
  adminMember, adminMemberRelease, adminMemberRestrict, adminMembers,
  adminReviewHide, adminReviewList, adminReviewUnhide,
  adminSessionCreate, adminSessionGet, adminSessionLogout, adminStats,
  type AdminMemberRestrictRequest, type ApiCall, type HttpMethod,
} from '../api/generated.ts';

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
/** A review as the moderation list returns it; `hiddenAt` set means off the public list. */
export interface ReviewRow { id: string; authorNickname: string; rating: number; body: string | null; createdAt: string; hiddenAt: string | null; hiddenReason: string | null }
export interface ReviewPage { reviews: ReviewRow[]; total: number }
export interface MemberDetail { member: AdminMemberDetailRow; restrictions: RestrictionRow[]; consents: ConsentRow[]; ledgers: LedgerRow[]; roles: RoleRow[] }
export interface AdminOperator { memberId: string; nickname: string; customerNumber: string }
export interface AdminSessionInfo { operator: AdminOperator; expiresAt: string }
/** One day of the dashboard trend, exactly as the server aggregated it. */
export interface StatsDay { date: string; trades: number; completed: number; reports: number; newMembers: number }
export interface StatsTotals { trades: number; completed: number; completionRate: number; reports: number; newMembers: number }
export interface Stats { from: string; to: string; totals: StatsTotals; daily: StatsDay[] }

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly attemptsRemaining: number | null;
  readonly retryAfterSeconds: number | null;
  constructor(status: number, code: string, extra: { attemptsRemaining?: number | null; retryAfterSeconds?: number | null } = {}) {
    super(code); this.name = 'AdminApiError'; this.status = status; this.code = code;
    this.attemptsRemaining = extra.attemptsRemaining ?? null;
    this.retryAfterSeconds = extra.retryAfterSeconds ?? null;
  }
}

const invalid = (): never => { throw new AdminApiError(502, 'INVALID_RESPONSE'); };
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const str = (v: unknown): string => typeof v === 'string' ? v : invalid();
const nullable = (v: unknown): string | null => v === null ? null : str(v);
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : invalid();
const count = (v: unknown): number => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : invalid();
const optionalNumber = (v: unknown): number | null => Number.isSafeInteger(v) ? v as number : null;

/** Operator-scope bearer: `adm_` + a 43-char opaque token. */
export const ADMIN_TOKEN_PATTERN = /^adm_[A-Za-z0-9_-]{43}$/;

export const ADMIN_ERROR_CODES = [
  'ADMIN_REQUIRED', 'ADMIN_SESSION_REQUIRED', 'AUTH_REQUIRED', 'SESSION_INVALID', 'MEMBER_NOT_FOUND',
  'MEMBER_WITHDRAWN', 'ALREADY_RESTRICTED', 'NOT_RESTRICTED', 'ADMIN_LOGIN_LOCKED', 'INVALID_TOKEN',
  'INVALID_REQUEST', 'ROUTE_NOT_FOUND',
  'REVIEW_NOT_FOUND', 'REVIEW_ALREADY_HIDDEN', 'REVIEW_NOT_HIDDEN', 'REVIEW_EXISTS',
] as const;

/** The console may only talk to the approved API origin or a loopback development server. */
export function assertApprovedApiOrigin(baseUrl: string): URL {
  const origin = new URL(baseUrl);
  if (origin.origin !== 'https://api-dev-kimgosu.mintech.ai' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname))) {
    throw new Error('UNAPPROVED_API_ORIGIN');
  }
  if (origin.pathname !== '/' || origin.search || origin.hash) throw new Error('INVALID_API_BASE');
  return origin;
}

export function createAdminApi(baseUrl: string, transport: typeof fetch = fetch, timeoutMs = 10000) {
  const origin = assertApprovedApiOrigin(baseUrl);

  let adminToken: string | undefined;
  const clearSession = () => { adminToken = undefined; };
  const setAdminSession = (value: string) => {
    if (!ADMIN_TOKEN_PATTERN.test(value)) throw new AdminApiError(400, 'INVALID_TOKEN');
    adminToken = value;
  };

  async function send(path: string, method: HttpMethod, body?: unknown, token?: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json', 'Cache-Control': 'no-store' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await transport(origin.origin + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new AdminApiError(502, 'INVALID_RESPONSE'); }
      if (!response.ok) {
        const envelope = obj(payload).error;
        const detail = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : invalid();
        const code = str(detail.code);
        throw new AdminApiError(response.status, (ADMIN_ERROR_CODES as readonly string[]).includes(code) ? code : 'REQUEST_FAILED', {
          attemptsRemaining: optionalNumber(detail.attemptsRemaining),
          retryAfterSeconds: optionalNumber(detail.retryAfterSeconds),
        });
      }
      return payload;
    } catch (e) {
      if (e instanceof AdminApiError) throw e;
      throw new AdminApiError(0, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }

  async function request(path: string, method: HttpMethod = 'GET', body?: unknown): Promise<unknown> {
    if (!adminToken) throw new AdminApiError(401, 'AUTH_REQUIRED');
    return send(path, method, body, adminToken);
  }

  // Contract-generated callers issue the path/method; this layer keeps auth,
  // error mapping and runtime validation.
  const callAuthed: ApiCall = (path, method, body) => request(path, method, body);
  const callPublic: ApiCall = (path, method, body) => send(path, method, body);

  const readOperator = (value: unknown): AdminOperator => {
    const d = obj(value);
    return { memberId: str(d.memberId), nickname: str(d.nickname), customerNumber: str(d.customerNumber) };
  };
  const readSessionInfo = (value: unknown): AdminSessionInfo => {
    const d = obj(value);
    return { operator: readOperator(d.operator), expiresAt: str(d.expiresAt) };
  };

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
  const readReview = (value: unknown): ReviewRow => {
    const d = obj(value);
    const rating = count(d.rating);
    if (rating < 1 || rating > 5) return invalid();
    return { id: str(d.id), authorNickname: str(d.authorNickname), rating, body: nullable(d.body), createdAt: str(d.createdAt), hiddenAt: nullable(d.hiddenAt), hiddenReason: nullable(d.hiddenReason) };
  };
  /** completionRate is a server-computed percentage; a client-side division would be a second source of truth. */
  const percentage = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : invalid();
  const readStatsDay = (value: unknown): StatsDay => {
    const d = obj(value);
    return { date: str(d.date), trades: count(d.trades), completed: count(d.completed), reports: count(d.reports), newMembers: count(d.newMembers) };
  };

  return {
    hasSession: () => adminToken !== undefined,
    setAdminSession,
    clearSession,
    /** Exchanges an already-authenticated member session for the operator scope. */
    async login(sessionToken: string): Promise<AdminSessionInfo> {
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(sessionToken)) throw new AdminApiError(400, 'INVALID_TOKEN');
      const d = obj(await adminSessionCreate(callPublic, { sessionToken }));
      const token = str(d.adminToken);
      if (!ADMIN_TOKEN_PATTERN.test(token)) return invalid();
      // The token is kept only after the whole envelope validated.
      adminToken = token;
      return { operator: readOperator(d.operator), expiresAt: str(d.expiresAt) };
    },
    async session(): Promise<AdminSessionInfo> {
      return readSessionInfo(await adminSessionGet(callAuthed));
    },
    async logout(): Promise<void> {
      try { if (adminToken) await adminSessionLogout(callAuthed); }
      finally { clearSession(); }
    },
    async members(params: { query?: string; status?: MemberStatus | ''; page?: number; limit?: number }): Promise<MemberPage> {
      const d = obj(await adminMembers(callAuthed, {
        query: params.query?.trim() || undefined,
        status: params.status || undefined,
        page: String(params.page ?? 1),
        limit: String(params.limit ?? 20),
      }));
      return { page: count(d.page), limit: count(d.limit), total: count(d.total), totalPages: count(d.totalPages), members: list(d.members).map(v => readRow(v)) };
    },
    async member(id: string): Promise<MemberDetail> {
      const d = obj(await adminMember(callAuthed, { id }));
      return {
        member: readDetailRow(d.member),
        restrictions: list(d.restrictions).map(readRestriction),
        consents: list(d.consents).map(v => { const c = obj(v); const s = str(c.status); if (!['GRANTED', 'WITHDRAWN'].includes(s)) return invalid(); return { kind: str(c.kind), title: str(c.title), version: str(c.version), status: s as 'GRANTED' | 'WITHDRAWN', recordedAt: str(c.recordedAt) }; }),
        ledgers: list(d.ledgers).map(v => { const l = obj(v); return { id: str(l.id), displayName: nullable(l.displayName), createdAt: str(l.createdAt), updatedAt: str(l.updatedAt), role: l.role === 'EXPERT' ? 'EXPERT' as const : 'CUSTOMER' as const, counterpartId: str(l.counterpartId), counterpartNickname: str(l.counterpartNickname), counterpartNumber: str(l.counterpartNumber), agreementCount: count(l.agreementCount), completedAgreements: count(l.completedAgreements) }; }),
        roles: list(d.roles).map(v => { const r = obj(v); return { id: str(r.id), role: str(r.role), reason: str(r.reason), startsAt: str(r.startsAt), endsAt: nullable(r.endsAt), revokedAt: nullable(r.revokedAt) }; }),
      };
    },
    async restrict(id: string, input: { reason: string; endsAt?: string }): Promise<RestrictionRow> {
      const payload: AdminMemberRestrictRequest = { reason: input.reason };
      if (input.endsAt) payload.endsAt = input.endsAt;
      const d = obj(await adminMemberRestrict(callAuthed, { id }, payload));
      return readRestriction(d);
    },
    async release(id: string, reason: string): Promise<{ released: boolean; restrictionId: string; revokedAt: string }> {
      const d = obj(await adminMemberRelease(callAuthed, { id }, { reason }));
      if (d.released !== true) return invalid();
      return { released: true, restrictionId: str(d.restrictionId), revokedAt: str(d.revokedAt) };
    },
    async reviews(params: { limit?: number; offset?: number } = {}): Promise<ReviewPage> {
      const d = obj(await adminReviewList(callAuthed, {
        limit: String(params.limit ?? 50),
        offset: String(params.offset ?? 0),
      }));
      return { reviews: list(d.reviews).map(v => readReview(v)), total: count(d.total) };
    },
    /** Reason is passed through untouched: the server rejects a short or empty one with 400. */
    async hideReview(id: string, reason: string): Promise<void> {
      const d = obj(await adminReviewHide(callAuthed, { id }, { reason }));
      if (d.hidden !== true) return invalid();
    },
    async unhideReview(id: string, reason: string): Promise<void> {
      const d = obj(await adminReviewUnhide(callAuthed, { id }, { reason }));
      if (d.hidden !== false) return invalid();
    },
    /** Dashboard aggregates: dates are passed through only when the operator picked them. */
    async stats(params: { from?: string; to?: string } = {}): Promise<Stats> {
      const d = obj(await adminStats(callAuthed, { from: params.from, to: params.to }));
      const totalsRow = obj(d.totals);
      return {
        from: str(d.from),
        to: str(d.to),
        totals: {
          trades: count(totalsRow.trades), completed: count(totalsRow.completed),
          completionRate: percentage(totalsRow.completionRate),
          reports: count(totalsRow.reports), newMembers: count(totalsRow.newMembers),
        },
        daily: list(d.daily).map(v => readStatsDay(v)),
      };
    },
  };
}
export type AdminApi = ReturnType<typeof createAdminApi>;
