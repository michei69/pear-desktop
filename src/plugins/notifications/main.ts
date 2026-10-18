import { Notification } from 'electron';
import is from 'electron-is';

import {
  registerCallback,
  unregisterCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';

import { setupHoverPopup } from './hover-popup';
import interactive from './interactive';
import { focusWindowOnNotificationClick, notificationImage } from './utils';

import type { NotificationsPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

let config: NotificationsPluginConfig;
let mainWindow: Electron.BrowserWindow | null = null;
let songInfoCallback:
  | ((songInfo: SongInfo, event: SongInfoEvent) => void)
  | null = null;
let disposeHoverPopup: (() => void) | null = null;
let disposeInteractive: (() => void) | null = null;
// The track the last toast was for; artwork decoding is async, so a toast that
// lands after a track change is dropped instead of shown stale.
let currentUrl: string | undefined;

const notify = async (info: SongInfo) => {
  const icon = await notificationImage(info, config);
  if (info.url !== currentUrl) {
    return undefined;
  }

  const currentNotification = new Notification({
    title: info.title || 'Playing',
    body: info.artist,
    icon,
    silent: true,
    urgency: config.urgency,
  });

  if (is.windows() && mainWindow) {
    focusWindowOnNotificationClick(currentNotification, mainWindow);
  }

  currentNotification.show();

  return currentNotification;
};

const setup = () => {
  let oldNotification: Notification;

  songInfoCallback = (songInfo: SongInfo, event) => {
    if (
      event !== SongInfoEvent.TimeChanged &&
      !songInfo.isPaused &&
      (songInfo.url !== currentUrl || config.unpauseNotification)
    ) {
      oldNotification?.close();
      currentUrl = songInfo.url;
      // The 10ms delay stops the notification being updated instead of shown.
      setTimeout(() => {
        notify(songInfo).then((notification) => {
          if (notification) {
            oldNotification = notification;
          }
        });
      }, 10);
    }
  };

  registerCallback(songInfoCallback);
};

export const onMainLoad = async (
  context: BackendContext<NotificationsPluginConfig>,
) => {
  mainWindow = context.window;
  config = await context.getConfig();
  if (is.windows() && config.interactive)
    disposeInteractive = interactive(context.window, () => config, context);
  else setup();

  if (config.hoverControls) {
    disposeHoverPopup = setupHoverPopup(context.window);
  }
};

export const onConfigChange = (newConfig: NotificationsPluginConfig) => {
  if (newConfig.hoverControls && !disposeHoverPopup) {
    if (mainWindow) {
      disposeHoverPopup = setupHoverPopup(mainWindow);
    }
  } else if (!newConfig.hoverControls && disposeHoverPopup) {
    disposeHoverPopup();
    disposeHoverPopup = null;
  }
  config = newConfig;
};

export const onStop = () => {
  // Interactive mode owns its own song-info callback; it is not the module-level
  // one, so it must be disposed through the function it returned.
  disposeInteractive?.();
  disposeInteractive = null;
  currentUrl = undefined;
  if (songInfoCallback) {
    unregisterCallback(songInfoCallback);
    songInfoCallback = null;
  }
  if (disposeHoverPopup) {
    disposeHoverPopup();
    disposeHoverPopup = null;
  }
};
