// Runs host parts of plugins and keeps the page in sync: enabling, disabling
// and config changes apply live in both processes, no restart needed.

import type { App, BrowserWindow, BrowserWindowConstructorOptions, Session } from "electron";
import { interpolate, type Translate } from "@pear/sdk/i18n";
import { type AnyPlugin, type HostContext, type HostPlayer, type PluginCallResult, type RpcMethod, supportsPlatform } from "@pear/sdk";
import type { MenuItems } from "./menu-items.ts";
import { CleanupStack, createLogger, errorMessage, timerSet } from "@pear/sdk/util";
import { v } from "@pear/sdk/rpc";
import type { HostEvent, PluginMeta, PluginState } from "@pear/sdk/protocol";
import type { Settings } from "./config.ts";
import type { I18n } from "./i18n.ts";
import type { PageRequests } from "./page-requests.ts";
import type { PlayerMirror } from "./player.ts";
import { resolvePluginConflicts } from "./plugin-conflicts.ts";
import { validationMessage } from "./validation.ts";
import type { WebRequestRouter } from "./web-request.ts";

type AnyConfig = Record<string, unknown>;
type ConfigListener = (config: AnyConfig) => void | "restart";

/** A running host part. */
class Instance {
  readonly cleanups = new CleanupStack((error) => this.ctx.log.error("cleanup failed", error));
  /** Registered with `ctx.onConfigChange`; they replace restarting. */
  readonly configListeners: ConfigListener[] = [];
  stopped = false;
  readonly ctx: HostContext<AnyConfig>;

  constructor(createContext: (instance: Instance) => HostContext<AnyConfig>) {
    this.ctx = createContext(this);
  }
}

export interface HostEnvironment {
  app: App;
  window: BrowserWindow;
  session: Session;
  router: WebRequestRouter;
  player: PlayerMirror;
  requests: PageRequests;
  send(event: HostEvent): void;
  /** The in-page settings, or the standalone window when the page isn't up. */
  openSettings(): void;
  /** Shows the main window and brings it to the front. */
  focusWindow(): void;
  /** Plugins' items in the app and tray menus. */
  menuItems: MenuItems;
  /** Sends a plugin event to API server WebSocket clients. */
  broadcast(plugin: string, event: string, data: unknown): void;
  /** Subscribes to app protocol commands. */
  onProtocol(listener: (command: string, args: string[]) => void): () => void;
  /** A plugin was turned off in settings (not stopped to restart it or to quit). */
  onDisabled(id: string): void;
}

/** An exposed method, as listed by the API server. */
export interface RpcEntry {
  plugin: string;
  name: string;
  method: RpcMethod;
}

export type RpcResult = { ok: true; value: unknown } | { ok: false; status: 400 | 404 | 503; error: string };

export class PluginHost {
  readonly plugins: readonly AnyPlugin[];
  #byId: Map<string, AnyPlugin>;
  #settings: Settings;
  #instances = new Map<string, Instance>();
  /** Host halves running at app launch, for page reloads of restart-required plugins. */
  #launchRunning = new Map<string, boolean>();
  #errors = new Map<string, string>();
  #statuses = new Map<string, string>();
  #env: HostEnvironment | undefined;
  #i18n: I18n | undefined;

  constructor(plugins: readonly AnyPlugin[], settings: Settings, platform: string) {
    // "core" addresses the core's own page handlers and webRequest listeners.
    if (plugins.some((plugin) => plugin.id === "core")) throw new Error('[pear] the plugin id "core" is reserved');
    this.plugins = plugins.filter((plugin) => supportsPlatform(plugin, platform));
    this.#byId = new Map(this.plugins.map((plugin) => [plugin.id, plugin]));
    this.#settings = settings;
  }

  get(id: string) {
    return this.#byId.get(id);
  }

