import { Mutex } from 'async-mutex';
import { type BrowserWindow, ipcMain, nativeImage, net } from 'electron';

import * as config from '@/config';

import {
  buildSongInfo,
  resolveScrobbleOptions,
  type ScrobbleOptions,
  type SongInfoData,
} from './song-info-data';

import type { GetPlayerResponse } from '@/types/get-player-response';

export { MediaType, cleanupName } from './song-info-data';

export interface SongInfo extends SongInfoData {
  image?: Electron.NativeImage | null;
}

export const getImage = async (
  src: string,
  depth = 0,
): Promise<Electron.NativeImage> => {
  if (depth > 3) {
    return nativeImage.createEmpty();
  }
  const result = await net.fetch(src);
  const output = nativeImage.createFromBuffer(
    Buffer.from(await result.arrayBuffer()),
  );
  if (output.isEmpty() && !src.endsWith('.jpg') && src.includes('.jpg')) {
    // Fix hidden webp files (https://github.com/pear-devs/pear-desktop/issues/315)
    const nextSrc = src.slice(0, src.lastIndexOf('.jpg') + 4);
    if (nextSrc === src) {
      return output;
    }
    return getImage(nextSrc, depth + 1);
  }

  return output;
};

const handleData = async (
  data: GetPlayerResponse,
  win: Electron.BrowserWindow,
): Promise<SongInfo | null> => {
  // The raw store holds only what the user changed, so the defaults have to be
  // merged back in — the plugin loader's deepmerge used to do it.
  const scrobbleOptions = resolveScrobbleOptions(
    config.get('plugins.scrobbler') as ScrobbleOptions | undefined,
  );

  const songInfo: SongInfo | null = buildSongInfo(data, {
    ...scrobbleOptions,
    usePodcastParticipantAsArtist: config.get(
      'options.usePodcastParticipantAsArtist',
    ),
  });

  if (!songInfo) {
    return null;
  }

  // Used for options.resumeOnStart
  const canonical = data.microformat?.microformatDataRenderer?.urlCanonical;
  if (canonical && config.get('url') !== canonical) {
    config.set('url', canonical);
  }

  if (songInfo.imageSrc) {
    songInfo.image = await getImage(songInfo.imageSrc);
  }

  if (data.videoDetails) {
    win.webContents.send('peard:update-song-info', songInfo);
  }

  return songInfo;
};

export enum SongInfoEvent {
  VideoSrcChanged = 'peard:video-src-changed',
  PlayOrPaused = 'peard:play-or-paused',
  TimeChanged = 'peard:time-changed',
}

export type SongInfoCallback = (
  songInfo: SongInfo,
  event: SongInfoEvent,
) => void;
const callbacks: Set<SongInfoCallback> = new Set();

// Lets plugins register a callback fired when song data changes
export const registerCallback = (callback: SongInfoCallback) => {
  callbacks.add(callback);
};

export const unregisterCallback = (callback: SongInfoCallback) => {
  callbacks.delete(callback);
};

const registerProvider = (win: BrowserWindow) => {
  const dataMutex = new Mutex();
  let songInfo: SongInfo | null = null;

  // Fired when song-info-front finds a new request with song data
  ipcMain.on('peard:video-src-changed', async (_, data: GetPlayerResponse) => {
    const tempSongInfo = await dataMutex.runExclusive<SongInfo | null>(
      async () => {
        songInfo = await handleData(data, win);
        return songInfo;
      },
    );

    if (tempSongInfo) {
      for (const c of callbacks) {
        c(tempSongInfo, SongInfoEvent.VideoSrcChanged);
      }
    }
  });
  ipcMain.on(
    'peard:play-or-paused',
    async (
      _,
      {
        isPaused,
        elapsedSeconds,
      }: { isPaused: boolean; elapsedSeconds: number },
    ) => {
      const tempSongInfo = await dataMutex.runExclusive<SongInfo | null>(() => {
        if (!songInfo) {
          return null;
        }

        songInfo.isPaused = isPaused;
        songInfo.elapsedSeconds = elapsedSeconds;

        return songInfo;
      });

      if (tempSongInfo) {
        for (const c of callbacks) {
          c(tempSongInfo, SongInfoEvent.PlayOrPaused);
        }
      }
    },
  );

  ipcMain.on('peard:time-changed', async (_, seconds: number) => {
    const tempSongInfo = await dataMutex.runExclusive<SongInfo | null>(() => {
      if (!songInfo) {
        return null;
      }

      songInfo.elapsedSeconds = seconds;

      return songInfo;
    });

    if (tempSongInfo) {
      for (const c of callbacks) {
        c(tempSongInfo, SongInfoEvent.TimeChanged);
      }
    }
  });
};

export const setupSongInfo = registerProvider;
