// What runs around startup besides building the app: the command line switches
// (before the app is ready), the proxy (before the first request), and the
// cache clearing (a while after the window is up).

import { type App, session } from "electron";
import type { Settings } from "./config.ts";
import type { PluginHost } from "./plugins.ts";
import { registerSettingsScheme } from "./settings-window.ts";

/** Like pear-desktop: clear the cache once the page has settled. */
const CLEAR_CACHE_DELAY_MS = 20_000;

/** Must run before `app.whenReady()`. */
export function beforeReady(app: App, settings: Settings, plugins: PluginHost) {
  const advanced = settings.core("advanced");
  if (advanced.disableHardwareAcceleration) {
    app.disableHardwareAcceleration();
  } else if (advanced.inProcessGpu) {
    // Opt-in experiment, not part of performance mode: folding the GPU service
    // into the app process saves a process, but can fall back to software rendering.
    app.commandLine.appendSwitch("in-process-gpu");
  }
  registerSettingsScheme();
  const features = plugins.beforeReady(app);
  const disabled = new Set(features.disabled);
  // node-smtc replaces Chromium's media session on Windows (see index.ts).
  if (process.platform === "win32" && advanced.forceSmtc) {
    disabled.add("HardwareMediaKeyHandling");
    disabled.add("MediaSessionService");
  }
  if (features.enabled.size > 0) app.commandLine.appendSwitch("enable-features", [...features.enabled].join(","));
  if (disabled.size > 0) app.commandLine.appendSwitch("disable-features", [...disabled].join(","));
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
    await session.defaultSession.setProxy({ mode: "fixed_servers", proxyRules: proxy.trim() });
    // Connections opened before keep their old route otherwise (after the Proxy plugin was turned off).
    await session.defaultSession.closeAllConnections();
    console.info(`[pear] using proxy ${proxy.trim()}`);
  } catch (error) {
    console.error(`[pear] invalid proxy "${proxy}":`, error);
  }
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
