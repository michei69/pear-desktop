// pear-desktop 3.x plugin options -> the rewrite's (part of the 4.0.0
// migration). Each entry converts one plugin's stored entry in place. Old keys
// stay in the file (unknown keys are kept), so going back to 3.x still finds
// them. Plugins not listed kept every option under the same key and value
// format; tray, api-server and performance-improvement are handled by the
// migrations themselves (index.ts).

import { clamp } from "@pear/sdk/util";
import {
  clampNumber,
  copyTyped,
  ensurePluginEntry,
  flattenStrings,
  fractionToPercent,
  isBoolean,
  isNumber,
  isPair,
  isRecord,
  isString,
  type Json,
  type MigratedFiles,
  setNew,
  type StoredConfig,
} from "./helpers.ts";

export type PluginMigration = (entry: Json, config: StoredConfig, files: MigratedFiles) => void;

/** discord's "Play on <app>" button option: the app's name, kept escaped like pear-desktop does. */
const DISCORD_PLAY_BUTTON = "playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063";
/** discord-api-types' StatusDisplayType, which pear-desktop stored as a number. */
const DISCORD_STATUS_DISPLAY = ["name", "state", "details"] as const;
/** pear-desktop's only equalizer preset, as the filter it applied. */
const BASS_BOOSTER = { type: "lowshelf", frequency: 80, Q: 100, gain: 12 };
/** pear-desktop's vudio.lighting options and the visualizer's flat names for them. */
const VUDIO_OPTIONS: Record<string, string> = {
  maxHeight: "vudioMaxHeight",
  maxSize: "vudioMaxSize",
  lineWidth: "vudioLineWidth",
  color: "vudioColor",
  shadowBlur: "vudioShadowBlur",
  shadowColor: "vudioShadowColor",
  fadeSide: "vudioFadeSide",
  prettify: "vudioPrettify",
  dottify: "vudioDottify",
  horizontalAlign: "vudioHorizontalAlign",
  verticalAlign: "vudioVerticalAlign",
};
/** The Ears-style equalizer's fixed layout, which pear-desktop's 3.12.4 betas stored in `filters`. */
const EQ_FREQUENCIES = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
const EQ_FILTER_TYPES = ["peaking", "lowshelf", "highshelf", "lowpass", "highpass", "bandpass", "notch", "allpass"];
const EQ_DEFAULT_Q = Math.SQRT1_2;
/** synced-lyrics' nested OpenAI-compatible translation settings -> flat keys. */
const OPENAI_OPTIONS: Record<string, string> = {
  baseUrl: "openaiBaseUrl",
  apiKey: "openaiApiKey",
  model: "openaiModel",
  apiMode: "openaiApiMode",
};
/** pear-desktop's notification toast styles, in the order of their numbers. */
const TOAST_STYLES = ["logo", "banner_centered_top", "hero", "banner_top_custom", "banner_centered_bottom", "banner_bottom", "legacy"];
const SPONSORBLOCK_CATEGORIES = ["sponsor", "intro", "outro", "interaction", "selfpromo", "music_offtopic", "preview", "filler"];
/** synced-lyrics' text for instrumental gaps -> the rewrite's choice. */
const GAP_TEXTS = new Map([
  ["♪", "note"],
  ["———", "dash"],
  [" ", "none"],
  ["", "none"],
]);
const CHINESE_CONVERSIONS: Record<string, string> = { simplifiedToTraditional: "s2t", traditionalToSimplified: "t2s", disabled: "off" };
const isDownloadMode = (value: unknown) => value === "seconds" || value === "percent";
/** downloader's download-on-finish options -> its flat ones. */
const DOWNLOAD_ON_FINISH: [from: string, to: string, valid: (value: unknown) => boolean][] = [
  ["enabled", "autoDownload", isBoolean],
  ["mode", "autoDownloadMode", isDownloadMode],
  ["seconds", "autoDownloadSeconds", isNumber],
  ["percent", "autoDownloadPercent", isNumber],
  ["folder", "autoDownloadFolder", isString],
];

