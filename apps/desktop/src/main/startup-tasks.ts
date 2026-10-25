// What runs around startup besides building the app: the command line switches
// (before the app is ready), the proxy (before the first request), and the
// cache clearing (a while after the window is up).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type App, session } from "electron";
import type { Settings } from "./config.ts";
import type { PluginHost } from "./plugins.ts";
import { registerSettingsScheme } from "./settings-window.ts";

/** Like pear-desktop: clear the cache once the page has settled. */
const CLEAR_CACHE_DELAY_MS = 20_000;

/**
 * Chromium features the app asks for on every platform (pear-desktop's list):
 * SharedArrayBuffer for the downloader's wasm, overlay scrollbars, native
 * Wayland windows, and the memory features that hand memory back under pressure.
 */
const BASE_ENABLED_FEATURES = [
  "SharedArrayBuffer",
  "OverlayScrollbar",
  "UseOzonePlatform",
  "WaylandWindowDecorations",
  "MemoryPurgeOnFreeze",
  "ReleaseResourceStrongReferencesOnMemoryPressure",
  "DeferSpeculativeRFHCreation",
];

/**
 * Chromium features turned off: FluentScrollbar is the desktop-style scrollbar
 * that OverlayScrollbar replaces, and the app never does browser-style
 * navigations, so the back/forward and prerender machinery is dead weight.
 */
const BASE_DISABLED_FEATURES = ["FluentScrollbar", "BackForwardCache", "Prerender2"];

/** Must run before `app.whenReady()`. */
export function beforeReady(app: App, settings: Settings, plugins: PluginHost) {
  const advanced = settings.core("advanced");
  // pear-desktop's transparent player needs software compositing on Linux, which
  // these beforeReady hooks turn on; in-process-gpu would contradict that.
  const transparentPlayer = process.platform === "linux" && settings.plugin("transparent-player")?.enabled === true;
  if (advanced.disableHardwareAcceleration) {
    app.disableHardwareAcceleration();
  } else if (advanced.inProcessGpu && !transparentPlayer) {
    // Opt-in experiment, not part of performance mode: folding the GPU service
    // into the app process saves a process, but can fall back to software rendering.
    app.commandLine.appendSwitch("in-process-gpu");
  }
  registerSettingsScheme();
  const features = plugins.beforeReady(app);
  const enabled = new Set([...BASE_ENABLED_FEATURES, ...features.enabled]);
  const disabled = new Set([...BASE_DISABLED_FEATURES, ...features.disabled]);
  // node-smtc replaces Chromium's media session on Windows (see index.ts).
  if (process.platform === "win32" && advanced.forceSmtc) {
    disabled.add("HardwareMediaKeyHandling");
    disabled.add("MediaSessionService");
  }
  // One switch per list: a second appendSwitch silences the first.
  app.commandLine.appendSwitch("enable-features", [...enabled].join(","));
  app.commandLine.appendSwitch("disable-features", [...disabled].join(","));
  console.info(`[pear] chromium features: +${[...enabled].join(",")} -${[...disabled].join(",")}`);
}

/** The Proxy plugin: while on, it owns the session's proxy. */
export const PROXY_PLUGIN = "auth-proxy-adapter";

/**
 * advanced.proxy, from the first request on (and again when the Proxy plugin is
 * turned off). The Proxy plugin (which also handles credentials) takes
 * precedence when it's enabled, as in pear-desktop.
 */
export async function applyProxy(settings: Settings) {
  const proxy = settings.core("advanced").proxy;
  const pluginEnabled = Boolean(settings.plugin(PROXY_PLUGIN)?.enabled);
  if (!proxy.trim() || pluginEnabled) return;
  try {
    // Plugin windows with their own partition (the scrobbler's Last.fm sign-in)
    // need it too; pear-desktop's --proxy-server was process-wide.
    for (const targetSession of [session.defaultSession, session.fromPartition("persist:pear-lastfm")]) {
      await targetSession.setProxy({ mode: "fixed_servers", proxyRules: proxy.trim() });
      // Connections opened before keep their old route otherwise (after the Proxy plugin was turned off).
      await targetSession.closeAllConnections();
    }
    console.info(`[pear] using proxy ${proxy.trim()}`);
  } catch (error) {
    console.error(`[pear] invalid proxy "${proxy}":`, error);
  }
}

/**
 * Code caches are keyed to the built renderer bundle, so after an app update the
 * old blobs are dead weight; drop them once per version (pear-desktop's
 * cache-version marker).
 */
export async function clearStaleCodeCaches(app: App) {
  const marker = join(app.getPath("userData"), "cache-version");
  const version = app.getVersion();
  let previous: string | undefined;
  try {
    previous = readFileSync(marker, "utf8");
  } catch {
    // First launch after install: no caches from an older bundle.
    writeFileSync(marker, version);
    return;
  }
  if (previous === version) return;
  try {
    await session.defaultSession.clearCodeCaches({});
  } catch (error) {
    console.error("[pear] failed to clear stale code caches:", error);
  }
  writeFileSync(marker, version);
}

export interface LaterTasksEnvironment {
  settings: Settings;
}

/** The cache clearing, after its delay. */
export function scheduleLaterTasks({ settings }: LaterTasksEnvironment) {
  if (!settings.core("advanced").autoResetAppCache) return;
  setTimeout(() => {
    console.info("[pear] clearing the app cache");
    void session.defaultSession.clearCache();
  }, CLEAR_CACHE_DELAY_MS);
}
