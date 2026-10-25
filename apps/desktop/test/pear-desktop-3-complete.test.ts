// A COMPLETE pear-desktop 3.12.4 config.json through the real plugins: every
// app option and plugin option at a non-default value must reach its rewrite
// equivalent with the same effective value, and every master key must be
// accounted for (same name, a migration, or a reported gap). The defaults come
// from master's sources, so a new master option cannot go unnoticed here.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flagOverrides, type CoreSection } from "@pear/sdk/core-config";
import hostPlugins from "virtual:pear/host-plugins";
import { afterAll, describe, expect, test, vi } from "vitest";
import { Settings } from "../src/main/config.ts";
import { CONTEXT_MENU_ENTRIES } from "@pear/sdk/context-menu";
import { PEAR_DESKTOP_3_COMPLETE } from "./pear-desktop-3-complete.ts";
import { PLAY_BUTTON } from "./pear-desktop-3.ts";
import {
  PEAR_DESKTOP_3_OPTION_DEFAULTS,
  PEAR_DESKTOP_3_PLUGIN_DEFAULTS,
  PEAR_DESKTOP_3_WINDOW_DEFAULTS,
} from "./pear-desktop-3-defaults.ts";

vi.mock("electron", () => ({}));

type Json = Record<string, unknown>;

const fixtureOptions = PEAR_DESKTOP_3_COMPLETE.options as Json;
const fixturePlugins = PEAR_DESKTOP_3_COMPLETE.plugins as Record<string, Json>;

/** pear-desktop's app options and where the rewrite keeps them (same names and values). */
const APP_SECTION: Record<string, string> = {
  resumeOnStart: "general",
  startingPage: "general",
  language: "general",
  autoUpdates: "general",
  updateChannel: "general",
  alwaysOnTop: "window",
  hideMenu: "window",
  startAtLogin: "window",
  appVisible: "window",
  removeUpgradeButton: "appearance",
  likeButtons: "appearance",
  swapLikeButtonsOrder: "appearance",
  useYtmIcons: "appearance",
  hideDislikeButton: "appearance",
  hideVideoCaptions: "appearance",
  usePodcastParticipantAsArtist: "appearance",
  customWindowTitle: "appearance",
  stripMusicFromSharedLinks: "general",
  stripSIFromSharedLinks: "general",
  disableHardwareAcceleration: "advanced",
  autoResetAppCache: "advanced",
  performanceMode: "advanced",
  inProcessGpu: "advanced",
  forceSmtc: "advanced",
  proxy: "advanced",
  overrideUserAgent: "advanced",
};

/** App options the rewrite has no room for; their keys stay in the file for a downgrade. */
const APP_GAPS = ["restartOnConfigChanges", "hideMenuWarned"];

/** Master options a migration moves elsewhere; the old key stays too. */
const MIGRATED_OPTIONS = [
  "tray",
  "trayClickPlayPause",
  "trayMoveToCurrentDesktop",
  "trayForceWhiteIcons",
  "contextMenuHidden",
  "featureFlags",
];

/** Master plugin keys with no same-named rewrite field: the new keys their migration fills (empty: none). */
const CONVERTED: Record<string, Record<string, string[]>> = {
  "custom-output-device": { devices: [] },
  discord: { [PLAY_BUTTON]: ["playButton"], activityTimeoutTime: ["activityTimeoutSeconds"] },
  downloader: {
    downloadOnFinish: ["autoDownload", "autoDownloadMode", "autoDownloadSeconds", "autoDownloadPercent", "autoDownloadFolder"],
    selectedPreset: ["format"],
    customPresetSetting: ["customArgs", "customExtension"],
  },
  equalizer: { activePreset: ["preset"] },
  "in-app-menu": { hideDOMWindowControls: ["windowControls"] },
  "picture-in-picture": { "pip-position": [], "pip-size": [], isInPiP: [] },
  "playback-speed": { noPreservesPitch: ["preservePitch"] },
  "precise-volume": { globalShortcuts: ["volumeUp", "volumeDown"] },
  scrobbler: {
    scrobblers: [
      "lastfmEnabled",
      "lastfmSessionKey",
      "lastfmApiKey",
      "lastfmSecret",
      "lastfmApiRoot",
      "listenbrainzEnabled",
      "listenbrainzToken",
      "listenbrainzApiRoot",
    ],
  },
  shortcuts: { global: ["playPause", "next", "previous"], local: ["localPlayPause", "localNext", "localPrevious"] },
  sponsorblock: { categories: ["sponsor", "intro", "outro", "interaction", "selfpromo", "music_offtopic", "preview", "filler"] },
  "synced-lyrics": {
    defaultTextString: ["gapText"],
    translation: [
      "translationEnabled",
      "translationProvider",
      "translationTargetLanguage",
      "openaiBaseUrl",
      "openaiApiKey",
      "openaiModel",
      "openaiApiMode",
      "anthropicApiKey",
      "anthropicModel",
      "geminiApiKey",
      "geminiModel",
      "localCliEngine",
      "localCliCommand",
      "localCliModel",
      "localCliTimeoutSeconds",
      "googleTranslateHost",
    ],
  },
  visualizer: {
    butterchurn: ["preset", "blendTimeInSeconds"],
    vudio: [
      "vudioEffect",
      "vudioAccuracy",
      "vudioMaxHeight",
      "vudioMaxSize",
      "vudioLineWidth",
      "vudioColor",
      "vudioShadowBlur",
      "vudioShadowColor",
      "vudioFadeSide",
      "vudioPrettify",
      "vudioDottify",
      "vudioHorizontalAlign",
      "vudioVerticalAlign",
    ],
    wavy: ["wavyLineWidth"],
    bars: ["barsVariant", "barsBarWidth", "barsGap"],
    circles: ["circlesVariant"],
    experimental: ["experimentalVariant"],
    discoBall: ["discoBallSensitivity"],
    wave: ["waveAnimations"],
  },
};

