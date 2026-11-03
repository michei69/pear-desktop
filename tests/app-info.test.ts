import { expect, test } from '@playwright/test';

import { buildLabel, channel, commit } from '../src/app-info';

test('unbaked builds are dev builds', () => {
  expect(channel).toBe('dev');
  expect(commit).toBe('');
  expect(buildLabel()).toBe('dev');
});

test('beta and dev builds show their commit, stable does not', () => {
  expect(buildLabel('beta', '1a2b3c4')).toBe('beta 1a2b3c4');
  expect(buildLabel('dev', '1a2b3c4')).toBe('dev 1a2b3c4');
  expect(buildLabel('stable', '1a2b3c4')).toBe('stable');
});

test('a build with no known commit still names its channel', () => {
  expect(buildLabel('beta', '')).toBe('beta');
});
