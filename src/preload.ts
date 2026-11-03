import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
  webFrame,
} from 'electron';
import is from 'electron-is';

import { getLoadedResources, loadI18n, t } from '@/i18n';
import { isPerformancePartEnabled } from '@/providers/performance-mode';
import { installAnimationThrottle } from '@/providers/performance-mode-animations';

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

// HACK: stop YTM's ES5 custom-elements adapter from replacing the real registry.
// @ts-expect-error dummy
globalThis.customElements = { define() {} };

// YTM injects `custom-elements-es5-adapter.js`, whose ES5 shims break every
// real ES-class custom element (mdui, Lit) the moment they run. The tag must
// go before its module evaluates: it is appended dynamically, so a sweep in
// each mutation batch (one native query — the loader can append anywhere)
// always wins. Bounded to boot, where the injection happens.
const ADAPTER_SRC = 'custom-elements-es5-adapter.js';
const removeAdapterScript = () => {
  const script = document.querySelector<HTMLScriptElement>(
    `script[src$="${ADAPTER_SRC}"]`,
  );
  if (!script) return false;
  script.remove();
  return true;
};

const adapterObserver = new MutationObserver((_mutations, observer) => {
  // One native query per batch covers wherever the loader appended the tag;
  // the sweep stops once it is gone.
  if (removeAdapterScript()) observer.disconnect();
});
adapterObserver.observe(document, { childList: true, subtree: true });
setTimeout(() => {
  adapterObserver.disconnect();
  removeAdapterScript();
}, 30_000);

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
// Renderer-side perf bisect switch; the page has no `process` to read it from.
contextBridge.exposeInMainWorld(
  'pearPerfDisabledParts',
  process.env.PEAR_PERF_DISABLE ?? '',
);

// Collapse YTM's non-composited Web Animations before the page creates them.
// The settings window is mdui/solid and does not need the patch.
if (
  config.get('options.performanceMode') &&
  isPerformancePartEnabled('animations') &&
  !new URLSearchParams(window.location.search).has('settings')
) {
  webFrame
    .executeJavaScript(`(${installAnimationThrottle.toString()})(); 0`)
    .catch((error) =>
      console.error('Failed to install the animation throttle:', error),
    );
}

// The renderer has no Electron APIs of its own; these are the webFrame calls the
// memory report reads and main asks for when the window has been hidden a while.
contextBridge.exposeInMainWorld('peardPerf', {
  getResourceUsage: () => webFrame.getResourceUsage(),
});
ipcRenderer.on('peard:clear-cache', () => webFrame.clearCache());

const showInjectionError = (error: unknown) => {
  console.error('Failed to inject the renderer:', error);
  if (!new URLSearchParams(window.location.search).has('settings')) return;

  const render = () => {
    if (!document.body) return;

    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:32px;background:#1d1b20;color:#e6e1e5;font-family:Roboto,system-ui,sans-serif;';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:560px;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:20px;font-weight:600;margin-bottom:12px;';
    title.textContent = t('settings-ui.boot-failed.title');
    const message = document.createElement('div');
    message.style.cssText =
      'margin-bottom:20px;color:#cac4d0;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;';
    message.textContent = t('settings-ui.boot-failed.message', {
      error: error instanceof Error ? error.message : String(error),
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText =
      'padding:9px 18px;border:1px solid #938f99;border-radius:20px;background:transparent;color:#d0bcff;cursor:pointer;font-family:inherit;font-size:13px;font-weight:500;';
    button.textContent = t('settings-ui.boot-failed.reload');
    button.addEventListener('click', () => location.reload());
    card.append(title, message, button);
    host.appendChild(card);
    document.body.replaceChildren(host);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  } else {
    render();
  }
};

const bootRenderer = () => {
  let result: [string | null, string] | undefined;
  try {
    result = ipcRenderer.sendSync('get-renderer-script') as [
      string | null,
      string,
    ];
  } catch (error) {
    showInjectionError(error);
    return;
  }

  const [path, script] = result ?? [null, ''];
  if (!path && !script) {
    showInjectionError(new Error('The renderer script is missing'));
    return;
  }

  // The renderer bundle carries no translations: hand it the ones loaded here.
  const code = `globalThis.__PEAR_I18N_RESOURCES__ = ${JSON.stringify(
    getLoadedResources(),
  )};\n${script}`;

  try {
    if (path) {
      webFrame.executeJavaScriptInIsolatedWorld(0, [{ code, url: path }], true);
    } else {
      webFrame.executeJavaScript(code, true);
    }
  } catch (error) {
    showInjectionError(error);
  }
};

i18nReady
  .catch((err) => console.error('Failed to load i18n:', err))
  .then(bootRenderer);