/** Master plugin keys with no rewrite field at all (reported gaps; the key stays in the file). */
const GAPS: Record<string, string[]> = {
  "custom-output-device": ["devices"], // a cache of the devices, re-read from the system
  "picture-in-picture": ["isInPiP"], // runtime state, not a setting
  "precise-volume": ["savedVolume"], // a value only a volume-restore setting has, if the rewrite adds one
};

/** Master plugin keys whose same-named rewrite field holds a converted value. */
const CONVERTED_IN_PLACE: Record<string, string[]> = {
  "album-color-theme": ["ratio"],
  "ambient-mode": ["opacity"],
  "custom-output-device": ["output"],
  "transparent-player": ["opacity"],
  crossfade: ["fadeScaling"],
  discord: ["statusDisplayType"],
  equalizer: ["filters", "userPresets"],
  notifications: ["toastStyle"],
  "skip-ai-slop": ["keywords", "userAllow", "userBlock"],
};

/** Plugins whose master entry has no rewrite plugin (the settings UI is core now). */
const NO_REWRITE_PLUGIN = ["settings-ui"];

/** Every leaf default: an empty object and every array are leaves too. */
function flatten(value: unknown, prefix: string, out: Map<string, unknown>) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else if (prefix) {
    out.set(prefix, value);
  }
}

const byPath = (value: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Json)[key] : undefined), value);

