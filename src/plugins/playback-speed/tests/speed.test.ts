import { expect, test } from '@playwright/test';

import {
  formatPlaybackSpeed,
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
  normalizePlaybackSpeed,
} from '../speed';

test('an unusable stored speed falls back to normal playback', () => {
  for (const value of [undefined, null, 'fast', Number.NaN, 0, -1]) {
    expect(normalizePlaybackSpeed(value)).toBe(1);
  }
});

test('a speed outside the player range is clamped to it', () => {
  expect(normalizePlaybackSpeed(0.001)).toBe(MIN_PLAYBACK_SPEED);
  expect(normalizePlaybackSpeed(100)).toBe(MAX_PLAYBACK_SPEED);
});

test('the speed is kept to the two decimals the player accepts', () => {
  expect(normalizePlaybackSpeed(1.239)).toBe(1.24);
  expect(formatPlaybackSpeed(1.5)).toBe('1.5×');
  expect(formatPlaybackSpeed(1)).toBe('1×');
});
