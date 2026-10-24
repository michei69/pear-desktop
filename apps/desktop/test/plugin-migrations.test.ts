// pear-desktop 3.x plugin options -> the rewrite's (the 4.0.0 migration),
// one conversion at a time, then a whole 3.12 config.json through Settings
// with the real plugins' schemas.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import hostPlugins from "virtual:pear/host-plugins";
import { afterAll, describe, expect, test, vi } from "vitest";
import { Settings } from "../src/main/config.ts";
import { migrate, PLUGIN_MIGRATIONS, type StoredConfig } from "../src/main/migrations/index.ts";
import { from312, PEAR_DESKTOP_3, PLAY_BUTTON } from "./pear-desktop-3.ts";

vi.mock("electron", () => ({}));

type Json = Record<string, unknown>;

/** Runs the 4.0.0 migration over a pear-desktop 3.12 file with these plugin entries. */
function migrated(plugins: Record<string, Json>, options: Json = {}) {
  const { config } = migrate(from312({ options, plugins }), "4.0.0");
  return config.plugins!;
}

/** Applies one plugin's conversion twice: the second run must change nothing. */
function twice(id: string, entry: Json, config: StoredConfig = {}) {
  const once = structuredClone(entry);
  PLUGIN_MIGRATIONS[id]!(once, config, {});
  const again = structuredClone(once);
  PLUGIN_MIGRATIONS[id]!(again, config, {});
  expect(again).toEqual(once);
  return once;
}

