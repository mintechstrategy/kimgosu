import type { Screen } from './types.ts';

/**
 * Which remote resource a screen must load before anything it renders counts as
 * authoritative. Screens with `none` are static copy or terminal state cards and
 * must never show a loading or empty-result notice.
 */
export type ScreenNeed = 'none' | 'member' | 'documents' | 'records' | 'preferences';

export const screenNeeds: Record<Screen, ScreenNeed> = {
  browse: 'none',
  login: 'none',
  signup: 'documents',
  info: 'none',
  sms: 'none',
  policies: 'documents',
  document: 'documents',
  member: 'member',
  consents: 'records',
  notifications: 'preferences',
  withdraw: 'member',
  expired: 'none',
  restricted: 'none',
  'social-error': 'none',
};

export interface ScreenDataState {
  /** A request for this screen's data is in flight. */
  loading: boolean;
  /** The last request for this screen's data failed. */
  failed: boolean;
  /** The screen's data was loaded successfully during this visit. */
  ready: boolean;
  /** The loaded collection is genuinely empty (only meaningful when ready). */
  empty: boolean;
}

export interface ScreenView {
  /** Show the loading notice. */
  loading: boolean;
  /** Screen content may be rendered as current. */
  content: boolean;
  /** A "no items" notice is truthful: loaded, non-empty-capable and empty. */
  empty: boolean;
  /** The screen's data failed to load, so content stays unavailable. */
  unavailable: boolean;
}

/** Only these screens have a legitimate empty-result surface. */
const emptySurfaces: Screen[] = ['policies', 'consents'];

/**
 * Failure must never be rendered as an empty list or as success. Empty is
 * therefore gated on a successful load of this visit, and content is gated on
 * readiness rather than on the absence of an unrelated error message.
 */
export function screenView(screen: Screen, state: ScreenDataState): ScreenView {
  const need = screenNeeds[screen];
  if (need === 'none') return { loading: false, content: true, empty: false, unavailable: false };
  const loading = state.loading;
  const content = state.ready && !loading;
  return {
    loading,
    content,
    empty: content && state.empty && emptySurfaces.includes(screen),
    unavailable: !content && !loading && state.failed,
  };
}

export type PolicyHint = 'unavailable' | 'available' | 'not-ready';

/** Consent checkbox hint: a failed policy load is not "DRAFT/준비 중". */
export function policyHint(canAgree: boolean, documentsContent: boolean): PolicyHint {
  if (!documentsContent) return 'unavailable';
  return canAgree ? 'available' : 'not-ready';
}
