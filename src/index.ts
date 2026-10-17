import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import url from 'node:url';

import ErrorHtmlAsset from '@assets/error.html?asset';
import {
  enhanceWebRequest,
  type BetterSession,
} from '@jellybrick/electron-better-web-request';
import { deepmerge } from 'deepmerge-ts';
import {
  BrowserWindow,
  app,
  screen,
  globalShortcut,
  session,
  shell,
  dialog,
  ipcMain,
  protocol,
  type BrowserWindowConstructorOptions,
} from 'electron';
import electronDebug from 'electron-debug';
import is from 'electron-is';
import unhandled from 'electron-unhandled';
import { deepEqual } from 'fast-equals';
import { parse } from 'node-html-parser';
import { languageCodes } from 'virtual:i18n';
import { allPlugins, mainPlugins } from 'virtual:plugins';

import { buildLabel, copyright } from '@/app-info';
import * as config from '@/config';
import { APPLICATION_NAME, loadI18n, t } from '@/i18n';
import {
  forceLoadMainPlugin,
  forceUnloadMainPlugin,
  getAllLoadedMainPlugins,
  loadAllMainPlugins,
} from '@/loader/main';
import { refreshMenu, setApplicationMenu } from '@/menu';
import musicPlayerCss from '@/music-player.css?inline';
import { defaultAuthProxyConfig } from '@/plugins/auth-proxy-adapter/config';
import { injectCSS } from '@/plugins/utils/main/css';
import { restart, setupAppControls } from '@/providers/app-controls';
import { appIconPath, windowIconPath } from '@/providers/app-icon';
import { setupAutoUpdates } from '@/providers/app-updates';
import { clearStaleCodeCaches } from '@/providers/cache-maintenance';
import { classifyLink } from '@/providers/external-links';
import { loadFlagMetadata } from '@/providers/flag-metadata';
import { setupMemoryReport } from '@/providers/memory-report';
import {
  performanceModeCss,
  isPerformancePartEnabled,
} from '@/providers/performance-mode';
import {
  APP_PROTOCOL,
  handleProtocol,
  setupProtocolHandler,
} from '@/providers/protocol-handler';
import { syncShortcutIcons } from '@/providers/shortcut-icons';
import {
  registerCallback,
  setupSongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import {
  createThemeFromCssFiles,
  getThemesDir,
  openThemesFolder,
  setupThemes,
  themePaletteLayers,
  themesForRenderer,
} from '@/themes/main';
import { setUpTray } from '@/tray';
import {
  restartRequirementKey,
  type RestartRequirement,
} from '@/types/restart';
import { LoggerPrefix } from '@/utils';
import { isTesting } from '@/utils/testing';
import { showOnCurrentDesktop } from '@/window-utils';

import packageJson from '../package.json';

import type { RepeatMode } from '@/types/datahost-get-state';
import type { PluginConfig } from '@/types/plugins';

// Log unhandled errors
unhandled({
  logger: console.error,
  showDialog: false,
});

// Prevent window being garbage collected
let mainWindow: Electron.BrowserWindow | null;
let renderProcessGoneRegistered = false;
const settingsRestartSessions = new Set<number>();
const pendingSettingsRestartRequirements = new Map<
  string,
  RestartRequirement
>();

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'http',
    privileges: {
      standard: true,
      bypassCSP: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
  {
    scheme: 'https',
    privileges: {
      standard: true,
      bypassCSP: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
  { scheme: 'mailto', privileges: { standard: true } },
]);

// Ozone platform hint: Required for Wayland support
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

// Feature lists are collected here and applied once at the bottom of this
// block: Chromium's command line stores one value per switch, so a second
// `appendSwitch('disable-features', ...)` silently drops everything before it.
const enabledFeatures = [
  // Required for downloader (@ffmpeg/core-mt)
  'SharedArrayBuffer',
  // Required for overlay scrollbars
  'OverlayScrollbar',
  // Required for Wayland
  'UseOzonePlatform',
  'WaylandWindowDecorations',
  // Hand memory back while the renderer is frozen or the OS is under pressure.
  'MemoryPurgeOnFreeze',
  'ReleaseResourceStrongReferencesOnMemoryPressure',
  'DeferSpeculativeRFHCreation',
];

const disabledFeatures = [
  // Required for overlay scrollbars
  'FluentScrollbar',
  // This app never does browser-style navigations, so these only cost memory.
  'BackForwardCache',
  'Prerender2',
];
let disableHardwareAcceleration = config.get(
  'options.disableHardwareAcceleration',
);

// Linux specific fixes
if (is.linux()) {
  // Stops chromium from launching its own MPRIS service
  if (await config.plugins.isEnabled('shortcuts')) {
    disabledFeatures.push('MediaSessionService');
  }

  // https://github.com/electron/electron/issues/15947
  if (await config.plugins.isEnabled('transparent-player')) {
    disableHardwareAcceleration = true;
    app.commandLine.appendSwitch('enable-transparent-visuals');
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  }

  // Overrides WM_CLASS for X11 to correspond to icon filename
  app.setName(
    'com.github.th-ch.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063',
  );
  // for wayland
  app.commandLine.appendSwitch(
    'class',
    'com.github.th-ch.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063',
  );
}

// node-smtc replaces Chromium's media session on Windows.
if (is.windows() && config.get('options.forceSmtc')) {
  disabledFeatures.push('HardwareMediaKeyHandling', 'MediaSessionService');
}

if (disableHardwareAcceleration) {
  if (is.dev()) console.log('Disabling hardware acceleration');
  app.disableHardwareAcceleration();
}

// Opt-in experiment, not part of performance mode: folding the GPU service into
// the browser process moves its memory there and can fall back to software
// rendering (which costs far more RAM than the separate process saves).
if (config.get('options.inProcessGpu') && !disableHardwareAcceleration) {
  app.commandLine.appendSwitch('in-process-gpu');
}

app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','));
app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));

