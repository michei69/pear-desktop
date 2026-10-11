import { nativeImage, Tray } from 'electron';
import is from 'electron-is';

import { createBackend } from '@/utils';

let tray: Tray | undefined;

// Lazily create one tray to reuse as the macOS title target
const getTray = () => {
  if (!tray) {
    tray = new Tray(nativeImage.createEmpty());
  }
  return tray;
};

// Collapse whitespace and truncate to the configured length
const normalizeText = (text: string, maxLength: number) => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const limit = Number.isFinite(maxLength) ? Math.floor(maxLength) : 0;
  if (limit <= 0) return '';
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 1).trimEnd()}…`;
};

export const backend = createBackend({
  start(ctx) {
    ctx.ipc.handle(
      'statusbar-lyrics:set-text',
      (text: string, maxLength: number) => {
        if (!is.macOS()) return;

        const trayInstance = getTray();
        trayInstance.setTitle(normalizeText(text, maxLength));
        // trayInstance.setTitle(text);
      },
    );

    ctx.ipc.handle('statusbar-lyrics:clear', () => {
      if (!is.macOS()) return;
      getTray().setTitle('');
    });
  },
  stop(ctx) {
    ctx.ipc.removeHandler('statusbar-lyrics:set-text');
    ctx.ipc.removeHandler('statusbar-lyrics:clear');
    if (tray && !tray.isDestroyed()) {
      tray.setTitle('');
      tray.destroy();
    }
    tray = undefined;
  },
});
