import type { PolicyDocument, PolicyKind } from './types.ts';
import { policyKinds } from './domain.ts';
import { supportedPolicy } from './policy-schema.ts';
export interface SnapshotDocument extends PolicyDocument { id: string; approvedAt: string | null; createdAt: string; isCurrent: boolean; isDisplay: boolean }
export interface PolicySnapshot {
  schemaVersion: 'policy-v0.3'; policyRevision: string; serverTime: string; timeAuthority: 'POSTGRES_TRANSACTION_NOW';
  cache: typeof supportedPolicy.cache; requirements: typeof supportedPolicy.requirements;
  constraints: typeof supportedPolicy.constraints; limitations: typeof supportedPolicy.limitations;
  currentDocuments: { kind: PolicyKind; currentDocument: Pick<SnapshotDocument,'id'|'kind'|'version'|'bodySha256'|'status'|'canConsent'> | null }[];
  missingReadyKinds: PolicyKind[]; documents: SnapshotDocument[];
}
// Exact raw UTF8, never normalize CRLF, Unicode or surrounding whitespace.
export async function bodyHash(body: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))), b => b.toString(16).padStart(2,'0')).join(''); }
const record = (v: any): v is Record<string,any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v: any): v is string => typeof v === 'string' && v.length > 0;
const sqlNonempty = (v: any): v is string => typeof v === 'string' && v.replace(/^ +| +$/g,'').length > 0;
const timestamp = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v));
const canonical = (v: any): string => JSON.stringify(Array.isArray(v) ? v.map(x=>JSON.parse(canonical(x))) : record(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])) : v);
export function samePolicy(a: PolicySnapshot | undefined, b: PolicySnapshot) {
  if (!a) return false;
  const comparable = (s: PolicySnapshot) => {
    const {serverTime: _time, documents, currentDocuments, missingReadyKinds, ...rest} = s;
    // Keyed equality only, never a current-document selector or version ordering.
    return {...rest,documents:Object.fromEntries(documents.map(d=>[d.id,d])),currentDocuments:Object.fromEntries(currentDocuments.map(d=>[d.kind,d.currentDocument])),missingReadyKinds:[...missingReadyKinds].sort()};
  };
  return canonical(comparable(a)) === canonical(comparable(b));
}
/** No revision recomputation, version/ID sorting or device-clock authority. */
export async function readPolicySnapshot(value: unknown): Promise<PolicySnapshot> {
  const bad = (): never => { throw new Error('INVALID_POLICY_SNAPSHOT'); };
  if (!record(value)) return bad(); const s = value;
  if (s.schemaVersion !== 'policy-v0.3' || !/^ps3-[0-9a-f]{64}$/.test(s.policyRevision) || !timestamp(s.serverTime) || s.timeAuthority !== 'POSTGRES_TRANSACTION_NOW') return bad();
  for (const key of ['cache','requirements','constraints','limitations'] as const) if (canonical(s[key] ?? null) !== canonical(supportedPolicy[key])) return bad();
  if (!Array.isArray(s.documents) || !Array.isArray(s.currentDocuments) || s.currentDocuments.length !== policyKinds.length || !Array.isArray(s.missingReadyKinds)) return bad();
  const ids = new Set(), pairs = new Set();
  for (const d of s.documents) {
    if (!record(d) || !nonempty(d.id) || !policyKinds.includes(d.kind) || !sqlNonempty(d.version) || !['DRAFT','READY','RETIRED'].includes(d.status) || !sqlNonempty(d.title) || !sqlNonempty(d.body) || typeof d.bodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(d.bodySha256) || !(d.operator === null || typeof d.operator === 'string') || !(d.effectiveAt === null || timestamp(d.effectiveAt)) || !(d.approvedAt === null || timestamp(d.approvedAt)) || !timestamp(d.createdAt) || typeof d.canConsent !== 'boolean' || typeof d.isCurrent !== 'boolean' || typeof d.isDisplay !== 'boolean') return bad();
    const pair = JSON.stringify([d.kind,d.version]); if (ids.has(d.id) || pairs.has(pair)) return bad(); ids.add(d.id); pairs.add(pair);
    if (await bodyHash(d.body) !== d.bodySha256) return bad();
    if (d.canConsent && (d.status !== 'READY' || !sqlNonempty(d.operator) || !d.effectiveAt || !d.approvedAt)) return bad();
    if (d.isCurrent && !d.canConsent) return bad();
  }
  const slots = new Set();
  for (const slot of s.currentDocuments) {
    if (!record(slot) || !policyKinds.includes(slot.kind) || slots.has(slot.kind)) return bad(); slots.add(slot.kind);
    const rows = s.documents.filter((d: SnapshotDocument)=>d.kind === slot.kind), current = rows.filter((d: SnapshotDocument)=>d.isCurrent), display = rows.filter((d: SnapshotDocument)=>d.isDisplay);
    if (current.length > 1 || display.length > 1 || (rows.length && display.length !== 1) || (rows.some((d: SnapshotDocument)=>d.canConsent) && current.length !== 1)) return bad();
    if (slot.currentDocument === null) { if (current.length) return bad(); }
    else {
      if (!record(slot.currentDocument) || current.length !== 1) return bad();
      for (const k of ['id','kind','version','bodySha256','status','canConsent']) if (slot.currentDocument[k] !== current[0][k]) return bad();
    }
  }
  const missing = s.requirements.requiredReadyKindsForGrant.filter((k: PolicyKind)=>!s.currentDocuments.find((x: any)=>x.kind === k)?.currentDocument);
  if (canonical([...s.missingReadyKinds].sort()) !== canonical([...missing].sort())) return bad();
  return s as PolicySnapshot;
}
export function snapshotCurrent(snapshot: PolicySnapshot | undefined, kind: PolicyKind) {
  const id = snapshot?.currentDocuments.find(x=>x.kind === kind)?.currentDocument?.id;
  return id === undefined ? undefined : snapshot?.documents.find(d=>d.id === id);
}
export function snapshotDisplay(snapshot: PolicySnapshot | undefined, kind: PolicyKind) { return snapshotCurrent(snapshot,kind) ?? snapshot?.documents.find(d=>d.kind === kind && d.isDisplay); }
export const canSnapshotConsent = (snapshot: PolicySnapshot | undefined, kind: PolicyKind) => snapshotCurrent(snapshot,kind)?.canConsent === true;
export function consentPayload(snapshot: PolicySnapshot, checked: Partial<Record<PolicyKind,boolean>>) {
  const allowed = snapshot.constraints.consentInputs.items.properties.kind.enum;
  if (snapshot.missingReadyKinds.length || !snapshot.requirements.requiredGrantKinds.every(k=>checked[k])) throw new Error('POLICY_RECONFIRM_REQUIRED');
  const consents = allowed.filter(k=>checked[k]).map(kind=>{
    const d = snapshotCurrent(snapshot,kind); const rule = snapshot.constraints.consentInputs.items.properties.version;
    // JSONschema string length counts Unicode codepoints, not UTF16 units.
    if (!d?.canConsent || [...d.version].length < rule.minLength || [...d.version].length > rule.maxLength) throw new Error('POLICY_RECONFIRM_REQUIRED');
    return {kind,version:d.version};
  });
  const rule = snapshot.constraints.consentInputs;
  if (consents.length < rule.minItems || consents.length > rule.maxItems) throw new Error('POLICY_RECONFIRM_REQUIRED');
  return {consents,expectedPolicyRevision:snapshot.policyRevision};
}