// Windows SMTC support via node-smtc
if (is.windows()) {
  if (config.get('options.forceSmtc')) {
    import('node-smtc').then((mod) => {
      const SMTCPlayer = mod.default;
      console.log('disabled mediasess');

      const smtc = new SMTCPlayer();
      smtc.addListener('play', () => {
        mainWindow?.webContents.send('peard:play');
      });
      smtc.addListener('pause', () => {
        mainWindow?.webContents.send('peard:pause');
      });
      smtc.addListener('next', () => {
        mainWindow?.webContents.send('peard:next-video');
      });
      smtc.addListener('previous', () => {
        mainWindow?.webContents.send('peard:previous-video');
      });
      smtc.addListener('shuffle', () => {
        mainWindow?.webContents.send('peard:shuffle');
        mainWindow?.webContents.send('peard:get-shuffle');
      });
      smtc.addListener('repeat', () => {
        mainWindow?.webContents.send('peard:switch-repeat');
      });
      smtc.addListener('positionchange', (ms: number) => {
        mainWindow?.webContents.send('peard:seek-to', ms / 1000);
      });
      ipcMain.on('peard:get-shuffle-response', (_, val: boolean) => {
        smtc.setShuffle(val);
      });
      ipcMain.on('peard:shuffle-changed', (_, val: boolean) => {
        smtc.setShuffle(val);
      });
      ipcMain.on('peard:repeat-changed', (_, repeatMode: RepeatMode) => {
        return smtc.setAutoRepeat(
          repeatMode == 'NONE'
            ? 'none'
            : repeatMode == 'ONE'
              ? 'track'
              : 'list',
        );
      });
      registerCallback((songInfo, event) => {
        if (event === SongInfoEvent.VideoSrcChanged) {
          smtc.setAlbumArtist(songInfo.artist);
          smtc.setAlbumTitle(songInfo.album ?? '');
          smtc.setArtist(songInfo.artist);
          smtc.setTitle(songInfo.title);
          if (songInfo.image) {
            const p = path.join(tmpdir(), 'thumb.png');
            fs.writeFileSync(p, songInfo.image.toPNG());
            smtc.setThumbnail(p);
          }
          smtc.setStartTime(0);
          smtc.setMinSeekTime(0);
          smtc.setPosition(0);
          smtc.setEndTime(songInfo.songDuration * 1000);
          smtc.setMaxSeekTime(songInfo.songDuration * 1000);
        }

        if (event === SongInfoEvent.PlayOrPaused) {
          smtc.setPosition((songInfo.elapsedSeconds ?? 0) * 1000);
          smtc.setPlaybackStatus(songInfo.isPaused ? 'paused' : 'playing');
        }

        if (event === SongInfoEvent.TimeChanged) {
          smtc.setPosition((songInfo.elapsedSeconds ?? 0) * 1000);
        }
      });
      smtc.setAppMediaId(
        'com.github.th-ch.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063',
      );
      smtc.start();
    });
  }
}

if (config.get('options.proxy')) {
  const authProxyEnabled = await config.plugins.isEnabled('auth-proxy-adapter');

  let proxyToUse = '';
  if (authProxyEnabled) {
    // Use proxy from Auth-Proxy-Adapter plugin
    const authProxyConfig = deepmerge(
      defaultAuthProxyConfig,
      config.get('plugins.auth-proxy-adapter') ?? {},
    ) as typeof defaultAuthProxyConfig;

    const { hostname, port } = authProxyConfig;
    proxyToUse = `socks5://${hostname}:${port}`;
  } else if (config.get('options.proxy')) {
    // Use global proxy settings
    proxyToUse = config.get('options.proxy');
  }
  console.log(LoggerPrefix, `Using proxy: ${proxyToUse}`);
  app.commandLine.appendSwitch('proxy-server', proxyToUse);
}

