import is from 'electron-is';

import { createBackend } from '@/utils';

import {
  WINDOWS_MATERIALS,
  MACOS_MATERIALS,
  type MaterialType,
  type TransparentPlayerConfig,
} from './types';

import type { BackendContext } from '@/types/contexts';
import type { BrowserWindow } from 'electron';

const setWindowTransparency = (
  window: BrowserWindow,
  material: MaterialType,
  opacity: number,
) => {
  if (is.windows()) {
    window.setBackgroundMaterial(
      WINDOWS_MATERIALS.includes(material)
        ? (material as Parameters<BrowserWindow['setBackgroundMaterial']>[0])
        : 'none',
    );
    window.setBackgroundColor(`rgba(0, 0, 0, ${opacity})`);
  } else if (is.macOS()) {
    window.setVibrancy(
      MACOS_MATERIALS.includes(material)
        ? (material as Parameters<BrowserWindow['setVibrancy']>[0])
        : null,
    );
    window.setBackgroundColor(`rgba(0, 0, 0, ${opacity})`);
  } else {
    window.setBackgroundColor('#00000000');
  }
};

export const backend = createBackend({
  window: null as BrowserWindow | null,
  async start({ window, getConfig }: BackendContext<TransparentPlayerConfig>) {
    const config = await getConfig();
    this.window = window;
    setWindowTransparency(window, config.type, config.opacity);
  },
  onConfigChange(newConfig) {
    if (!this.window) return;
    setWindowTransparency(this.window, newConfig.type, newConfig.opacity);
  },
  stop({ window }) {
    if (is.windows()) {
      window.setBackgroundMaterial('none');
    } else if (is.macOS()) {
      window.setVibrancy(null);
    }
    window.setBackgroundColor('#000');
    this.window = null;
  },
});
