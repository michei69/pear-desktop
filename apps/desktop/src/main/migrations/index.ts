// config.json migrations, with electron-store's semantics (pear-desktop's
// store): each runs once, when the file was last written by a version older
// than the migration's, and the file then records the running version in
// `__internal__.migrations.version`.
//
// Add a migration for every change to what config.json means; never edit a
// released one.

import { CONTEXT_MENU_ENTRIES } from "@pear/sdk/context-menu";
import { compareVersions } from "../version.ts";
import {
  ensurePluginEntry,
  isNumber,
  isRecord,
  isString,
  type MigratedFiles,
  setNew,
  siteFlagEntries,
  type StoredConfig,
} from "./helpers.ts";
import { PLUGIN_MIGRATIONS } from "./plugins.ts";

export type { MigratedFiles, StoredConfig } from "./helpers.ts";
export { PLUGIN_MIGRATIONS } from "./plugins.ts";

type Migration = (config: StoredConfig, files: MigratedFiles) => void;

const MIGRATIONS: [version: string, migration: Migration][] = [
  // pear-desktop migrations from before 3.12: old configs are upgraded through
  // the same chain, oldest first, exactly as pear-desktop ran them.
  [
    "1.7.0",
    (config) => {
      // The plugin list was an array of enabled ids; later versions need entries.
      const ids = config.plugins as unknown;
      if (!Array.isArray(ids)) return;
      const entries: Record<string, Record<string, unknown>> = {
        adblocker: { enabled: true, cache: true, additionalBlockLists: [] },
        downloader: { enabled: false, ffmpegArgs: [], downloadFolder: undefined },
      };
      for (const id of ids) {
        if (typeof id !== "string") continue;
        entries[id] = { ...(entries[id] ?? {}), enabled: true };
      }
      config.plugins = entries;
    },
  ],
  [
    "1.12.0",
    (config) => {
      // Shortcuts were { action, shortcut }[]; they became one record per scope.
      const shortcuts = config.plugins?.shortcuts;
      if (!isRecord(shortcuts)) return;
      for (const scope of ["global", "local"]) {
        const value = shortcuts[scope];
        if (!Array.isArray(value)) continue;
        const record: Record<string, unknown> = {};
        for (const item of value) {
          if (isRecord(item) && isString(item.action) && item.shortcut !== undefined && item.shortcut !== null) {
            record[item.action] = item.shortcut;
          }
        }
        shortcuts[scope] = record;
      }
    },
  ],
  [
    "1.14.0",
    (config) => {
      const precise = config.plugins?.["precise-volume"];
      if (isRecord(precise) && !isRecord(precise.globalShortcuts)) precise.globalShortcuts = {};
      const old = config.plugins?.["hide-video-player"];
      if (isRecord(old) && old.enabled === true) {
        delete config.plugins!["hide-video-player"];
        setNew(ensurePluginEntry(config, "video-toggle"), "enabled", true);
      }
    },
  ],
  [
    "1.17.0",
    (config) => {
      // The plugin's defaults changed; pear-desktop dropped the stored entry.
      if (config.plugins) delete config.plugins["picture-in-picture"];
      setNew(ensurePluginEntry(config, "video-toggle"), "mode", "custom");
    },
  ],
  [
    "1.20.0",
    (config) => {
      if (config.plugins) delete config.plugins.visualizer;
      const options = (config.options ??= {});
      if (options.ForceShowLikeButtons === true) {
        delete options.ForceShowLikeButtons;
        options.likeButtons = "force";
      }
    },
  ],
  [
    "2.1.0",
    (config) => {
      // The downloader's preset names became format + custom args.
      const downloader = config.plugins?.downloader;
      if (!isRecord(downloader)) return;
      const preset = downloader.preset;
      const custom = downloader.customPresetSetting;
      if (!isString(preset)) return;
      if (preset === "Source") {
        setNew(downloader, "format", "source");
      } else {
        setNew(downloader, "format", "custom");
        if (isRecord(custom)) {
          if (Array.isArray(custom.ffmpegArgs)) setNew(downloader, "customArgs", custom.ffmpegArgs.filter(isString).join(" "));
          if (isString(custom.extension)) setNew(downloader, "customExtension", custom.extension);
        }
      }
      delete downloader.preset;
      delete downloader.customPresetSetting;
    },
  ],
  [
    "2.1.3",
    (config) => {
      const discord = config.plugins?.discord;
      if (!isRecord(discord) || discord.listenAlong === undefined) return;
      setNew(discord, "playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063", discord.listenAlong);
      delete discord.listenAlong;
    },
  ],
  [
    "3.0.0",
    (config) => {
      const discord = config.plugins?.discord;
      if (!isRecord(discord)) return;
      // The 3.0 beta typo in the stored key.
      if (isNumber(discord.activityTimoutTime)) setNew(discord, "activityTimeoutTime", discord.activityTimoutTime);
      if (isRecord(discord) && discord.activityTimoutEnabled !== undefined)
        setNew(discord, "activityTimeoutEnabled", discord.activityTimoutEnabled);
      delete discord.activityTimoutEnabled;
      delete discord.activityTimoutTime;
    },
  ],
  [
    "3.3.0",
    (config) => {
      // The separate Last.fm plugin folded into the scrobbler.
      const lastfm = config.plugins?.lastfm;
      if (!isRecord(lastfm)) return;
      const scrobbler = ensurePluginEntry(config, "scrobbler");
      const scrobblers = isRecord(scrobbler.scrobblers) ? scrobbler.scrobblers : (scrobbler.scrobblers = {});
      scrobblers.lastfm = {
        ...(isRecord(scrobblers.lastfm) ? scrobblers.lastfm : {}),
        enabled: lastfm.enabled,
        token: lastfm.token,
        sessionKey: lastfm.session_key,
        apiRoot: lastfm.api_root,
        apiKey: lastfm.api_key,
        secret: lastfm.secret,
      };
      delete config.plugins!.lastfm;
    },
  ],
  [
    "3.10.0",
    (config) => {
      // lyrics-genius became synced-lyrics.
      const old = config.plugins?.["lyrics-genius"];
      if (!isRecord(old)) return;
      const synced = ensurePluginEntry(config, "synced-lyrics");
      if (synced.enabled !== old.enabled) setNew(synced, "enabled", old.enabled);
      delete config.plugins!["lyrics-genius"];
    },
  ],
  [
    "3.12.3",
    (config) => {
      // A single preferred provider became an orderable priority list.
      const synced = config.plugins?.["synced-lyrics"];
      if (!isRecord(synced) || synced.providerPriority !== undefined || synced.preferredProvider === undefined) return;
      const preferred = synced.preferredProvider;
      delete synced.preferredProvider;
      if (isString(preferred)) {
        synced.providerPriority = [preferred];
        synced.usePriorityList = true;
      }
    },
  ],
  [
    "3.12.4",
    (config) => {
      // Removed options/plugins from the 3.12.4 release; deleting only when present
      // keeps a file that never had them untouched.
      delete config.options?.inProcessGpu;
      for (const id of ["skip-disliked-songs", "compact-sidebar", "custom-theme"]) delete config.plugins?.[id];
    },
  ],
  [
    // pear-desktop's own: its ad blocker became do-not-track (for files from before 3.12).
    "3.12.0",
    (config) => {
      const blocker = config.plugins?.adblocker;
      // Exactly as pear-desktop released it (arrays included), like every released migration.
      if (!blocker || typeof blocker !== "object") return;
      if (blocker.blocker !== "In player" && blocker.blocker !== "With blocklists") blocker.blocker = "In player";
      config.plugins!["do-not-track"] = blocker;
      delete config.plugins!.adblocker;
    },
  ],
  [
    // pear-desktop 3.x -> the rewrite. Most of the file already means the same:
    // plugin ids, options and their values were kept on purpose. What moved:
    "4.0.0",
    (config, files) => {
      const options = (config.options ??= {});
      // The file's last writer, before this migration: some 3.x defaults changed over time.
      const previous = typeof config.__internal__?.migrations?.version === "string" ? config.__internal__.migrations.version : "0.0.0";
      // The one performance mode toggle became a switch per part; a config written
      // before the split still holds the boolean.
      if (typeof options.performanceMode === "boolean") {
        const on = options.performanceMode;
        options.performanceMode = { flags: on, css: on, animations: on, plugins: on };
      }
      // The tray was an app option; it is a plugin now.
      if (typeof options.tray === "boolean") ensurePluginEntry(config, "tray").enabled = options.tray;
      // With the tray on, closing the window only hid it; that is an option of its own now.
      if (options.tray === true) setNew(ensurePluginEntry(config, "tray"), "closeToTray", true);
      if (typeof options.trayClickPlayPause === "boolean") ensurePluginEntry(config, "tray").clickPlayPause = options.trayClickPlayPause;
      // The tray's own window/icon behavior was app options; the tray plugin carries them now.
      for (const [option, key] of [
        ["trayMoveToCurrentDesktop", "moveToCurrentDesktop"],
        ["trayForceWhiteIcons", "forceWhiteIcons"],
      ] as const) {
        if (typeof options[option] === "boolean") setNew(ensurePluginEntry(config, "tray"), key, options[option]);
      }
      // The API server listened on every interface (phone remotes) until 3.12.4 changed that
      // default to this machine only; pear-desktop didn't store defaults, so files from before
      // 3.12.4 get the old default set for them. 3.12.4 files keep its local-only default.
      const apiServer = config.plugins?.["api-server"];
      if (isRecord(apiServer) && compareVersions(previous, "3.12.4") < 0) setNew(apiServer, "hostname", "0.0.0.0");
      // On by default in pear-desktop (off in the rewrite): keep it for everyone who didn't turn it off.
      const doNotTrack = ensurePluginEntry(config, "do-not-track");
      if (doNotTrack.enabled !== false) doNotTrack.enabled = true;
      // Appearance -> Context menu kept the hidden entry keys in one record; the rewrite has a
      // flat switch per entry (`contextMenu<Entry>`). The record stays for a downgrade.
      const hiddenMenuEntries = options.contextMenuHidden;
      if (isRecord(hiddenMenuEntries)) {
        for (const entry of CONTEXT_MENU_ENTRIES) {
          if (hiddenMenuEntries[entry.key] === true) setNew(options, entry.configKey, true);
        }
      }
      // YTM's feature-flag overrides record became the site section's "name=value" list.
      if (isRecord(options.featureFlags)) {
        const flags = siteFlagEntries(options.featureFlags);
        if (flags.length > 0) setNew(options, "siteFlags", flags);
      }
      // Created before the plugin conversions: they set pear-desktop's defaults (skipExisting) on it too.
      const downloader = ensurePluginEntry(config, "downloader");
      migratePlugins(config, files);
      // pear-desktop saved every download to the download folder; the rewrite keeps them in the app
      // unless asked (exportFiles). Everyone upgrading keeps getting the files.
      setNew(downloader, "exportFiles", true);
    },
  ],
];

