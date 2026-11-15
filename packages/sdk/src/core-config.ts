// Schemas of the core's own settings sections, rendered in the settings
// overlay next to the plugins with the same field builders.

import { config, type BoolField, type ConfigOf } from "./config.ts";
import { CONTEXT_MENU_ENTRIES } from "./context-menu.ts";
import { languages } from "./macros.ts" with { type: "macro" };

/**
 * Where YTM opens: pear-desktop's page names (stored as is) and the
 * page each one opens. "" is YTM's own default.
 */
export const STARTING_PAGES = {
  "": "/",
  Home: "/browse/FEmusic_home",
  Explore: "/browse/FEmusic_explore",
  "New Releases": "/browse/FEmusic_new_releases",
  Charts: "/browse/FEmusic_charts",
  "Moods & Genres": "/browse/FEmusic_moods_and_genres",
  Library: "/browse/FEmusic_library_landing",
  Playlists: "/browse/FEmusic_liked_playlists",
  Songs: "/browse/FEmusic_liked_videos",
  Albums: "/browse/FEmusic_liked_albums",
  Artists: "/browse/FEmusic_library_corpus_track_artists",
  "Subscribed Artists": "/browse/FEmusic_library_corpus_artists",
  Uploads: "/browse/FEmusic_library_privately_owned_landing",
  "Uploaded Playlists": "/browse/FEmusic_liked_playlists",
  "Uploaded Songs": "/browse/FEmusic_library_privately_owned_tracks",
  "Uploaded Albums": "/browse/FEmusic_library_privately_owned_releases",
  "Uploaded Artists": "/browse/FEmusic_library_privately_owned_artists",
  "Mixed for you": "/browse/FEmusic_mixed_for_you",
} as const;

export type StartingPage = keyof typeof STARTING_PAGES;

const startingPageOptions = Object.keys(STARTING_PAGES).map((value) => ({
  value: value as StartingPage,
  label: value || "Default",
}));

// The core sections below are views over config.json (pear-desktop's app
// options, same names and values): `options` for most, `options.performanceMode`
// for the performance switches and `plugins.settings-ui` for the dialog's own
// options. Keys are unique across them.

export const GENERAL = {
  resumeOnStart: config.bool(true, {
    label: "Resume the last song",
    description: "Opens the song you played last when the app starts.",
    group: "Startup",
    restart: true,
  }),
  startingPage: config.select("", startingPageOptions, {
    label: "Starting page",
    description: "The page shown when the app starts, also with the last song resumed.",
    group: "Startup",
    variant: "dropdown",
    restart: true,
  }),
  language: config.select("", [{ value: "", label: "System default" }, ...languages()], {
    label: "Language",
    group: "Language",
    variant: "dropdown",
    restart: true,
    languageSync: true,
  }),
  autoUpdates: config.bool(true, {
    label: "Check for updates",
    description: "Tells you when a new version is out.",
    group: "Updates",
  }),
  updateChannel: config.select(
    "stable",
    [
      { value: "stable", label: "Stable" },
      { value: "beta", label: "Beta" },
    ],
    {
      label: "Update channel",
      description: "Beta gets the rolling build from master; stable gets versioned releases.",
      group: "Updates",
    },
  ),
  stripMusicFromSharedLinks: config.bool(false, {
    label: "Strip 'music.' from shared links",
    description: "Turns music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com links back into regular ones.",
    group: "Shared links",
  }),
  stripSIFromSharedLinks: config.bool(true, {
    label: "Strip 'si' from shared links",
    description: "Drops YTM's tracking parameter from links copied by the share dialog.",
    group: "Shared links",
  }),
};

export const WINDOW = {
  alwaysOnTop: config.bool(false, { label: "Always on top", group: "Window" }),
  hideMenu: config.bool(false, {
    label: "Hide the menu bar",
    description: "Press Alt to show it.",
    group: "Window",
    platforms: ["linux", "win32"],
  }),
  customWindowTitle: config.string("", {
    label: "Window title",
    placeholder: "The page's title",
    group: "Window",
  }),
  startAtLogin: config.bool(false, {
    label: "Start at login",
    group: "System",
    platforms: ["win32", "darwin"],
  }),
  forceSmtc: config.bool(false, {
    label: "Use Windows media controls",
    description: "Replaces Chromium's media session with the native System Media Transport Controls.",
    group: "System",
    platforms: ["win32"],
    restart: true,
  }),
  appVisible: config.bool(true, {
    label: "Show the window at startup",
    description: "Off: start hidden in the tray (needs the Tray icon plugin; otherwise the window shows as usual).",
    group: "System",
    hidden: true,
  }),
};

