import { expect, test } from '@playwright/test';

import { nudgeRate } from '../src/plugins/crossfade/align';

test('a follower behind its clock catches up, one ahead of it waits', () => {
  expect(nudgeRate(0.01, 0.5, 0.05)).toBeCloseTo(1.02, 10);
  expect(nudgeRate(-0.01, 0.5, 0.05)).toBeCloseTo(0.98, 10);
  expect(nudgeRate(0, 0.5, 0.05)).toBe(1);
});

test('the rate stays within its limit, however far off the clock is', () => {
  expect(nudgeRate(30, 0.5, 0.05)).toBeCloseTo(1.05, 10);
  expect(nudgeRate(-30, 0.5, 0.05)).toBeCloseTo(0.95, 10);
});
