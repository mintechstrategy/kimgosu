import { createHash } from 'node:crypto';
import type { Sql, Row } from './app.ts';
import { ApiError } from './security.ts';

export const POLICY_METADATA = 'policy-v0.3';
export const requiredGrantKinds = ['TERMS', 'PRIVACY_CONSENT'] as const;
export const requiredReadyKindsForGrant = ['TERMS', 'PRIVACY_CONSENT', 'PRIVACY_POLICY'] as const;
export const optionalGrantKinds = ['MARKETING'] as const;
export const policyKinds = ['TERMS', 'PRIVACY_CONSENT', 'PRIVACY_POLICY', 'MARKETING', 'OPERATIONS'] as const;
export const nicknameSchema = { type: 'string', pattern: '^[\\p{L}\\p{N}]{1,10}$', maxLength: 10 };
export const consentInputSchema = { type: 'array', minItems: 2, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['kind', 'version'], properties: { kind: { type: 'string', enum: [...requiredGrantKinds, ...optionalGrantKinds] }, version: { type: 'string', minLength: 1, maxLength: 100 } } } };
export const revisionSchema = { type: 'string', pattern: '^ps3-[0-9a-f]{64}$' };

// Verbatim final grant/requireCurrentConsents authority. Do NOT replace it with
// the legacy display selector (which also considers created_at and unready rows).
export const currentDocumentsSelect = `SELECT DISTINCT ON(kind) id,kind,version FROM kg_membership.policy_documents
    WHERE status='READY' AND approved_at IS NOT NULL AND effective_at<=now() AND operator_name IS NOT NULL AND length(trim(operator_name))>0
    ORDER BY kind,effective_at DESC,id DESC`;

// A single PostgreSQL statement/MVCC snapshot, including its now() anchor.
// No DDL, new transaction isolation or lock/writer protocol is introduced.
export const policySnapshotSelect = `WITH current_documents AS (${currentDocumentsSelect}),
  display_documents AS (
    SELECT DISTINCT ON(kind) id FROM kg_membership.policy_documents
    ORDER BY kind,(status='READY' AND approved_at IS NOT NULL AND effective_at<=now()) DESC,effective_at DESC NULLS LAST,created_at DESC,id DESC
  )
  SELECT now() AS "serverTime", COALESCE(jsonb_agg(jsonb_build_object(
    'id',d.id::text,'kind',d.kind,'version',d.version,'status',d.status,'title',d.title,
    'body',d.body,'bodySha256',d.body_sha256,'operator',d.operator_name,
    'effectiveAt',d.effective_at,'approvedAt',d.approved_at,'createdAt',d.created_at,
    'canConsent',COALESCE(d.status='READY' AND d.approved_at IS NOT NULL AND d.effective_at<=now() AND d.operator_name IS NOT NULL AND length(trim(d.operator_name))>0,false),
    'isCurrent',c.id IS NOT NULL,'isDisplay',v.id IS NOT NULL
  ) ORDER BY d.kind,d.created_at DESC,d.id DESC) FILTER (WHERE d.id IS NOT NULL),'[]'::jsonb) AS documents
  FROM kg_membership.policy_documents d
  LEFT JOIN current_documents c ON c.id=d.id LEFT JOIN display_documents v ON v.id=d.id`;