/** One "hide this entry" switch per three-dot menu entry, stored as `contextMenu<Entry>`. */
const contextMenuFields = Object.fromEntries(
  CONTEXT_MENU_ENTRIES.map((entry) => [entry.configKey, config.bool(false, { label: `Hide “${entry.label}”`, group: "Context menu" })]),
) as Record<string, BoolField>;

export const APPEARANCE = {
  removeUpgradeButton: config.bool(false, { label: "Remove the Upgrade button", group: "Interface" }),
  useYtmIcons: config.bool(false, {
    label: "Use Music's icons",
    description: "The window, tray and About artwork use YTM's logo instead of Pear Desktop's.",
    group: "Interface",
  }),
  likeButtons: config.select(
    "",
    [
      { value: "", label: "Default" },
      { value: "force", label: "Always show" },
      { value: "hide", label: "Hide" },
    ],
    { label: "Like buttons", group: "Interface" },
  ),
  swapLikeButtonsOrder: config.bool(false, { label: "Swap the like and dislike buttons", group: "Interface" }),
  hideDislikeButton: config.bool(false, {
    label: "Hide the dislike button",
    description: "Only the old player bar has one to hide.",
    group: "Interface",
  }),
  hideVideoCaptions: config.bool(false, {
    label: "Hide video captions",
    description: "Hides the player's captions button; captions already on keep showing.",
    group: "Interface",
  }),
  usePodcastParticipantAsArtist: config.bool(false, {
    label: "Show the listed participant as a podcast's artist",
    description: "Off: the channel that publishes it, usually the host. Used in notifications and integrations.",
    group: "Interface",
  }),
  ...contextMenuFields,
};

export const ADVANCED = {
  proxy: config.string("", {
    label: "Proxy",
    description: "For proxies that need a username and password, use the Proxy plugin.",
    placeholder: "socks5://127.0.0.1:9999",
    group: "Network",
    restart: true,
  }),
  overrideUserAgent: config.bool(false, {
    label: "Override the user agent",
    description:
      "Tell \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music this is Chrome rather than an Electron app. Google sign-in always sees the app as it is.",
    group: "Network",
    restart: true,
  }),
  disableHardwareAcceleration: config.bool(false, {
    label: "Disable hardware acceleration",
    description: "Try this if video or animations flicker or the window stays black.",
    group: "Performance",
    restart: true,
  }),
  autoResetAppCache: config.bool(false, {
    label: "Clear the cache at startup",
    group: "Performance",
    restart: true,
  }),
  restartOnConfigChanges: config.bool(false, {
    label: "Restart when settings change",
    description: "Applies every settings change at once by restarting the app instead of waiting for you to.",
    group: "Configuration",
  }),
};

/**
 * The performance switches: independent parts that each trade some visual
 * fidelity for cheaper rendering. Read at page start, so each needs a restart.
 */
export const PERFORMANCE = {
  flags: config.bool(false, {
    label: "Lighter \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music interface",
    description:
      "Turns off \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music's heavier artwork, motion and list-rendering features. Your own flag overrides still win.",
    group: "Rendering",
    restart: true,
  }),
  css: config.bool(false, {
    label: "Disable animations and backdrop blur",
    description: "Injects a stylesheet that collapses animations and transitions and turns off backdrop blur across the interface.",
    group: "Rendering",
    restart: true,
  }),
  animations: config.bool(false, {
    label: "Reduce main-thread animation work",
    description:
      "Ends the layout animations \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music runs on the main thread as soon as they start.",
    group: "Rendering",
    restart: true,
  }),
  plugins: config.bool(false, {
    label: "Skip heavy visual plugins",
    description: "Does not start the renderer half of Ambient mode, Blur navigation bar and Visualizer. Their settings are kept.",
    group: "Rendering",
    restart: true,
  }),
};

/** The settings dialog's own options, stored where pear-desktop's settings-ui plugin kept them. */
export const SETTINGS_UI = {
  showButton: config.bool(true, {
    label: "Show the settings entry in the sidebar",
    description: "Turn this off to keep the sidebar clean; Settings is still under Options \u203a Settings\u2026 and on Ctrl/Cmd+,.",
  }),
  separateWindow: config.bool(false, {
    label: "Always open Settings in a separate window",
    description: "Opens the standalone settings window instead of the in-app panel.",
  }),
  removeBackdropBlur: config.bool(false, {
    label: "Remove the settings backdrop blur",
    description: "Turns off the blur behind the in-app settings panel while it is open. Other blurs in the app keep working.",
  }),
};