// Adds debug features: hotkeys for dev tools and reload.
electronDebug({
  showDevTools: false, // Disable automatic devTools on new window
});

const icon = windowIconPath();

// Without this the About panel shows the raw app id and no icon.
app.setAboutPanelOptions({
  applicationName: APPLICATION_NAME,
  // Channel and commit ride along here: `version` is macOS-only and GTK prints
  // only this field.
  applicationVersion: `v${app.getVersion()} ${buildLabel()}`,
  iconPath: appIconPath(),
  copyright,
  website: `https://github.com/${packageJson.repository}`,
});

function onClosed() {
  // Dereference the window
  // For multiple Windows store them in an array
  mainWindow = null;
}

ipcMain.handle('peard:get-main-plugin-names', async () =>
  Object.keys(await mainPlugins()),
);

const initHook = async (win: BrowserWindow) => {
  const allPluginStubs = await allPlugins();

  const addPendingSettingsRestartRequirement = (
    requirement: RestartRequirement,
  ) => {
    pendingSettingsRestartRequirements.set(
      restartRequirementKey(requirement),
      requirement,
    );
  };

  ipcMain.handle('ytmd-sui:restart-session-open', (event) => {
    // First active session starts a fresh batch; later ones join it.
    if (settingsRestartSessions.size === 0) {
      pendingSettingsRestartRequirements.clear();
    }
    settingsRestartSessions.add(event.sender.id);
  });
  ipcMain.handle(
    'ytmd-sui:restart-session-close',
    async (event, requirements: RestartRequirement[]) => {
      settingsRestartSessions.delete(event.sender.id);
      requirements.forEach(addPendingSettingsRestartRequirement);

      // Keep batching while any settings window remains active.
      if (settingsRestartSessions.size > 0) return;

      const pending = [...pendingSettingsRestartRequirements.values()];
      pendingSettingsRestartRequirements.clear();
      if (pending.length) await showNeedToRestartDialog(pending, true);
    },
  );

  ipcMain.handle(
    'peard:get-config',
    (_, id: string) =>
      deepmerge(
        allPluginStubs[id].config ?? { enabled: false },
        config.get(`plugins.${id}`) ?? {},
      ) as PluginConfig,
  );
  ipcMain.handle('peard:set-config', (_, name: string, obj: object) =>
    config.setPartial(`plugins.${name}`, obj, allPluginStubs[name].config),
  );

  ipcMain.handle('peard:get-themes', () => ({
    themes: themesForRenderer(),
    selected: config.get('options.theme'),
    // Per theme: values layered over its own palette - the picked preset, or
    // the palette the user edited.
    overrides: themePaletteLayers(),
  }));
  ipcMain.handle('peard:create-theme-from-css', (_, paths: string[]) =>
    createThemeFromCssFiles(paths),
  );
  ipcMain.handle('peard:open-themes-folder', () => openThemesFolder());
  ipcMain.handle('peard:get-themes-dir', () => getThemesDir());

  config.watch((newValue, oldValue) => {
    const newPluginConfigList = (newValue?.plugins ?? {}) as Record<
      string,
      unknown
    >;
    const oldPluginConfigList = (oldValue?.plugins ?? {}) as Record<
      string,
      unknown
    >;

    Object.entries(newPluginConfigList).forEach(([id, newPluginConfig]) => {
      const isEqual = deepEqual(oldPluginConfigList[id], newPluginConfig);

      if (!isEqual) {
        const oldConfig = oldPluginConfigList[id] as PluginConfig;
        const config = deepmerge(
          allPluginStubs[id].config ?? { enabled: false },
          newPluginConfig ?? {},
        ) as PluginConfig;

        // Essential plugins can never be disabled.
        if (allPluginStubs[id]?.essential) config.enabled = true;

        if (config.enabled !== oldConfig?.enabled) {
          if (config.enabled) {
            win.webContents.send('plugin:enable', id);
            ipcMain.emit('plugin:enable', id);
            forceLoadMainPlugin(id, win).catch((err) =>
              console.error(`Failed to load main plugin ${id}:`, err),
            );
          } else {
            win.webContents.send('plugin:unload', id);
            ipcMain.emit('plugin:unload', id);
            forceUnloadMainPlugin(id, win).catch((err) =>
              console.error(`Failed to unload main plugin ${id}:`, err),
            );
          }

          if (allPluginStubs[id]?.restartNeeded) {
            const requirement: RestartRequirement = { type: 'plugin', id };
            if (settingsRestartSessions.size > 0) {
              addPendingSettingsRestartRequirement(requirement);
            } else {
              showNeedToRestartDialog([requirement]).catch((err) =>
                console.error(`Failed to show restart dialog for ${id}:`, err),
              );
            }
          }
        }

        const mainPlugin = getAllLoadedMainPlugins()[id];
        if (mainPlugin) {
          if (config.enabled && typeof mainPlugin.backend !== 'function') {
            mainPlugin.backend?.onConfigChange?.call(
              mainPlugin.backend,
              config,
            );
          }
        }

        win.webContents.send('config-changed', id, config);
      }
    });
  });
};

