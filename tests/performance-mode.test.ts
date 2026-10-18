import { expect, test } from '@playwright/test';

import {
  isPerformancePartEnabled,
  isSkippedInPerformanceMode,
  performanceModeFeatureFlags,
  performanceModeOverrides,
} from '../src/providers/performance-mode';

test('performance mode layers its flags under the user overrides', () => {
  const user = { web_animated_actions: true, kevlar_tuner_thumbnail_factor: 2 };
  const merged = performanceModeOverrides(user, true);

  // A deliberate choice wins over the mode's defaults in both directions, so
  // the win cannot hide behind a mode flag that happens to match the input.
  expect(merged.web_animated_actions).toBe(true);
  expect(
    performanceModeOverrides({ web_animated_actions: false }, true)
      .web_animated_actions,
  ).toBe(false);
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

test('individual parts can be disabled for bisecting', () => {
  process.env.PEAR_PERF_DISABLE = 'flags,css';

  try {
    expect(isPerformancePartEnabled('flags')).toBe(false);
    expect(isPerformancePartEnabled('css')).toBe(false);
    expect(isPerformancePartEnabled('plugins')).toBe(true);
    expect(isSkippedInPerformanceMode('visualizer', true)).toBe(true);
  } finally {
    delete process.env.PEAR_PERF_DISABLE;
  }
});