export const PLUGIN_MIGRATIONS: Record<string, PluginMigration> = {
  "album-color-theme": (entry) => fractionToPercent(entry, "ratio"),
  "ambient-mode": (entry) => fractionToPercent(entry, "opacity"),
  "auth-proxy-adapter": (entry, config) => {
    // The adapter used to forward to the app's proxy option; the plugin has its own address now.
    const proxy = config.options?.proxy;
    if (typeof proxy === "string" && proxy && !entry.url) entry.url = proxy;
  },
  crossfade: (entry) => {
    // 'linear', 'logarithmic', or a number: logarithmic with that range in dB.
    const scaling = typeof entry.fadeScaling === "string" && entry.fadeScaling.trim() ? Number(entry.fadeScaling) : entry.fadeScaling;
    if (isNumber(scaling)) {
      entry.fadeScaling = scaling > 0 ? "logarithmic" : "linear";
      if (scaling > 0) setNew(entry, "dynamicRange", clamp(Math.round(scaling), 10, 120));
    }
    clampNumber(entry, "fadeInDuration", 0, 10_000);
    clampNumber(entry, "fadeOutDuration", 0, 20_000);
    clampNumber(entry, "secondsBeforeEnd", 0, 30);
  },
  "custom-output-device": (entry) => {
    // A device id, or "default"; the rewrite prefers the device's name (ids work too).
    const output = entry.output;
    if (output === "default") {
      entry.output = "";
      return;
    }
    const name = typeof output === "string" && isRecord(entry.devices) ? entry.devices[output] : undefined;
    if (typeof name === "string" && name) entry.output = name;
  },
  discord: (entry) => {
    if (isBoolean(entry[DISCORD_PLAY_BUTTON])) setNew(entry, "playButton", entry[DISCORD_PLAY_BUTTON]);
    const timeout = entry.activityTimeoutTime;
    if (isNumber(timeout)) {
      // Milliseconds; pear-desktop only armed the timeout for values above 0, so 0 never cleared it.
      if (timeout > 0) setNew(entry, "activityTimeoutSeconds", clamp(Math.round(timeout / 1000), 1, 14_400));
      else entry.activityTimeoutEnabled = false;
    }
    const status = entry.statusDisplayType;
    if (isNumber(status) && DISCORD_STATUS_DISPLAY[status]) entry.statusDisplayType = DISCORD_STATUS_DISPLAY[status];
  },
  "do-not-track": (entry) => {
    // pear-desktop's two blockers were the player-data layer alone and the
    // player layer plus the curated lists; the fork calls those Lite and
    // Balanced and made the extra lists custom ones. "With blocklists" always
    // loaded them, so its users keep them.
    const blocker = entry.blocker;
    if (blocker === "Custom") {
      entry.blocker = "Lite";
      entry.customEnabled = true;
    } else if (blocker === "With blocklists") {
      entry.blocker = "Balanced";
      entry.customEnabled = true;
    } else if (blocker !== "Lite" && blocker !== "Balanced" && blocker !== "Strict") {
      // "In player", or a file that predates the option: Lite still strips the player's ads.
      entry.blocker = "Lite";
    }
  },
  downloader: (entry) => {
    // Same names: downloadFolder, skipExisting, playlistMaxItems.
    // Off by default in pear-desktop (on in the rewrite, for new profiles).
    setNew(entry, "skipExisting", false);
    if (entry.format === undefined && typeof entry.selectedPreset === "string") presetToFormat(entry, entry.selectedPreset);
    // { enabled, mode, seconds, percent, folder } -> flat options.
    const onFinish = entry.downloadOnFinish;
    if (entry.autoDownload === undefined && isRecord(onFinish)) {
      // Set outright, not with setNew: autoDownload being unset says these are all pear-desktop's.
      for (const [from, to, valid] of DOWNLOAD_ON_FINISH) {
        if (valid(onFinish[from])) entry[to] = onFinish[from];
      }
    }
  },
  equalizer: (entry) => {
    if (typeof entry.filters === "string") return;
    const filters = Array.isArray(entry.filters) ? entry.filters.filter(isRecord) : [];
    // pear-desktop's Ears rewrite made the equalizer 11 fixed bands and stored that
    // curve in `filters`, with `activePreset`/`userPresets` beside it. Those are
    // the bands, not the extra biquads the rewrite calls `filters`: treating them
    // as extras moves the curve out of the 11-band UI and applies it in parallel.
    const earsCurve = filters.some((filter) => isString(filter.id) && /^band\d+$/.test(filter.id));
    if (earsCurve || isString(entry.activePreset) || Array.isArray(entry.userPresets)) {
      setNew(entry, "bands", JSON.stringify(earsBands(filters)));
      if (isString(entry.activePreset) && entry.activePreset) setNew(entry, "preset", entry.activePreset);
      // Set outright: the old array is under the same key, so setNew would keep it.
      if (Array.isArray(entry.userPresets)) entry.userPresets = JSON.stringify(entry.userPresets);
      entry.filters = "";
      return;
    }
    // pear-desktop 3.12 and earlier: a list of biquad filters (plus the bass booster preset) -> the extra filters, as JSON.
    if (isRecord(entry.presets) && entry.presets["bass-booster"] === true) filters.push(BASS_BOOSTER);
    entry.filters = filters.length > 0 ? JSON.stringify(filters) : "";
  },
  "in-app-menu": (entry) => {
    if (isBoolean(entry.hideDOMWindowControls)) setNew(entry, "windowControls", !entry.hideDOMWindowControls);
  },
  notifications: (entry) => {
    // The Windows toast style was a number (1-based).
    if (isNumber(entry.toastStyle) && TOAST_STYLES[entry.toastStyle - 1]) entry.toastStyle = TOAST_STYLES[entry.toastStyle - 1];
  },
  "picture-in-picture": (entry, _config, files) => {
    // The small window's last position and size; the rewrite keeps them in a file of their own.
    const position = entry["pip-position"];
    const size = entry["pip-size"];
    const hasSize = isPair(size) && size[0] > 0 && size[1] > 0;
    const bounds = {
      ...(isPair(position) ? { x: Math.round(position[0]), y: Math.round(position[1]) } : {}),
      ...(hasSize ? { width: Math.round(size[0]), height: Math.round(size[1]) } : {}),
    };
    if (Object.keys(bounds).length > 0) files["picture-in-picture.json"] ??= bounds;
  },
  "precise-volume": (entry) => {
    flattenStrings(entry, entry.globalShortcuts, { volumeUp: "volumeUp", volumeDown: "volumeDown" });
    clampNumber(entry, "steps", 1, 100);
  },
  scrobbler: (entry) => {
    const scrobblers: Json = isRecord(entry.scrobblers) ? entry.scrobblers : {};
    const { lastfm, listenbrainz } = scrobblers;
    copyTyped(entry, lastfm, { enabled: "lastfmEnabled" }, isBoolean);
    flattenStrings(entry, lastfm, {
      sessionKey: "lastfmSessionKey",
      apiKey: "lastfmApiKey",
      secret: "lastfmSecret",
      apiRoot: "lastfmApiRoot",
    });
    copyTyped(entry, listenbrainz, { enabled: "listenbrainzEnabled" }, isBoolean);
    flattenStrings(entry, listenbrainz, { token: "listenbrainzToken", apiRoot: "listenbrainzApiRoot" });
  },
  shortcuts: (entry, config) => {
    // Global and in-window ("local") shortcuts; overrideMediaKeys keeps its name.
    flattenStrings(entry, entry.global, { playPause: "playPause", next: "next", previous: "previous" });
    flattenStrings(entry, entry.local, { playPause: "localPlayPause", next: "localNext", previous: "localPrevious" });
    // The plugin also ran the Linux MPRIS player, which is the media-controls plugin now.
    if (entry.enabled === true) setNew(ensurePluginEntry(config, "media-controls"), "enabled", true);
  },
  "skip-ai-slop": (entry) => {
    // Keywords were { text, enabled } and channels { id, name }; the rewrite stores
    // plain string lists. Disabled keywords are dropped on purpose: there is no
    // per-keyword switch any more, so keeping them would start filtering entries
    // the user had turned off.
    entry.keywords = keywordList(entry.keywords) ?? entry.keywords;
    entry.userAllow = channelList(entry.userAllow) ?? entry.userAllow;
    entry.userBlock = channelList(entry.userBlock) ?? entry.userBlock;
  },
  sponsorblock: (entry) => {
    // A list of categories -> one switch per category.
    const categories = entry.categories;
    if (!Array.isArray(categories)) return;
    for (const category of SPONSORBLOCK_CATEGORIES) setNew(entry, category, categories.includes(category));
  },
  // preferredProvider, lineEffect, showTimeCodes, romanization and
  // showLyricsEvenIfInexact keep their names and values.
  "synced-lyrics": (entry) => {
    // defaultTextString: what fills instrumental gaps; ♪ by default in pear-desktop
    // (which didn't store defaults), animated dots in the rewrite.
    setNew(entry, "gapText", gapText(entry.defaultTextString));
    const chinese = entry.convertChineseCharacter;
    if (typeof chinese === "string" && Object.hasOwn(CHINESE_CONVERSIONS, chinese)) {
      setNew(entry, "convertChinese", CHINESE_CONVERSIONS[chinese]);
    }
    // Translation was one nested object (one entry per provider); the rewrite's
    // config is a flat record, so every provider's settings became top-level keys.
    // Without this the plugin reads its defaults: translation off, credentials lost.
    const translation = entry.translation;
    if (!isRecord(translation)) return;
    copyTyped(entry, translation, { enabled: "translationEnabled" }, isBoolean);
    flattenStrings(entry, translation, { provider: "translationProvider", targetLanguage: "translationTargetLanguage" });
    const providers = translation.providers;
    if (!isRecord(providers)) return;
    flattenStrings(entry, providers["openai-compatible"], OPENAI_OPTIONS);
    flattenStrings(entry, providers.anthropic, { apiKey: "anthropicApiKey", model: "anthropicModel" });
    flattenStrings(entry, providers.gemini, { apiKey: "geminiApiKey", model: "geminiModel" });
    flattenStrings(entry, providers["local-cli"], { engine: "localCliEngine", command: "localCliCommand", model: "localCliModel" });
    const localCli = providers["local-cli"];
    if (isRecord(localCli) && isNumber(localCli.timeoutSeconds)) {
      setNew(entry, "localCliTimeoutSeconds", clamp(localCli.timeoutSeconds, 15, 600));
    }
    flattenStrings(entry, providers["google-translate"], { host: "googleTranslateHost" });
  },
  "transparent-player": (entry) => fractionToPercent(entry, "opacity"),
  visualizer: (entry) => {
    // Per-visualizer objects -> flat options; Wave's animations -> JSON.
    const { butterchurn, vudio, wave, wavy, bars, circles, experimental, discoBall } = entry;
    if (isRecord(butterchurn)) {
      copyTyped(entry, butterchurn, { preset: "preset" }, isString);
      if (isNumber(butterchurn.blendTimeInSeconds)) setNew(entry, "blendTimeInSeconds", clamp(butterchurn.blendTimeInSeconds, 0, 10));
    }
    if (isRecord(vudio)) {
      copyTyped(entry, vudio, { effect: "vudioEffect" }, isString);
      if (isNumber(vudio.accuracy)) setNew(entry, "vudioAccuracy", String(vudio.accuracy));
      copyTyped(entry, vudio.lighting, VUDIO_OPTIONS, (value) => value !== undefined);
    }
    if (isRecord(wave) && Array.isArray(wave.animations)) setNew(entry, "waveAnimations", JSON.stringify(wave.animations));
    if (isRecord(wavy)) clampNew(entry, "wavyLineWidth", wavy.lineWidth, 1, 20);
    if (isRecord(bars)) {
      copyTyped(entry, bars, { variant: "barsVariant" }, isString);
      clampNew(entry, "barsBarWidth", bars.barWidth, 5, 80);
      clampNew(entry, "barsGap", bars.gap, 0, 20);
    }
    if (isRecord(circles)) copyTyped(entry, circles, { variant: "circlesVariant" }, isString);
    if (isRecord(experimental)) copyTyped(entry, experimental, { variant: "experimentalVariant" }, isString);
    if (isRecord(discoBall)) clampNew(entry, "discoBallSensitivity", discoBall.sensitivity, 0.25, 3);
  },
};

