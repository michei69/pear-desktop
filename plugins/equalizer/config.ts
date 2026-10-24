// The equalizer's settings: an 11-band Ears-style layout plus presets. The
// page-side panel edits `bands`, `preset`, `recentPresets` and `userPresets`;
// they are stored as JSON in string/list fields because the settings schema has
// no object kind. The schema keeps the previous rewrite's keys (preamp and the
// 10 band sliders) and the older pear-desktop `filters` JSON, so an upgrade
// migrates the sound instead of resetting it.

import { config, type ConfigOf } from "@pear/sdk";
import { clamp } from "@pear/sdk/util";

/** Fixed Ears Audio Toolkit layout; defaults for a fresh profile. */
export const BAND_FREQUENCIES = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480] as const;
export const DEFAULT_Q = Math.SQRT1_2;

export const MIN_GAIN_DB = -30;
export const MAX_GAIN_DB = 30;
export const MIN_OUTPUT_GAIN_DB = -30;
/** The fork's trim went to +10 dB; +12 covers the previous rewrite's preamp unchanged. */
export const MAX_OUTPUT_GAIN_DB = 12;
export const MIN_FREQUENCY = 20;
export const MAX_FREQUENCY = 22050;
export const MIN_Q = 0.1;
export const MAX_Q = 30;
export const MAX_USER_PRESETS = 100;
export const MAX_RECENT_PRESETS = 3;

/** The previous rewrite's 10 bands, kept only to migrate their settings. */
const LEGACY_BANDS = [
  { key: "band32", frequency: 32 },
  { key: "band64", frequency: 64 },
  { key: "band125", frequency: 125 },
  { key: "band250", frequency: 250 },
  { key: "band500", frequency: 500 },
  { key: "band1000", frequency: 1000 },
  { key: "band2000", frequency: 2000 },
  { key: "band4000", frequency: 4000 },
  { key: "band8000", frequency: 8000 },
  { key: "band16000", frequency: 16000 },
] as const;
const LEGACY_Q = 1.41;

/** The old presets' gains, for configs where the band values were never written. */
const LEGACY_PRESET_GAINS: Readonly<Record<string, readonly number[]>> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "bass-booster": [12, 10, 7, 3, 0, 0, 0, 0, 0, 0],
  "treble-booster": [0, 0, 0, 0, 0, 1, 3, 6, 9, 10],
  "vocal-booster": [-2, -2, -1, 1, 3, 4, 4, 2, 0, -1],
  rock: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
  pop: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  electronic: [6, 5, 2, 0, -2, 1, 0, 2, 5, 6],
  acoustic: [4, 3, 2, 1, 1, 1, 2, 3, 3, 2],
  loudness: [6, 4, 0, 0, -2, 0, -1, -4, 4, 1],
};

export const FILTER_TYPES: readonly BiquadFilterType[] = [
  "peaking",
  "lowshelf",
  "highshelf",
  "lowpass",
  "highpass",
  "bandpass",
  "notch",
  "allpass",
];

export type Band = {
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
};

export type Profile = {
  bands: Band[];
  /** Omitted means "leave the current output gain alone" (Bass Booster). */
  outputGainDb?: number;
};

export type UserPreset = Profile & { id: string; name: string; outputGainDb: number };

export type EqualizerState = {
  bypass: boolean;
  outputGainDb: number;
  bands: Band[];
  activePreset: string;
  recentPresets: string[];
  userPresets: UserPreset[];
};