describe("pear-desktop plugin options", () => {
  test("fractions become percentages", () => {
    const plugins = migrated({
      "album-color-theme": { enabled: true, ratio: 0.3, enableSeekbar: false },
      "ambient-mode": { enabled: true, opacity: 1, blur: 50 },
      "transparent-player": { enabled: true, opacity: 0.7, type: "mica" },
    });
    expect(plugins["album-color-theme"]).toMatchObject({ ratio: 30, enableSeekbar: false });
    expect(plugins["ambient-mode"]).toMatchObject({ opacity: 100, blur: 50 });
    expect(plugins["transparent-player"]).toMatchObject({ opacity: 70, type: "mica" });
    expect(twice("album-color-theme", { ratio: 0.5 })).toEqual({ ratio: 50 });
    expect(twice("transparent-player", { opacity: "half" })).toEqual({ opacity: "half" });
  });

  test("auth-proxy-adapter takes over the app's proxy option it used to forward to", () => {
    const plugins = migrated({ "auth-proxy-adapter": { enabled: true, port: 4600 } }, { proxy: "socks5://me:pw@proxy.lan:1080" });
    expect(plugins["auth-proxy-adapter"]).toEqual({ enabled: true, port: 4600, url: "socks5://me:pw@proxy.lan:1080" });
    expect(twice("auth-proxy-adapter", { url: "http://own:8080" }, { options: { proxy: "socks5://other:1" } })).toEqual({
      url: "http://own:8080",
    });
    expect(twice("auth-proxy-adapter", {}, { options: { proxy: "" } })).toEqual({});
  });

  test("crossfade: a numeric fade scaling is a logarithmic range in dB", () => {
    expect(twice("crossfade", { fadeScaling: 40 })).toEqual({ fadeScaling: "logarithmic", dynamicRange: 40 });
    // pear-desktop's prompt could store it as text, and beyond the rewrite's range.
    expect(twice("crossfade", { fadeScaling: "200" })).toEqual({ fadeScaling: "logarithmic", dynamicRange: 120 });
    expect(twice("crossfade", { fadeScaling: 0 })).toEqual({ fadeScaling: "linear" });
    expect(twice("crossfade", { fadeScaling: "logarithmic" })).toEqual({ fadeScaling: "logarithmic" });
    // Durations pear-desktop allowed beyond the sliders' ranges are kept at the ends.
    expect(twice("crossfade", { fadeInDuration: 15_000, fadeOutDuration: -5, secondsBeforeEnd: 45 })).toEqual({
      fadeInDuration: 10_000,
      fadeOutDuration: 0,
      secondsBeforeEnd: 30,
    });
  });

  test("custom-output-device: the device's name instead of its id", () => {
    const devices = { abc123: "USB DAC", def456: "" };
    expect(twice("custom-output-device", { output: "abc123", devices })).toMatchObject({ output: "USB DAC" });
    // No name known: the id still works.
    expect(twice("custom-output-device", { output: "def456", devices })).toMatchObject({ output: "def456" });
    expect(twice("custom-output-device", { output: "default", devices })).toMatchObject({ output: "" });
  });

  test("discord: renamed options, seconds, and the status display enum", () => {
    expect(
      twice("discord", { [PLAY_BUTTON]: false, activityTimeoutTime: 5 * 60_000, statusDisplayType: 1, hideGitHubButton: true }),
    ).toEqual({
      [PLAY_BUTTON]: false,
      playButton: false,
      activityTimeoutTime: 300_000,
      activityTimeoutSeconds: 300,
      statusDisplayType: "state",
      hideGitHubButton: true,
    });
    expect(twice("discord", { statusDisplayType: 0 })).toMatchObject({ statusDisplayType: "name" });
    expect(twice("discord", { statusDisplayType: 2 })).toMatchObject({ statusDisplayType: "details" });
    expect(twice("discord", { statusDisplayType: 7 })).toMatchObject({ statusDisplayType: 7 });
    // pear-desktop never armed a zero timeout: the activity stayed while paused.
    expect(twice("discord", { activityTimeoutTime: 0 })).toEqual({ activityTimeoutTime: 0, activityTimeoutEnabled: false });
    expect(twice("discord", { activityTimeoutTime: 0, activityTimeoutEnabled: true })).not.toHaveProperty("hideWhenPaused");
    expect(twice("discord", { activityTimeoutTime: 999 * 60_000 })).toMatchObject({ activityTimeoutSeconds: 14_400 });
    // Sub-minute timeouts, which pear-desktop's prompt allowed, are kept.
    expect(twice("discord", { activityTimeoutTime: 30_000 })).toMatchObject({ activityTimeoutSeconds: 30 });
    expect(twice("discord", { activityTimeoutTime: 1000 })).toMatchObject({ activityTimeoutSeconds: 1 });
  });

  test("notifications: the numbered toast style becomes its name", () => {
    expect(twice("notifications", { toastStyle: 1 })).toMatchObject({ toastStyle: "logo" });
    expect(twice("notifications", { toastStyle: 7 })).toMatchObject({ toastStyle: "legacy" });
    expect(twice("notifications", { toastStyle: 42 })).toMatchObject({ toastStyle: 42 });
  });

  test("equalizer: filters and the bass booster become the extra filters", () => {
    const peak = { type: "peaking", frequency: 1000, Q: 1, gain: -3 };
    const bass = { type: "lowshelf", frequency: 80, Q: 100, gain: 12 };
    expect(twice("equalizer", { filters: [peak], presets: { "bass-booster": true } }).filters).toBe(JSON.stringify([peak, bass]));
    expect(twice("equalizer", { presets: { "bass-booster": true } }).filters).toBe(JSON.stringify([bass]));
    expect(twice("equalizer", { filters: [], presets: { "bass-booster": false } }).filters).toBe("");
    expect(twice("equalizer", { filters: ["junk", peak] }).filters).toBe(JSON.stringify([peak]));
  });

  test("equalizer: the 11-band Ears curve becomes bands and user presets", () => {
    const frequencies = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
    const curve = frequencies.map((frequency, index) => ({
      id: `band${index}`,
      type: index === 0 ? "lowshelf" : index === frequencies.length - 1 ? "highshelf" : "peaking",
      frequency,
      Q: 0.707,
      gain: index,
    }));
    const preset = { id: "preset-abc", name: "Mine", outputGainDb: 3, filters: curve };
    const entry = twice("equalizer", {
      filters: curve,
      activePreset: "preset-abc",
      recentPresets: ["preset-abc"],
      userPresets: [preset],
      outputGainDb: 1,
    });
    // The curve is the 11-band layout, not the extra filters that add in parallel.
    expect(entry.filters).toBe("");
    expect(entry.preset).toBe("preset-abc");
    expect(entry.outputGainDb).toBe(1);
    expect(entry.userPresets).toBe(JSON.stringify([preset]));
    const bands = JSON.parse(entry.bands as string) as { type: string; frequency: number; gain: number }[];
    expect(bands).toHaveLength(11);
    expect(bands[0]).toMatchObject({ type: "lowshelf", frequency: 20, gain: 0 });
    expect(bands[5]).toMatchObject({ type: "peaking", frequency: 640, gain: 5 });
    expect(bands[10]).toMatchObject({ type: "highshelf", frequency: 20480, gain: 10 });
    // A flat, never-saved curve is still the 11-band layout (the preset carries the choice).
    expect(twice("equalizer", { filters: [], activePreset: "flat" })).toMatchObject({ filters: "", preset: "flat" });
    expect(JSON.parse(twice("equalizer", { filters: [], activePreset: "flat" }).bands as string)).toHaveLength(11);
  });

  test("in-app-menu: hiding the window buttons is the inverse of showing them", () => {
    expect(twice("in-app-menu", { hideDOMWindowControls: true })).toMatchObject({ windowControls: false });
    expect(twice("in-app-menu", { hideDOMWindowControls: false })).toMatchObject({ windowControls: true });
    expect(twice("in-app-menu", { hideDOMWindowControls: "yes" })).not.toHaveProperty("windowControls");
  });

  test("precise-volume: global shortcuts are top-level options", () => {
    expect(twice("precise-volume", { steps: 0, globalShortcuts: { volumeUp: "Shift+Up", volumeDown: 3 } })).toEqual({
      steps: 1,
      globalShortcuts: { volumeUp: "Shift+Up", volumeDown: 3 },
      volumeUp: "Shift+Up",
    });
    expect(twice("precise-volume", { globalShortcuts: "none" })).toEqual({ globalShortcuts: "none" });
  });

  test("scrobbler: one entry per service becomes flat options", () => {
    const entry = twice("scrobbler", {
      scrobbleOtherMedia: false,
      scrobblers: {
        lastfm: { enabled: true, token: "t", sessionKey: "sk", apiRoot: "https://lfm/", apiKey: "key", secret: "s" },
        listenbrainz: { enabled: true, token: "lb", apiRoot: "https://lb/" },
      },
    });
    expect(entry).toMatchObject({
      scrobbleOtherMedia: false,
      lastfmEnabled: true,
      lastfmSessionKey: "sk",
      lastfmApiRoot: "https://lfm/",
      lastfmApiKey: "key",
      lastfmSecret: "s",
      listenbrainzEnabled: true,
      listenbrainzToken: "lb",
      listenbrainzApiRoot: "https://lb/",
    });
    // Partial entries (pear-desktop stored only what changed) and junk.
    expect(twice("scrobbler", { scrobblers: { lastfm: { sessionKey: null }, listenbrainz: "x" } })).toEqual({
      scrobblers: { lastfm: { sessionKey: null }, listenbrainz: "x" },
    });
  });

  test("shortcuts: global and in-window shortcuts are top-level options; MPRIS stays on", () => {
    const plugins = migrated({
      shortcuts: { enabled: true, overrideMediaKeys: true, global: { playPause: "Ctrl+F1", next: "", previous: 5 }, local: { next: "N" } },
    });
    expect(plugins.shortcuts).toMatchObject({ enabled: true, overrideMediaKeys: true, playPause: "Ctrl+F1", next: "", localNext: "N" });
    expect(plugins.shortcuts).not.toHaveProperty("previous");
    expect(plugins["media-controls"]).toEqual({ enabled: true });
    // Not enabled: media-controls keeps its own default.
    expect(migrated({ shortcuts: { enabled: false } })).not.toHaveProperty("media-controls");
    expect(twice("shortcuts", { enabled: true }, { plugins: { "media-controls": { enabled: false } } })).toEqual({ enabled: true });
  });

  test("skip-ai-slop: keyword and channel objects become the flat lists", () => {
    expect(
      twice("skip-ai-slop", {
        keywords: [{ text: "AI cover", enabled: true }, { text: "turned off", enabled: false }, " plain "],
        userAllow: [{ id: "UCallow", name: "Good channel" }],
        userBlock: [{ name: "Bad channel" }],
      }),
    ).toEqual({
      // No per-keyword switch any more: a disabled keyword is dropped, not re-enabled.
      keywords: ["AI cover", "plain"],
      userAllow: ["UCallow"],
      userBlock: ["Bad channel"],
    });
    expect(twice("skip-ai-slop", { keywords: "junk" })).toEqual({ keywords: "junk" });
  });

  test("sponsorblock: the category list becomes one switch per category", () => {
    expect(twice("sponsorblock", { categories: ["sponsor", "preview", "chapter"], apiURL: "https://sb.lan" })).toMatchObject({
      apiURL: "https://sb.lan",
      sponsor: true,
      preview: true,
      intro: false,
      outro: false,
      interaction: false,
      selfpromo: false,
      music_offtopic: false,
      filler: false,
    });
    expect(twice("sponsorblock", { categories: "sponsor" })).toEqual({ categories: "sponsor" });
  });

  test("visualizer: per-visualizer options are flat; Wave's animations are JSON", () => {
    const animations = [{ type: "Cubes", config: { count: 3 } }];
    expect(
      twice("visualizer", {
        type: "vudio",
        butterchurn: { preset: "Geiss - Thumb Drum", blendTimeInSeconds: 30 },
        vudio: { effect: "waveform", accuracy: 512, lighting: { color: "#ff0000", dottify: false, horizontalAlign: "left" } },
        wave: { animations },
      }),
    ).toMatchObject({
      type: "vudio",
      preset: "Geiss - Thumb Drum",
      blendTimeInSeconds: 10,
      vudioEffect: "waveform",
      vudioAccuracy: "512",
      vudioColor: "#ff0000",
      vudioDottify: false,
      vudioHorizontalAlign: "left",
      waveAnimations: JSON.stringify(animations),
    });
    expect(twice("visualizer", { type: "wave" })).toEqual({ type: "wave" });
    // The other per-visualizer objects are flat too, clamped into the rewrite's ranges.
    expect(
      twice("visualizer", {
        wavy: { lineWidth: 3 },
        bars: { variant: "rgb", barWidth: 120, gap: -1 },
        circles: { variant: "party" },
        experimental: { variant: "e14" },
        discoBall: { sensitivity: 9 },
      }),
    ).toMatchObject({
      wavyLineWidth: 3,
      barsVariant: "rgb",
      barsBarWidth: 80,
      barsGap: 0,
      circlesVariant: "party",
      experimentalVariant: "e14",
      discoBallSensitivity: 3,
    });
  });

  test("runs on the stored entry only, never on a missing or broken one", () => {
    expect(migrated({ visualizer: "broken" as unknown as Json }).visualizer).toBe("broken");
    // Only performance-improvement (on by default in pear-desktop) and the downloader (saving to the folder) get an entry.
    expect(migrated({})).toEqual({ "performance-improvement": { enabled: true }, downloader: { exportFiles: true } });
  });
});