const showNeedToRestartDialog = async (
  requirements: RestartRequirement[],
  showSummary = false,
) => {
  const plugins = await allPlugins();
  const changes = [
    ...new Set(
      requirements.map((requirement) =>
        requirement.type === 'plugin'
          ? (plugins[requirement.id]?.name?.() ?? requirement.id)
          : requirement.label,
      ),
    ),
  ];
  const pluginName = changes[0] ?? '';
  const useSummary = showSummary || requirements.length > 1;

  const dialogOptions: Electron.MessageBoxOptions = {
    type: 'info',
    buttons: [
      t('main.dialog.need-to-restart.buttons.restart-now'),
      t('main.dialog.need-to-restart.buttons.later'),
    ],
    title: t(
      useSummary
        ? 'main.dialog.restart-summary.title'
        : 'main.dialog.need-to-restart.title',
    ),
    message: t(
      useSummary
        ? 'main.dialog.restart-summary.message'
        : 'main.dialog.need-to-restart.message',
      { pluginName },
    ),
    detail: t(
      useSummary
        ? 'main.dialog.restart-summary.detail'
        : 'main.dialog.need-to-restart.detail',
      { changes: changes.join(', '), pluginName },
    ),
    defaultId: 0,
    cancelId: 1,
  };

  let dialogPromise: Promise<Electron.MessageBoxReturnValue>;
  if (mainWindow) {
    dialogPromise = dialog.showMessageBox(mainWindow, dialogOptions);
  } else {
    dialogPromise = dialog.showMessageBox(dialogOptions);
  }

  dialogPromise
    .then((dialogOutput) => {
      switch (dialogOutput.response) {
        case 0: {
          restart();
          break;
        }

        default: {
          break;
        }
      }
    })
    .catch((err) => {
      console.error('Failed to show restart dialog:', err);
    });
};

function initTheme(win: BrowserWindow) {
  injectCSS(win.webContents, musicPlayerCss);

  if (
    config.get('options.performanceMode') &&
    isPerformancePartEnabled('css')
  ) {
    injectCSS(win.webContents, performanceModeCss);
  }

  win.webContents.once('did-finish-load', () => {
    if (is.dev() && process.env.OPEN_DEVTOOLS) {
      console.debug(LoggerPrefix, t('main.console.did-finish-load.dev-tools'));
      win.webContents.openDevTools();
    }
  });
}

/** Hands a link to the desktop; a scheme nothing handles is dropped. */
const openExternally = (url: string) => {
  shell.openExternal(url).catch(() => {});
};

/**
 * Keeps Google/YouTube links in the app and sends the rest to the browser, via
 * window-open, in-place navigation and redirect (YouTube's outbound links bounce
 * through its own host). Applied to popups too.
 */
function interceptExternalLinks(win: BrowserWindow) {
  const { webContents } = win;

  const route = (event: Electron.Event, url: string) => {
    const target = classifyLink(url, config.get('url'));

    if (target === 'in-app') return;

    event.preventDefault();
    if (target === 'external') openExternally(url);
  };

  webContents.setWindowOpenHandler(({ url }) => {
    const target = classifyLink(url, config.get('url'));

    if (target === 'in-app') return { action: 'allow' };

    if (target === 'external') openExternally(url);
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event) => route(event, event.url));
  webContents.on('will-redirect', (event) => route(event, event.url));
  webContents.on('did-create-window', (popup) => interceptExternalLinks(popup));
}

