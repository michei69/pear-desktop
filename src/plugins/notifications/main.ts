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
import { notificationImage } from './utils';

import type { NotificationsPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

let config: NotificationsPluginConfig;
let mainWindow: Electron.BrowserWindow | null = null;
let songInfoCallback:
  | ((songInfo: SongInfo, event: SongInfoEvent) => void)
  | null = null;
let disposeHoverPopup: (() => void) | null = null;

const notify = (info: SongInfo) => {
  // Send the notification
  const currentNotification = new Notification({
    title: info.title || 'Playing',
    body: info.artist,
    icon: notificationImage(info, config),
    silent: true,
    urgency: config.urgency,
  });
  currentNotification.show();

  return currentNotification;
};

const setup = () => {
  let oldNotification: Notification;
  let currentUrl: string | undefined;

  songInfoCallback = (songInfo: SongInfo, event) => {
    if (
      event !== SongInfoEvent.TimeChanged &&
      !songInfo.isPaused &&
      (songInfo.url !== currentUrl || config.unpauseNotification)
    ) {
      // Close the old notification
      oldNotification?.close();
      currentUrl = songInfo.url;
      // This fixes a weird bug that would cause the notification to be updated instead of showing
      setTimeout(() => {
        oldNotification = notify(songInfo);
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
  // Register the callback for new song information
  if (is.windows() && config.interactive)
    interactive(context.window, () => config, context);
  else setup();

  if (config.hoverControls) {
    disposeHoverPopup = setupHoverPopup(context.window);
  }
};

export const onConfigChange = (newConfig: NotificationsPluginConfig) => {
  if (newConfig.hoverControls && !disposeHoverPopup) {
    // Re-create the popup when the setting is turned back on
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
  if (songInfoCallback) {
    unregisterCallback(songInfoCallback);
    songInfoCallback = null;
  }
  if (disposeHoverPopup) {
    disposeHoverPopup();
    disposeHoverPopup = null;
  }
};
