import { deepmerge } from 'deepmerge-ts';
import {
  rendererPlugin,
  rendererPluginMeta,
  supportsPlatform,
} from 'virtual:plugins';

import { t } from '@/i18n';
import { isSkippedInPerformanceMode } from '@/providers/performance-mode';
import { LoggerPrefix, startPlugin, stopPlugin } from '@/utils';

import type { RendererContext } from '@/types/contexts';
import type { PluginConfig, PluginDef } from '@/types/plugins';

declare module 'virtual:plugins' {
  export interface RendererPluginMeta {
    /** `null` when the build could not read the plugin definition. */
    hasRenderer: boolean | null;
    essential: boolean | null;
    /** The plugin's default `config.enabled`, before stored config is merged. */
    enabled: boolean | null;
    platform: number | null;
  }

  export const rendererPluginMeta: Record<string, RendererPluginMeta>;
  export const rendererPlugin: (
    id: string,
  ) => Promise<PluginDef<unknown, unknown, unknown, PluginConfig> | undefined>;
  export const supportsPlatform: (plugin: {
    platform?: number | null;
  }) => boolean;
}

const adoptedStyleSheetMap: Record<string, CSSStyleSheet[]> = {};
const loadedPluginMap: Record<
  string,
  PluginDef<unknown, unknown, unknown>
> = {};

// The context object is recreated for every start/stop, but a plugin's `off`
// must still find the unsubscribe its own `on` registered — so the registry
// lives here, keyed by plugin id.
const listenersById = new Map<
  string,
  Map<string, Map<CallableFunction, () => void>>
>();

/** The renderer-side IPC bridge, shared with the standalone settings window. */
export const createRendererIpc = (
  listeners: Map<string, Map<CallableFunction, () => void>> = new Map(),
): RendererContext<PluginConfig>['ipc'] => {
  // One preload-side subscription per (channel, listener): `off` can then call
  // the matching unsubscribe closure instead of re-forwarding the listener
  // (contextBridge gives each crossing a fresh proxy, so identity never matches).
  return {
    send: (event: string, ...args: unknown[]) => {
      window.ipcRenderer.send(event, ...args);
    },
    invoke: (event: string, ...args: unknown[]) =>
      window.ipcRenderer.invoke(event, ...args),
    on: (event: string, listener: CallableFunction) => {
      const unsubscribe = window.ipcRenderer.subscribe(event, (...args) => {
        // oxlint-disable-next-line typescript/no-unsafe-call
        listener(...args);
      });
      const forEvent = listeners.get(event) ?? new Map();
      forEvent.set(listener, unsubscribe);
      listeners.set(event, forEvent);
    },
    off: (event: string, listener: CallableFunction) => {
      const forEvent = listeners.get(event);
      const unsubscribe = forEvent?.get(listener);
      if (!forEvent || !unsubscribe) return;
      forEvent.delete(listener);
      if (forEvent.size === 0) listeners.delete(event);
      unsubscribe();
    },
    removeAllListeners: (event: string) => {
      for (const unsubscribe of listeners.get(event)?.values() ?? []) {
        unsubscribe();
      }
      listeners.delete(event);
      window.ipcRenderer.removeAllListeners(event);
    },
  };
};

export const createContext = <Config extends PluginConfig>(
  id: string,
): RendererContext<Config> => {
  const listeners = listenersById.get(id) ?? new Map();
  listenersById.set(id, listeners);

  return {
    getConfig: () =>
      window.ipcRenderer.invoke('peard:get-config', id) as Promise<Config>,
    setConfig: async (newConfig) => {
      await window.ipcRenderer.invoke('peard:set-config', id, newConfig);
    },
    ipc: createRendererIpc(listeners),
  };
};

export const forceUnloadRendererPlugin = async (id: string) => {
  if (adoptedStyleSheetMap[id]) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => !adoptedStyleSheetMap[id].includes(sheet),
    );
    delete adoptedStyleSheetMap[id];
  }

  const plugin = await rendererPlugin(id);
  if (!plugin) return;

  const hasStopped = await stopPlugin(id, plugin, {
    ctx: 'renderer',
    context: createContext(id),
  });
  if (plugin?.stylesheets) {
    document.querySelector(`style#plugin-${id}`)?.remove();
  }
  if (hasStopped || (hasStopped === null && plugin?.renderer)) {
    delete loadedPluginMap[id];
    console.log(
      LoggerPrefix,
      t('common.console.plugins.unloaded', { pluginName: id }),
    );
  } else {
    console.error(
      LoggerPrefix,
      t('common.console.plugins.unload-failed', { pluginName: id }),
    );
  }
};