/**
 * YTM's feature flags, set as the page loads (see packages/page/src/site-flags.ts).
 * YTM tries new designs on some users first, chosen per visitor.
 */
export const SITE = {
  playerBar: config.select(
    "",
    [
      { value: "", label: "Site's choice" },
      { value: "classic", label: "Classic" },
      { value: "new", label: "New" },
    ],
    {
      label: "Player bar",
      description:
        "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music is trying a new player bar on some users. The one it didn't choose for you works, but without like buttons: it only sends them for its choice.",
      group: "Site features",
      restart: true,
    },
  ),
  siteFlags: config.list([], {
    label: "Feature flag overrides",
    description:
      "One flag per entry, as name=value. Values keep their type: true or false, a number, text, or JSON for objects and lists. Unknown names do nothing.",
    placeholder: "flag_name=false",
    group: "Site features",
    restart: true,
  }),
};

/** A JSON value as the page's flags can hold one (objects and arrays included). */
export type JsonValue = boolean | number | string | null | JsonValue[] | { [key: string]: JsonValue };
export type FlagValue = JsonValue;
export type Flags = Record<string, FlagValue>;

const FLAG_NAME = /^[\w.-]+$/;
/** Prefix of an entry whose value is any JSON literal, verbatim (objects, arrays, null, a "true"-looking string…). */
const JSON_VALUE = "json:";

/** A `siteFlags` entry, "name=value", as [name, value] with true/false and numbers typed like YTM's. */
export function parseFlagOverride(entry: string): [string, FlagValue] | undefined {
  const separator = entry.indexOf("=");
  const name = (separator === -1 ? entry : entry.slice(0, separator)).trim();
  if (!FLAG_NAME.test(name)) return undefined;
  // A bare name turns the flag on.
  if (separator === -1) return [name, true];
  const raw = entry.slice(separator + 1).trim();
  if (raw.startsWith(JSON_VALUE)) {
    const value = parseJson(raw.slice(JSON_VALUE.length));
    if (value !== undefined) return [name, value];
  }
  if (raw === "true" || raw === "false") return [name, raw === "true"];
  if (raw !== "" && Number.isFinite(Number(raw))) return [name, Number(raw)];
  // The migration of pear-desktop's flag record writes objects and arrays as
  // their JSON text (no prefix), so read those back typed too.
  if (raw.startsWith("{") || raw.startsWith("[")) {
    const value = parseJson(raw);
    if (value !== undefined) return [name, value];
  }
  return [name, raw];
}

/** A JSON literal's value; undefined when the text isn't JSON (it is then kept as text). */
function parseJson(text: string): FlagValue | undefined {
  try {
    return JSON.parse(text) as FlagValue;
  } catch {
    return undefined;
  }
}

/** `name=value` for booleans and numbers; text and other JSON values keep their type through `json:`. */
function encodeFlagValue(value: FlagValue): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : `${JSON_VALUE}${JSON.stringify(String(value))}`;
  if (typeof value === "string") {
    // Text that reads back as itself stays plain, like pear-desktop's list did.
    const plain = parseFlagOverride(`flag=${value}`);
    return plain?.[1] === value ? value : `${JSON_VALUE}${JSON.stringify(value)}`;
  }
  return `${JSON_VALUE}${JSON.stringify(value)}`;
}

/** The overrides a `siteFlags` list asks for; later entries win. */
export function flagOverrides(entries: readonly string[]): Flags {
  const flags: Flags = {};
  for (const entry of entries) {
    const parsed = parseFlagOverride(entry);
    if (parsed) flags[parsed[0]] = parsed[1];
  }
  return flags;
}

/** `siteFlags` with `name` set to `value`, or without it when `value` is undefined. */
export function withFlagOverride(entries: readonly string[], name: string, value: FlagValue | undefined): string[] {
  const others = entries.filter((entry) => parseFlagOverride(entry)?.[0] !== name);
  return value === undefined ? others : [...others, `${name}=${encodeFlagValue(value)}`];
}

/**
 * Flags forced while the performance flags switch is on. The page's own
 * `EXPERIMENT_FLAGS` read them; a flag the user overrides wins (see
 * `performanceModeOverrides`). Shared by the page (which applies them) and the
 * main process (the API server reports what the app actually sets).
 */
