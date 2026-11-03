import { type BrowserWindow, globalShortcut } from 'electron';
import is from 'electron-is';
import {
  register as registerElectronLocalShortcut,
  unregister as unregisterElectronLocalShortcut,
} from 'electron-localshortcut';

import { getSongControls } from '@/providers/song-controls';

import { registerMPRIS, unregisterMPRIS } from './mpris';

import type { ShortcutMappingType, ShortcutsPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

const teardowns: Array<() => void> = [];
let generation = 0;

const registerGlobalShortcut = (shortcut: string, action: () => void) => {
  if (!globalShortcut.register(shortcut, action)) {
    console.warn(`Could not register global shortcut "${shortcut}"`);
    return;
  }

  teardowns.push(() => globalShortcut.unregister(shortcut));
};

const registerLocalShortcut = (
  win: BrowserWindow,
  shortcut: string,
  action: () => void,
) => {
  try {
    registerElectronLocalShortcut(win, shortcut, action);
  } catch (error) {
    console.warn(`Could not register local shortcut "${shortcut}"`, error);
    return;
  }

  teardowns.push(() => unregisterElectronLocalShortcut(win, shortcut));
};

const registerAllShortcuts = (
  win: BrowserWindow,
  container: ShortcutMappingType,
  songControls: ReturnType<typeof getSongControls>,
  global: boolean,
) => {
  for (const action of Object.keys(
    container,
  ) as (keyof ShortcutMappingType)[]) {
    const accelerator = container[action];
    if (!accelerator) {
      continue;
    }

    const actionCallback = songControls[action];
    if (typeof actionCallback !== 'function') {
      console.warn('Invalid action', action);
      continue;
    }

    if (global) {
      registerGlobalShortcut(accelerator, actionCallback);
    } else {
      registerLocalShortcut(win, accelerator, actionCallback);
    }
  }
};

export const onMainLoad = async ({
  getConfig,
  window,
}: BackendContext<ShortcutsPluginConfig>) => {
  const currentGeneration = ++generation;
  const config = await getConfig();
  if (currentGeneration !== generation) return;

  const songControls = getSongControls(window);
  const { playPause, next, previous } = songControls;

  if (config.overrideMediaKeys) {
    registerGlobalShortcut('MediaPlayPause', playPause);
    registerGlobalShortcut('MediaNextTrack', next);
    registerGlobalShortcut('MediaPreviousTrack', previous);
  }

  if (is.linux()) {
    registerMPRIS(window);
  }

  registerAllShortcuts(window, config.global, songControls, true);
  registerAllShortcuts(window, config.local, songControls, false);
};

export const onMainStop = () => {
  generation++;
  for (const teardown of teardowns.splice(0)) {
    teardown();
  }

  unregisterMPRIS();
};
