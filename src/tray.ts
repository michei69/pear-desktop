import { ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import is from 'electron-is';

import { APPLICATION_NAME, t } from '@/i18n';
import { trayIconPaths } from '@/providers/app-icon';
import { LikeType } from '@/types/datahost-get-state';
import {
  SONG_INFO_SETUP_CHANNEL,
  SongInfoEventFlag,
} from '@/types/song-info-events';

import * as config from './config';
import { restart } from './providers/app-controls';
import { getSongControls } from './providers/song-controls';
import {
  registerCallback,
  unregisterCallback,
  SongInfoEvent,
  type SongInfoCallback,
} from './providers/song-info';
import { openSettingsWindow } from './settings-window';
import { showOnCurrentDesktop } from './window-utils';

import type { MenuTemplate } from './menu';

// Prevent tray being garbage collected
let tray: Electron.Tray | undefined;
let traySongInfoCallback: SongInfoCallback | null = null;
let likeChangedListener:
  | ((event: Electron.IpcMainEvent, status: LikeType) => void)
  | null = null;
let playerApiLoadedListener: (() => void) | null = null;
let currentLikeStatus: LikeType = LikeType.Indifferent;
let defaultTrayIcon: Electron.NativeImage = nativeImage.createEmpty();
let pausedTrayIcon: Electron.NativeImage = nativeImage.createEmpty();
let trayIsPaused = false;

const computeTrayIcons = () => {
  const pixelRatio = is.windows()
    ? screen.getPrimaryDisplay().scaleFactor || 1
    : 1;
  const { default: defaultPath, paused: pausedPath } = trayIconPaths();
  const create = (path: string) =>
    nativeImage.createFromPath(path).resize({
      width: 16 * pixelRatio,
      height: 16 * pixelRatio,
    });

  return { default: create(defaultPath), paused: create(pausedPath) };
};

// Rebuilds the tray icons from the current config (e.g. after an icon-style toggle).
export const refreshTrayIcons = () => {
  if (!tray) return;
  ({ default: defaultTrayIcon, paused: pausedTrayIcon } = computeTrayIcons());
  tray.setImage(trayIsPaused ? pausedTrayIcon : defaultTrayIcon);
};

// The hover popup is drawn where the tray tooltip pops up, so silence the
// tooltip (empty string = Windows shows nothing) while the popup is visible.
let trayTooltipText = '';
let trayTooltipSuppressed = false;

const updateTrayTooltip = () => {
  tray?.setToolTip(trayTooltipSuppressed ? '' : trayTooltipText);
};

export const setTrayTooltipSuppressed = (suppressed: boolean) => {
  trayTooltipSuppressed = suppressed;
  updateTrayTooltip();
};

type MouseMoveEvent = (
  event: Electron.KeyboardEvent,
  position: Electron.Point,
) => void;

// Plugins load before the tray, so queue early handlers and apply them in setUpTray.
let pendingMouseMove: MouseMoveEvent | null = null;
// Track only our handler: removeListener must not drop other producers' listeners.
let trayMouseMoveHandler: MouseMoveEvent | null = null;

// macOS and Windows only
export const setTrayOnMouseMove = (fn: MouseMoveEvent) => {
  if (!tray) {
    pendingMouseMove = fn;
    return;
  }

  if (trayMouseMoveHandler) {
    tray.removeListener('mouse-move', trayMouseMoveHandler);
  }
  trayMouseMoveHandler = fn;
  tray.on('mouse-move', fn);
};

export const getTrayBounds = () => tray?.getBounds();

/**
 * Removes only the tray's listener: the API server and the taskbar controls
 * subscribe to the same channel, and `removeAllListeners` would mute them too.
 */
const removeLikeChangedListener = () => {
  if (!likeChangedListener) return;

  ipcMain.removeListener('peard:like-changed', likeChangedListener);
  likeChangedListener = null;
};

const removePlayerApiLoadedListener = () => {
  if (!playerApiLoadedListener) return;

  ipcMain.removeListener('peard:player-api-loaded', playerApiLoadedListener);
  playerApiLoadedListener = null;
};

export const setUpTray = (app: Electron.App, win: Electron.BrowserWindow) => {
  if (!config.get('options.tray')) {
    tray?.destroy();
    tray = undefined;
    if (traySongInfoCallback) {
      unregisterCallback(traySongInfoCallback);
      traySongInfoCallback = null;
    }
    removeLikeChangedListener();
    removePlayerApiLoadedListener();
    return;
  }

  if (traySongInfoCallback) {
    unregisterCallback(traySongInfoCallback);
  }

  removeLikeChangedListener();
  removePlayerApiLoadedListener();

  tray?.destroy();
  tray = undefined;

  const { playPause, next, previous, like, dislike } = getSongControls(win);

  ({ default: defaultTrayIcon, paused: pausedTrayIcon } = computeTrayIcons());

  tray = new Tray(defaultTrayIcon);

  // Old tray's hover suppression must not blank the new tooltip; keep the paused icon.
  trayTooltipSuppressed = false;
  if (trayIsPaused) tray.setImage(pausedTrayIcon);
  trayTooltipText ||= t('main.tray.tooltip.default', {
    applicationName: APPLICATION_NAME,
  });
  updateTrayTooltip();

  // MacOS only
  tray.setIgnoreDoubleClickEvents(true);

  // Windows turns a click within the system double-click time into
  // WM_LBUTTONDBLCLK, reported as 'double-click' instead of 'click'
  // (setIgnoreDoubleClickEvents is a no-op off macOS), so listening to 'click'
  // alone dropped rapid clicks.
  const onTrayClick = () => {
    if (config.get('options.trayClickPlayPause')) {
      playPause();
    } else if (win.isVisible()) {
      win.hide();
      app.dock?.hide();
    } else {
      if (config.get('options.trayMoveToCurrentDesktop')) {
        showOnCurrentDesktop(win);
      } else {
        win.show();
      }
      app.dock?.show();
    }
  };

  tray.on('click', onTrayClick);
  tray.on('double-click', onTrayClick);

  const buildTrayMenu = (): Menu => {
    const template: MenuTemplate = [
      {
        label: t('main.tray.play-pause'),
        click() {
          playPause();
        },
      },
      {
        label: t('main.tray.next'),
        click() {
          next();
        },
      },
      {
        label: t('main.tray.previous'),
        click() {
          previous();
        },
      },
      {
        label:
          currentLikeStatus === LikeType.Like
            ? t('main.tray.unlike')
            : t('main.tray.like'),
        click() {
          like();
        },
      },
      {
        label:
          currentLikeStatus === LikeType.Dislike
            ? t('main.tray.undislike')
            : t('main.tray.dislike'),
        click() {
          dislike();
        },
      },
      {
        label: t('main.tray.show'),
        click() {
          if (config.get('options.trayMoveToCurrentDesktop')) {
            showOnCurrentDesktop(win);
          } else {
            win.show();
          }
          app.dock?.show();
        },
      },
      { type: 'separator' },
      {
        label: t('settings-ui.title'),
        click() {
          openSettingsWindow();
        },
      },
      {
        label: t('main.tray.restart'),
        click: restart,
      },
      { type: 'separator' },
      {
        label: t('main.tray.quit'),
        role: 'quit',
      },
    ];

    return Menu.buildFromTemplate(template);
  };

  tray.setContextMenu(buildTrayMenu());

  // Renderer may not be listening yet; re-ask when it announces the player API.
  const requestLikeState = () => {
    if (!win.isDestroyed()) {
      win.webContents.send(
        SONG_INFO_SETUP_CHANNEL,
        SongInfoEventFlag.LikeChanged,
      );
    }
  };
  requestLikeState();
  playerApiLoadedListener = requestLikeState;
  ipcMain.on('peard:player-api-loaded', playerApiLoadedListener);
  likeChangedListener = (_, status: LikeType) => {
    currentLikeStatus = status;
    if (tray) {
      tray.setContextMenu(buildTrayMenu());
    }
  };
  ipcMain.on('peard:like-changed', likeChangedListener);

  traySongInfoCallback = (songInfo, event) => {
    if (event === SongInfoEvent.TimeChanged) return;

    if (tray) {
      if (typeof songInfo.isPaused === 'undefined') {
        tray.setImage(defaultTrayIcon);
        return;
      }

      trayTooltipText = t('main.tray.tooltip.with-song-info', {
        artist: songInfo.artist,
        title: songInfo.title,
        applicationName: APPLICATION_NAME,
      });
      updateTrayTooltip();

      trayIsPaused = songInfo.isPaused;
      tray.setImage(trayIsPaused ? pausedTrayIcon : defaultTrayIcon);
    }
  };
  registerCallback(traySongInfoCallback);

  // Apply handlers plugins registered before the tray existed.
  if (pendingMouseMove) {
    trayMouseMoveHandler = pendingMouseMove;
    pendingMouseMove = null;
  }
  if (trayMouseMoveHandler) {
    tray.on('mouse-move', trayMouseMoveHandler);
  }
};
