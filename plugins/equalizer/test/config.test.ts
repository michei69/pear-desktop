import { defaultsOf } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import {
  BAND_FREQUENCIES,
  bandsFromGains,
  builtInProfile,
  DEFAULT_Q,
  decodeBands,
  decodeUserPresets,
  encodeBands,
  encodeUserPresets,
  matchingPresetId,
  migrationPatch,
  normalizeUserPresets,
  parsePresetImport,
  presetProfile,
  profilesMatch,
  readConfig,
  schema,
  type EqualizerConfig,
  type UserPreset,
} from "../config.ts";

const config = (patch: Partial<EqualizerConfig> = {}): EqualizerConfig => ({ ...defaultsOf(schema), ...patch });

const band = (gain: number) => ({
  type: "peaking" as const,
  frequency: 1000,
  Q: DEFAULT_Q,
  gain,
});

const userPreset = (preset: Partial<UserPreset> & { name: string }): UserPreset => ({
  id: "own",
  outputGainDb: 0,
  bands: bandsFromGains([]),
  ...preset,
});

describe("stored config normalization", () => {
  it("starts from the Ears 11-band layout", () => {
    const state = readConfig(config());
    expect(state.bands).toHaveLength(11);
    expect(state.bands.map((value) => value.frequency)).toEqual([...BAND_FREQUENCIES]);
    expect(state.bands.map((value) => value.type)).toEqual([
      "lowshelf",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "peaking",
      "highshelf",
    ]);
    expect(state.bands.every((value) => value.Q === DEFAULT_Q)).toBe(true);
    expect(state.activePreset).toBe("flat");
  });

  it("round-trips the stored JSON without doubling bands or presets", () => {
    const stored = readConfig(
      config({
        bands: encodeBands(bandsFromGains([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
        userPresets: encodeUserPresets([userPreset({ name: "Own", outputGainDb: -2 })]),
        recentPresets: ["own"],
        preset: "own",
      }),
    );
    for (let repeat = 0; repeat < 4; repeat += 1) {
      expect(decodeBands(encodeBands(stored.bands))).toHaveLength(11);
      expect(decodeUserPresets(encodeUserPresets(stored.userPresets))).toHaveLength(1);
      expect(stored.recentPresets).toEqual(["own"]);
    }
  });

  it("built-in presets cover flat and bass boost", () => {
    const flat = readConfig(
      config({
        preset: "flat",
        bands: encodeBands(builtInProfile("flat").bands),
        outputGainDb: 0,
      }),
    );
    expect(profilesMatch(flat, builtInProfile("flat"))).toBe(true);
    expect(flat.activePreset).toBe("flat");

    const bass = builtInProfile("bass-booster");
    expect(bass.bands[0]?.gain).toBe(10);
    expect(bass.bands[5]?.gain).toBe(0);
    expect(presetProfile("bass-booster", [])).toEqual(bass);
  });

  it("migrates the previous rewrite's bands once, then ignores them", () => {
    const legacyConfig = config({ band32: 6, band1000: -3 });
    const legacy = readConfig(legacyConfig);
    expect(legacy.bands).toHaveLength(11);
    expect(legacy.bands[0]?.frequency).toBe(32);
    expect(legacy.bands[0]?.gain).toBe(6);
    expect(legacy.bands[5]?.gain).toBe(-3);
    // The old preamp was a plain gain before the bands; the output trim is the same gain after them.
    expect(readConfig(config({ preamp: -4 })).outputGainDb).toBe(-4);

    const patch = migrationPatch(legacyConfig);
    expect(patch?.bands).toBe(encodeBands(legacy.bands));
    expect(patch?.preset).toBe(legacy.activePreset);
    expect(migrationPatch(config({ bands: encodeBands(bandsFromGains([])) }))).toBeUndefined();

    // Once bands are stored, the legacy sliders and preset toggle are ignored.
    const saved = readConfig(
      config({
        bands: encodeBands(builtInProfile("bass-booster").bands),
        band32: 0,
        band1000: 0,
        preset: "bass-booster",
      }),
    );
    expect(saved.bands[0]?.gain).toBe(10);
    expect(saved.activePreset).toBe("bass-booster");
  });

  it("re-derives the active preset from the curve", () => {
    const state = readConfig(config({ bands: encodeBands(bandsFromGains([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0])) }));
    expect(state.activePreset).toBe("custom");
    expect(matchingPresetId(state)).toBeNull();
    expect(matchingPresetId({ ...state, bands: builtInProfile("flat").bands, outputGainDb: 0 })).toBe("flat");
  });
});

describe("preset imports", () => {
  it("converts Ears presets (linear gain, lower-case q)", () => {
    const imported = parsePresetImport(
      JSON.stringify({
        MyEarsPreset: {
          gain: 0.5,
          filters: BAND_FREQUENCIES.map((frequency, index) => ({
            type: index === 0 ? "lowshelf" : index === BAND_FREQUENCIES.length - 1 ? "highshelf" : "peaking",
            frequency,
            gain: index,
            q: DEFAULT_Q,
          })),
        },
      }),
    );
    expect(imported).toHaveLength(1);
    expect(imported[0]?.name).toBe("MyEarsPreset");
    expect(imported[0]?.outputGainDb).toBeCloseTo(-6.0206, 3);
    expect(imported[0]?.bands[10]?.gain).toBe(10);
  });

  it("regenerates ids that would shadow a built-in preset", () => {
    const presets = normalizeUserPresets([
      { id: "flat", name: "Mine", bands: [band(1)] },
      { id: "custom", name: "Other", bands: [] },
      { id: "bass-booster", name: "Boost", bands: [] },
      { id: "kept", name: "Kept", bands: [] },
    ]);
    expect(presets.map((preset) => preset.id)).toEqual(["preset-0", "preset-1", "preset-2", "kept"]);
    expect(presets.map((preset) => preset.name)).toEqual(["Mine", "Other", "Boost", "Kept"]);

    const imported = parsePresetImport(JSON.stringify({ id: "flat", name: "Imported", bands: [band(2)] }));
    expect(imported).toHaveLength(1);
    expect(imported[0]?.id).not.toBe("flat");
    expect(imported[0]?.bands[0]?.gain).toBe(2);
  });

  it("accepts this plugin's export and skips malformed entries", () => {
    const exported = JSON.stringify({
      version: 2,
      presets: [userPreset({ name: "Kept", bands: [band(3)] }), { name: "" }, { name: "No bands" }],
    });
    const imported = parsePresetImport(exported);
    expect(imported.map((preset) => preset.name)).toEqual(["Kept", "No bands"]);
    expect(imported[0]?.bands[0]?.gain).toBe(3);
    expect(() => parsePresetImport("[]")).not.toThrow();
    expect(() => parsePresetImport("42")).toThrow();
  });
});
