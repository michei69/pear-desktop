import { randomUUID } from 'node:crypto';

import { type BrowserWindow, ipcMain } from 'electron';

import * as config from '@/config';
import { LikeType } from '@/types/datahost-get-state';

// see protocol-handler.ts
type ArgsType<T> = T | string[] | undefined;

export type SearchResults = Record<string, unknown>;

const parseNumberFromArgsType = (args: ArgsType<number>) => {
  if (typeof args === 'number') {
    return Number.isFinite(args) ? args : null;
  } else if (Array.isArray(args)) {
    const parsed = Number(args[0]);
    return Number.isFinite(parsed) ? parsed : null;
  } else {
    return null;
  }
};

const parseBooleanFromArgsType = (args: ArgsType<boolean>) => {
  if (typeof args === 'boolean') {
    return args;
  } else if (Array.isArray(args)) {
    return args[0] === 'true';
  } else {
    return null;
  }
};

const parseStringFromArgsType = (args: ArgsType<string>) => {
  if (typeof args === 'string') {
    return args;
  } else if (Array.isArray(args)) {
    return args[0];
  } else {
    return null;
  }
};

/**
 * Whether precise-volume's renderer half has registered its volume receiver.
 * The plugin marks the page when it registers and clears the mark on unload
 * (`precise-volume/renderer.ts`), so routing by config alone cannot send a
 * command to a channel nobody listens on during boot or a re-enable.
 */
const PRECISE_VOLUME_RECEIVER_PROBE =
  "document.documentElement.dataset.preciseVolumeReceiver === '1'";

const isPreciseVolumeReceiverReady = async (win: BrowserWindow) => {
  if (win.isDestroyed()) return false;
  try {
    return Boolean(
      await win.webContents.executeJavaScript(PRECISE_VOLUME_RECEIVER_PROBE),
    );
  } catch {
    // The page can be mid-navigation or gone; the player path is the fallback.
    return false;
  }
};

export const getSongControls = (win: BrowserWindow) => {
  return {
    // Playback
    previous: () => win.webContents.send('peard:previous-video'),
    next: () => win.webContents.send('peard:next-video'),
    play: () => win.webContents.send('peard:play'),
    pause: () => win.webContents.send('peard:pause'),
    playPause: () => win.webContents.send('peard:toggle-play'),
    like: () => win.webContents.send('peard:update-like', LikeType.Like),
    dislike: () => win.webContents.send('peard:update-like', LikeType.Dislike),
    seekTo: (seconds: ArgsType<number>) => {
      const secondsNumber = parseNumberFromArgsType(seconds);
      if (secondsNumber !== null) {
        win.webContents.send('peard:seek-to', secondsNumber);
      }
    },
    goBack: (seconds: ArgsType<number>) => {
      const secondsNumber = parseNumberFromArgsType(seconds);
      if (secondsNumber !== null) {
        win.webContents.send('peard:seek-by', -secondsNumber);
      }
    },
    goForward: (seconds: ArgsType<number>) => {
      const secondsNumber = parseNumberFromArgsType(seconds);
      if (secondsNumber !== null) {
        win.webContents.send('peard:seek-by', secondsNumber);
      }
    },
    requestShuffleInformation: () => {
      win.webContents.send('peard:get-shuffle');
    },
    shuffle: () => win.webContents.send('peard:shuffle'),
    switchRepeat: (n: ArgsType<number> = 1) => {
      const repeat = parseNumberFromArgsType(n);
      if (repeat !== null) {
        win.webContents.send('peard:switch-repeat', repeat);
      }
    },
    // General
    setVolume: async (volume: ArgsType<number>) => {
      const volumeNumber = parseNumberFromArgsType(volume);
      if (volumeNumber === null) return;

      if (
        (await config.plugins.isEnabled('precise-volume')) &&
        (await isPreciseVolumeReceiverReady(win))
      ) {
        // precise-volume owns the volume UI (saved volume, tooltip, slider,
        // HUD), so let it apply the change instead of writing the player. It
        // only gets the command while its receiver is actually registered.
        win.webContents.send('setVolume', volumeNumber);
      } else {
        win.webContents.send('peard:update-volume', volumeNumber);
      }
    },
    setFullscreen: (isFullscreen: ArgsType<boolean>) => {
      const isFullscreenValue = parseBooleanFromArgsType(isFullscreen);
      if (isFullscreenValue !== null) {
        win.setFullScreen(isFullscreenValue);
        win.webContents.send(
          'peard:click-fullscreen-button',
          isFullscreenValue,
        );
      }
    },
    requestFullscreenInformation: () => {
      win.webContents.send('peard:get-fullscreen');
    },
    requestQueueInformation: () => {
      win.webContents.send('peard:get-queue');
    },
    muteUnmute: () => win.webContents.send('peard:toggle-mute'),
    openSearchBox: () => {
      win.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: '/',
      });
    },
    // Queue
    addSongToQueue: (videoId: string, queueInsertPosition: string) => {
      const videoIdValue = parseStringFromArgsType(videoId);
      if (videoIdValue === null) return;

      win.webContents.send(
        'peard:add-to-queue',
        videoIdValue,
        queueInsertPosition,
      );
    },
    moveSongInQueue: (
      fromIndex: ArgsType<number>,
      toIndex: ArgsType<number>,
    ) => {
      const fromIndexValue = parseNumberFromArgsType(fromIndex);
      const toIndexValue = parseNumberFromArgsType(toIndex);
      if (fromIndexValue === null || toIndexValue === null) return;

      win.webContents.send('peard:move-in-queue', fromIndexValue, toIndexValue);
    },
    removeSongFromQueue: (index: ArgsType<number>) => {
      const indexValue = parseNumberFromArgsType(index);
      if (indexValue === null) return;

      win.webContents.send('peard:remove-from-queue', indexValue);
    },
    setQueueIndex: (index: ArgsType<number>) => {
      const indexValue = parseNumberFromArgsType(index);
      if (indexValue === null) return;

      win.webContents.send('peard:set-queue-index', indexValue);
    },
    clearQueue: () => win.webContents.send('peard:clear-queue'),

    search: (
      query: string,
      params?: string,
      continuation?: string,
    ): Promise<SearchResults> =>
      new Promise<SearchResults>((resolve, reject) => {
        const requestId = randomUUID();
        const onResult = (_: unknown, id: string, result: SearchResults) => {
          if (id !== requestId) return;

          cleanup();
          resolve(result);
        };
        const cleanup = () => {
          clearTimeout(timeout);
          ipcMain.removeListener('peard:search-results', onResult);
        };
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Search request timed out after 30s'));
        }, 30_000);

        ipcMain.on('peard:search-results', onResult);
        win.webContents.send(
          'peard:search',
          requestId,
          query,
          params,
          continuation,
        );
      }),

    loadVideo: (videoId: ArgsType<string>) => {
      const vId = parseStringFromArgsType(videoId);
      win.webContents.send('peard:load-video', vId);
    },
    loadPlaylist: (playlistId: ArgsType<string>) => {
      const pId = parseStringFromArgsType(playlistId);
      win.webContents.send('peard:load-playlist', pId);
    },
  };
};