const sqlTrim = (text: string) => text.replace(/^ +| +$/g, '');
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const unavailable = () => new ApiError(503, 'POLICY_METADATA_UNAVAILABLE');
function timestamp(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (!(typeof value === 'string' || value instanceof Date)) throw unavailable();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw unavailable();
  return date.toISOString();
}
export function makePolicySnapshot(row: Row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) throw unavailable();
  const serverTime = timestamp(row.serverTime)!;
  if (!Array.isArray(row.documents)) throw unavailable();
  const ids = new Set<string>(); const versions = new Set<string>();
  const documents = row.documents.map((raw: Row) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw unavailable();
    if (typeof raw.id !== 'string' || !raw.id || typeof raw.kind !== 'string' || !policyKinds.includes(raw.kind as typeof policyKinds[number]) ||
        typeof raw.version !== 'string' || !sqlTrim(raw.version) || !['DRAFT', 'READY', 'RETIRED'].includes(String(raw.status)) ||
        typeof raw.title !== 'string' || !sqlTrim(raw.title) || typeof raw.body !== 'string' || !sqlTrim(raw.body) ||
        typeof raw.bodySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.bodySha256) || sha(raw.body) !== raw.bodySha256 ||
        !(raw.operator === null || typeof raw.operator === 'string') || typeof raw.canConsent !== 'boolean' ||
        typeof raw.isCurrent !== 'boolean' || typeof raw.isDisplay !== 'boolean') throw unavailable();
    const pair = JSON.stringify([raw.kind, raw.version]);
    if (ids.has(raw.id) || versions.has(pair)) throw unavailable();
    ids.add(raw.id); versions.add(pair);
    const document = { id: raw.id, kind: raw.kind, version: raw.version, status: String(raw.status), title: raw.title,
      body: raw.body, bodySha256: raw.bodySha256, operator: raw.operator as string | null,
      effectiveAt: timestamp(raw.effectiveAt, true), approvedAt: timestamp(raw.approvedAt, true), createdAt: timestamp(raw.createdAt)!,
      canConsent: raw.canConsent, isCurrent: raw.isCurrent, isDisplay: raw.isDisplay };
    // Verify structural consistency; the DB predicate, not a JS/local clock,
    // decides effectiveness. An inconsistent row is not permission to guess.
    if (document.canConsent && (document.status !== 'READY' || !document.operator || !sqlTrim(document.operator) || !document.approvedAt || !document.effectiveAt)) throw unavailable();
    if (document.isCurrent && !document.canConsent) throw unavailable();
    return document;
  });
  const currentDocuments = policyKinds.map(kind => {
    const current = documents.filter(d => d.kind === kind && d.isCurrent);
    const display = documents.filter(d => d.kind === kind && d.isDisplay);
    if (current.length > 1 || display.length > 1 || (documents.some(d => d.kind === kind && d.canConsent) && current.length !== 1) ||
        (documents.some(d => d.kind === kind) && display.length !== 1)) throw unavailable();
    const d = current[0];
    return { kind, currentDocument: d ? { id: d.id, kind: d.kind, version: d.version, bodySha256: d.bodySha256, status: d.status, canConsent: d.canConsent } : null };
  });
  const requirements = { requiredGrantKinds: [...requiredGrantKinds], requiredReadyKindsForGrant: [...requiredReadyKindsForGrant], optionalGrantKinds: [...optionalGrantKinds], operationsConsentRequired: false };
  const constraints = { consentInputs: consentInputSchema, nickname: nicknameSchema };
  const missingReadyKinds = requiredReadyKindsForGrant.filter(kind => !currentDocuments.find(d => d.kind === kind)?.currentDocument);
  // Explicit fixed-order UTF8 JSON, no locale, numeric-ID conversion, time or
  // nonce. Include history/display and semantics; changing text at the same
  // version or crossing an effectiveness boundary invalidates the revision.
  const canonical = [...documents].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const policyRevision = 'ps3-' + sha(JSON.stringify({ selector: 'existing-grant-effectiveAt-desc-id-desc-v1', requirements, constraints, documents: canonical }));
  return { schemaVersion: POLICY_METADATA, policyRevision, serverTime, timeAuthority: 'POSTGRES_TRANSACTION_NOW',
    cache: { control: 'no-store', ttlSeconds: 0, revalidateBeforeConsent: true },
    requirements, constraints, currentDocuments, missingReadyKinds, documents,
    limitations: { commitFence: false, allowedActions: 'NOT_IMPLEMENTED', materialChangeClassification: 'NOT_IMPLEMENTED' } };
}
export type PolicySnapshot = ReturnType<typeof makePolicySnapshot>;
export async function loadPolicySnapshot(sql: Sql): Promise<PolicySnapshot> {
  const result = await sql.query(policySnapshotSelect);
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw unavailable();
  const rows = result.rows;
  return makePolicySnapshot(rows[0]!);
}
export function assertPolicyRevision(snapshot: PolicySnapshot, expected: string) {
  if (snapshot.policyRevision !== expected) throw new ApiError(409, 'POLICY_VERSION_CHANGED');
}
