import { type BrowserWindow, ipcMain } from 'electron';
import { allPlugins, mainPlugins } from 'virtual:plugins';

import * as config from '@/config';
import { mergePluginConfig } from '@/config/plugins';
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
  const allPluginDefs = allPlugins();
  // One ipcMain subscription per (channel, listener): `off` can then remove the
  // wrapper that was actually registered, leaving the channel's other listeners
  // (the provider's, other plugins') alone.
  const listeners = listenersById.get(id) ?? new Map();
  listenersById.set(id, listeners);

  return {
    getConfig: async () =>
      mergePluginConfig(
        (await allPluginDefs)[id].config,
        config.get(`plugins.${id}`),
      ),
    setConfig: async (newConfig) => {
      config.setPartial(
        `plugins.${id}`,
        newConfig,
        (await allPluginDefs)[id].config,
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
  }

  const message = t('common.console.plugins.unload-failed', { pluginName: id });
  console.log(LoggerPrefix, message);
  return Promise.reject(new Error(message));
};

export const forceLoadMainPlugin = async (
  id: string,
  win: BrowserWindow,
): Promise<void> => {
  // Re-entrant enable after a failed unload: re-running start() duplicates IPC subs.
  if (loadedPluginMap[id]) return;

  const plugin = (await mainPlugins())[id];
  if (!plugin) return;

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
    return;
  }

  const message = t('common.console.plugins.load-failed', { pluginName: id });
  console.log(LoggerPrefix, message);
  return Promise.reject(new Error(message));
};

export const loadAllMainPlugins = async (win: BrowserWindow) => {
  console.log(LoggerPrefix, t('common.console.plugins.load-all'));
  const pluginConfigs = config.plugins.getPlugins();
  const queue: Promise<void>[] = [];

  for (const [plugin, pluginDef] of Object.entries(await mainPlugins())) {
    const config = mergePluginConfig(pluginDef.config, pluginConfigs[plugin]);
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
