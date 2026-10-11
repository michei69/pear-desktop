import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { isJsConsented, readThemesFrom } from '../src/themes/load';

const makeDir = () => fs.mkdtempSync(join(os.tmpdir(), 'pear-themes-js-'));

const writeTheme = (
  root: string,
  id: string,
  manifest: unknown,
  files: Record<string, string> = {},
) => {
  const folder = join(root, id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(join(folder, 'theme.json'), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(join(folder, name), content);
  }
};

test('a declared script is read and hashed', () => {
  const root = makeDir();
  writeTheme(
    root,
    'js-theme',
    { name: 'JS', js: 'theme.js' },
    {
      'theme.js': 'module.exports = {};',
    },
  );

  const [theme] = readThemesFrom(root);
  expect(theme.js?.source).toBe('module.exports = {};');
  // The digest consent is pinned to, computed outside `hashThemeJs` so a broken
  // hash function cannot agree with itself.
  expect(theme.js?.hash).toBe(
    '1cf3e1eeed2d717d4dba8a101c28b71f65e908beb02f90371b11f927125b8390',
  );
});

test('a theme without js has no script', () => {
  const root = makeDir();
  writeTheme(root, 'css-only', { name: 'CSS' });
  expect(readThemesFrom(root)[0].js).toBeUndefined();
});

test('a missing js file degrades to no script rather than failing', () => {
  const root = makeDir();
  writeTheme(root, 'broken', { name: 'Broken', js: 'nope.js' });
  expect(readThemesFrom(root)[0].js).toBeUndefined();
});

test('the hash changes when the script contents change', () => {
  const root = makeDir();
  writeTheme(
    root,
    'changing',
    { name: 'Changing', js: 'theme.js' },
    {
      'theme.js': 'module.exports = { mount() {} };',
    },
  );
  const before = readThemesFrom(root)[0].js!.hash;

  fs.writeFileSync(
    join(root, 'changing', 'theme.js'),
    'module.exports = { mount() { /* different */ } };',
  );
  const after = readThemesFrom(root)[0].js!.hash;

  expect(after).not.toBe(before);
});

test('editing theme.json alone does not change the hash', () => {
  const root = makeDir();
  writeTheme(
    root,
    'palette-change',
    { name: 'One', palette: { accent: '#fff' }, js: 'theme.js' },
    { 'theme.js': 'module.exports = {};' },
  );
  const before = readThemesFrom(root)[0].js!.hash;

  // A palette/name tweak must not re-prompt; only the code matters.
  writeTheme(
    root,
    'palette-change',
    { name: 'Two', palette: { accent: '#000' }, js: 'theme.js' },
    { 'theme.js': 'module.exports = {};' },
  );
  expect(readThemesFrom(root)[0].js!.hash).toBe(before);
});

test('consent is required until the current hash is recorded', () => {
  const theme = { id: 't', js: { source: 'x', hash: 'abc' } };

  expect(isJsConsented(theme, {})).toBe(false);
  expect(isJsConsented(theme, { t: 'other' })).toBe(false);
  expect(isJsConsented(theme, { t: 'abc' })).toBe(true);
});

test('a theme with no script never needs consent', () => {
  expect(isJsConsented({ id: 't' }, {})).toBe(true);
});

test('a stale consent entry for changed code does not carry over', () => {
  const root = makeDir();
  writeTheme(
    root,
    'swap',
    { name: 'Swap', js: 'theme.js' },
    {
      'theme.js': 'module.exports = {};',
    },
  );
  const consent = { swap: readThemesFrom(root)[0].js!.hash };

  fs.writeFileSync(join(root, 'swap', 'theme.js'), 'alert(1)');

  // The recorded hash was for the old source, so the new code is not consented.
  expect(isJsConsented(readThemesFrom(root)[0], consent)).toBe(false);
});
