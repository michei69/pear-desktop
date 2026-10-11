import { app, type BrowserWindow } from 'electron';
import is from 'electron-is';

import { refreshTrayIcons } from '@/tray';

import { appIconPath, windowIconPath } from './app-icon';
import { syncShortcutIcons } from './shortcut-icons';

/**
 * Side effects an option's value implies beyond storing it. Both the native menu
 * and the in-app settings write options, so they route through here to stay in
 * step; options read only on launch (window/tray/proxy/...) rely on
 * `restartNeeded`.
 */
export const applyOptionEffects = (
  key: string,
  value: unknown,
  win: BrowserWindow,
) => {
  switch (key) {
    case 'options.alwaysOnTop':
      win.setAlwaysOnTop(Boolean(value));
      break;

    // Only works on Win/Mac, but a no-op elsewhere is harmless.
    case 'options.startAtLogin':
      app.setLoginItemSettings({ openAtLogin: Boolean(value) });
      break;

    case 'options.useYtmIcons':
      // The window/dock and tray icons can be swapped without a restart.
      if (is.macOS()) app.dock?.setIcon(appIconPath());
      else win.setIcon(windowIconPath());
      refreshTrayIcons();
      // The exe icon is baked in at build time; shortcuts can carry their
      // own, so keep those in step with the option.
      syncShortcutIcons();
      break;

    case 'options.trayForceWhiteIcons':
      refreshTrayIcons();
      break;

    // The renderer starts/stops its share-url rewriter from these.
    case 'options.stripMusicFromSharedLinks':
      win.webContents.send('peard:strip-music-from-shared-links', value);
      break;
    case 'options.stripSIFromSharedLinks':
      win.webContents.send('peard:strip-si-from-shared-links', value);
      break;

    default:
      break;
  }
};
