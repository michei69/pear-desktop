import fs from 'node:fs';

import { app, BrowserWindow, dialog } from 'electron';
import is from 'electron-is';

import { t } from '@/i18n';
import { settingsWindowPaths } from '@/plugins/settings-ui/window-paths';

let icon = 'assets/icon.png';
if (process.platform === 'win32') {
  icon = 'assets/generated/icons/win/icon.ico';
} else if (process.platform === 'darwin') {
  icon = 'assets/generated/icons/mac/icon.icns';
}

const SHOW_FALLBACK_DELAY = 500;

let settingsWindow: Electron.BrowserWindow | undefined;

export const openSettingsWindow = () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.focus();
    return settingsWindow;
  }

  const appPath = app.getAppPath();
  const paths = settingsWindowPaths(appPath);
  const devUrl = is.dev() ? process.env.ELECTRON_RENDERER_URL : undefined;

  if (!devUrl) {
    const missing = [paths.preload, paths.html].filter(
      (file) => !fs.existsSync(file),
    );
    if (missing.length > 0) {
      console.error(
        '[settings-ui] cannot open the settings window, missing build files:',
        missing,
      );
      dialog.showErrorBox(
        t('settings-ui.window.open-failed-title'),
        t('settings-ui.window.missing-files', {
          files: missing.join('\n'),
        }),
      );
      return undefined;
    }
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
      preload: paths.preload,
      sandbox: false,
    },
  });

  const showWindow = () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.show();
  };
  const showFallbackTimer = setTimeout(showWindow, SHOW_FALLBACK_DELAY);

  settingsWindow.once('show', () => clearTimeout(showFallbackTimer));
  settingsWindow.once('ready-to-show', showWindow);
  settingsWindow.on('closed', () => {
    clearTimeout(showFallbackTimer);
    settingsWindow = undefined;
  });

  settingsWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      console.error('[settings-ui] settings window failed to load:', {
        errorCode,
        errorDescription,
        validatedURL,
      });
      showWindow();
    },
  );

  settingsWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[settings-ui] settings window renderer gone:', details);
    showWindow();
  });

  if (devUrl) {
    settingsWindow.loadURL(`${devUrl}/settings.html?settings=1`);
  } else {
    settingsWindow.loadFile(paths.html, { search: 'settings=1' });
  }

  return settingsWindow;
};
