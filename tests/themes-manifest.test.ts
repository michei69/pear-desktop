import { expect, test } from '@playwright/test';

import {
  defaultPreset,
  normalizeThemeState,
  paletteToCss,
  parseManifest,
  presetPalette,
  resolvePalette,
} from '../src/themes/types';

test('parses a manifest with a palette and a single css file', () => {
  expect(
    parseManifest(
      JSON.stringify({
        name: 'My Theme',
        palette: { accent: '#22c55e', font: 'monospace' },
        css: 'style.css',
      }),
    ),
  ).toEqual({
    name: 'My Theme',
    palette: { accent: '#22c55e', font: 'monospace' },
    css: 'style.css',
  });
});

test('palette values are arbitrary CSS values, not just colours', () => {
  const manifest = parseManifest(
    JSON.stringify({ palette: { font: 'monospace', radius: '8px' } }),
  );
  expect(manifest?.palette).toEqual({ font: 'monospace', radius: '8px' });
});

test('rejects malformed or wrongly typed manifests', () => {
  for (const raw of [
    'not json',
    '[]',
    '"string"',
    JSON.stringify({ palette: { accent: 123 } }),
    JSON.stringify({ css: [1, 2] }),
    JSON.stringify({ palette: ['#fff'] }),
  ]) {
    expect(parseManifest(raw), raw).toBeNull();
  }
});

test('a manifest may omit palette and css', () => {
  expect(parseManifest('{}')).toEqual({});
});

test('overrides win over the theme palette and keep the other keys', () => {
  const resolved = resolvePalette(
    { accent: '#22c55e', background: '#0a0a0a' },
    { accent: '#ff00ff' },
  );
  expect(resolved).toEqual({ accent: '#ff00ff', background: '#0a0a0a' });
});

test('palette is emitted as custom properties, values verbatim', () => {
  expect(paletteToCss({ accent: '#22c55e', font: 'monospace' })).toBe(
    ':root {\n  --pear-theme-accent: #22c55e;\n  --pear-theme-font: monospace;\n}',
  );
});

test('an empty theme payload normalizes instead of crashing', () => {
  // A config predating these keys yields an empty payload; reading a palette
  // override off it used to throw and abort renderer init.
  expect(normalizeThemeState({})).toEqual({
    themes: [],
    selected: '',
    overrides: {},
  });
  expect(normalizeThemeState({ themes: [], selected: 'basic' })).toEqual({
    themes: [],
    selected: 'basic',
    overrides: {},
  });
});

test('defaults survive a payload with explicit undefined values', () => {
  expect(
    normalizeThemeState({ themes: undefined, selected: undefined }),
  ).toEqual({ themes: [], selected: '', overrides: {} });
});

test("a declared palette keeps Default, even with 'palette': {}", () => {
  const presets = { blue: { accent: '#0000ff' } };
  // The empty record is the point: declared, so there is a Default, and the
  // first preset must not stand in for it.
  const empty = {};

  expect(defaultPreset(empty, presets, undefined)).toBeUndefined();
  expect(defaultPreset(empty, presets, '')).toBe('');
  expect(presetPalette(empty, presets, '', {})).toEqual({});

  // A theme with a real palette behaves the same way.
  const palette = { accent: '#ff0000' };
  expect(presetPalette(palette, presets, '', {})).toEqual({});
  expect(defaultPreset(palette, presets, undefined)).toBeUndefined();
  // An explicit pick is left alone; a name the theme no longer defines layers
  // nothing, so the theme's own palette shows through.
  expect(defaultPreset(palette, presets, 'gone')).toBe('gone');
  expect(presetPalette(palette, presets, 'gone', {})).toEqual({});
});

test('a theme with no palette at all resolves to its first preset', () => {
  const presets = { example1: { accent: '#111111' }, example2: {} };
  // No `palette` key, which is what the reader reports as undefined.
  const none = undefined;

  expect(defaultPreset(none, presets, undefined)).toBe('example1');
  expect(defaultPreset(none, presets, '')).toBe('example1');
  expect(presetPalette(none, presets, '', {})).toEqual({ accent: '#111111' });
  expect(resolvePalette(none, presetPalette(none, presets, '', {}))).toEqual({
    accent: '#111111',
  });

  // An explicit pick still wins; an unknown name layers nothing, since the first
  // preset only stands in for an untouched pick.
  expect(defaultPreset(none, presets, 'example2')).toBe('example2');
  expect(defaultPreset(none, presets, 'gone')).toBe('gone');
  expect(presetPalette(none, presets, 'gone', {})).toEqual({});

  // Nothing to stand in with.
  expect(defaultPreset(none, undefined, '')).toBeUndefined();
  expect(presetPalette(none, undefined, '', {})).toEqual({});
});
