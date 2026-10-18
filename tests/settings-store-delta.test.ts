import { expect, test } from '@playwright/test';

import {
  diffPaths,
  setByPathCopy,
  type ConfigDelta,
} from '../src/plugins/settings-ui/paths';

const apply = (root: object, delta: ConfigDelta) =>
  delta.reduce<object>(
    (next, { path, value }) => setByPathCopy(next, path, value),
    root,
  );

test('a copy-on-write patch keeps every untouched branch by reference', () => {
  const config = {
    options: { tray: false, appVisible: true },
    plugins: { scrobbler: { enabled: true } },
  };

  const next = setByPathCopy(config, 'options.tray', true);

  expect(next).not.toBe(config);
  expect(next.options).toEqual({ tray: true, appVisible: true });
  expect(config.options.tray).toBe(false);
  // The write is a few levels deep; the rest of the config is shared.
  expect(next.plugins).toBe(config.plugins);
});

test('a copy-on-write patch clones arrays as arrays', () => {
  const config = { options: { list: [1, 2, 3] } };

  const next = setByPathCopy(config, 'options.list', [4]);

  expect(next.options.list).toEqual([4]);
  expect(config.options.list).toEqual([1, 2, 3]);
});

test('only the changed leaves are reported, arrays as one leaf', () => {
  const before = {
    options: { tray: false, theme: 'dark', featureFlags: { a: true } },
    plugins: { scrobbler: { enabled: true, keywords: ['a', 'b'] } },
  };
  const after = {
    options: { tray: true, theme: 'dark', featureFlags: { a: true } },
    plugins: { scrobbler: { enabled: true, keywords: ['c'] } },
  };

  expect(diffPaths(before, after, '')).toEqual([
    { path: 'options.tray', value: true },
    { path: 'plugins.scrobbler.keywords', value: ['c'] },
  ]);
});

test('applying the delta reproduces the new store', () => {
  const before = {
    options: {
      tray: false,
      theme: 'dark',
      featureFlags: { a: true, b: false },
    },
    plugins: { scrobbler: { enabled: true, keywords: ['a'] } },
  };
  const after = {
    options: { tray: true, theme: 'dark', featureFlags: { a: true, b: true } },
    plugins: { scrobbler: { enabled: false, keywords: ['a', 'b'] } },
  };

  expect(apply(before, diffPaths(before, after, ''))).toEqual(after);
});

test('an unchanged store yields no deltas', () => {
  const config = { options: { tray: false }, plugins: {} };

  expect(diffPaths(config, structuredClone(config), '')).toEqual([]);
});

test('a removed key is sent as an undefined leaf', () => {
  expect(diffPaths({ options: { tray: true } }, { options: {} }, '')).toEqual([
    { path: 'options.tray', value: undefined },
  ]);
});