async function createMainWindow() {
  const windowSize = config.get('window-size');
  const windowMaximized = config.get('window-maximized');
  const windowPosition: Electron.Point = config.get('window-position');
  const useInlineMenu = await config.plugins.isEnabled('in-app-menu');

  const defaultTitleBarOverlayOptions: Electron.TitleBarOverlay = {
    color: '#00000000',
    symbolColor: '#ffffff',
    height: 32,
  };

  const decorations: Partial<BrowserWindowConstructorOptions> = {
    frame: !is.macOS() && !useInlineMenu,
    titleBarOverlay: defaultTitleBarOverlayOptions,
    titleBarStyle: useInlineMenu
      ? 'hidden'
      : is.macOS()
        ? 'hiddenInset'
        : 'default',
    autoHideMenuBar: config.get('options.hideMenu'),
  };

  // NOTE: on Linux these extra properties do not work with 'frame: false'.
  if (is.linux() && useInlineMenu) {
    delete decorations.titleBarOverlay;
    delete decorations.titleBarStyle;
  }

  const electronWindowSettings: Electron.BrowserWindowConstructorOptions = {
    icon,
    width: windowSize.width,
    height: windowSize.height,
    minWidth: 325,
    minHeight: 425,
    backgroundColor: '#000',
    show: false,
    webPreferences: {
      contextIsolation: true,
      // Nothing in the app spells words: skip the hunspell dictionaries and the
      // input-path work they add. Re-enable per surface if a text editor lands.
      spellcheck: false,
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      ...(isTesting()
        ? undefined
        : {
            // Sandbox is only enabled in tests for now
            // See https://www.electronjs.org/docs/latest/tutorial/sandbox#preload-scripts
            sandbox: false,
          }),
    },
    ...decorations,
  };

  const win = new BrowserWindow(electronWindowSettings);

  interceptExternalLinks(win);

  await initHook(win);
  initTheme(win);

  await loadAllMainPlugins(win);

  if (windowPosition) {
    const { x: windowX, y: windowY } = windowPosition;
    const winSize = win.getSize();
    const display = screen.getDisplayNearestPoint(windowPosition);
    const primaryDisplay = screen.getPrimaryDisplay();

    const scaleFactor = is.windows()
      ? primaryDisplay.scaleFactor / display.scaleFactor
      : 1;
    const scaledWidth = Math.floor(windowSize.width * scaleFactor);
    const scaledHeight = Math.floor(windowSize.height * scaleFactor);

    const scaledX = windowX;
    const scaledY = windowY;

    if (
      scaledX + scaledWidth / 2 < display.bounds.x - 8 || // Left
      scaledX + scaledWidth / 2 > display.bounds.x + display.bounds.width || // Right
      scaledY < display.bounds.y - 8 || // Top
      scaledY + scaledHeight / 2 > display.bounds.y + display.bounds.height // Bottom
    ) {
      if (is.dev()) {
        console.warn(
          LoggerPrefix,
          t('main.console.window.tried-to-render-offscreen', {
            windowSize: String(winSize),
            displaySize: JSON.stringify(display.bounds),
            position: JSON.stringify(windowPosition),
          }),
        );
      }
    } else {
      win.setSize(scaledWidth, scaledHeight);
      win.setPosition(scaledX, scaledY);
    }
  }

  if (windowMaximized) {
    win.maximize();
  }

  if (config.get('options.alwaysOnTop')) {
    win.setAlwaysOnTop(true);
  }

  const urlToLoad = config.get('options.resumeOnStart')
    ? config.get('url')
    : config.defaultConfig.url;
  win.on('closed', onClosed);

  let lastSavedPosition = config.get('window-position') as
    | { x: number; y: number }
    | undefined;
  let lastSavedSize = config.get('window-size') as
    | { width: number; height: number }
    | undefined;

  win.on('move', () => {
    if (win.isMaximized()) {
      return;
    }

    const [x, y] = win.getPosition();
    if (lastSavedPosition?.x !== x || lastSavedPosition?.y !== y) {
      lastSavedPosition = { x, y };
      lateSave('window-position', { x, y });
    }
  });

  let winWasMaximized = win.isMaximized();

  win.on('resize', () => {
    const [width, height] = win.getSize();
    const isMaximized = win.isMaximized();

    if (winWasMaximized !== isMaximized) {
      winWasMaximized = isMaximized;
      config.set('window-maximized', isMaximized);
    }

    if (isMaximized) {
      return;
    }

    if (lastSavedSize?.width !== width || lastSavedSize?.height !== height) {
      lastSavedSize = { width, height };
      lateSave('window-size', {
        width,
        height,
      });
    }
  });

  const savedTimeouts: Record<string, NodeJS.Timeout | undefined> = {};

  function lateSave(
    key: string,
    value: unknown,
    fn: (key: string, value: unknown) => void = config.set,
  ) {
    if (savedTimeouts[key]) {
      clearTimeout(savedTimeouts[key]);
    }

    savedTimeouts[key] = setTimeout(() => {
      fn(key, value);
      savedTimeouts[key] = undefined;
    }, 600);
  }

  if (!renderProcessGoneRegistered) {
    renderProcessGoneRegistered = true;
    app.on('render-process-gone', (_event, _webContents, details) => {
      showUnresponsiveDialog(win, details);
    });
  }

  win.once('ready-to-show', () => {
    if (config.get('options.appVisible')) {
      win.show();
    }
  });

  // Hidden to tray: Blink's resource caches (decoded images, fonts) are
  // re-fetchable, so hand them back after a minute hidden instead of holding
  // them for the whole session.
  let hiddenCacheTimer: NodeJS.Timeout | undefined;
  win.on('hide', () => {
    hiddenCacheTimer = setTimeout(
      () => win.webContents.send('peard:clear-cache'),
      60_000,
    );
  });
  win.on('show', () => {
    if (!hiddenCacheTimer) return;
    clearTimeout(hiddenCacheTimer);
    hiddenCacheTimer = undefined;
  });
  win.on('closed', () => clearTimeout(hiddenCacheTimer));

  removeContentSecurityPolicy();

  win.webContents.on('dom-ready', () => {
    if (useInlineMenu && is.windows()) {
      win.setTitleBarOverlay({
        ...defaultTitleBarOverlayOptions,
        height: Math.floor(
          defaultTitleBarOverlayOptions.height! *
            win.webContents.getZoomFactor(),
        ),
      });
    }
  });
  win.webContents.on('will-redirect', (event) => {
    const url = URL.parse(event.url);

    // Workarounds for regions where YTM is restricted
    if (
      url &&
      url.hostname.endsWith('\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com') &&
      url.pathname === '/premium'
    ) {
      event.preventDefault();

      win.webContents.loadURL(
        'https://accounts.google.com/ServiceLogin?ltmpl=music&service=\u0079\u006f\u0075\u0074\u0075\u0062\u0065&continue=https%3A%2F%2Fwww.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3Dhttps%253A%252F%252Fmusic.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com%252F',
      );
    }
  });

  win.webContents.loadURL(urlToLoad);

  return win;
}