  states(): Record<string, PluginState> {
    const stored = this.#settings.allPlugins();
    const enabled = new Set(this.plugins.filter((plugin) => stored[plugin.id]?.enabled).map((plugin) => plugin.id));
    const blocked = resolvePluginConflicts(this.plugins, enabled);
    return Object.fromEntries(
      this.plugins.map((plugin) => {
        const state = stored[plugin.id] ?? { enabled: false, config: {} };
        const blocker = blocked.get(plugin.id);
        const blockerPlugin = blocker && this.#byId.get(blocker.id);
        return [
          plugin.id,
          {
            enabled: state.enabled && !blocker,
            config: state.config,
            ...(blocker && blockerPlugin
              ? {
                  blockedBy: {
                    id: blockerPlugin.id,
                    name: this.t(`plugins.${blockerPlugin.id}.name`, blockerPlugin.name),
                    reason: blocker.reason,
                  },
                }
              : {}),
          },
        ];
      }),
    );
  }

  /** What the settings UI needs to know per plugin: whether changes take a restart. */
  meta(): Record<string, PluginMeta> {
    return Object.fromEntries(
      this.plugins.map((p) => [
        p.id,
        {
          restartRequired: Boolean(p.restartRequired || p.host?.beforeReady || p.host?.windowOptions),
          runningAtLaunch: this.#launchRunning.get(p.id) === true,
        },
      ]),
    );
  }

  /** Main-window options contributed by plugins enabled at launch. */
  windowOptions(): BrowserWindowConstructorOptions {
    let merged: BrowserWindowConstructorOptions = {};
    const states = this.states();
    for (const plugin of this.plugins) {
      const state = this.#settings.plugin(plugin.id);
      if (!state || !states[plugin.id]?.enabled || !plugin.host?.windowOptions) continue;
      try {
        const options = plugin.host.windowOptions(state.config);
        merged = { ...merged, ...options, webPreferences: { ...merged.webPreferences, ...options.webPreferences } };
      } catch (error) {
        this.#reportError(plugin.id, "windowOptions failed", error);
      }
    }
    return merged;
  }

