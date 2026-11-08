import path from 'node:path';

import { expect, test } from '@playwright/test';

import { settingsWindowPaths } from '../window-paths';

// The regression is about resolving the window files from the app root rather
// than from the chunk's `__dirname`, so the expectation is built from native
// paths instead of hardcoded Windows separators (which fail on POSIX runners).
const sep = path.sep;
const appRoot = `${process.cwd()}${sep}app-root`;

test('resolves the settings window files from an unpackaged app root', () => {
  expect(settingsWindowPaths(appRoot)).toEqual({
    preload: `${appRoot}${sep}dist${sep}preload${sep}preload.cjs`,
    html: `${appRoot}${sep}dist${sep}renderer${sep}settings.html`,
  });
});

test('resolves the settings window files from inside the packaged asar', () => {
  const asarRoot = `${process.cwd()}${sep}resources${sep}app.asar`;

  expect(settingsWindowPaths(asarRoot)).toEqual({
    preload: `${asarRoot}${sep}dist${sep}preload${sep}preload.cjs`,
    html: `${asarRoot}${sep}dist${sep}renderer${sep}settings.html`,
  });
});