app.once('browser-window-created', (_event, win) => {
  if (config.get('options.overrideUserAgent')) {
    // User agents are from https://developers.whatismybrowser.com/useragents/explore/
    const originalUserAgent = win.webContents.userAgent;
    const userAgents = {
      mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36',
      windows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36',
      linux:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36',
    };

    const updatedUserAgent = is.macOS()
      ? userAgents.mac
      : is.windows()
        ? userAgents.windows
        : userAgents.linux;

    win.webContents.userAgent = updatedUserAgent;
    app.userAgentFallback = updatedUserAgent;

    win.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
      // This will only happen if login failed, and "retry" was pressed
      if (
        win.webContents.getURL().startsWith('https://accounts.google.com') &&
        details.url.startsWith('https://accounts.google.com')
      ) {
        details.requestHeaders['User-Agent'] = originalUserAgent;
      }

      cb({ requestHeaders: details.requestHeaders });
    });
  }

  setupSongInfo(win);
  setupAppControls();

  win.webContents.on(
    'did-fail-load',
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
      frameProcessId,
      frameRoutingId,
    ) => {
      const log = JSON.stringify(
        {
          error: 'did-fail-load',
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
          frameProcessId,
          frameRoutingId,
        },
        null,
        '\t',
      );
      if (is.dev()) {
        console.log(log);
      }

      if (
        errorCode !== -3 &&
        // Workaround for #2435
        !URL.parse(validatedURL)?.hostname?.includes('doubleclick.net')
      ) {
        // -3 is a false positive
        win.webContents.send('log', log);
        win.webContents.loadFile(ErrorHtmlAsset);
      }
    },
  );

  win.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  const customWindowTitle = config.get('options.customWindowTitle');

  if (customWindowTitle) {
    win.on('page-title-updated', (event) => {
      event.preventDefault();
      win.setTitle(customWindowTitle);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }

  globalShortcut.unregisterAll();
});

app.on('activate', async () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    mainWindow = await createMainWindow();
  } else if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
});

const getDefaultLocale = (locale: string) =>
  languageCodes.includes(locale) ? locale : null;