const profiles: string[] = [];
afterAll(() => profiles.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function profile(contents: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "pear-complete-"));
  profiles.push(dir);
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(contents, null, "\t")}\n`);
  return dir;
}

const dir = profile(PEAR_DESKTOP_3_COMPLETE);
const settings = new Settings(dir, hostPlugins, "4.0.0");
const saved = () => JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as Json;

const pluginConfig = (id: string) => settings.plugin(id)!.config as Json;
const pluginIds = new Set(hostPlugins.map((plugin) => plugin.id));

describe("the 3.12.4 fixture", () => {
  test("sets every app option and plugin config key pear-desktop had to a non-default value", () => {
    const windowDefaults = new Map<string, unknown>();
    flatten(PEAR_DESKTOP_3_WINDOW_DEFAULTS, "", windowDefaults);
    for (const [path, value] of windowDefaults) {
      const stored = byPath(PEAR_DESKTOP_3_COMPLETE, path);
      expect(stored, path).not.toBeUndefined();
      expect(stored, path).not.toEqual(value);
    }

    const defaults = new Map<string, unknown>();
    flatten(PEAR_DESKTOP_3_OPTION_DEFAULTS, "", defaults);
    for (const [path, value] of defaults) {
      const stored = byPath(fixtureOptions, path);
      expect(stored, path).not.toBeUndefined();
      // null: pear-desktop had no default for it, so any value will do.
      if (value === null) expect(stored, path).not.toBeNull();
      else expect(stored, path).not.toEqual(value);
    }

    for (const [id, config] of Object.entries(PEAR_DESKTOP_3_PLUGIN_DEFAULTS)) {
      expect(fixturePlugins, id).toHaveProperty(id);
      expect(typeof fixturePlugins[id]!.enabled, `${id}.enabled`).toBe("boolean");
      const entryDefaults = new Map<string, unknown>();
      flatten(config, "", entryDefaults);
      for (const [path, value] of entryDefaults) {
        if (path === "enabled") continue;
        const stored = byPath(fixturePlugins[id], path);
        expect(stored, `${id}.${path}`).not.toBeUndefined();
        if (value === null) continue;
        expect(stored, `${id}.${path}`).not.toEqual(value);
      }
    }
  });
});

describe("a complete pear-desktop 3.12.4 config.json, migrated to 4.0.0", () => {
  test("every app option with a rewrite equivalent keeps its value", () => {
    for (const [key, section] of Object.entries(APP_SECTION)) {
      const config = settings.core(section as CoreSection) as unknown as Json;
      expect(config[key], `${section}.${key}`).toEqual(fixtureOptions[key]);
    }
    // The theme engine's own keys are read with the same names and shapes.
    expect(settings.themeConfig()).toEqual({
      theme: fixtureOptions.theme,
      themePresets: fixtureOptions.themePresets,
      themeOverrides: fixtureOptions.themeOverrides,
      themeConsent: fixtureOptions.themeConsent,
      themesSeeded: true,
    });
    expect(settings.legacyThemeCss()).toEqual(fixtureOptions.themes);
    expect(settings.window).toEqual({ width: 1280, height: 720, x: 40, y: 60, maximized: true });
    expect(settings.lastUrl).toBe(PEAR_DESKTOP_3_COMPLETE.url);
  });

  test("the app options a migration moves still work in their new homes", () => {
    // The tray was an app option with a click toggle, window and icon behavior; all are the plugin's now.
    expect(settings.plugin("tray")).toMatchObject({
      enabled: true,
      config: { closeToTray: true, clickPlayPause: true },
    });
    expect(settings.plugin("tray")!.config).toMatchObject({ moveToCurrentDesktop: true, forceWhiteIcons: true });
    const trayEntry = (settings.all().plugins as Record<string, Json>).tray!;
    expect(trayEntry).toMatchObject({ moveToCurrentDesktop: true, forceWhiteIcons: true });
    // The context-menu record became one flat appearance switch per entry.
    const appearance = settings.core("appearance") as unknown as Json;
    for (const entry of CONTEXT_MENU_ENTRIES) {
      const hidden = entry.key === "share" || entry.key === "play-next";
      expect(appearance[entry.configKey], entry.key).toBe(hidden);
    }
    expect((settings.all().options as Json).contextMenuHidden).toEqual(fixtureOptions.contextMenuHidden);
    // hideVideoCaptions is a core option now; the captions plugin entry is left as stored.
    expect(appearance.hideVideoCaptions).toBe(true);
    expect((settings.all().plugins as Record<string, Json>)["captions-selector"]).toEqual(fixturePlugins["captions-selector"]);
    // The feature-flag record is the site section's "name=value" list, typed as the page reads it.
    const flags = settings.core("site").siteFlags;
    expect(flags).toEqual([
      "music_web_enable_wiz_miniplayer=false",
      "music_web_enable_like_count=2",
      "music_web_enable_contained_content_layout=true",
      "some_text_flag=alpha",
    ]);
    expect(flagOverrides(flags)).toEqual(fixtureOptions.featureFlags);
    // The API server is a core section stored where the plugin kept it.
    expect(settings.core("apiServer")).toMatchObject(fixturePlugins["api-server"]!);
  });

  test("the settings pear-desktop had but the rewrite does not keep their values in the file", () => {
    const file = saved();
    const options = file.options as Json;
    for (const key of [...APP_GAPS, ...MIGRATED_OPTIONS]) {
      expect(options[key], key).toEqual(fixtureOptions[key]);
    }
    // Plugin settings with no rewrite field stay for a downgrade.
    const plugins = file.plugins as Record<string, Json>;
    expect(plugins["precise-volume"]!.savedVolume).toBe(42);
    expect(plugins["picture-in-picture"]!.isInPiP).toBe(true);
    expect(plugins["custom-output-device"]!.devices).toEqual(fixturePlugins["custom-output-device"]!.devices);
    // pear-desktop's settings-ui plugin is core now; its entry is kept untouched.
    expect(pluginIds.has("settings-ui")).toBe(false);
    expect(plugins["settings-ui"]).toEqual(fixturePlugins["settings-ui"]);
  });

  test("every master plugin option is accounted for: same name, a migration, or a reported gap", () => {
    for (const [id, defaults] of Object.entries(PEAR_DESKTOP_3_PLUGIN_DEFAULTS)) {
      if (id === "api-server") continue;
      if (NO_REWRITE_PLUGIN.includes(id)) {
        expect(pluginIds.has(id), `${id} unexpectedly has a rewrite plugin`).toBe(false);
        continue;
      }
      expect(pluginIds.has(id), `${id} is missing from the rewrite`).toBe(true);
      const config = (settings.plugin(id)!.config ?? {}) as Json;
      const schema = new Set(Object.keys(hostPlugins.find((plugin) => plugin.id === id)!.config ?? {}));
      for (const key of Object.keys(defaults)) {
        if (key === "enabled" || CONVERTED_IN_PLACE[id]?.includes(key)) continue;
        // The migration filled the keys it moves values to.
        const converted = CONVERTED[id]?.[key];
        if (converted) {
          for (const target of converted) expect(config, `${id}.${target}`).toHaveProperty(target);
          continue;
        }
        if (schema.has(key)) continue; // same-named value checked below
        expect(GAPS[id] ?? [], `${id}.${key} has no rewrite equivalent and no migration`).toContain(key);
      }
      // Same-named options keep pear-desktop's values.
      for (const [key, value] of Object.entries(fixturePlugins[id]!)) {
        if (key === "enabled" || !schema.has(key) || CONVERTED_IN_PLACE[id]?.includes(key)) continue;
        expect(config[key], `${id}.${key}`).toEqual(value);
      }
    }
  });

  test("the plugin options a migration converts carry pear-desktop's values", () => {
    expect(pluginConfig("album-color-theme")).toMatchObject({ ratio: 80, enableSeekbar: false });
    expect(pluginConfig("ambient-mode")).toMatchObject({ opacity: 60 });
    expect(pluginConfig("transparent-player")).toMatchObject({ opacity: 30 });
    expect(pluginConfig("notifications")).toMatchObject({ toastStyle: "banner_top_custom" });

    expect(pluginConfig("crossfade")).toEqual({
      fadeInDuration: 2000,
      fadeOutDuration: 8000,
      secondsBeforeEnd: 12,
      fadeScaling: "logarithmic",
      dynamicRange: 45,
    });
    expect(pluginConfig("discord")).toMatchObject({
      playButton: false,
      activityTimeoutSeconds: 90,
      statusDisplayType: "state",
      activityTimeoutEnabled: false,
    });

    expect(pluginConfig("custom-output-device")).toMatchObject({ output: "Speakers (USB)", showPicker: true });

    expect(pluginConfig("downloader")).toMatchObject({
      downloadFolder: "/home/me/Music/YTM",
      exportFiles: true,
      format: "custom",
      customArgs: '-compression_level 8 -metadata "comment=a b"',
      customExtension: "flac",
      skipExisting: true,
      playlistMaxItems: 50,
      autoDownload: true,
      autoDownloadMode: "percent",
      autoDownloadSeconds: 30,
      autoDownloadPercent: 80,
      autoDownloadFolder: "/home/me/Music/Auto",
    });

    // The 11-band curve, its preset and user presets move to the rewrite's fields.
    const equalizer = pluginConfig("equalizer");
    expect(equalizer).toMatchObject({ bypass: true, outputGainDb: 3, filters: "", preset: "custom", recentPresets: ["flat"] });
    const bands = JSON.parse(equalizer.bands as string) as Json[];
    expect(bands).toHaveLength(11);
    expect(bands.map(({ type, frequency, Q, gain }) => ({ type, frequency, Q, gain }))).toEqual(
      (fixturePlugins.equalizer!.filters as Json[]).map(({ type, frequency, Q, gain }) => ({ type, frequency, Q, gain })),
    );
    expect(equalizer.userPresets).toBe(JSON.stringify(fixturePlugins.equalizer!.userPresets));

    expect(pluginConfig("in-app-menu")).toMatchObject({ windowControls: false });
    expect(pluginConfig("playback-speed")).toMatchObject({ preservePitch: false });

    // The small window's saved bounds move to their own file.
    expect(readFileSync(join(dir, "picture-in-picture.json"), "utf8")).toBe('{"x":20,"y":30,"width":500,"height":300}');
    const pip = pluginConfig("picture-in-picture");
    expect(pip).toMatchObject({ hotkey: "Shift+P", useNativePiP: false, alwaysOnTop: false, savePosition: false, saveSize: true });
    expect(pip).not.toHaveProperty("pip-position");
    expect(pip).not.toHaveProperty("pip-size");

    expect(pluginConfig("precise-volume")).toMatchObject({
      volumeUp: "Ctrl+Up",
      volumeDown: "Ctrl+Down",
      steps: 50,
      arrowsShortcut: false,
    });

    expect(pluginConfig("scrobbler")).toMatchObject({
      lastfmEnabled: true,
      lastfmSessionKey: "session",
      lastfmApiKey: "custom-key",
      lastfmSecret: "custom-secret",
      lastfmApiRoot: "https://lastfm.example/2.0/",
      listenbrainzEnabled: true,
      listenbrainzToken: "lb-token",
      listenbrainzApiRoot: "https://lb.example/1/",
      scrobbleOtherMedia: false,
      alternativeTitles: false,
      alternativeArtist: false,
      useMusicBrainz: true,
      musicBrainzEmail: "me@example.com",
    });

    expect(pluginConfig("shortcuts")).toMatchObject({
      playPause: "Ctrl+Shift+Space",
      next: "Ctrl+Shift+Right",
      previous: "Ctrl+Shift+Left",
      localPlayPause: "Ctrl+Alt+Space",
      localNext: "Ctrl+Alt+Right",
      localPrevious: "Ctrl+Alt+Left",
      overrideMediaKeys: true,
    });

    // No per-keyword switch any more: the keyword turned off is dropped, not re-enabled.
    expect(pluginConfig("skip-ai-slop")).toMatchObject({
      keywords: ["AI cover"],
      userAllow: ["UCallow"],
      userBlock: ["UCbad"],
      reportFeedback: true,
      hideInPages: false,
    });

    expect(pluginConfig("sponsorblock")).toMatchObject({
      apiURL: "https://sponsor.example",
      sponsor: true,
      intro: false,
      outro: false,
      interaction: false,
      selfpromo: false,
      music_offtopic: true,
      preview: false,
      filler: false,
    });

    expect(pluginConfig("synced-lyrics")).toMatchObject({
      usePriorityList: true,
      providerPriority: ["LRCLib", "YTMusic"],
      preferSynced: false,
      preciseTiming: false,
      showLyricsEvenIfInexact: false,
      showTimeCodes: true,
      gapText: "dash",
      lineEffect: "scale",
      lyricsFontSize: "large",
      romanization: false,
      useYTMLyricsWithoutProxy: true,
      showCustomSearchButton: false,
      translationEnabled: true,
      translationProvider: "anthropic",
      translationTargetLanguage: "de",
      openaiBaseUrl: "https://openai.example/v1",
      openaiApiKey: "sk-openai",
      openaiModel: "gpt-4o",
      openaiApiMode: "responses",
      anthropicApiKey: "sk-anthropic",
      anthropicModel: "claude-opus-4-1",
      geminiApiKey: "sk-gemini",
      geminiModel: "gemini-2.5-pro",
      localCliEngine: "codex",
      localCliCommand: "my-cli",
      localCliModel: "local-model",
      localCliTimeoutSeconds: 300,
      googleTranslateHost: "translate.google.co.jp",
    });

    expect(pluginConfig("visualizer")).toMatchObject({
      type: "vudio",
      preset: "Flexi - alien fish pond",
      blendTimeInSeconds: 5,
      vudioEffect: "waveform",
      vudioAccuracy: "512",
      vudioMaxHeight: 120,
      vudioMaxSize: 20,
      vudioLineWidth: 2,
      vudioColor: "#ff0000",
      vudioShadowBlur: 1,
      vudioShadowColor: "rgba(1,1,1,.5)",
      vudioFadeSide: false,
      vudioPrettify: true,
      vudioDottify: false,
      vudioHorizontalAlign: "left",
      vudioVerticalAlign: "bottom",
      wavyLineWidth: 3,
      barsVariant: "rgb",
      barsBarWidth: 60,
      barsGap: 2,
      circlesVariant: "party",
      experimentalVariant: "e14",
      discoBallSensitivity: 2,
      waveAnimations: JSON.stringify(PEAR_DESKTOP_3_COMPLETE.plugins.visualizer.wave.animations),
    });
  });

  test("plugin states keep pear-desktop's choice", () => {
    for (const [id, entry] of Object.entries(fixturePlugins)) {
      if (id === "api-server" || id === "settings-ui") continue;
      expect(settings.plugin(id)!.enabled, id).toBe(entry.enabled);
    }
  });
});