export const performanceModeFeatureFlags: Flags = {
  // Artwork: fixed 1x thumbnail factor instead of the device pixel ratio, no
  // forced max quality, no placeholder background, no oversized search art.
  kevlar_tuner_should_use_thumbnail_factor: true,
  kevlar_tuner_thumbnail_factor: 1,
  kevlar_tuner_max_thumbnail_quality: false,
  kevlar_thumbnail_bg: false,
  enable_desktop_search_bigger_thumbs: false,
  yt_img_shadow_trigger_show_on_visible: true,
  // Motion: Lottie/Rive/WASM animations and the watch-page cinematics are the
  // expensive half of the UI; they are all optional.
  web_animated_actions: false,
  web_animated_actions_v2: false,
  web_enable_voting_animation: false,
  enable_music_web_cairo_voting_animation: false,
  enable_player_bar_slide_up_animation: false,
  web_enable_rive_animated_like_icon: false,
  music_web_enable_album_art_zoom: false,
  web_watch_cinematics_disabled_by_default: true,
  web_watch_cinematics_preferred_reduced_motion_default_disabled: true,
  // Cheaper list and icon rendering.
  music_web_optimize_queue_rendering: true,
  wil_icon_render_when_idle: true,
  always_render_thumbnail_overlay: false,
  web_enable_card_view_model_hover_effect: false,
};

/** Performance flags first, the user's own flag overrides second, so a deliberate choice always wins. */
export function performanceModeOverrides(userOverrides: Flags, enabled: boolean): Flags {
  return enabled ? { ...performanceModeFeatureFlags, ...userOverrides } : userOverrides;
}

/** pear-desktop's API server port, which companion apps expect by default. */
export const DEFAULT_API_PORT = 26538;
const MAX_PORT = 65535;

export const API_SERVER = {
  enabled: config.bool(false, {
    label: "Enable the API server",
    description: "Lets other apps control playback and read the current song over HTTP and WebSocket.",
  }),
  hostname: config.string("127.0.0.1", {
    label: "Hostname",
    group: "Network",
    description: "127.0.0.1 accepts connections only from this computer; 0.0.0.0 from your network too.",
  }),
  port: config.number(DEFAULT_API_PORT, { label: "Port", group: "Network", min: 1, max: MAX_PORT, step: 1, variant: "stepper" }),
  authStrategy: config.select(
    "AUTH_AT_FIRST",
    [
      { value: "AUTH_AT_FIRST", label: "Ask when a new client connects" },
      { value: "NONE", label: "None (anyone who can reach the port)" },
    ],
    { label: "Authorization", group: "Access" },
  ),
  authorizedClients: config.list([], {
    label: "Authorized clients",
    group: "Access",
    description: "Client IDs that may use the API. Remove one to revoke it.",
  }),
  secret: config.string("", {
    label: "Token secret",
    group: "Access",
    secret: true,
    description: "Signs access tokens; changing it signs every client out. Generated when empty.",
  }),
  mcpEnabled: config.bool(false, {
    label: "Enable MCP",
    description: "Exposes the API server's operations as Model Context Protocol tools at /mcp.",
    group: "MCP",
  }),
  useHttps: config.bool(false, { label: "Use HTTPS", group: "HTTPS" }),
  certPath: config.string("", { label: "Certificate file", group: "HTTPS", placeholder: "/path/to/cert.pem" }),
  keyPath: config.string("", { label: "Private key file", group: "HTTPS", placeholder: "/path/to/key.pem" }),
};

export type ApiServerConfig = ConfigOf<typeof API_SERVER>;

/** Translation keys for one field, where pear-desktop already translated its texts under other keys. */
export interface FieldTextKeys {
  label?: string;
  description?: string;
  placeholder?: string;
  /** Translation key per option value. */
  options?: Readonly<Record<string, string>>;
  /** Translation keys for the label's `{{placeholders}}`, translated before they are filled in. */
  vars?: Readonly<Record<string, string>>;
}

const menu = (path: string) => `main.menu.options.submenu.${path}`;

/**
 * The texts pear-desktop already had translated, under its own keys (mostly the
 * Options menu's). Only fields whose label, description or option names carry
 * over from master are listed; the rest keep the generated `settings-ui.core.*`
 * keys and fall back to English until they are translated.
 */