// Deny web permissions by default, allowing only what the app itself relies on:
// the output-device plugin needs `media` (microphone), the settings and
// music-together UIs write to the clipboard, the YouTube player uses the
// fullscreen API for video, and mediaKeySystem is required if a DRM-capable
// build (e.g. castlabs Electron) is used later.
const allowedPermissions = new Set([
  'media',
  'clipboard-sanitized-write',
  'fullscreen',
  'mediaKeySystem',
]);

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) =>
      callback(allowedPermissions.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    allowedPermissions.has(permission),
  );
  session.defaultSession.setSpellCheckerEnabled(false);

  // Not awaited: a few file stats must not hold the window back.
  clearStaleCodeCaches().catch((error) =>
    console.error(LoggerPrefix, 'Failed to clear stale code caches:', error),
  );

  if (!config.get('options.language')) {
    const locale = getDefaultLocale(app.getLocale());
    if (locale) {
      config.set('options.language', locale);
    }
  }

  await loadI18n(config.get('options.language') ?? 'en').then(() => {
    console.log(LoggerPrefix, t('main.console.i18n.loaded'));
  });

  await setupThemes();

  // Not awaited: a slow GitHub must not hold the window back.
  loadFlagMetadata();

  // Override the baked-in logo when the original YTM icons are requested.
  if (is.macOS() && config.get('options.useYtmIcons')) {
    app.dock?.setIcon(appIconPath());
  }

  if (config.get('options.autoResetAppCache')) {
    const clearCacheTimeout = setTimeout(() => {
      if (is.dev()) {
        console.log(
          LoggerPrefix,
          t('main.console.when-ready.clearing-cache-after-20s'),
        );
      }

      Promise.all([
        session.defaultSession.clearCache(),
        session.defaultSession.clearCodeCaches({}),
      ]).catch((error) =>
        console.error(LoggerPrefix, 'Failed to reset the app cache:', error),
      );
      clearTimeout(clearCacheTimeout);
    }, 20_000);
  }

  // Windows: app id and Start Menu shortcut.
  if (is.windows()) {
    const appID =
      'com.github.th-ch.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063';
    app.setAppUserModelId(appID);
    const appLocation = process.execPath;
    const appData = app.getPath('appData');
    // Check shortcut validity outside dev/portable runs.
    if (
      !is.dev() &&
      !appLocation.startsWith(path.join(appData, '..', 'Local', 'Temp'))
    ) {
      const shortcutPath = path.join(
        appData,
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        `${APPLICATION_NAME}.lnk`,
      );
      try {
        const shortcutDetails = shell.readShortcutLink(shortcutPath); // Throw error if it doesn't exist yet
        if (
          shortcutDetails.target !== appLocation ||
          shortcutDetails.appUserModelId !== appID
        ) {
          // oxlint-disable-next-line typescript/only-throw-error
          throw 'needUpdate';
        }
      } catch (error) {
        // If not valid -> Register shortcut
        shell.writeShortcutLink(
          shortcutPath,
          error === 'needUpdate' ? 'update' : 'create',
          {
            target: appLocation,
            cwd: path.dirname(appLocation),
            description: `${APPLICATION_NAME} Desktop App - including custom plugins`,
            appUserModelId: appID,
          },
        );
      }
    }
  }

  ipcMain.on('get-renderer-script', (event) => {
    // Hand the renderer its entry script: dev server URL in dev, built file otherwise.
    if (is.dev() && process.env.ELECTRON_RENDERER_URL) {
      // HACK: makes vite work with the electron renderer (hot reload).
      event.returnValue = [
        null,
        `
        console.log('${LoggerPrefix}', 'Loading vite from dev server');
        (async () => {
          await new Promise((resolve) => {
            if (document.readyState === 'loading') {
              console.log('${LoggerPrefix}', 'Waiting for DOM to load');
              document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
            } else {
              resolve();
            }
          });
          const viteScript = document.createElement('script');
          viteScript.type = 'module';
          viteScript.src = '${process.env.ELECTRON_RENDERER_URL}/@vite/client';
          const rendererScript = document.createElement('script');
          rendererScript.type = 'module';
          rendererScript.src = '${process.env.ELECTRON_RENDERER_URL}/renderer.ts';
          document.body.appendChild(viteScript);
          document.body.appendChild(rendererScript);
        })();
        0
      `,
      ];
    } else {
      const rendererPath = path.join(__dirname, '..', 'renderer');
      const indexHTML = parse(
        fs.readFileSync(path.join(rendererPath, 'index.html'), 'utf-8'),
      );
      const scriptSrc = indexHTML.querySelector('script')!;
      const scriptPath = path.join(
        rendererPath,
        scriptSrc.getAttribute('src')!,
      );
      const scriptString = fs.readFileSync(scriptPath, 'utf-8');
      event.returnValue = [
        url.pathToFileURL(scriptPath).toString(),
        scriptString + ';0',
      ];
    }
  });

  mainWindow = await createMainWindow();
  setupMemoryReport(mainWindow);
  await setApplicationMenu(mainWindow);
  await refreshMenu(mainWindow);
  setUpTray(app, mainWindow);

  // Shortcuts created or re-pinned after the option was toggled start on the exe
  // icon, so re-sync on launch (only differing shortcuts are written).
  if (is.windows()) {
    syncShortcutIcons();
  }

  setupProtocolHandler(mainWindow);

  app.on('second-instance', (_, commandLine) => {
    const uri = `${APP_PROTOCOL}://`;
    const protocolArgv = commandLine.find((arg) => arg.startsWith(uri));

    if (protocolArgv) {
      const lastIndex = protocolArgv.endsWith('/') ? -1 : undefined;
      const command = protocolArgv.slice(uri.length, lastIndex);
      if (is.dev()) {
        console.debug(
          LoggerPrefix,
          t('main.console.second-instance.receive-command', { command }),
        );
      }

      const splited = decodeURIComponent(command).split(' ');

      handleProtocol(splited.shift()!, ...splited);
      return;
    }

    // Only treat the last argument as a protocol command when it carries the
    // scheme: on Windows a plain relaunch has just the executable path, whose
    // drive-letter colon would be mistaken for a separator.
    const lastArg = commandLine.at(-1) ?? '';

    if (lastArg.startsWith(`${APP_PROTOCOL}:`)) {
      const splited = lastArg.split(':');

      if (splited.length > 1) {
        handleProtocol(splited.shift()!, ...splited);
        return;
      }
    }

    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    if (config.get('options.trayMoveToCurrentDesktop')) {
      showOnCurrentDesktop(mainWindow);
    } else {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  });

  app.setLoginItemSettings({
    openAtLogin: config.get('options.startAtLogin'),
  });

  // Provider owns channel, feed and dialogs; the stored channel applies even
  // with auto-updates off, so manual checks follow it too.
  setupAutoUpdates(mainWindow);

  if (config.get('options.hideMenu') && !config.get('options.hideMenuWarned')) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: t('main.dialog.hide-menu-enabled.title'),
      message: t('main.dialog.hide-menu-enabled.message'),
    });
    config.set('options.hideMenuWarned', true);
  }

  if (is.macOS() && !config.get('options.appVisible')) {
    app.dock?.hide();
  }

  let forceQuit = false;
  app.on('before-quit', () => {
    forceQuit = true;
  });

  if (is.macOS() || config.get('options.tray')) {
    mainWindow.on('close', (event) => {
      // Hide the window instead of quitting (quit is available in tray options)
      if (!forceQuit) {
        event.preventDefault();
        mainWindow!.hide();
      }
    });
  }
});