/** Each plugin's settings once PEAR_DESKTOP_3 is loaded. */
const EXPECTED: Record<string, { enabled: boolean; config: Json }> = {
  "album-actions": { enabled: true, config: {} },
  "album-color-theme": { enabled: true, config: { ratio: 80, enableSeekbar: false } },
  "ambient-mode": {
    enabled: true,
    config: {
      interpolationTime: 3000,
      quality: 1000,
      size: 125,
      buffer: 20,
      opacity: 60,
      blur: 25,
      extendSidebar: false,
      fullscreen: true,
    },
  },
  amuse: { enabled: true, config: { port: 9863, hostname: "0.0.0.0" } },
  "audio-compressor": {
    enabled: true,
    config: { threshold: -50, ratio: 12, knee: 40, attack: 0, release: 250, autoTrackGain: false, maxTrackGainDb: 12 },
  },
  "auth-proxy-adapter": {
    enabled: true,
    config: { url: "socks5://user:pass@proxy.lan:1080", username: "", password: "", bypass: "<local>", hostname: "0.0.0.0", port: 4646 },
  },
  "blur-nav-bar": { enabled: true, config: { blur: 8, opacity: 30 } },
  "captions-selector": { enabled: true, config: { autoload: true, disableCaptions: false, lastCaptionsCode: "de" } },
  clock: { enabled: true, config: { displaySeconds: true, hour12: true } },
  crossfade: {
    enabled: true,
    config: { fadeInDuration: 2000, fadeOutDuration: 8000, secondsBeforeEnd: 12, fadeScaling: "logarithmic", dynamicRange: 30 },
  },
  "custom-output-device": { enabled: true, config: { output: "Speakers (USB)", showPicker: true } },
  "disable-autoplay": { enabled: true, config: { applyOnce: true } },
  discord: {
    enabled: true,
    config: {
      activityType: "listening",
      statusDisplayType: "name",
      playButton: false,
      hideGitHubButton: true,
      hideDurationLeft: true,
      hideWhenPaused: false,
      activityTimeoutEnabled: true,
      activityTimeoutSeconds: 1800,
      autoReconnect: false,
    },
  },
  equalizer: {
    enabled: true,
    config: {
      bypass: false,
      outputGainDb: 0,
      filters: JSON.stringify([
        { type: "highshelf", frequency: 8000, Q: 1, gain: 4 },
        { type: "lowshelf", frequency: 80, Q: 100, gain: 12 },
      ]),
      preset: "flat",
      bands: "",
      recentPresets: [],
      userPresets: "",
      ...Object.fromEntries([32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((hz) => [`band${hz}`, 0])),
      preamp: 0,
    },
  },
  "exponential-volume": { enabled: true, config: {} },
  "in-app-menu": { enabled: true, config: { windowControls: false } },
  lumiastream: { enabled: false, config: {} },
  "media-controls": { enabled: true, config: {} },
  "music-together": {
    enabled: true,
    config: {
      displayName: "",
      defaultPermission: "playlist",
      iceServers: expect.arrayContaining(["stun:stun.l.google.com:19302"]),
    },
  },
  navigation: { enabled: false, config: {} },
  notifications: {
    enabled: true,
    config: {
      unpauseNotification: true,
      urgency: "critical",
      interactive: false,
      refreshOnPlayPause: true,
      toastStyle: "hero",
      trayControls: false,
      hoverControls: true,
      hideButtonText: true,
    },
  },
  "picture-in-picture": {
    enabled: true,
    config: { hotkey: "Shift+P", useNativePiP: false, alwaysOnTop: false, savePosition: false, saveSize: true },
  },
  "playback-speed": { enabled: true, config: { speed: 1, preservePitch: true } },
  "precise-volume": {
    enabled: true,
    config: { steps: 50, wheel: true, arrowsShortcut: false, showHud: true, volumeUp: "Ctrl+Up", volumeDown: "Ctrl+Down" },
  },
  "quality-changer": { enabled: true, config: {} },
  scrobbler: {
    enabled: true,
    config: {
      lastfmEnabled: true,
      lastfmSessionKey: "session",
      lastfmApiKey: "k",
      lastfmSecret: "s",
      lastfmApiRoot: "https://ws.audioscrobbler.com/2.0/",
      listenbrainzEnabled: true,
      listenbrainzToken: "lb-token",
      listenbrainzApiRoot: "https://api.listenbrainz.org/1/",
      scrobbleOtherMedia: false,
      alternativeTitles: false,
      alternativeArtist: true,
      customRegexFilters: expect.arrayContaining(["\\s[([]Explicit[)\\]]"]),
      useMusicBrainz: false,
      musicBrainzEmail: "",
    },
  },
  shortcuts: {
    enabled: true,
    config: {
      playPause: "Ctrl+Shift+Space",
      next: "Ctrl+Shift+Right",
      previous: "Ctrl+Shift+Left",
      volumeUp: "",
      volumeDown: "",
      like: "",
      showWindow: "",
      overrideMediaKeys: true,
      localPlayPause: "",
      localNext: "",
      localPrevious: "",
    },
  },
  "skip-silences": { enabled: true, config: { onlySkipBeginning: true } },
  sponsorblock: {
    enabled: true,
    config: {
      music_offtopic: true,
      sponsor: true,
      selfpromo: true,
      interaction: false,
      intro: false,
      outro: false,
      preview: false,
      filler: true,
      apiURL: "https://sponsor.example",
    },
  },
  "taskbar-mediacontrol": { enabled: true, config: {} },
  touchbar: { enabled: true, config: {} },
  "transparent-player": { enabled: true, config: { opacity: 30, type: "acrylic" } },
  "tuna-obs": { enabled: true, config: { port: 1608 } },
  "unobtrusive-player": { enabled: true, config: {} },
  "video-toggle": { enabled: true, config: { mode: "native", align: "right", hideVideo: true, forceHide: true } },
  visualizer: {
    enabled: true,
    config: {
      type: "butterchurn",
      preset: "Flexi - alien fish pond",
      blendTimeInSeconds: 5,
      songTitle: false,
      vudioEffect: "lighting",
      vudioAccuracy: "128",
      vudioMaxHeight: 160,
      vudioMaxSize: 12,
      vudioLineWidth: 1,
      vudioColor: "#49f3f7",
      vudioShadowBlur: 2,
      vudioShadowColor: "rgba(244,244,244,.5)",
      vudioFadeSide: true,
      vudioPrettify: false,
      vudioDottify: true,
      vudioHorizontalAlign: "center",
      vudioVerticalAlign: "middle",
      waveAnimations: expect.stringContaining("Cubes"),
      wavyLineWidth: 8,
      barsVariant: "dancing-palette",
      barsBarWidth: 30,
      barsGap: 8,
      circlesVariant: "palette",
      experimentalVariant: "e8",
      discoBallSensitivity: 1,
    },
  },
};

describe("a pear-desktop 3.12 config.json, loaded with the real plugins", () => {
  const dir = mkdtempSync(join(tmpdir(), "pear-plugins-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(PEAR_DESKTOP_3, null, "\t")}\n`);
  const settings = new Settings(dir, hostPlugins, "4.0.0");

  test.each(Object.keys(EXPECTED))("%s", (id) => {
    expect(hostPlugins.some((plugin) => plugin.id === id)).toBe(true);
    expect(settings.plugin(id)).toEqual(EXPECTED[id]);
  });

  test("keeps pear-desktop's own keys in the file", () => {
    const file = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(file.plugins.scrobbler.scrobblers.lastfm.sessionKey).toBe("session");
    expect(file.plugins["picture-in-picture"]["pip-size"]).toEqual([500, 300]);
    expect(file.plugins.discord[PLAY_BUTTON]).toBe(false);
    expect(file.__internal__.migrations.version).toBe("4.0.0");
  });
});

describe("synced-lyrics", () => {
  test("gap text and Chinese conversion map onto the rewrite's values", () => {
    expect(
      twice("synced-lyrics", { defaultTextString: ["•", "••", "•••"], convertChineseCharacter: "traditionalToSimplified" }),
    ).toMatchObject({
      gapText: "bullets",
      convertChinese: "t2s",
    });
    expect(twice("synced-lyrics", { defaultTextString: [".", "..", "..."] })).toMatchObject({ gapText: "dots" });
    // Not stored: pear-desktop's default, ♪ (the rewrite's own default is dots).
    expect(twice("synced-lyrics", { enabled: true })).toMatchObject({ gapText: "note" });
    expect(twice("synced-lyrics", { defaultTextString: "♪", convertChineseCharacter: "disabled" })).toMatchObject({
      gapText: "note",
      convertChinese: "off",
    });
    expect(twice("synced-lyrics", { defaultTextString: " " })).toMatchObject({ gapText: "none" });
    // Same names and values: nothing to convert.
    const kept = migrated({ "synced-lyrics": { enabled: true, preferredProvider: "LRCLib", lineEffect: "focus", romanization: false } })[
      "synced-lyrics"
    ];
    expect(kept).toMatchObject({ preferredProvider: "LRCLib", lineEffect: "focus", romanization: false });
  });

  test("the nested translation settings become flat keys, keeping the credentials", () => {
    const entry = twice("synced-lyrics", {
      translation: {
        enabled: true,
        provider: "anthropic",
        targetLanguage: "de",
        providers: {
          "openai-compatible": { baseUrl: "https://example.test/v1", apiKey: "sk-openai", model: "gpt-4o-mini", apiMode: "responses" },
          anthropic: { apiKey: "sk-anthropic", model: "claude-haiku-4-5-20251001" },
          gemini: { apiKey: "sk-gemini", model: "gemini-2.0-flash" },
          "local-cli": { engine: "codex", command: "my-cli", model: "local-model", timeoutSeconds: 900 },
          "google-translate": { host: "translate.google.co.jp" },
        },
      },
    });
    expect(entry).toMatchObject({
      translationEnabled: true,
      translationProvider: "anthropic",
      translationTargetLanguage: "de",
      openaiBaseUrl: "https://example.test/v1",
      openaiApiKey: "sk-openai",
      openaiModel: "gpt-4o-mini",
      openaiApiMode: "responses",
      anthropicApiKey: "sk-anthropic",
      anthropicModel: "claude-haiku-4-5-20251001",
      geminiApiKey: "sk-gemini",
      geminiModel: "gemini-2.0-flash",
      localCliEngine: "codex",
      localCliCommand: "my-cli",
      localCliModel: "local-model",
      localCliTimeoutSeconds: 600,
      googleTranslateHost: "translate.google.co.jp",
    });
    expect(twice("synced-lyrics", { translation: "broken" })).toMatchObject({ translation: "broken" });
  });
});
