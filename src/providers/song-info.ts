import { app, type BrowserWindow, ipcMain, nativeImage, net } from 'electron';

import * as config from '@/config';

import {
  buildSongInfo,
  resolveScrobbleOptions,
  type ScrobbleOptions,
  type SongInfoData,
  type SongInfoSource,
} from './song-info-data';

export { MediaType, cleanupName } from './song-info-data';

export type SongInfo = SongInfoData;

const IMAGE_CACHE_LIMIT = 10;
const imageCache = new Map<string, Promise<Electron.NativeImage>>();

const fetchImage = async (
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
    return fetchImage(nextSrc, depth + 1);
  }

  return output;
};

/**
 * Decodes an image URL once: callers that need pixels (notifications, the
 * TouchBar, the Windows media control) share a small LRU cache instead of
 * fetching and decoding the same album art again. Rejections are not cached, so
 * a transient network failure can be retried.
 */
export const getImage = (src: string): Promise<Electron.NativeImage> => {
  const cached = imageCache.get(src);
  if (cached) {
    // Re-insert so the map stays in least-recently-used order.
    imageCache.delete(src);
    imageCache.set(src, cached);
    return cached;
  }

  const pending = fetchImage(src).catch((error: unknown) => {
    imageCache.delete(src);
    throw error;
  });
  imageCache.set(src, pending);
  if (imageCache.size > IMAGE_CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) {
      imageCache.delete(oldest);
    }
  }

  return pending;
};

// The URL of the playing track, kept in memory so every song change does not
// rewrite the config file (and wake every store watcher). Persisted on quit.
let currentUrl: string | undefined;

/** The current track URL, falling back to the last one persisted on quit. */
export const getCurrentUrl = () => currentUrl ?? config.get('url');

const handleData = (
  data: SongInfoSource,
  win: Electron.BrowserWindow,
): SongInfo | null => {
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

  // Used for options.resumeOnStart; persisted on quit, not per track.
  currentUrl =
    data.microformat?.microformatDataRenderer?.urlCanonical || currentUrl;

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
  let songInfo: SongInfo | null = null;

  // The last played URL is the only config value the song-change path used to
  // write; flush it once instead of rewriting the store per track.
  app.on('before-quit', () => {
    if (currentUrl !== undefined) {
      config.set('url', currentUrl);
    }
  });

  const emit = (event: SongInfoEvent) => {
    if (!songInfo) return;

    for (const c of callbacks) {
      c(songInfo, event);
    }
  };

  // Fired when song-info-front finds a new request with song data
  ipcMain.on('peard:video-src-changed', (_, data: SongInfoSource) => {
    songInfo = handleData(data, win);
    // Other main-process listeners on this channel (MPRIS's raw handler) run
    // after this one, in registration order, and set the state the callbacks
    // validate against — the old async handler deferred them past the whole
    // dispatch. Keep that ordering rather than emitting inside the handler.
    queueMicrotask(() => emit(SongInfoEvent.VideoSrcChanged));
  });
  ipcMain.on(
    'peard:play-or-paused',
    (
      _,
      {
        isPaused,
        elapsedSeconds,
      }: { isPaused: boolean; elapsedSeconds: number },
    ) => {
      if (!songInfo) return;

      songInfo.isPaused = isPaused;
      songInfo.elapsedSeconds = elapsedSeconds;
      emit(SongInfoEvent.PlayOrPaused);
    },
  );

  ipcMain.on('peard:time-changed', (_, seconds: number) => {
    if (!songInfo) return;

    songInfo.elapsedSeconds = seconds;
    emit(SongInfoEvent.TimeChanged);
  });
};

export const setupSongInfo = registerProvider;