function showUnresponsiveDialog(
  _win: Electron.BrowserWindow,
  details: Electron.RenderProcessGoneDetails,
) {
  const buttons = [
    t('main.dialog.unresponsive.buttons.wait'),
    t('main.dialog.unresponsive.buttons.relaunch'),
    t('main.dialog.unresponsive.buttons.quit'),
  ];

  const dialogOptions: Electron.MessageBoxOptions = {
    type: 'info',
    buttons,
    title: t('main.dialog.unresponsive.title'),
    message: t('main.dialog.unresponsive.message'),
    detail: t('main.dialog.unresponsive.details', {
      error: details.reason,
    }),
    defaultId: 0,
    cancelId: 0,
  };

  let dialogPromise: Promise<Electron.MessageBoxReturnValue>;
  if (mainWindow) {
    dialogPromise = dialog.showMessageBox(mainWindow, dialogOptions);
  } else {
    dialogPromise = dialog.showMessageBox(dialogOptions);
  }

  dialogPromise.then((dialogOutput) => {
    switch (dialogOutput.response) {
      case 1: {
        restart();
        break;
      }

      case 2: {
        app.quit();
        break;
      }

      // Wait
      default: {
        break;
      }
    }
  });
}

function removeContentSecurityPolicy(
  betterSession: BetterSession = session.defaultSession as BetterSession,
) {
  // enhanceWebRequest allows multiple "onHeadersReceived" listeners; some plugins
  // (e.g. adblocker) define their own.
  enhanceWebRequest(betterSession);

  // Tweak the content security policy.
  betterSession.webRequest.onHeadersReceived((details, callback) => {
    details.responseHeaders ??= {};

    // prettier-ignore
    if (URL.parse(details.url)?.protocol === 'https:') {
      delete details.responseHeaders['content-security-policy-report-only'];
      delete details.responseHeaders['Content-Security-Policy-Report-Only'];
      delete details.responseHeaders['content-security-policy'];
      delete details.responseHeaders['Content-Security-Policy'];

      if (
        !details.responseHeaders['access-control-allow-origin'] &&
        !details.responseHeaders['Access-Control-Allow-Origin']
      ) {
        details.responseHeaders['access-control-allow-origin'] = ['https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com'];
      }
    }

    // Podcast/RSS audio streams from third-party hosts that omit CORS headers,
    // so the renderer's Web Audio graph silences it. Media is fetched in anonymous
    // (credential-less) CORS mode, so "*" is valid here, and it covers the whole
    // redirect chain since every hop passes through this listener.
    if (details.resourceType === 'media') {
      delete details.responseHeaders['Access-Control-Allow-Origin'];
      details.responseHeaders['access-control-allow-origin'] = ['*'];
    }

    callback({ cancel: false, responseHeaders: details.responseHeaders });
  });

  // With multiple listeners, apply them all.
  betterSession.webRequest.setResolver('onHeadersReceived', (listeners) => {
    return listeners.reduce(
      async (accumulator, listener) => {
        const acc = await accumulator;
        if (acc.cancel) {
          return acc;
        }

        const result = await listener.apply();
        return { ...acc, ...result };
      },
      Promise.resolve({ cancel: false }),
    );
  });
}