/** Sets a numeric key, clamped into the range the rewrite accepts, unless it is already set. */
function clampNew(entry: Json, key: string, value: unknown, min: number, max: number) {
  if (isNumber(value)) setNew(entry, key, clamp(value, min, max));
}

/** pear-desktop's 11-band equalizer curve -> the rewrite's `bands` JSON (positional, no ids). */
function earsBands(filters: readonly Json[]) {
  return EQ_FREQUENCIES.map((frequency, index) => {
    const filter = filters[index] ?? {};
    const type = filter.type;
    const q = isNumber(filter.Q) ? filter.Q : filter.q;
    return {
      type:
        isString(type) && EQ_FILTER_TYPES.includes(type)
          ? type
          : index === 0
            ? "lowshelf"
            : index === EQ_FREQUENCIES.length - 1
              ? "highshelf"
              : "peaking",
      frequency: clamp(isNumber(filter.frequency) ? filter.frequency : frequency, 20, 22050),
      Q: clamp(isNumber(q) ? q : EQ_DEFAULT_Q, 0.1, 30),
      gain: clamp(isNumber(filter.gain) ? filter.gain : 0, -30, 30),
    };
  });
}

/** Old keyword entries ({ text, enabled }) or plain strings -> the rewrite's string list. */
function keywordList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return;
  const texts: string[] = [];
  for (const item of value) {
    const text = isString(item) ? item.trim() : isRecord(item) && item.enabled !== false && isString(item.text) ? item.text.trim() : "";
    if (text) texts.push(text);
  }
  return texts;
}