/**
 * Starts one renderer plugin. `adoptStyleSheets: false` hands the sheets back
 * to the caller instead of assigning `document.adoptedStyleSheets`, so a batch
 * load can adopt everything once (each assignment invalidates style).
 */
export const forceLoadRendererPlugin = async (
  id: string,
  adoptStyleSheets = true,
): Promise<CSSStyleSheet[] | undefined> => {
  // A `plugin:enable` can arrive for a plugin that is already running (the
  // stored config may not carry its `enabled` key): re-running the lifecycle
  // would duplicate its observers and listeners.
  if (loadedPluginMap[id]) return;
  if (
    isSkippedInPerformanceMode(
      id,
      Boolean(window.mainConfig.get('options.performanceMode')),
    )
  ) {
    console.log(LoggerPrefix, `Plugin "${id}" skipped: performance mode`);
    return;
  }

  const plugin = await rendererPlugin(id);
  if (!plugin) return;

  const hasEvaled = await startPlugin(id, plugin, {
    ctx: 'renderer',
    context: createContext(id),
  });

  if (
    hasEvaled ||
    plugin?.stylesheets ||
    (hasEvaled === null &&
      typeof plugin?.renderer !== 'function' &&
      plugin?.renderer)
  ) {
    loadedPluginMap[id] = plugin;

    let styleSheetList: CSSStyleSheet[] | undefined;
    if (plugin?.stylesheets) {
      styleSheetList = plugin.stylesheets.map((style) => {
        const styleSheet = new CSSStyleSheet();
        styleSheet.replaceSync(style);

        return styleSheet;
      });

      adoptedStyleSheetMap[id] = styleSheetList;

      if (adoptStyleSheets) {
        document.adoptedStyleSheets = [
          ...document.adoptedStyleSheets,
          ...styleSheetList,
        ];
      }
    }

    console.log(
      LoggerPrefix,
      t('common.console.plugins.loaded', { pluginName: id }),
    );

    return adoptStyleSheets ? undefined : styleSheetList;
  } else {
    console.log(
      LoggerPrefix,
      t('common.console.plugins.initialize-failed', { pluginName: id }),
    );
  }

  return undefined;
};

export const loadAllRendererPlugins = async () => {
  const pluginConfigs = window.mainConfig.plugins.getPlugins();
  const tasks: Array<Promise<CSSStyleSheet[] | undefined>> = [];

  for (const [pluginId, meta] of Object.entries(rendererPluginMeta)) {
    if (meta.hasRenderer === false || !supportsPlatform(meta)) continue;

    // The metadata is read from the plugin source at build time. A field that
    // could not be read falls back to importing the definition (and thus keeps
    // the old behaviour for that plugin).
    const needsDefinition =
      meta.hasRenderer === null ||
      meta.essential === null ||
      meta.enabled === null;
    const pluginDef = needsDefinition
      ? await rendererPlugin(pluginId)
      : undefined;
    if (needsDefinition && !pluginDef) continue;

    const config = deepmerge(
      pluginDef?.config ?? { enabled: meta.enabled ?? false },
      pluginConfigs[pluginId] ?? {},
    );
    const essential = pluginDef?.essential ?? meta.essential === true;

    if (essential || config.enabled) {
      tasks.push(forceLoadRendererPlugin(pluginId, false));
    } else if (loadedPluginMap[pluginId]) {
      tasks.push(forceUnloadRendererPlugin(pluginId).then(() => undefined));
    }
  }

  const results = await Promise.allSettled(tasks);

  // One assignment for the whole batch: only enabled plugins' sheets are in
  // here, and the single-plugin enable path still adopts immediately.
  const styleSheets = results.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? result.value : [],
  );
  if (styleSheets.length > 0) {
    document.adoptedStyleSheets = [
      ...document.adoptedStyleSheets,
      ...styleSheets,
    ];
  }
};

export const getLoadedRendererPlugin = (
  id: string,
): PluginDef<unknown, unknown, unknown> | undefined => {
  return loadedPluginMap[id];
};

export const getAllLoadedRendererPlugins = () => {
  return loadedPluginMap;
};
