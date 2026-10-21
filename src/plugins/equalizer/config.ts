import {
  BAND_FREQUENCIES,
  DEFAULT_Q,
  filterTypeForBand,
  presetConfigs,
  type FilterConfig,
  type Preset,
} from './presets';

export const MIN_GAIN_DB = -30;
export const MAX_GAIN_DB = 30;
export const MIN_OUTPUT_GAIN_DB = -30;
export const MAX_OUTPUT_GAIN_DB = 10;
export const MIN_FREQUENCY = 20;
export const MAX_FREQUENCY = 22050;
export const MIN_Q = 0.1;
export const MAX_Q = 30;
export const MAX_USER_PRESETS = 100;
export const MAX_RECENT_PRESETS = 3;

export type EqualizerBand = FilterConfig & { id: string };

export type EqualizerProfile = {
  filters: EqualizerBand[];
  /** Omitted means "leave the current output gain alone" (Ears Bass Boost). */
  outputGainDb?: number;
};

export type UserPreset = EqualizerProfile & {
  id: string;
  name: string;
};

export type LegacyFilterConfig = FilterConfig;

export type EqualizerPluginConfig = {
  enabled: boolean;
  /** The EQ passes audio, but leaves the response flat for A/B checks. */
  bypass: boolean;
  /** Output trim after the filter chain, in dB. Never touches player volume. */
  outputGainDb: number;
  /** Fixed 11-band layout; defaults stay empty to survive array deep-merging. */
  filters: EqualizerBand[];
  /** Last applied built-in or user preset id. */
  activePreset: string;
  recentPresets: string[];
  userPresets: UserPreset[];
  /** Legacy settings, retained so an older build can still read the config. */
  presets?: Record<string, boolean>;
};

export const bandId = (index: number) => `band${index}`;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const isFilterType = (value: unknown): value is BiquadFilterType =>
  value === 'peaking' ||
  value === 'lowshelf' ||
  value === 'highshelf' ||
  value === 'lowpass' ||
  value === 'highpass' ||
  value === 'bandpass' ||
  value === 'notch' ||
  value === 'allpass';

export function normalizeBand(
  value: Partial<EqualizerBand> | undefined,
  index: number,
): EqualizerBand {
  return {
    id: typeof value?.id === 'string' && value.id ? value.id : bandId(index),
    type: isFilterType(value?.type) ? value.type : filterTypeForBand(index),
    frequency: clamp(
      finite(value?.frequency, BAND_FREQUENCIES[index]),
      MIN_FREQUENCY,
      MAX_FREQUENCY,
    ),
    Q: clamp(finite(value?.Q, DEFAULT_Q), MIN_Q, MAX_Q),
    gain: clamp(finite(value?.gain, 0), MIN_GAIN_DB, MAX_GAIN_DB),
  };
}

/**
 * Complete the fixed layout. Arrangement is positional: index 0 is the low
 * shelf, the last index is the high shelf, and everything between peaks.
 */
export function normalizeFilters(value: unknown): EqualizerBand[] {
  const source = Array.isArray(value) ? value : [];
  return BAND_FREQUENCIES.map((_, index) =>
    normalizeBand(
      source[index] && typeof source[index] === 'object'
        ? (source[index] as Partial<EqualizerBand>)
        : undefined,
      index,
    ),
  );
}

export function filtersFromGains(gains: readonly number[]): EqualizerBand[] {
  return BAND_FREQUENCIES.map((frequency, index) =>
    normalizeBand(
      {
        id: bandId(index),
        type: filterTypeForBand(index),
        frequency,
        Q: DEFAULT_Q,
        gain: gains[index] ?? 0,
      },
      index,
    ),
  );
}

export function flatProfile(): EqualizerProfile {
  return { outputGainDb: 0, filters: filtersFromGains(presetConfigs.flat) };
}

export function builtInProfile(preset: Preset): EqualizerProfile {
  return {
    // Ears' Bass Boost leaves the volume untouched; Flat resets it to unity.
    ...(preset === 'flat' ? { outputGainDb: 0 } : {}),
    filters: filtersFromGains(presetConfigs[preset]),
  };
}

export const defaultConfig: EqualizerPluginConfig = {
  enabled: false,
  bypass: false,
  outputGainDb: 0,
  // Empty on purpose: config loaders use array-concatenating deepmerge, while
  // setPartial replaces arrays. Normalizers fill this to exactly 11 bands.
  filters: [],
  activePreset: 'flat',
  recentPresets: [],
  userPresets: [],
};

