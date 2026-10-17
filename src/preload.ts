import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
  webFrame,
} from 'electron';
import is from 'electron-is';

import { getLoadedResources, loadI18n } from '@/i18n';

import * as config from './config';
import {
  forceLoadPreloadPlugin,
  forceUnloadPreloadPlugin,
  loadAllPreloadPlugins,
} from './loader/preload';

// Only the page-world keys the preload/renderer code actually reads. Anything
// else (api-server secrets, plugin configs) stays main-process only.
const rendererConfigKeys = new Set([
  'options.startingPage',
  'options.removeUpgradeButton',
  'options.likeButtons',
  'options.swapLikeButtonsOrder',
  'options.hideMenu',
  'options.hideDislikeButton',
  'options.hideVideoCaptions',
  'options.language',
  'options.stripMusicFromSharedLinks',
  'options.stripSIFromSharedLinks',
  'options.usePodcastParticipantAsArtist',
  'options.performanceMode',
  'plugins.transparent-player.opacity',
]);

const isValidVideoToggleOptions = (
  options: unknown,
): options is Record<string, unknown> => {
  if (
    options === null ||
    typeof options !== 'object' ||
    Object.getPrototypeOf(options) !== Object.prototype
  )
    return false;

  return Reflect.ownKeys(options).every((key) => {
    if (typeof key !== 'string') return false;

    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !('value' in descriptor)) return false;

    switch (key) {
      case 'enabled':
      case 'hideVideo':
      case 'forceHide':
        return typeof descriptor.value === 'boolean';
      case 'mode':
        return (
          typeof descriptor.value === 'string' &&
          ['custom', 'native', 'disabled'].includes(descriptor.value)
        );
      case 'align':
        return (
          typeof descriptor.value === 'string' &&
          ['left', 'middle', 'right'].includes(descriptor.value)
        );
      default:
        return false;
    }
  });
};

const rendererConfig = {
  get: (key: string) =>
    rendererConfigKeys.has(key) ? config.get(key as never) : undefined,
  plugins: {
    getPlugins: () =>
      Object.fromEntries(
        Object.entries(config.plugins.getPlugins()).map(([id, plugin]) => [
          id,
          { enabled: plugin.enabled },
        ]),
      ),
    isEnabled: (plugin: string) => config.plugins.isEnabled(plugin),
    setOptions: (plugin: string, options: object) => {
      if (plugin === 'video-toggle' && isValidVideoToggleOptions(options)) {
        config.plugins.setOptions(plugin, options);
      }
    },
  },
  // The context-menu customizer reads this through the page world.
  getContextMenuHidden: () => config.getContextMenuHidden(),
  // Only the scrobbler settings that shape song metadata; never its secrets.
  getScrobbleOptions: () => {
    const scrobbler = config.get('plugins.scrobbler') as
      | {
          alternativeTitles?: boolean;
          alternativeArtist?: boolean;
          customRegexFilters?: string[];
        }
      | undefined;
    return {
      alternativeTitles: scrobbler?.alternativeTitles,
      alternativeArtist: scrobbler?.alternativeArtist,
      customRegexFilters: scrobbler?.customRegexFilters,
    };
  },
};

// @ts-expect-error dummy
globalThis.customElements = { define() {} };

new MutationObserver((mutations, observer) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      const elem = node as HTMLElement;
      if (elem.tagName !== 'SCRIPT') continue;

      const script = elem as HTMLScriptElement;
      if (
        !script.getAttribute('src')?.endsWith('custom-elements-es5-adapter.js')
      )
        continue;

      script.remove();

      observer.disconnect();
      return;
    }
  }
}).observe(document, { subtree: true, childList: true });

const i18nReady = loadI18n(config.get('options.language') ?? 'en');

i18nReady.then(loadAllPreloadPlugins).catch((err) => {
  console.error('Failed to load preload plugins:', err);
});

ipcRenderer.on('plugin:unload', async (_, id: string) => {
  await forceUnloadPreloadPlugin(id);
});
ipcRenderer.on('plugin:enable', async (_, id: string) => {
  await forceLoadPreloadPlugin(id);
});

contextBridge.exposeInMainWorld('mainConfig', rendererConfig);
contextBridge.exposeInMainWorld('electronIs', is);
contextBridge.exposeInMainWorld('ipcRenderer', {
  subscribe: (channel: string, listener: (...args: unknown[]) => void) => {
    // contextBridge creates a new proxy each time a page function crosses, so
    // page-side `off(listener)` cannot match. Keep the wrapper here and hand
    // the page an unsubscribe closure that references that same wrapper.
    const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) =>
      listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  on: (
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ) => ipcRenderer.on(channel, listener),
  off: (channel: string, listener: (...args: unknown[]) => void) =>
    ipcRenderer.off(channel, listener),
  once: (
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ) => ipcRenderer.once(channel, listener),
  send: (channel: string, ...args: unknown[]) =>
    ipcRenderer.send(channel, ...args),
  removeListener: (channel: string, listener: (...args: unknown[]) => void) =>
    ipcRenderer.removeListener(channel, listener),
  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
  invoke: async (channel: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),
  sendSync: (channel: string, ...args: unknown[]): unknown =>
    ipcRenderer.sendSync(channel, ...args),
  sendToHost: (channel: string, ...args: unknown[]) =>
    ipcRenderer.sendToHost(channel, ...args),
});
contextBridge.exposeInMainWorld('reload', () =>
  ipcRenderer.send('peard:reload'),
);
contextBridge.exposeInMainWorld(
  'ELECTRON_RENDERER_URL',
  process.env.ELECTRON_RENDERER_URL,
);
// Renderer-side perf bisect switch; the page has no `process` to read it from.
contextBridge.exposeInMainWorld(
  'pearPerfDisabledParts',
  process.env.PEAR_PERF_DISABLE ?? '',
);

// The renderer has no Electron APIs of its own; these are the webFrame calls the
// memory report reads and main asks for when the window has been hidden a while.
contextBridge.exposeInMainWorld('peardPerf', {
  getResourceUsage: () => webFrame.getResourceUsage(),
});
ipcRenderer.on('peard:clear-cache', () => webFrame.clearCache());

const bootRenderer = () => {
  const [path, script] = ipcRenderer.sendSync('get-renderer-script') as [
    string | null,
    string,
  ];
  if (!path && !script) return;

  // The renderer bundle carries no translations: hand it the ones loaded here.
  const code = `globalThis.__PEAR_I18N_RESOURCES__ = ${JSON.stringify(
    getLoadedResources(),
  )};\n${script}`;

  let blocked = true;
  const unblock = () => {
    blocked = false;
  };

  if (path) {
    webFrame.executeJavaScriptInIsolatedWorld(
      0,
      [{ code, url: path }],
      true,
      unblock,
    );
  } else {
    webFrame.executeJavaScript(code, true, unblock);
  }

  // HACK: wait for the script to run (with a timeout). The IIFE avoids top-level
  // await in CJS output.
  (async () => {
    const startTime = Date.now();
    const TIMEOUT = 10_000;
    while (blocked && Date.now() - startTime < TIMEOUT) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  })();
};

i18nReady
  .catch((err) => console.error('Failed to load i18n:', err))
  .then(bootRenderer);
