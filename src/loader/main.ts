import { deepmerge } from 'deepmerge-ts';
import { type BrowserWindow, ipcMain } from 'electron';
import { allPlugins, mainPlugins } from 'virtual:plugins';

import * as config from '@/config';
import { t } from '@/i18n';
import { LoggerPrefix, startPlugin, stopPlugin } from '@/utils';

import type { BackendContext } from '@/types/contexts';
import type { PluginConfig, PluginDef } from '@/types/plugins';

const loadedPluginMap: Record<
  string,
  PluginDef<unknown, unknown, unknown>
> = {};

// The context object is recreated for every start/stop, but a plugin's `off`
// must still find the wrapper its own `on` registered — so the registry lives
// here, keyed by plugin id.
const listenersById = new Map<
  string,
  Map<string, Map<CallableFunction, (...a: unknown[]) => void>>
>();

export const createContext = (
  id: string,
  win: BrowserWindow,
): BackendContext<PluginConfig> => {
  // One ipcMain subscription per (channel, listener): `off` can then remove the
  // wrapper that was actually registered, leaving the channel's other listeners
  // (the provider's, other plugins') alone.
  const listeners = listenersById.get(id) ?? new Map();
  listenersById.set(id, listeners);

  return {
    getConfig: async () =>
      deepmerge(
        (await allPlugins())[id].config ?? { enabled: false },
        config.get(`plugins.${id}`) ?? {},
      ) as PluginConfig,
    setConfig: async (newConfig) => {
      config.setPartial(
        `plugins.${id}`,
        newConfig,
        (await allPlugins())[id].config,
      );
    },

    ipc: {
      send: (event: string, ...args: unknown[]) => {
        win.webContents.send(event, ...args);
      },
      handle: (event: string, listener: CallableFunction) => {
        // oxlint-disable-next-line typescript/no-unsafe-return,typescript/no-unsafe-call
        ipcMain.handle(event, (_, ...args: unknown[]) => listener(...args));
      },
      on: (event: string, listener: CallableFunction) => {
        const wrapper = (_: unknown, ...args: unknown[]) => {
          // oxlint-disable-next-line typescript/no-unsafe-call
          listener(...args);
        };
        ipcMain.on(event, wrapper);
        const forEvent = listeners.get(event) ?? new Map();
        forEvent.set(listener, wrapper);
        listeners.set(event, forEvent);
      },
      off: (event: string, listener: CallableFunction) => {
        const forEvent = listeners.get(event);
        const wrapper = forEvent?.get(listener);
        if (!forEvent || !wrapper) return;
        forEvent.delete(listener);
        if (forEvent.size === 0) listeners.delete(event);
        ipcMain.removeListener(event, wrapper);
      },
      removeHandler: (event: string) => {
        ipcMain.removeHandler(event);
      },
      removeAllListeners: (event: string) => {
        for (const wrapper of listeners.get(event)?.values() ?? []) {
          ipcMain.removeListener(event, wrapper);
        }
        listeners.delete(event);
        ipcMain.removeAllListeners(event);
      },
    },

    window: win,
  };
};

export const forceUnloadMainPlugin = async (
  id: string,
  win: BrowserWindow,
): Promise<void> => {
  const plugin = loadedPluginMap[id];
  if (!plugin) return;

  try {
    const hasStopped = await stopPlugin(id, plugin, {
      ctx: 'backend',
      context: createContext(id, win),
    });
    if (
      hasStopped ||
      (hasStopped === null &&
        typeof plugin.backend !== 'function' &&
        plugin.backend)
    ) {
      delete loadedPluginMap[id];
      console.log(
        LoggerPrefix,
        t('common.console.plugins.unloaded', { pluginName: id }),
      );
      return;
    } else {
      const message = t('common.console.plugins.unload-failed', {
        pluginName: id,
      });
      console.log(LoggerPrefix, message);
      return Promise.reject(new Error(message));
    }
  } catch (err) {
    console.error(
      LoggerPrefix,
      t('common.console.plugins.unload-failed', { pluginName: id }),
    );
    console.trace(err);
    return Promise.reject(err as Error);
  }
};

export const forceLoadMainPlugin = async (
  id: string,
  win: BrowserWindow,
): Promise<void> => {
  const plugin = (await mainPlugins())[id];
  if (!plugin) return;

  try {
    const hasStarted = await startPlugin(id, plugin, {
      ctx: 'backend',
      context: createContext(id, win),
    });
    if (
      hasStarted ||
      (hasStarted === null &&
        typeof plugin.backend !== 'function' &&
        plugin.backend)
    ) {
      loadedPluginMap[id] = plugin;
    } else {
      const message = t('common.console.plugins.load-failed', {
        pluginName: id,
      });
      console.log(LoggerPrefix, message);
      return Promise.reject(new Error(message));
    }
  } catch (err) {
    console.error(
      LoggerPrefix,
      t('common.console.plugins.initialize-failed', { pluginName: id }),
    );
    console.trace(err);
    return Promise.reject(err as Error);
  }
};

export const loadAllMainPlugins = async (win: BrowserWindow) => {
  console.log(LoggerPrefix, t('common.console.plugins.load-all'));
  const pluginConfigs = config.plugins.getPlugins();
  const queue: Promise<void>[] = [];

  for (const [plugin, pluginDef] of Object.entries(await mainPlugins())) {
    const config = deepmerge(
      pluginDef.config ?? { enabled: false },
      pluginConfigs[plugin] ?? {},
    );
    if (pluginDef.essential || config.enabled) {
      queue.push(forceLoadMainPlugin(plugin, win));
    } else if (loadedPluginMap[plugin]) {
      queue.push(forceUnloadMainPlugin(plugin, win));
    }
  }

  await Promise.allSettled(queue);
};

export const getAllLoadedMainPlugins = () => {
  return loadedPluginMap;
};