export const CORE_FIELD_KEYS: Readonly<Record<string, FieldTextKeys>> = {
  // General
  resumeOnStart: { label: menu("resume-on-start") },
  startingPage: { label: menu("starting-page.label"), options: { "": menu("starting-page.unset") } },
  language: { label: menu("language.label") },
  autoUpdates: { label: menu("updates.auto-update") },
  updateChannel: {
    label: menu("updates.channel.label"),
    options: { stable: menu("updates.channel.stable"), beta: menu("updates.channel.beta") },
  },
  stripMusicFromSharedLinks: { label: menu("shared-links.submenu.strip-music") },
  stripSIFromSharedLinks: { label: menu("shared-links.submenu.strip-si") },
  // Window & Tray
  alwaysOnTop: { label: menu("always-on-top") },
  hideMenu: { label: menu("hide-menu.label") },
  customWindowTitle: {
    label: menu("visual-tweaks.submenu.custom-window-title.label"),
    placeholder: menu("visual-tweaks.submenu.custom-window-title.prompt.placeholder"),
  },
  startAtLogin: { label: menu("start-at-login") },
  forceSmtc: { label: menu("advanced-options.submenu.force-smtc") },
  // Appearance
  removeUpgradeButton: { label: menu("visual-tweaks.submenu.remove-upgrade-button") },
  useYtmIcons: { label: menu("visual-tweaks.submenu.use-ytm-icons") },
  likeButtons: {
    label: menu("visual-tweaks.submenu.like-buttons.label"),
    options: {
      "": menu("visual-tweaks.submenu.like-buttons.default"),
      force: menu("visual-tweaks.submenu.like-buttons.force-show"),
      hide: menu("visual-tweaks.submenu.like-buttons.hide"),
    },
  },
  swapLikeButtonsOrder: { label: menu("visual-tweaks.submenu.like-buttons.swap") },
  hideDislikeButton: { label: "settings-ui.fields.hide-dislike-button" },
  hideVideoCaptions: { label: "settings-ui.fields.hide-video-captions" },
  usePodcastParticipantAsArtist: {
    label: "settings-ui.fields.podcast-artist",
    description: "settings-ui.fields.podcast-artist-desc",
  },
  // Advanced
  proxy: {
    label: menu("advanced-options.submenu.set-proxy.label"),
    placeholder: menu("advanced-options.submenu.set-proxy.prompt.placeholder"),
  },
  overrideUserAgent: { label: menu("advanced-options.submenu.override-user-agent") },
  disableHardwareAcceleration: { label: menu("advanced-options.submenu.disable-hardware-acceleration") },
  autoResetAppCache: { label: menu("advanced-options.submenu.auto-reset-app-cache") },
  restartOnConfigChanges: { label: menu("advanced-options.submenu.restart-on-config-changes") },
  // The settings dialog's own options (labels only: master's descriptions name a menu path the rewrite moved)
  showButton: { label: "settings-ui.settings.show-button" },
  separateWindow: { label: "settings-ui.settings.separate-window" },
  // The API server's (pear-desktop's plugin strings)
  hostname: { label: "plugins.api-server.menu.hostname.label" },
  port: { label: "plugins.api-server.menu.port.label" },
  authStrategy: {
    label: "plugins.api-server.menu.auth-strategy.label",
    options: {
      AUTH_AT_FIRST: "plugins.api-server.menu.auth-strategy.submenu.auth-at-first.label",
      NONE: "plugins.api-server.menu.auth-strategy.submenu.none.label",
    },
  },
  useHttps: { label: "plugins.api-server.menu.https.submenu.enable-https.label" },
  certPath: { label: "plugins.api-server.menu.https.submenu.cert.label" },
  keyPath: { label: "plugins.api-server.menu.https.submenu.key.label" },
  mcpEnabled: { label: "plugins.api-server.menu.mcp.label", description: "plugins.api-server.menu.mcp.description" },
  // The context-menu switches: one shared label with the entry's own name in it.
  ...Object.fromEntries(
    CONTEXT_MENU_ENTRIES.map((entry) => [
      entry.configKey,
      {
        label: "settings-ui.fields.context-menu.hide-entry",
        vars: { entry: `settings-ui.fields.context-menu.entries.${entry.key}` },
      },
    ]),
  ),
};

export const CORE_SECTIONS = {
  general: GENERAL,
  window: WINDOW,
  appearance: APPEARANCE,
  performance: PERFORMANCE,
  settingsUi: SETTINGS_UI,
  advanced: ADVANCED,
  site: SITE,
  apiServer: API_SERVER,
} as const;

export type CoreSection = keyof typeof CORE_SECTIONS;

/** The core sections plugins may read: all but the API server's (it holds the token secret). */
export type PluginCoreSection = Exclude<CoreSection, "apiServer">;
export type CoreConfigOf<S extends CoreSection> = ConfigOf<(typeof CORE_SECTIONS)[S]>;

export function isCoreSection(name: string): name is CoreSection {
  return Object.hasOwn(CORE_SECTIONS, name);
}
