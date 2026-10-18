import path from 'node:path';

import { app, BrowserWindow, ipcMain } from 'electron';

import { getCurrentUrl } from '@/providers/song-info';

export const restart = () => restartInternal();

export const setupAppControls = () => {
  ipcMain.on('peard:restart', restart);
  ipcMain.handle('peard:get-downloads-folder', () => app.getPath('downloads'));
  ipcMain.on('peard:reload', () =>
    BrowserWindow.getFocusedWindow()?.webContents.loadURL(getCurrentUrl()),
  );
  ipcMain.handle('peard:get-path', (_, ...args: string[]) =>
    path.join(...args),
  );
};

function restartInternal() {
  app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE });
  // execPath is undefined outside the portable app, which is the default behaviour
  app.quit();
}

function sendToFrontInternal(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

export const sendToFront =
  process.type === 'browser'
    ? sendToFrontInternal
    : () => {
        console.error('sendToFront called from renderer');
      };
