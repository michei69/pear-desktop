/// <reference path="./virtual.d.ts" />
// Page runtime: runs in YTM's main world before any of its own
// scripts. Boots the player facade and the plugin runner.

import type { NowPlaying } from "@pear/sdk";
import type { Bridge, UiAction } from "@pear/sdk/protocol";
import { createShareUrlRewriter } from "@pear/sdk/share-url";
import { adoptSheet, styleSheet } from "@pear/sdk/stylesheets";
import { normalizeThemeState } from "@pear/sdk/themes";
import { mountSettings, type SettingsController } from "@pear/ui";
import plugins from "virtual:pear/page-plugins";
import { registerApiHandlers } from "./api.ts";
import { Appearance } from "./appearance.ts";
import { ContextMenuCustomizer } from "./context-menu.ts";
import { domReady } from "./dom.ts";
import { installAnimationThrottle, performanceModeCss } from "./performance.ts";
import { Player, type StatePublisher } from "./player.ts";
import { PluginRunner } from "./plugins.ts";
import { overrideSiteFlags, type SiteFlags, siteOverrides } from "./site-flags.ts";
import { ThemesRuntime } from "./themes.ts";

export interface RuntimeMarker {
  /** performance.now() at the moment the runtime executed. */
  injectedAt: number;
  /** document.readyState when the runtime executed; "loading" means before the page parsed. */
  readyState: DocumentReadyState;
  /** Number of <script> elements already in the document when the runtime executed. */
  scriptsBefore: number;
}

export interface Runtime {
  readonly marker: RuntimeMarker;
  readonly player: Player;
  readonly plugins: PluginRunner;
  /** YTM's feature flags as served, and the overrides the settings applied. */
  readonly siteFlags: SiteFlags;
  /** Available once the document has loaded. */
  readonly settings: SettingsController | undefined;
}

declare global {
  interface Window {
    __pear?: Bridge;
    __pearRuntime?: Runtime;
  }
}

const marker: RuntimeMarker = {
  injectedAt: performance.now(),
  readyState: document.readyState,
  scriptsBefore: document.scripts.length,
};

const bridge = window.__pear;
if (!bridge) throw new Error("[pear] bridge missing; preload did not expose __pear");

const performanceMode = bridge.bootstrap.core.advanced.config.performanceMode === true;
if (performanceMode) {
  adoptSheet(styleSheet(performanceModeCss));
  installAnimationThrottle();
}

// First: YTM's config script runs right after the runtime.
const siteFlags = overrideSiteFlags(siteOverrides(bridge.bootstrap.core.site.config), performanceMode);

/** The share dialog's cleaning options, from the General section. */
function shareUrlOptions(config: Record<string, unknown>) {
  return { stripMusic: config.stripMusicFromSharedLinks === true, stripSI: config.stripSIFromSharedLinks === true };
}

/** The share dialog rewriter's lifecycle, as `@pear/sdk/share-url` returns it. */
interface ShareUrlRewriter {
  start(): void;
  stop(): void;
}

let shareUrlOptionsValue = shareUrlOptions(bridge.bootstrap.core.general.config);
let shareUrlRewriter: ShareUrlRewriter | undefined;
let shareUrlReady = false;

/** (Re)starts the share dialog rewriter with the current options. */
const applyShareUrlOptions = (config: Record<string, unknown> = bridge.bootstrap.core.general.config): void => {
  shareUrlOptionsValue = shareUrlOptions(config);
  if (!shareUrlReady) return;
  shareUrlRewriter?.stop();
  shareUrlRewriter = undefined;
  if (!shareUrlOptionsValue.stripMusic && !shareUrlOptionsValue.stripSI) return;
  const rewriter = createShareUrlRewriter(document, shareUrlOptionsValue);
  shareUrlRewriter = rewriter;
  rewriter.start();
};

void domReady().then(() => {
  shareUrlReady = true;
  applyShareUrlOptions();
});

// Position-only updates are batched; everything else goes to the host at once.
const POSITION_PUBLISH_MS = 1000;

function hostPublisher(bridge: Bridge): StatePublisher {
  let lastSent = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let latest: NowPlaying | undefined;
  const send = () => {
    pending = undefined;
    lastSent = Date.now();
    if (latest) void bridge.invoke("player:update", latest);
  };
  const now = (state: NowPlaying) => {
    latest = state;
    clearTimeout(pending);
    send();
  };
  const batched = (state: NowPlaying) => {
    if (Date.now() - lastSent >= POSITION_PUBLISH_MS) return now(state);
    latest = state;
    pending ??= setTimeout(send, POSITION_PUBLISH_MS);
  };
  return { now, batched };
}

const UI_ACTIONS: Record<UiAction, (settings: SettingsController) => void> = {
  "open-settings": (settings) => settings.open(),
  "close-settings": (settings) => settings.close(),
  "toggle-settings": (settings) => settings.toggle(),
};

const player = new Player(hostPublisher(bridge), bridge.bootstrap.core.appearance.config);
const runner = new PluginRunner(plugins, bridge, player);
const appearance = new Appearance();
appearance.apply(runner.core("appearance"));
const contextMenu = new ContextMenuCustomizer();
contextMenu.apply(runner.core("appearance").config);
const themes = new ThemesRuntime();
themes.apply(normalizeThemeState(bridge.bootstrap.themes));

let settings: SettingsController | undefined;
const settingsReady = domReady().then(() => {
  settings = mountSettings({ ...runner.settings, siteFlags: () => siteFlags });
  return settings;
});

bridge.onEvent((event) => {
  switch (event.type) {
    case "plugin-state":
      return runner.applyState(event.id, event.state);
    case "plugin-event":
      return runner.dispatch(event.id, event.event, event.payload);
    case "plugin-error":
      return runner.reportError(event.id, event.message, "host");
    case "plugin-status":
      return runner.applyStatus(event.id, event.message);
    case "plugin-request":
      return void runner.request(event.id, event.event, event.payload, event.requestId);
    case "core-state":
      runner.applyCore(event.section, event.state);
      if (event.section === "general") return applyShareUrlOptions(event.state.config);
      if (event.section !== "appearance") return;
      appearance.apply(event.state);
      contextMenu.apply(event.state.config);
      return player.setOptions(event.state.config);
    case "themes": {
      const state = normalizeThemeState(event.state);
      runner.applyThemes(state);
      return themes.apply(state);
    }
    case "window-visibility":
      return runner.setWindowVisible(event.visible);
    case "player-control":
      return player.control(event.action);
    case "ui":
      return void settingsReady.then(UI_ACTIONS[event.action]);
  }
});

window.__pearRuntime = Object.freeze({
  marker,
  player,
  plugins: runner,
  siteFlags,
  get settings() {
    return settings;
  },
});
console.info("[pear] runtime injected", marker);

registerApiHandlers(runner, player);
runner.startEnabled();
