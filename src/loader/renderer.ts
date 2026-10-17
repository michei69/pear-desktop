import { deepmerge } from 'deepmerge-ts';
import { rendererPlugins } from 'virtual:plugins';

import { t } from '@/i18n';
import { LoggerPrefix, startPlugin, stopPlugin } from '@/utils';

import type { RendererContext } from '@/types/contexts';
import type { PluginConfig, PluginDef } from '@/types/plugins';

const adoptedStyleSheetMap: Record<string, CSSStyleSheet[]> = {};
const loadedPluginMap: Record<
  string,
  PluginDef<unknown, unknown, unknown>
> = {};

/** The renderer-side IPC bridge, shared with the standalone settings window. */
export const createRendererIpc = (): RendererContext<PluginConfig>['ipc'] => {
  // One preload-side subscription per (channel, listener): `off` can then call
  // the matching unsubscribe closure instead of re-forwarding the listener
  // (contextBridge gives each crossing a fresh proxy, so identity never matches).
  const listeners = new Map<string, Map<CallableFunction, () => void>>();

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
): RendererContext<Config> => ({
  getConfig: () =>
    window.ipcRenderer.invoke('peard:get-config', id) as Promise<Config>,
  setConfig: async (newConfig) => {
    await window.ipcRenderer.invoke('peard:set-config', id, newConfig);
  },
  ipc: createRendererIpc(),
});

export const forceUnloadRendererPlugin = async (id: string) => {
  if (adoptedStyleSheetMap[id]) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => !adoptedStyleSheetMap[id].includes(sheet),
    );
    delete adoptedStyleSheetMap[id];
  }

  const plugin = (await rendererPlugins())[id];
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

export const forceLoadRendererPlugin = async (id: string) => {
  const plugin = (await rendererPlugins())[id];
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

    if (plugin?.stylesheets) {
      const styleSheetList = plugin.stylesheets.map((style) => {
        const styleSheet = new CSSStyleSheet();
        styleSheet.replaceSync(style);

        return styleSheet;
      });

      adoptedStyleSheetMap[id] = styleSheetList;

      document.adoptedStyleSheets = [
        ...document.adoptedStyleSheets,
        ...styleSheetList,
      ];
    }

    console.log(
      LoggerPrefix,
      t('common.console.plugins.loaded', { pluginName: id }),
    );
  } else {
    console.log(
      LoggerPrefix,
      t('common.console.plugins.initialize-failed', { pluginName: id }),
    );
  }
};

export const loadAllRendererPlugins = async () => {
  const pluginConfigs = window.mainConfig.plugins.getPlugins();

  for (const [pluginId, pluginDef] of Object.entries(await rendererPlugins())) {
    const config = deepmerge(
      pluginDef.config ?? { enabled: false },
      pluginConfigs[pluginId] ?? {},
    );

    if (pluginDef.essential || config.enabled) {
      await forceLoadRendererPlugin(pluginId);
    } else {
      if (loadedPluginMap[pluginId]) {
        await forceUnloadRendererPlugin(pluginId);
      }
    }
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