  errors(): Record<string, string> {
    return Object.fromEntries(this.#errors);
  }

  statuses(): Record<string, string> {
    return Object.fromEntries(this.#statuses);
  }

  #setStatus(id: string, message: string) {
    if ((this.#statuses.get(id) ?? "") === message) return;
    if (message) this.#statuses.set(id, message);
    else this.#statuses.delete(id);
    this.#env?.send({ type: "plugin-status", id, message });
  }

  #clearError(id: string) {
    if (this.#errors.delete(id)) this.#env?.send({ type: "plugin-error", id, message: "" });
  }

  #reportError(id: string, what: string, error: unknown) {
    createLogger(id).error(what, error);
    const message = `${what}: ${errorMessage(error)}`;
    this.#errors.set(id, message);
    this.#env?.send({ type: "plugin-error", id, message });
  }

  /** Runs plugins' beforeReady hooks; returns the Chromium features they asked for. */
  beforeReady(app: App) {
    const enabled = new Set<string>();
    const disabled = new Set<string>();
    const states = this.states();
    for (const plugin of this.plugins) {
      const state = this.#settings.plugin(plugin.id);
      if (!state || !states[plugin.id]?.enabled || !plugin.host?.beforeReady) continue;
      try {
        plugin.host.beforeReady({
          config: state.config,
          app,
          enableFeatures: (...features) => features.forEach((f) => enabled.add(f)),
          disableFeatures: (...features) => features.forEach((f) => disabled.add(f)),
        });
      } catch (error) {
        this.#reportError(plugin.id, "beforeReady failed", error);
      }
    }
    return { enabled, disabled };
  }

  /** The active language; set once the app is ready, before plugins start. */
  setI18n(i18n: I18n) {
    this.#i18n = i18n;
  }

  get i18n() {
    return this.#i18n;
  }

  /** Translates into the active language; the English fallbacks until it is set. */
  readonly t: Translate = (key, fallback, vars) => (this.#i18n ? this.#i18n.t(key, fallback, vars) : interpolate(fallback ?? key, vars));

  attach(env: HostEnvironment) {
    this.#env = env;
    const states = this.states();
    for (const plugin of this.plugins) {
      if (states[plugin.id]?.enabled) void this.#start(plugin);
    }
    // Restart-required page halves follow the launch state, including page-only
    // plugins that never create a host instance.
    this.#launchRunning = new Map(this.plugins.map((plugin) => [plugin.id, states[plugin.id]?.enabled === true]));
  }

  async setEnabled(id: string, enabled: boolean) {
    const plugin = this.#require(id);
    // A blocked plugin's switch is disabled in settings; an API/menu call must
    // not sneak it on behind the blocker's back.
    if (enabled && this.states()[id]?.blockedBy) return this.states()[id]!;

    this.#settings.setPlugin(plugin, { enabled });
    const states = this.states();
    const meta = this.meta();
    const restart = meta[id]?.restartRequired === true;
    // A beforeReady/windowOptions plugin applies at the next launch. Keeping
    // its current instance (and not starting one) makes the switch truthful.
    for (const other of this.plugins) {
      // Restart-required plugins (including a sibling this toggle would block)
      // keep their launch state until the next launch.
      if (meta[other.id]?.restartRequired) continue;
      const running = this.#instances.has(other.id);
      if (states[other.id]?.enabled && !running) await this.#start(other);
      else if (!states[other.id]?.enabled && running) this.#stop(other.id);
    }
    if (!enabled && !restart) this.#env?.onDisabled(id);
    this.#broadcastStates(states);
    return states[id]!;
  }

  async setConfig(id: string, patch: Record<string, unknown>) {
    const plugin = this.#require(id);
    const before = JSON.stringify(this.#settings.plugin(id)?.config);
    const state = this.#settings.setPlugin(plugin, { config: patch });
    if (JSON.stringify(state.config) === before) return state;

    const instance = this.#instances.get(id);
    if (instance && configChange(plugin, instance, state.config) === "restart") {
      this.#stop(id);
      await this.#start(plugin);
    }
    this.#broadcastStates(this.states());
    return state;
  }

  async invoke(id: string, command: string, args: unknown[]) {
    const plugin = this.#require(id);
    const instance = this.#instances.get(id);
    const handler = plugin.host?.commands?.[command] as ((...a: unknown[]) => unknown) | undefined;
    if (!instance || !handler || !Object.hasOwn(plugin.host!.commands!, command)) {
      throw new Error(`[pear] ${id}: no command "${command}" (or plugin disabled)`);
    }
    return handler.apply(instance.ctx, args);
  }

  /** RPC methods of the plugins running right now. */
  rpcMethods(): RpcEntry[] {
    const entries: RpcEntry[] = [];
    for (const id of this.#instances.keys()) {
      const rpc = this.#byId.get(id)?.host?.rpc as Record<string, RpcMethod> | undefined;
      for (const [name, method] of Object.entries(rpc ?? {})) entries.push({ plugin: id, name, method });
    }
    return entries;
  }

  /** Calls an RPC method with an untrusted JSON body, validating it first. */
  async callRpc(id: string, name: string, body: unknown): Promise<RpcResult> {
    const rpc = this.#byId.get(id)?.host?.rpc as Record<string, RpcMethod> | undefined;
    const method = rpc && Object.hasOwn(rpc, name) ? rpc[name] : undefined;
    if (!method) return { ok: false, status: 404, error: `no RPC method "${name}" on plugin "${id}"` };
    const instance = this.#instances.get(id);
    if (!instance) return { ok: false, status: 503, error: `plugin "${id}" is disabled` };
    const parsed = v.safeParse(method.input, body);
    if (!parsed.success) return { ok: false, status: 400, error: validationMessage(parsed.issues) };
    return { ok: true, value: await method.run.call(instance.ctx, parsed.output) };
  }

  stopAll() {
    for (const id of [...this.#instances.keys()]) this.#stop(id);
  }

  #require(id: string) {
    const plugin = this.#byId.get(id);
    if (!plugin) throw new Error(`[pear] unknown plugin: ${id}`);
    return plugin;
  }

  #broadcast(id: string, state: PluginState) {
    this.#env?.send({ type: "plugin-state", id, state });
  }

  /** States change in pairs, not one at a time: a block also stops another plugin. */
  #broadcastStates(states: Record<string, PluginState>) {
    for (const [id, state] of Object.entries(states)) this.#broadcast(id, state);
  }

  async #start(plugin: AnyPlugin) {
    const env = this.#env;
    if (!env || !plugin.host || this.#instances.has(plugin.id) || !this.states()[plugin.id]?.enabled) return;
    const instance = this.#createInstance(plugin, env);
    this.#instances.set(plugin.id, instance);
    this.#clearError(plugin.id);
    try {
      const cleanup = await plugin.host.start?.(instance.ctx);
      // Stopped while starting: the stack runs it at once.
      if (typeof cleanup === "function") instance.cleanups.add(cleanup);
    } catch (error) {
      this.#reportError(plugin.id, "failed to start", error);
    }
  }

  #stop(id: string) {
    const instance = this.#instances.get(id);
    if (!instance) return;
    this.#instances.delete(id);
    instance.stopped = true;
    this.#clearError(id);
    this.#setStatus(id, "");
    this.#env?.router.release(id);
    instance.cleanups.run();
  }

  #createInstance(plugin: AnyPlugin, env: HostEnvironment) {
    return new Instance((instance) => this.#context(plugin.id, env, instance));
  }

  #context(id: string, env: HostEnvironment, instance: Instance): HostContext<AnyConfig> {
    const settings = this.#settings;
    const { cleanups } = instance;
    const active = () => !instance.stopped;
    return {
      id,
      get config() {
        return settings.plugin(id)?.config ?? {};
      },
      setConfig: (patch) => void this.setConfig(id, patch),
      app: env.app,
      window: env.window,
      core: (section) => settings.core(section),
      session: env.router.scopedSession(id, active),
      webRequest: env.router.scoped(id, active),
      request: (event, payload, options) => env.requests.request(id, event, payload, options),
      callPlugin: async <T>(target: string, name: string, body?: unknown) =>
        (await this.callRpc(target, name, body)) as PluginCallResult<T>,
      player: scopedPlayer(env, cleanups),
      openSettings: () => env.openSettings(),
      focusWindow: () => env.focusWindow(),
      addMenuItem: (item) => {
        if (!instance.stopped) cleanups.add(env.menuItems.add(item));
      },
      pluginMenuItems: () => env.menuItems.items,
      onMenuItemsChange: (listener) => cleanups.add(env.menuItems.onChange(listener)),
      listen: (target, event, listener) => {
        target.on(event, listener);
        cleanups.add(() => target.removeListener(event, listener));
      },
      onConfigChange: (listener) => void instance.configListeners.push(listener as ConfigListener),
      ...timers(cleanups),
      setStatus: (message) => {
        if (!instance.stopped) this.#setStatus(id, message);
      },
      emit: (event, payload) => env.send({ type: "plugin-event", id, event, payload }),
      api: {
        broadcast: (event, data) => {
          if (!instance.stopped) env.broadcast(id, event, data);
        },
      },
      onProtocol: (listener) => cleanups.add(env.onProtocol(listener)),
      onCleanup: (fn) => cleanups.add(fn),
      t: this.t,
      log: createLogger(id),
      onCoreChange: (section, listener) => {
        cleanups.add(
          settings.onCoreChange((changed) => {
            if (changed === section && !instance.stopped) listener(settings.core(section));
          }),
        );
      },
    };
  }
}

/** setTimeout / setInterval, cleared when the plugin stops. */
function timers(cleanups: CleanupStack) {
  const { stop, ...timers } = timerSet();
  cleanups.add(stop);
  return timers;
}

/** The player, with the plugin's listeners removed when it stops. */
function scopedPlayer({ player, requests }: HostEnvironment, cleanups: CleanupStack): HostPlayer {
  return {
    get state() {
      return player.state;
    },
    // One implementation for both of `on`'s overloads, which a function expression can't declare.
    on: ((event: "change", listener: never) => cleanups.track(player.on(event, listener))) as HostPlayer["on"],
    control: (action) => player.control(action),
    details: (options) => requests.songDetails(options),
  };
}

/** Lets the running host part take a config change; "restart" when it can't. */
function configChange(plugin: AnyPlugin, instance: Instance, config: AnyConfig) {
  const host = plugin.host;
  if (!host) return;
  if (instance.configListeners.length > 0) {
    const results = instance.configListeners.map((listener) => listener(config));
    if (results.includes("restart")) return "restart";
    return;
  }
  if (host.onConfigChange) return host.onConfigChange(config, instance.ctx);
  if (host.start) return "restart";
}
