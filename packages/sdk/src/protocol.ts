// Internal wire protocol between the main process, the preload and the page
// runtime. Plugins never use this directly.

import type { ConfigShape } from "./config.ts";
import type { CoreSection, FlagValue, Flags } from "./core-config.ts";
import type { NowPlaying, PlayerAction } from "./player.ts";
import type { ThemeState } from "./themes.ts";

/** Origin of the standalone settings window (served by the host). */
export const SETTINGS_ORIGIN = "pear://settings";

export const CHANNEL = {
  invoke: "pear:invoke",
  bootstrap: "pear:bootstrap",
  event: "pear:event",
} as const;

export interface PluginState {
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface PluginMeta {
  /** `restartRequired` or a beforeReady/windowOptions hook: enabling/disabling only fully applies after a restart. */
  restartRequired: boolean;
}

/** The debug info the settings window's About section shows, and `GET /api/v2/pear` (getAppMeta). */
export interface AppDebugInfo {
  name: string;
  version: string;
  /** Channel and commit, e.g. `stable` or `beta 1a2b3c4`. */
  build: string;
  /** One line per copyright holder. */
  copyright: string;
  platform: string;
  arch: string;
  osVersion: string;
  versions: { electron: string; chrome: string; node: string };
  cpu: { model: string; threads: number };
  gpu: {
    renderer?: string;
    vendor?: string;
    driver?: string;
    /** From app.getGPUFeatureStatus(), e.g. `{ gpu_compositing: 'enabled' }`. */
    features: Record<string, string>;
  };
  /** Working set in kilobytes, per process group. */
  memory: { main: number; renderers: number; gpu: number };
}

/** What the published `flags.json` says about one Music feature flag. */
export interface FlagMetadata {
  /** Shown under the flag's name. */
  description?: string;
  /** Whether a change needs a restart. */
  requires_restart: boolean;
  /** Group the flag belongs to, shown as a tag. */
  family: string;
}

/** The published flag metadata, keyed by flag name. */
export type FlagMetadataMap = Record<string, FlagMetadata>;

/** YTM's live feature flags, as the page runtime exposes them to the settings UI. */
export interface LiveFeatureFlags {
  /** The flags YTM served this session, before any override. */
  served(): Flags;
  /** Add or replace one override and apply it live. */
  set(name: string, value: FlagValue): void;
  /** Drop one override, putting the page's own value back. */
  remove(name: string): void;
  /** YTM's client version this session. */
  clientVersion(): string | undefined;
}

/** A core settings section: its config and what the core is doing with it. */
export interface CoreState {
  config: Record<string, unknown>;
  /** e.g. the address the API server listens on. */
  status?: string;
  error?: string;
}

/** What the settings UI shows about a plugin (sent by the host, so it works without the page). */
export interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  config: ConfigShape;
  /** Settings buttons (`PluginDef.actions`), translated. */
  actions?: { name: string; label: string; description?: string }[];
}

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  /** `stable`, `beta` or `dev`. */
  channel?: string;
  /** Short commit the build came from. */
  commit?: string;
  /** `beta 1a2b3c4`, or the channel for stable/dev-unbaked builds. */
  build?: string;
  copyright?: string;
}

export interface Bootstrap {
  version: string;
  platform: string;
  /** Only plugins supported on this platform. */
  plugins: Record<string, PluginState>;
  meta: Record<string, PluginMeta>;
  /** Host-side errors so far, by plugin id. */
  errors: Record<string, string>;
  /** What host plugins say they are doing (`ctx.setStatus`), by plugin id. */
  statuses: Record<string, string>;
  core: Record<CoreSection, CoreState>;
  app: AppInfo;
  /** The active language and its strings (English underneath). */
  language: string;
  strings: Record<string, string>;
  /** Plugins supported on this platform, in settings-UI form. */
  catalog: PluginInfo[];
  /** The user's theme folders, the selected one and each one's palette layer. */
  themes: ThemeState;
  /** Whether the main window is on screen (not hidden or minimized). */
  windowVisible: boolean;
}

export type UiAction = "toggle-settings" | "open-settings" | "close-settings";

export type HostEvent =
  | { type: "plugin-state"; id: string; state: PluginState }
  | { type: "plugin-event"; id: string; event: string; payload: unknown }
  /** An empty message clears the plugin's host error. */
  | { type: "plugin-error"; id: string; message: string }
  /** An empty message clears the plugin's status line. */
  | { type: "plugin-status"; id: string; message: string }
  | { type: "plugin-request"; id: string; event: string; payload: unknown; requestId: number }
  | { type: "core-state"; section: CoreSection; state: CoreState }
  /** The theme folders changed (the list, a file's contents or the selection). */
  | { type: "themes"; state: ThemeState }
  /** The main window was shown, hidden, minimized or restored. */
  | { type: "window-visibility"; visible: boolean }
  | { type: "player-control"; action: PlayerAction }
  | { type: "ui"; action: UiAction };

/** Commands the page runtime may invoke on the host. */
export interface CoreCommands {
  ping(message: string): string;
  "app:version"(): string;
  "app:relaunch"(): void;
  "plugin:set-enabled"(id: string, enabled: boolean): void;
  "plugin:set-config"(id: string, patch: Record<string, unknown>): void;
  "plugin:invoke"(id: string, command: string, args: unknown[]): unknown;
  "plugin:respond"(requestId: number, ok: boolean, value: unknown): void;
  "core:set-config"(section: CoreSection, patch: Record<string, unknown>): void;
  /** Selects a theme ('' for none), asking for consent to its script first; false when declined. */
  "theme:select"(id: string): Promise<boolean>;
  /** Allows the theme's current script, asking for consent; false when declined. */
  "theme:allow-script"(id: string): Promise<boolean>;
  "theme:set-preset"(themeId: string, preset: string): void;
  "theme:set-palette-value"(themeId: string, key: string, value: string): void;
  "theme:reset-palette"(themeId: string): void;
  /** Creates a theme folder from CSS files (the user picks them when `paths` is omitted). */
  "theme:import"(paths?: string[]): Promise<string | null>;
  "theme:open-folder"(): void;
  /** The app language YTM is set to, or undefined when it isn't one we ship. */
  "language:from-\u0079outube"(): Promise<string | null>;
  /** Points YTM at the app language; takes a reload. */
  "language:to-\u0079outube"(): Promise<void>;
  /** Forwards a page-side event (lyrics updates) to the API server. */
  "api:page-event"(name: string, payload: unknown): void;
  /** Reveals config.json in the file manager. */
  "app:show-settings-file"(): void;
  /** Opens config.json in the default editor. */
  "app:edit-config"(): Promise<void>;
  "app:toggle-devtools"(): void;
  /** Opens a URL in the user's browser (the About links). */
  "app:open-external"(url: string): Promise<void>;
  /** The About section's debug info (and its copied report). */
  "app:meta"(): Promise<AppDebugInfo>;
  /** Descriptions, families and restart requirements for YTM's feature flags. */
  "flags:metadata"(): Promise<FlagMetadataMap>;
  /** Runs the update check now (the About "Check for updates" button). */
  "app:check-updates"(): void;
  "player:update"(state: NowPlaying): void;
}

export type CoreCommandName = keyof CoreCommands;

/** What the preload exposes on `window.__pear` in YTM's main world. */
export interface Bridge {
  readonly bootstrap: Bootstrap;
  invoke<K extends CoreCommandName>(name: K, ...args: Parameters<CoreCommands[K]>): Promise<Awaited<ReturnType<CoreCommands[K]>>>;
  onEvent(listener: (event: HostEvent) => void): void;
}
