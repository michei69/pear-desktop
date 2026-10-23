import path from 'node:path';

import { app, BrowserWindow } from 'electron';
import is from 'electron-is';

import { t } from '@/i18n';

let icon = 'assets/icon.png';
if (process.platform === 'win32') {
  icon = 'assets/generated/icons/win/icon.ico';
} else if (process.platform === 'darwin') {
  icon = 'assets/generated/icons/mac/icon.icns';
}

// This module can be code-split into a chunk under `dist/main/chunks`, where
// `__dirname` points at the chunk instead of the main bundle and the `'..'`
// in the paths below then lands in `dist/main`. Resolve from the app root (the
// project root in dev, `app.asar` when packaged) against electron-vite's outDir
// so the paths hold wherever this module ends up in the build.
const buildDir = () => path.join(app.getAppPath(), 'dist');

let settingsWindow: Electron.BrowserWindow | undefined;

export const openSettingsWindow = () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    icon,
    width: 900,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#1d1b20',
    title: t('settings-ui.title'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      spellcheck: false,
      preload: path.join(buildDir(), 'preload', 'preload.cjs'),
      sandbox: false,
    },
  });

  settingsWindow.on('closed', () => {
    settingsWindow = undefined;
  });
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());

  if (is.dev() && process.env.ELECTRON_RENDERER_URL) {
    settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/?settings=1`);
  } else {
    settingsWindow.loadFile(path.join(buildDir(), 'renderer', 'index.html'), {
      search: 'settings=1',
    });
  }

  return settingsWindow;
};
