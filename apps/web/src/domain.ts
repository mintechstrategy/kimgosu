import type { AuthConfig, PolicyDocument, PolicyKind, Screen } from './types.ts';
export const policyKinds = ['TERMS', 'PRIVACY_CONSENT', 'PRIVACY_POLICY', 'MARKETING', 'OPERATIONS'] as const;
export const screens: Screen[] = ['browse','login','signup','info','sms','policies','document','member','consents','notifications','withdraw','expired','restricted','social-error'];
export const parseScreen = (hash: string): Screen => screens.includes(hash.slice(1) as Screen) ? hash.slice(1) as Screen : 'browse';
export const digits = (value: string, max: number) => value.replace(/[^0-9]/g, '').slice(0, max);
export const validPhone = (value: string) => /^010[0-9]{8}$/.test(value);
export const validInfo = (name: string, email: string) => name.trim().length > 0 && [...name].length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && [...email].length <= 254;
// The server evaluates effectiveness. Dates remain display/shape metadata, never
// a second wall-clock eligibility decision on this device.
export function eligible(doc: PolicyDocument | undefined) { return !!doc && doc.status === 'READY' && doc.canConsent === true && !!doc.body.trim() && !!doc.version.trim() && !!doc.operator?.trim() && !!doc.effectiveAt && Number.isFinite(Date.parse(doc.effectiveAt)) && /^[a-f0-9]{64}$/i.test(doc.bodySha256); }
/** config selects one version per kind; list order/version strings are not a selector. */
export function currentPolicy(documents: PolicyDocument[], selection: AuthConfig['documents'], kind: PolicyKind) {
  const selected = selection.filter(d => d.kind === kind);
  if (selected.length !== 1) return;
  const meta = selected[0];
  const matches = documents.filter(d => d.kind === kind && d.version === meta.version);
  if (matches.length !== 1) return;
  const doc = matches[0];
  // Separate no-store reads can straddle a server update. Never merge conflicting
  // authority into an eligible document or fall back to a different list entry.
  return doc.status === meta.status && doc.canConsent === meta.canConsent ? doc : undefined;
}
export const notice = '탈퇴 후 30일이 지나면 새 고객번호로 재가입할 수 있습니다. 이전 활동과 비공개 접근권한은 자동 복원되지 않으며, 유효한 이용제한은 유지됩니다. 거래상대방 보호를 위한 이전 자료의 기본 보존기간은 탈퇴 확정 시점부터 1년이며 재가입으로 다시 시작하지 않습니다. 자료별 법적 보존 예외·최소 범위·열람 및 파기 기준은 별도 검토 중입니다.';