/** Old channel entries ({ id, name }) or plain strings -> ids, or the exact name when there is no id. */
function channelList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return;
  const ids: string[] = [];
  for (const item of value) {
    const raw = isString(item)
      ? item
      : isRecord(item)
        ? isString(item.id)
          ? item.id
          : isString(item.name)
            ? item.name
            : undefined
        : undefined;
    const id = raw?.trim();
    if (id) ids.push(id);
  }
  return ids;
}

/** FFmpeg presets became yt-dlp audio formats; the Custom preset keeps its arguments and extension. */
function presetToFormat(entry: Json, preset: string) {
  if (preset !== "Custom") {
    entry.format = preset === "Source" ? "source" : "mp3";
    return;
  }
  const custom = isRecord(entry.customPresetSetting) ? entry.customPresetSetting : {};
  entry.format = "custom";
  if (Array.isArray(custom.ffmpegArgs)) {
    const quote = (arg: string) => (/[\s"']/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
    setNew(entry, "customArgs", custom.ffmpegArgs.filter(isString).map(quote).join(" "));
  }
  copyTyped(entry, custom, { extension: "customExtension" }, isString);
}

function gapText(gap: unknown) {
  if (gap === undefined) return "note";
  if (typeof gap === "string") return GAP_TEXTS.get(gap);
  if (!Array.isArray(gap)) return undefined;
  return gap.some((frame) => typeof frame === "string" && frame.includes("•")) ? "bullets" : "dots";
}
