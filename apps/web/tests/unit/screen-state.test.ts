// WS-03: per-screen loading / empty / error / permission-denied / expired states.
// Local pure-module regressions only; no API, DB or provider is contacted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { policyHint, screenNeeds, screenView, type ScreenDataState } from '../../src/screen-state.ts';
import { screens } from '../../src/domain.ts';
import type { Screen } from '../../src/types.ts';

const state = (patch: Partial<ScreenDataState> = {}): ScreenDataState => ({ loading: false, failed: false, ready: true, empty: false, ...patch });
const source = readFileSync(new URL('../../src/App.vue', import.meta.url), 'utf8');
const needsData = (screen: Screen) => screenNeeds[screen] !== 'none';

test('WS03 every routed screen declares exactly one data need', () => {
  assert.equal(screens.length, 14);
  assert.deepEqual(Object.keys(screenNeeds).sort(), [...screens].sort());
  for (const screen of screens) assert.ok(['none', 'member', 'documents', 'records', 'preferences'].includes(screenNeeds[screen]));
});

// One row per screen: loading, loaded, loaded-but-empty, failed.
for (const screen of screens) {
  test(`WS03 screen ${screen} states`, () => {
    const loadingView = screenView(screen, state({ loading: true }));
    const loadedView = screenView(screen, state());
    const emptyView = screenView(screen, state({ empty: true }));
    const failedView = screenView(screen, state({ ready: false, failed: true }));

    if (!needsData(screen)) {
      // Static copy and the terminal expired/restricted/social-error cards never
      // claim a load is pending and never render an empty-result notice.
      for (const v of [loadingView, loadedView, emptyView, failedView]) {
        assert.equal(v.loading, false);
        assert.equal(v.empty, false);
        assert.equal(v.content, true);
        assert.equal(v.unavailable, false);
      }
      return;
    }

    assert.deepEqual(loadingView, { loading: true, content: false, empty: false, unavailable: false });
    assert.equal(loadedView.content, true);
    assert.equal(loadedView.loading, false);
    assert.equal(loadedView.unavailable, false);
    assert.equal(failedView.content, false, 'a failed load must not render as loaded content');
    assert.equal(failedView.unavailable, true);
    assert.equal(failedView.empty, false, 'a failed load must never become an empty list');
    assert.equal(failedView.loading, false);
  });
}

test('WS03 empty-result notice is only truthful on policies and consents', () => {
  const withEmptySurface = screens.filter(s => screenView(s, state({ empty: true })).empty);
  assert.deepEqual(withEmptySurface.sort(), ['consents', 'policies']);
});

test('WS03 regression: failed consent-history load is not shown as "no consent history"', () => {
  const failed = screenView('consents', state({ ready: false, failed: true, empty: true }));
  assert.equal(failed.empty, false);
  assert.equal(failed.unavailable, true);
});

test('WS03 regression: failed policy reload is not shown as "no documents registered"', () => {
  const failed = screenView('policies', state({ ready: false, failed: true, empty: true }));
  assert.equal(failed.empty, false);
  assert.equal(failed.unavailable, true);
});

test('WS03 regression: in-flight reload hides stale empty state', () => {
  assert.equal(screenView('consents', state({ loading: true, empty: true })).empty, false);
  assert.equal(screenView('policies', state({ loading: true, empty: true })).empty, false);
});

test('WS03 unrelated action error does not blank already-loaded content', () => {
  // e.g. a notification PATCH conflict while preferences are still authoritative
  const v = screenView('notifications', state({ failed: true }));
  assert.equal(v.content, true);
  assert.equal(v.unavailable, false);
  assert.equal(v.empty, false);
});

test('WS03 permission-denied and expired surfaces are terminal states, not data screens', () => {
  for (const screen of ['expired', 'restricted', 'social-error'] as const) {
    assert.equal(screenNeeds[screen], 'none');
    const v = screenView(screen, state({ loading: true, failed: true }));
    assert.equal(v.content, true);
    assert.equal(v.loading, false);
    assert.equal(v.empty, false);
  }
  // A restricted account is routed to the denied card, never to an empty list.
  assert.equal(screenView('member', state({ ready: false, failed: true })).content, false);
});

test('WS03 consent hint never labels a load failure as DRAFT/준비 중', () => {
  assert.equal(policyHint(true, false), 'unavailable');
  assert.equal(policyHint(false, false), 'unavailable');
  assert.equal(policyHint(true, true), 'available');
  assert.equal(policyHint(false, true), 'not-ready');
});

test('WS03 template binds empty/loading surfaces to the computed view', () => {
  assert.equal(source.match(/v-if="view\.empty"/g)?.length, 2, 'policies and consents empty notices are gated');
  assert.ok(!source.includes('docsLoaded && !docs.length'), 'policies empty notice is not bound to raw flags');
  assert.ok(!source.includes('!loading && !records.length'), 'consents empty notice is not bound to raw flags');
  assert.ok(source.includes('v-if="view.loading"'), 'loading notice follows the screen data phase');
  assert.ok(source.includes('v-if="view.unavailable"'), 'unavailable notification state is rendered');
  assert.ok(source.includes('protectedScreens.includes(screen)'), 'protected screens have a memberless fallback');
});

test('WS03 failed social start reports a config failure, not success or readiness', () => {
  assert.ok(source.includes("'CONFIG_UNAVAILABLE'"));
  assert.ok(source.includes("'CONFIG_PENDING'"));
  assert.ok(source.includes("['CONFIG_UNAVAILABLE','CONFIG_PENDING'].includes(e.code)"), 'config failure keeps a valid session');
});
