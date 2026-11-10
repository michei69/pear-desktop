// The Plugins tab's headings: what kind of job each plugin does, like
// pear-desktop's Playback/Audio/Interface/Lyrics/Integrations/System groups.

import type { PluginInfo } from "@pear/sdk/protocol";
import type { UiKey } from "../strings.ts";

const CATEGORY_IDS = ["playback", "audio", "interface", "lyrics", "integrations", "system", "other"] as const;

export type PluginCategoryId = (typeof CATEGORY_IDS)[number];

const CATEGORY_BY_PLUGIN: Record<string, PluginCategoryId> = {
  "playback-speed": "playback",
  "playback-recovery": "playback",
  "crossfade": "playback",
  "disable-autoplay": "playback",
  "skip-silences": "playback",
  "sponsorblock": "playback",
  "seek-shortcuts": "playback",
  "prefer-song": "playback",
  "skip-ai-slop": "playback",
  "quality-changer": "playback",
  "video-toggle": "playback",
  "picture-in-picture": "playback",
  "captions-selector": "playback",
  "sfw-music": "playback",
  "resume-shuffle": "playback",

  "equalizer": "audio",
  "audio-compressor": "audio",
  "audio-only": "audio",
  "audio-track": "audio",
  "custom-output-device": "audio",
  "precise-volume": "audio",
  "exponential-volume": "audio",
  "always-show-volume-slider": "audio",

  "album-actions": "interface",
  "album-color-theme": "interface",
  "ambient-mode": "interface",
  "blur-nav-bar": "interface",
  "clock": "interface",
  "dismiss-multidevice-popup": "interface",
  "fullscreen-auto-hide": "interface",
  "in-app-menu": "interface",
  "navigation": "interface",
  "playlist-search": "interface",
  "search-commands": "interface",
  "shortcuts": "interface",
  "toast-autoclose": "interface",
  "transparent-player": "interface",
  "unobtrusive-player": "interface",
  "visualizer": "interface",
  "no-google-login": "interface",
  "tray": "interface",

  "synced-lyrics": "lyrics",
  "statusbar-lyrics": "lyrics",

  "discord": "integrations",
  "downloader": "integrations",
  "lumiastream": "integrations",
  "music-together": "integrations",
  "scrobbler": "integrations",
  "tuna-obs": "integrations",
  "amuse": "integrations",

  "auth-proxy-adapter": "system",
  "do-not-track": "system",
  "media-controls": "system",
  "memory-saver": "system",
  "notifications": "system",
  "performance-improvement": "system",
  "taskbar-mediacontrol": "system",
  "touchbar": "system",
};

export const pluginCategoryLabel = (id: PluginCategoryId): UiKey => `settings-ui.plugin-categories.${id}`;

const categoryOf = (id: string): PluginCategoryId => CATEGORY_BY_PLUGIN[id] ?? "other";

/** The plugins under their category headings, in the sidebar's order, empty ones left out. */
export function groupPluginsByCategory(plugins: readonly PluginInfo[]) {
  return CATEGORY_IDS.map((id) => ({
    id,
    plugins: plugins.filter((plugin) => categoryOf(plugin.id) === id).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.plugins.length > 0);
}
