import { expect, test } from '@playwright/test';
import { deepmerge } from 'deepmerge-ts';

import {
  builtInProfile,
  defaultConfig,
  flatProfile,
  matchingPreset,
  normalizeConfig,
  normalizeFilters,
  parsePresetImport,
  profilesMatch,
} from '../src/plugins/equalizer/config';
import { BAND_FREQUENCIES, DEFAULT_Q } from '../src/plugins/equalizer/presets';

test('empty defaults normalize to the Ears 11-band layout', () => {
  expect(defaultConfig.filters).toEqual([]);
  const config = normalizeConfig(deepmerge(defaultConfig, {}));
  expect(config.filters).toHaveLength(11);
  expect(config.filters.map((band) => band.frequency)).toEqual([
    ...BAND_FREQUENCIES,
  ]);
  expect(config.filters.map((band) => band.type)).toEqual([
    'lowshelf',
    'peaking',
    'peaking',
    'peaking',
    'peaking',
    'peaking',
    'peaking',
    'peaking',
    'peaking',
    'peaking',
    'highshelf',
  ]);
  expect(config.filters.every((band) => band.Q === DEFAULT_Q)).toBe(true);
});

test('array defaults survive repeated loader deep-merges without doubling', () => {
  const stored = normalizeConfig({
    filters: normalizeFilters(
      flatProfile().filters.map((band) => ({ ...band, gain: 3 })),
    ),
    userPresets: [
      {
        id: 'own',
        name: 'Own',
        outputGainDb: -2,
        filters: flatProfile().filters,
      },
    ],
    recentPresets: ['own'],
  });
  for (let repeat = 0; repeat < 4; repeat += 1) {
    const merged = normalizeConfig(deepmerge(defaultConfig, stored));
    expect(merged.filters).toHaveLength(11);
    expect(merged.userPresets).toHaveLength(1);
    expect(merged.recentPresets).toEqual(['own']);
  }
});

test('built-in presets and profile matching cover flat and bass boost', () => {
  const flat = normalizeConfig({
    ...flatProfile(),
    enabled: true,
  });
  expect(matchingPreset(flat)).toBe('flat');
  expect(profilesMatch(flat, builtInProfile('flat'))).toBe(true);

  const bass = normalizeConfig({
    ...builtInProfile('bass-booster'),
    enabled: true,
  });
  expect(bass.filters[0].gain).toBe(10);
  expect(bass.filters[5].gain).toBe(0);
  expect(matchingPreset(bass)).toBe('bass-booster');
});

test('Ears preset imports convert linear gain and lower-case q', () => {
  const imported = parsePresetImport(
    JSON.stringify({
      MyEarsPreset: {
        gain: 0.5,
        filters: BAND_FREQUENCIES.map((frequency, index) => ({
          type:
            index === 0
              ? 'lowshelf'
              : index === BAND_FREQUENCIES.length - 1
                ? 'highshelf'
                : 'peaking',
          frequency,
          gain: index,
          q: DEFAULT_Q,
        })),
      },
    }),
  );
  expect(imported).toHaveLength(1);
  expect(imported[0].name).toBe('MyEarsPreset');
  expect(imported[0].outputGainDb).toBeCloseTo(-6.0206, 3);
  expect(imported[0].filters[10].gain).toBe(10);
});

test('legacy filters and bass-booster toggle migrate until a full profile exists', () => {
  const legacy = normalizeConfig({
    filters: [],
    presets: { 'bass-booster': true },
  });
  expect(legacy.activePreset).toBe('bass-booster');
  expect(legacy.filters[0].gain).toBe(10);

  const saved = normalizeConfig({
    filters: flatProfile().filters,
    presets: { 'bass-booster': true },
  });
  expect(saved.filters[0].gain).toBe(0);
});
