import {
  BrowserWindow,
  Menu,
  type MenuItem,
  ipcMain,
  nativeImage,
  type WebContents,
} from 'electron';
import { register, unregister } from 'electron-localshortcut';

import type { InAppMenuConfig } from './constants';
import type { BackendContext } from '@/types/contexts';

const MENU_EVENT_CHANNEL = 'peard:menu-event';
const TOGGLE_SHORTCUT = '`';

const cleanups: Array<() => void> = [];

const serializeMenu = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (key: string, field: unknown) =>
      key !== 'commandsMap' && key !== 'menu' ? field : undefined,
    ),
  );

const getMenuItemById = (commandId: number): MenuItem | null => {
  const menu = Menu.getApplicationMenu();

  let target: MenuItem | null = null;
  const stack = [...(menu?.items ?? [])];
  while (stack.length > 0) {
    const now = stack.shift();
    now?.submenu?.items.forEach((item) => stack.push(item));

    if (now?.commandId === commandId) {
      target = now;
      break;
    }
  }

  return target;
};

export const onMainLoad = ({
  window: win,
  ipc: { handle, send, removeHandler },
}: BackendContext<InAppMenuConfig>) => {
  const onClose = () => send('close-all-in-app-menu-panel');
  win.on('close', onClose);
  cleanups.push(() => win.removeListener('close', onClose));

  const onToggle = () => send('toggle-in-app-menu');
  register(win, TOGGLE_SHORTCUT, onToggle);
  cleanups.push(() => unregister(win, TOGGLE_SHORTCUT));

  handle('get-menu', () => serializeMenu(Menu.getApplicationMenu()));

  const onMenuEvent = (
    event: Electron.IpcMainInvokeEvent,
    commandId: number,
  ) => {
    const target = getMenuItemById(commandId);
    if (!target) return;

    (
      target.click as (
        args0: unknown,
        args1: BrowserWindow | null,
        args3: WebContents,
      ) => void
    )(undefined, BrowserWindow.fromWebContents(event.sender), event.sender);
  };
  ipcMain.handle(MENU_EVENT_CHANNEL, onMenuEvent);
  cleanups.push(() => ipcMain.removeHandler(MENU_EVENT_CHANNEL));

  handle('get-menu-by-id', (commandId: number) =>
    serializeMenu(getMenuItemById(commandId)),
  );

  handle('window-is-maximized', () => win.isMaximized());
  handle('window-close', () => win.close());
  handle('window-minimize', () => win.minimize());
  handle('window-maximize', () => win.maximize());
  handle('window-unmaximize', () => win.unmaximize());

  const onMaximize = () => send('window-maximize');
  win.on('maximize', onMaximize);
  cleanups.push(() => win.removeListener('maximize', onMaximize));

  const onUnmaximize = () => send('window-unmaximize');
  win.on('unmaximize', onUnmaximize);
  cleanups.push(() => win.removeListener('unmaximize', onUnmaximize));

  handle('image-path-to-data-url', (imagePath: string) =>
    nativeImage.createFromPath(imagePath)?.toDataURL(),
  );

  cleanups.push(() => {
    for (const channel of [
      'get-menu',
      'get-menu-by-id',
      'window-is-maximized',
      'window-close',
      'window-minimize',
      'window-maximize',
      'window-unmaximize',
      'image-path-to-data-url',
    ]) {
      removeHandler(channel);
    }
  });
};

export const onStop = () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
};