/** Plugin options renamed or reshaped by the rewrite (see plugins.ts). */
function migratePlugins(config: StoredConfig, files: MigratedFiles) {
  const entries = config.plugins ?? {};
  for (const [id, migrate] of Object.entries(PLUGIN_MIGRATIONS)) {
    const entry = entries[id];
    if (isRecord(entry)) migrate(entry, config, files);
  }
}

/** Runs the migrations a stored config needs; a missing file starts fresh. */
export function migrate(
  stored: StoredConfig | undefined,
  appVersion: string,
): { config: StoredConfig; migrated: boolean; files: MigratedFiles } {
  const config: StoredConfig = structuredClone(stored ?? {});
  const files: MigratedFiles = {};
  const previous = stored ? (config.__internal__?.migrations?.version ?? "0.0.0") : appVersion;
  for (const [version, migration] of MIGRATIONS) {
    if (compareVersions(version, previous) > 0 && compareVersions(version, appVersion) <= 0) migration(config, files);
  }
  const migrated = !stored || previous !== appVersion;
  // Never record an older version than the one that wrote the file (a downgrade).
  if (compareVersions(appVersion, previous) >= 0) {
    config.__internal__ = { ...config.__internal__, migrations: { ...config.__internal__?.migrations, version: appVersion } };
  }
  return { config, migrated, files };
}