const normalizePresetList = (value: unknown): UserPreset[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const presets: UserPreset[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Partial<UserPreset>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name || name.length > 80) continue;
    const id =
      typeof item.id === 'string' && item.id
        ? item.id
        : `preset-${presets.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    presets.push({
      id,
      name,
      outputGainDb: clamp(
        finite(item.outputGainDb, 0),
        MIN_OUTPUT_GAIN_DB,
        MAX_OUTPUT_GAIN_DB,
      ),
      filters: normalizeFilters(item.filters),
    });
    if (presets.length >= MAX_USER_PRESETS) break;
  }
  return presets;
};

/**
 * Turn stored, legacy or partially missing data into a complete live config.
 * This never mutates the input: unknown/legacy keys are retained by the store.
 */
export function normalizeConfig(
  raw: Partial<EqualizerPluginConfig> | undefined,
): EqualizerPluginConfig {
  const source = raw ?? {};
  const storedFilters = Array.isArray(source.filters) ? source.filters : [];
  let filters = normalizeFilters(storedFilters);

  // The old plugin concatenated filters and the bass-booster toggle. Until a
  // user has saved a full 11-band profile, migrate that behaviour rather than
  // silently dropping their sound.
  if (
    storedFilters.length < BAND_FREQUENCIES.length &&
    source.presets?.['bass-booster']
  ) {
    filters = filters.map((band, index) => ({
      ...band,
      gain: clamp(
        band.gain + presetConfigs['bass-booster'][index],
        MIN_GAIN_DB,
        MAX_GAIN_DB,
      ),
    }));
  }

  const activePreset =
    typeof source.activePreset === 'string' && source.activePreset
      ? source.activePreset
      : source.presets?.['bass-booster']
        ? 'bass-booster'
        : 'flat';
  const seenRecent = new Set<string>();
  const recentPresets = (
    Array.isArray(source.recentPresets) ? source.recentPresets : []
  )
    .filter((item): item is string => typeof item === 'string' && Boolean(item))
    .filter((item) => {
      if (seenRecent.has(item)) return false;
      seenRecent.add(item);
      return true;
    })
    .slice(0, MAX_RECENT_PRESETS);

  return {
    enabled: Boolean(source.enabled),
    bypass: Boolean(source.bypass),
    outputGainDb: clamp(
      finite(source.outputGainDb, 0),
      MIN_OUTPUT_GAIN_DB,
      MAX_OUTPUT_GAIN_DB,
    ),
    filters,
    activePreset,
    recentPresets,
    userPresets: normalizePresetList(source.userPresets),
    ...(source.presets ? { presets: source.presets } : {}),
  };
}

const filtersMatch = (left: EqualizerBand[], right: EqualizerBand[]) => {
  const a = normalizeFilters(left);
  const b = normalizeFilters(right);
  return a.every(
    (band, index) =>
      band.type === b[index].type &&
      Math.abs(band.frequency - b[index].frequency) < 0.5 &&
      Math.abs(band.gain - b[index].gain) < 0.02 &&
      Math.abs(band.Q - b[index].Q) < 0.005,
  );
};

export function profilesMatch(
  left: EqualizerProfile,
  right: EqualizerProfile,
): boolean {
  return (
    (right.outputGainDb === undefined ||
      Math.abs((left.outputGainDb ?? 0) - right.outputGainDb) < 0.01) &&
    filtersMatch(left.filters, right.filters)
  );
}

/** The preset matching the live profile, or null when it was edited. */
export function matchingPreset(config: EqualizerPluginConfig): string | null {
  for (const preset of ['flat', 'bass-booster'] as const) {
    if (profilesMatch(config, builtInProfile(preset))) return preset;
  }
  return (
    config.userPresets.find((preset) => profilesMatch(config, preset))?.id ??
    null
  );
}

export function snapshotProfile(
  config: EqualizerPluginConfig,
): EqualizerProfile {
  return {
    outputGainDb: config.outputGainDb,
    filters: structuredClone(normalizeFilters(config.filters)),
  };
}

const profileFromEarsPreset = (
  id: string,
  name: string,
  value: Record<string, unknown>,
): UserPreset | null => {
  if (!Array.isArray(value.filters)) return null;
  const filters = normalizeFilters(
    value.filters.slice(0, BAND_FREQUENCIES.length).map((filter) => {
      if (!filter || typeof filter !== 'object') return undefined;
      const entry = filter as Record<string, unknown>;
      return {
        type: entry.type,
        frequency: entry.frequency,
        gain: entry.gain,
        Q: entry.q ?? entry.Q,
      };
    }),
  );
  const linearGain =
    typeof value.gain === 'number' && value.gain > 0 ? value.gain : 1;
  return {
    id,
    name,
    outputGainDb: clamp(
      20 * Math.log10(linearGain),
      MIN_OUTPUT_GAIN_DB,
      MAX_OUTPUT_GAIN_DB,
    ),
    filters,
  };
};

/** Accept this plugin's export, an Ears preset export, or a bare preset map. */
export function parsePresetImport(text: string): UserPreset[] {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Preset file must contain a JSON object or array.');
  }
  const candidates: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { presets?: unknown }).presets)
      ? ((parsed as { presets: unknown[] }).presets ?? [])
      : Object.entries(
          ((parsed as { presets?: Record<string, unknown> }).presets ??
            parsed) as Record<string, unknown>,
        ).map(([name, value]) => ({ name, value }));

  const imported: UserPreset[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== 'object') continue;
    if ('value' in candidate) {
      const entry = candidate as { name: string; value: unknown };
      if (entry.value && typeof entry.value === 'object') {
        const preset = profileFromEarsPreset(
          `import-${Date.now()}-${index}`,
          entry.name,
          entry.value as Record<string, unknown>,
        );
        if (preset) imported.push(preset);
      }
      continue;
    }
    const item = candidate as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name || !Array.isArray(item.filters)) continue;
    imported.push({
      id:
        typeof item.id === 'string' && item.id
          ? item.id
          : `import-${Date.now()}-${index}`,
      name: name.slice(0, 80),
      outputGainDb: clamp(
        finite(item.outputGainDb, 0),
        MIN_OUTPUT_GAIN_DB,
        MAX_OUTPUT_GAIN_DB,
      ),
      filters: normalizeFilters(item.filters),
    });
  }
  return imported;
}