export const schema = {
  bypass: config.bool(false, {
    label: "Bypass",
    description: "Pass the audio through unchanged while keeping your settings.",
    group: "Equalizer",
  }),
  outputGainDb: config.number(0, {
    label: "Output gain",
    description: "Trim after the filters, in dB. Lower it to avoid clipping when boosting bands.",
    min: MIN_OUTPUT_GAIN_DB,
    max: MAX_OUTPUT_GAIN_DB,
    step: 0.1,
    unit: " dB",
    group: "Equalizer",
  }),
  filters: config.string("", {
    label: "Extra filters (advanced)",
    description:
      'A JSON list of biquad filters added in parallel to the bands, as pear-desktop did, e.g. [{"type":"lowshelf","frequency":80,"Q":100,"gain":12}].',
    placeholder: "[]",
    group: "Advanced",
  }),
  // The panel's active preset id (built-in, user preset, or "custom"). A string
  // rather than a select: user preset ids are only known at runtime.
  preset: config.string("flat", { label: "Active preset", platforms: [] }),
  // JSON arrays, kept out of the generated settings UI; the panel edits them.
  bands: config.string("", { label: "Bands", platforms: [] }),
  recentPresets: config.list([], { label: "Recent presets", platforms: [] }),
  userPresets: config.string("", { label: "User presets", platforms: [] }),
  // The previous rewrite's settings, read once while `bands` is empty.
  preamp: config.number(0, { label: "Preamp (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
  band32: config.number(0, { label: "32 Hz (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
  band64: config.number(0, { label: "64 Hz (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
  band125: config.number(0, { label: "125 Hz (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
  band250: config.number(0, { label: "250 Hz (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
  band500: config.number(0, { label: "500 Hz (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
  band1000: config.number(0, { label: "1 kHz (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
  band2000: config.number(0, { label: "2 kHz (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
  band4000: config.number(0, { label: "4 kHz (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
  band8000: config.number(0, { label: "8 kHz (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
  band16000: config.number(0, { label: "16 kHz (legacy)", min: -12, max: 12, step: 0.5, unit: " dB", platforms: [] }),
};

export type EqualizerConfig = ConfigOf<typeof schema>;

const finite = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export const isFilterType = (value: unknown): value is BiquadFilterType => FILTER_TYPES.includes(value as BiquadFilterType);

export const filterTypeForBand = (index: number): BiquadFilterType => {
  if (index === 0) return "lowshelf";
  if (index === BAND_FREQUENCIES.length - 1) return "highshelf";
  return "peaking";
};

export function normalizeBand(value: unknown, index: number): Band {
  const band: Partial<Band> = value && typeof value === "object" ? (value as Partial<Band>) : {};
  return {
    type: isFilterType(band.type) ? band.type : filterTypeForBand(index),
    frequency: clamp(finite(band.frequency, BAND_FREQUENCIES[index] ?? MIN_FREQUENCY), MIN_FREQUENCY, MAX_FREQUENCY),
    Q: clamp(finite(band.Q, DEFAULT_Q), MIN_Q, MAX_Q),
    gain: clamp(finite(band.gain, 0), MIN_GAIN_DB, MAX_GAIN_DB),
  };
}

/** Complete the fixed 11-band layout, positionally. */
export function normalizeBands(value: unknown): Band[] {
  const source = Array.isArray(value) ? value : [];
  return BAND_FREQUENCIES.map((_, index) => normalizeBand(source[index], index));
}

export function bandsFromGains(gains: readonly number[]): Band[] {
  return BAND_FREQUENCIES.map((frequency, index) => ({
    type: filterTypeForBand(index),
    frequency,
    Q: DEFAULT_Q,
    gain: clamp(gains[index] ?? 0, MIN_GAIN_DB, MAX_GAIN_DB),
  }));
}

export const defaultBands = () => bandsFromGains([]);

export function builtInProfile(preset: "flat" | "bass-booster"): Profile {
  return {
    // Ears' Bass Boost leaves the volume untouched; Flat resets it to unity.
    ...(preset === "flat" ? { outputGainDb: 0 } : {}),
    bands: bandsFromGains(preset === "flat" ? [] : [10, 8, 6, 3, 1, 0, 0, 0, 0, 0, 0]),
  };
}

/** A built-in or user preset by id. */
export function presetProfile(id: string, userPresets: readonly UserPreset[]): Profile | undefined {
  if (id === "flat" || id === "bass-booster") return builtInProfile(id);
  return userPresets.find((preset) => preset.id === id);
}

export const decodeBands = (value: string): Band[] | undefined => {
  if (!value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeBands(parsed) : undefined;
  } catch {
    return undefined;
  }
};

export const encodeBands = (bands: readonly Band[]) => JSON.stringify(normalizeBands(bands));

/** The sound of the previous rewrite: its 10 bands, then a flat 11th one. */
function legacyBands(config: Readonly<EqualizerConfig>): Band[] {
  const values = LEGACY_BANDS.map(({ key }) => clamp(finite(config[key], 0), -12, 12));
  const presetGains = LEGACY_PRESET_GAINS[config.preset];
  const gains = values.some((gain) => gain !== 0) ? values : (presetGains ?? values);
  // A flat old EQ is the same sound as a flat new one; use the new layout so it
  // is recognised as the Flat profile instead of a custom curve.
  if (gains.every((gain) => gain === 0)) return defaultBands();
  return [
    ...LEGACY_BANDS.map(({ frequency }, index): Band => ({
      type: index === 0 ? "lowshelf" : index === LEGACY_BANDS.length - 1 ? "highshelf" : "peaking",
      frequency,
      Q: LEGACY_Q,
      gain: clamp(gains[index] ?? 0, MIN_GAIN_DB, MAX_GAIN_DB),
    })),
    { type: "peaking", frequency: BAND_FREQUENCIES[BAND_FREQUENCIES.length - 1] ?? MAX_FREQUENCY, Q: DEFAULT_Q, gain: 0 },
  ];
}

const filtersMatch = (left: readonly Band[], right: readonly Band[]) => {
  const a = normalizeBands(left);
  const b = normalizeBands(right);
  return a.every(
    (band, index) =>
      band.type === b[index]!.type &&
      Math.abs(band.frequency - b[index]!.frequency) < 0.5 &&
      Math.abs(band.gain - b[index]!.gain) < 0.02 &&
      Math.abs(band.Q - b[index]!.Q) < 0.005,
  );
};

export function profilesMatch(left: Profile, right: Profile): boolean {
  return (
    (right.outputGainDb === undefined || Math.abs((left.outputGainDb ?? 0) - right.outputGainDb) < 0.01) &&
    filtersMatch(left.bands, right.bands)
  );
}

/** The built-in or user preset matching the live profile, or null when edited. */
export function matchingPresetId(state: Pick<EqualizerState, "bands" | "outputGainDb" | "userPresets">): string | null {
  for (const preset of ["flat", "bass-booster"] as const) {
    if (profilesMatch(state, builtInProfile(preset))) return preset;
  }
  return state.userPresets.find((preset) => profilesMatch(state, preset))?.id ?? null;
}

const normalizePresetName = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 80) : "");

/** Ears writes `q`, BiquadFilterNode writes `Q`; accept either. */
const bandEntries = (value: unknown) => {
  if (!Array.isArray(value)) return value;
  return value.map((filter) => {
    if (!filter || typeof filter !== "object") return undefined;
    const entry = filter as Record<string, unknown>;
    return { type: entry.type, frequency: entry.frequency, gain: entry.gain, Q: entry.q ?? entry.Q };
  });
};

function normalizeUserPreset(value: unknown, index: number, seen: Set<string>): UserPreset | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  const name = normalizePresetName(item.name);
  if (!name) return;
  let id = typeof item.id === "string" && item.id ? item.id : `preset-${index}`;
  while (seen.has(id)) id = `${id}-${index}`;
  seen.add(id);
  const bands = Array.isArray(item.bands) ? item.bands : item.filters;
  const gain = item.gain;
  const linearGain = typeof gain === "number" && gain > 0 ? gain : 1;
  return {
    id,
    name,
    outputGainDb:
      item.outputGainDb === undefined
        ? clamp(20 * Math.log10(linearGain), MIN_OUTPUT_GAIN_DB, MAX_OUTPUT_GAIN_DB)
        : clamp(finite(item.outputGainDb, 0), MIN_OUTPUT_GAIN_DB, MAX_OUTPUT_GAIN_DB),
    bands: normalizeBands(bandEntries(bands)),
  };
}

export function normalizeUserPresets(value: unknown): UserPreset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const presets: UserPreset[] = [];
  for (const [index, item] of value.entries()) {
    const preset = normalizeUserPreset(item, index, seen);
    if (!preset) continue;
    presets.push(preset);
    if (presets.length >= MAX_USER_PRESETS) break;
  }
  return presets;
}

export const decodeUserPresets = (value: string): UserPreset[] => {
  if (!value.trim()) return [];
  try {
    return normalizeUserPresets(JSON.parse(value));
  } catch {
    return [];
  }
};

export const encodeUserPresets = (presets: readonly UserPreset[]) => JSON.stringify(normalizeUserPresets(presets));

const normalizeRecent = (value: readonly string[], presets: readonly UserPreset[]) => {
  const valid = new Set(["flat", "bass-booster", ...presets.map((preset) => preset.id)]);
  const seen = new Set<string>();
  const recent: string[] = [];
  for (const id of value) {
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    recent.push(id);
    if (recent.length >= MAX_RECENT_PRESETS) break;
  }
  return recent;
};

/**
 * The live state, from the stored config. While `bands` is empty (an upgraded
 * profile) the previous rewrite's preset, preamp and band sliders are
 * interpreted; migrating writes `bands`, after which they are ignored.
 */
export function readConfig(config: Readonly<EqualizerConfig>): EqualizerState {
  const userPresets = decodeUserPresets(config.userPresets);
  const stored = decodeBands(config.bands);
  if (stored) {
    const outputGainDb = clamp(config.outputGainDb, MIN_OUTPUT_GAIN_DB, MAX_OUTPUT_GAIN_DB);
    const candidate = config.preset;
    const candidateProfile =
      candidate === "flat" || candidate === "bass-booster"
        ? builtInProfile(candidate)
        : userPresets.find((preset) => preset.id === candidate);
    const activePreset =
      candidate === "custom" || (candidateProfile && profilesMatch({ bands: stored, outputGainDb }, candidateProfile))
        ? candidate
        : "custom";
    return {
      bypass: config.bypass,
      outputGainDb,
      bands: stored,
      activePreset,
      recentPresets: normalizeRecent(config.recentPresets, userPresets),
      userPresets,
    };
  }

  const bands = legacyBands(config);
  // The old preamp was a plain gain before the bands; an output gain is the same
  // gain after them, so it preserves the old level.
  const outputGainDb = clamp(config.preamp !== 0 ? config.preamp : config.outputGainDb, MIN_OUTPUT_GAIN_DB, MAX_OUTPUT_GAIN_DB);
  const activePreset = matchingPresetId({ bands, outputGainDb, userPresets }) ?? "custom";
  return {
    bypass: config.bypass,
    outputGainDb,
    bands,
    activePreset,
    recentPresets: normalizeRecent(config.recentPresets, userPresets),
    userPresets,
  };
}

/** The one-time upgrade patch, or undefined when `bands` is already stored. */
export function migrationPatch(config: Readonly<EqualizerConfig>): Partial<EqualizerConfig> | undefined {
  if (decodeBands(config.bands)) return undefined;
  const state = readConfig(config);
  return {
    bands: encodeBands(state.bands),
    preset: state.activePreset,
    outputGainDb: state.outputGainDb,
    recentPresets: state.recentPresets,
    userPresets: encodeUserPresets(state.userPresets),
  };
}

const profileFromEarsPreset = (id: string, name: string, value: Record<string, unknown>): UserPreset | undefined => {
  const filters = Array.isArray(value.filters) ? value.filters : value.bands;
  if (!Array.isArray(filters)) return;
  const presetName = normalizePresetName(name);
  if (!presetName) return;
  const gain = value.gain;
  const linearGain = typeof gain === "number" && gain > 0 ? gain : 1;
  const importedOutputGain = value.outputGainDb;
  return {
    id,
    name: presetName,
    outputGainDb:
      typeof importedOutputGain === "number" && Number.isFinite(importedOutputGain)
        ? clamp(importedOutputGain, MIN_OUTPUT_GAIN_DB, MAX_OUTPUT_GAIN_DB)
        : clamp(20 * Math.log10(linearGain), MIN_OUTPUT_GAIN_DB, MAX_OUTPUT_GAIN_DB),
    bands: normalizeBands(bandEntries(filters)),
  };
};

/**
 * Accept this plugin's export, an Ears preset export, or a bare preset map.
 * Every preset is normalized; malformed entries are skipped.
 */
export function parsePresetImport(text: string): UserPreset[] {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Preset file must contain a JSON object or array.");
  }

  let candidates: unknown[];
  if (Array.isArray(parsed)) candidates = parsed;
  else if ("name" in parsed && typeof parsed.name === "string") candidates = [parsed];
  else if ("presets" in parsed && Array.isArray(parsed.presets)) candidates = parsed.presets;
  else if ("presets" in parsed && typeof parsed.presets === "object" && parsed.presets !== null && !Array.isArray(parsed.presets)) {
    candidates = Object.entries(parsed.presets).map(([name, value]) => ({ name, value }));
  } else {
    candidates = Object.entries(parsed).map(([name, value]) => ({ name, value }));
  }

  const imported: UserPreset[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of candidates.entries()) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    const isEarsPreset =
      "value" in candidate &&
      typeof candidate.value === "object" &&
      candidate.value !== null &&
      !Array.isArray(candidate.value) &&
      !("bands" in candidate) &&
      !("filters" in candidate);
    if (isEarsPreset) {
      if (!("name" in candidate) || typeof candidate.name !== "string") continue;
      const preset = profileFromEarsPreset(`import-${Date.now()}-${index}`, candidate.name, candidate.value as Record<string, unknown>);
      if (preset) imported.push(preset);
      continue;
    }
    const preset = normalizeUserPreset(candidate, index, seen);
    if (preset) imported.push(preset);
    if (imported.length >= MAX_USER_PRESETS) break;
  }
  return imported;
}
