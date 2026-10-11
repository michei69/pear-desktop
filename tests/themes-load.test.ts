import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { readThemesFrom } from '../src/themes/load';

const makeDir = () => fs.mkdtempSync(join(os.tmpdir(), 'pear-themes-test-'));

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

test('reads a theme folder, joining its css files in order', () => {
  const root = makeDir();
  writeTheme(
    root,
    'my-theme',
    {
      name: 'My Theme',
      palette: { accent: '#22c55e' },
      css: ['a.css', 'b.css'],
    },
    { 'a.css': 'a{}', 'b.css': 'b{}' },
  );

  expect(readThemesFrom(root)).toEqual([
    {
      id: 'my-theme',
      name: 'My Theme',
      description: undefined,
      author: undefined,
      palette: { accent: '#22c55e' },
      css: 'a{}\nb{}',
    },
  ]);
});

test('a folder without a manifest is skipped, not fatal', () => {
  const root = makeDir();
  fs.mkdirSync(join(root, 'no-manifest'));
  writeTheme(root, 'valid', { name: 'Valid' });

  expect(readThemesFrom(root).map((theme) => theme.id)).toEqual(['valid']);
});

test('an invalid manifest is skipped and css defaults to empty', () => {
  const root = makeDir();
  fs.mkdirSync(join(root, 'broken'), { recursive: true });
  fs.writeFileSync(join(root, 'broken', 'theme.json'), 'not json');
  writeTheme(root, 'no-css', { name: 'No CSS' });

  const themes = readThemesFrom(root);
  expect(themes.map((theme) => theme.id)).toEqual(['no-css']);
  expect(themes[0].css).toBe('');
  // Absent, not empty: a theme with no palette offers its presets in place of
  // Default, while an empty one still has Default to fall back on.
  expect(themes[0].palette).toBeUndefined();
  expect(themes[0].presets).toBeUndefined();
});

test("an empty palette is kept, so 'palette': {} keeps its Default", () => {
  const root = makeDir();
  writeTheme(root, 'empty-palette', { name: 'Empty', palette: {} });
  writeTheme(root, 'no-palette', { name: 'None' });

  // Looked up by id: `readdirSync` order is not the order they were written.
  const themes = readThemesFrom(root);
  const empty = themes.find((theme) => theme.id === 'empty-palette');
  const none = themes.find((theme) => theme.id === 'no-palette');
  expect(empty?.palette).toEqual({});
  expect(none?.palette).toBeUndefined();
});

test('themes are read in folder-name order, whatever the filesystem says', () => {
  const root = makeDir();
  // `é` comes after `z` in raw byte order but before it in a locale collation, so
  // this passes only when the reader sorts rather than trusting readdir.
  writeTheme(root, 'z', { name: 'Zeta' });
  writeTheme(root, 'é', { name: 'Eacute' });
  writeTheme(root, 'a', { name: 'Alpha' });

  expect(readThemesFrom(root).map((theme) => theme.id)).toEqual([
    'a',
    'é',
    'z',
  ]);
});

test('a missing css file is dropped without losing the theme', () => {
  const root = makeDir();
  writeTheme(
    root,
    'partial',
    { name: 'Partial', css: ['present.css', 'missing.css'] },
    { 'present.css': 'present{}' },
  );

  expect(readThemesFrom(root)[0].css).toBe('present{}');
});

test('a missing themes directory yields no themes', () => {
  expect(readThemesFrom(join(os.tmpdir(), 'pear-does-not-exist-xyz'))).toEqual(
    [],
  );
});

test('the id falls back to the folder name when name is absent', () => {
  const root = makeDir();
  writeTheme(root, 'folder-name', {});

  expect(readThemesFrom(root)[0]).toMatchObject({
    id: 'folder-name',
    name: 'folder-name',
  });
});
