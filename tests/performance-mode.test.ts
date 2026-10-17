import { expect, test } from '@playwright/test';

import {
  isSkippedInPerformanceMode,
  performanceModeFeatureFlags,
  performanceModeOverrides,
} from '../src/providers/performance-mode';

test('performance mode layers its flags under the user overrides', () => {
  const user = { web_animated_actions: true, kevlar_tuner_thumbnail_factor: 2 };
  const merged = performanceModeOverrides(user, true);

  // A deliberate choice wins over the mode's defaults.
  expect(merged.web_animated_actions).toBe(true);
  expect(merged.kevlar_tuner_thumbnail_factor).toBe(2);
  // Everything else comes from the mode.
  expect(merged.web_watch_cinematics_disabled_by_default).toBe(true);
  expect(performanceModeFeatureFlags.web_animated_actions).toBe(false);
});

test('performance mode leaves the user overrides untouched when off', () => {
  const user = { web_animated_actions: true };

  expect(performanceModeOverrides(user, false)).toEqual(user);
});

test('performance mode skips only the expensive visual plugins', () => {
  expect(isSkippedInPerformanceMode('visualizer', true)).toBe(true);
  expect(isSkippedInPerformanceMode('ambient-mode', true)).toBe(true);
  expect(isSkippedInPerformanceMode('blur-nav-bar', true)).toBe(true);

  expect(isSkippedInPerformanceMode('visualizer', false)).toBe(false);
  expect(isSkippedInPerformanceMode('synced-lyrics', true)).toBe(false);
});
