import fs from 'node:fs';
import path from 'node:path';

import {
  app,
  type BrowserWindow,
  type NativeImage,
  type Notification,
} from 'electron';

import { appIconPath } from '@/providers/app-icon';
import { getImage, type SongInfo } from '@/providers/song-info';

import { ToastStyles } from './labels';

import type { NotificationsPluginConfig } from './index';

const userData = app.getPath('userData');
const temporaryIcon = path.join(userData, 'tempIcon.png');
const temporaryBanner = path.join(userData, 'tempBanner.png');

const nativeImageToLogo = (nativeImage: NativeImage) => {
  const temporaryImage = nativeImage.resize({ height: 256 });
  const margin = Math.max(temporaryImage.getSize().width - 256, 0);

  return temporaryImage.crop({
    x: Math.round(margin / 2),
    y: 0,
    width: 256,
    height: 256,
  });
};

export const notificationImage = async (
  songInfo: SongInfo,
  config: NotificationsPluginConfig,
): Promise<string | NativeImage> => {
  if (!songInfo.imageSrc) {
    return appIconPath();
  }

  // Decoded at most once per URL by the shared cache; the fallback keeps a
  // notification working when the artwork cannot be fetched.
  const image = await getImage(songInfo.imageSrc).catch(() => null);
  if (!image || image.isEmpty()) {
    return appIconPath();
  }

  if (!config.interactive) {
    return nativeImageToLogo(image);
  }

  switch (config.toastStyle) {
    case ToastStyles.logo:
    case ToastStyles.legacy: {
      return saveImage(nativeImageToLogo(image), temporaryIcon);
    }

    default: {
      return saveImage(image, temporaryBanner);
    }
  }
};

export const saveImage = (img: NativeImage, savePath: string) => {
  try {
    fs.writeFileSync(savePath, img.toPNG());
  } catch (error: unknown) {
    console.error('Error writing song icon to disk:');
    console.trace(error);
    return appIconPath();
  }

  return savePath;
};

export const secondsToMinutes = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const secondsLeft = Math.floor(seconds % 60);
  return `${minutes}:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`;
};

/**
 * Bring the app window forward on a notification click. macOS activates the
 * app on its own, Windows does not, so without this a toast click just dismisses.
 */
export const focusWindowOnNotificationClick = (
  notification: Notification,
  win: BrowserWindow,
) => {
  notification.on('click', () => {
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
  });
};
