import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Mutex } from 'async-mutex';
import { type BrowserWindow, dialog, ipcMain, utilityProcess } from 'electron';
import is from 'electron-is';
import filenamify from 'filenamify';
import {
  Utils,
  YTNodes,
  type Innertube,
  type Types,
  type YT,
  type YTMusic,
} from 'youtubei.js';

import { t } from '@/i18n';
import { getInnertubeSession, isPremium } from '@/plugins/utils/main';
import {
  registerCallback,
  unregisterCallback,
  cleanupName,
  getImage,
  MediaType,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import {
  SONG_INFO_SETUP_CHANNEL,
  SongInfoEventFlag,
} from '@/types/song-info-events';

// oxlint-disable-next-line import/default -- `?modulePath` is a build-time path string.
import ffmpegWorkerPath from './ffmpeg-worker?modulePath';
import {
  cropMaxWidth,
  getFolder,
  sendFeedback as sendFeedback_,
  setBadge,
} from './utils';

import { DefaultPresetList, type Preset, VideoFormatList } from '../types';

import type { DownloaderPluginConfig } from '../index';
import type { DownloadJob, TagPayload, WorkerMessage } from './ffmpeg-worker';
import type { BackendContext } from '@/types/contexts';
import type { GetPlayerResponse } from '@/types/get-player-response';

// Built from ytmusic's TrackInfo rather than the player response, so it has no
// scrobbler metadata; the downloader only reads title/artist/album/trackId.
type CustomSongInfo = Omit<SongInfo, 'scrobbleTitle' | 'scrobbleArtist'> & {
  trackId?: string;
};

type JobOutcome =
  | { ok: true; tagError?: string }
  | { ok: false; code: 'ffmpeg-not-found' | 'failed'; message: string };

// Only conversions queue up: downloads run in parallel, ffmpeg does not.
const ffmpegMutex = new Mutex();
let ffmpegMissing = false;

// Console stays English; the dialog the throws surface in is localized at the
// throw sites via `t('plugins.downloader.backend.feedback.ffmpeg-missing')`.
const FFMPEG_MISSING_MESSAGE =
  'FFmpeg was not found. Install FFmpeg and make sure `ffmpeg` is on your PATH to download in this format.';

const noteMissingFfmpeg = () => {
  if (ffmpegMissing) return;
  ffmpegMissing = true;
  console.warn(FFMPEG_MISSING_MESSAGE);
};

/**
 * Runs one download job in a short-lived utility process, so neither the ffmpeg
 * child nor the blocking ID3 writer ever holds up the main process.
 */
const runDownloadJob = (
  job: DownloadJob,
  onProgress?: (ratio: number) => void,
) =>
  new Promise<JobOutcome>((resolve) => {
    const child = utilityProcess.fork(ffmpegWorkerPath, [], {
      serviceName: 'pear-downloader-ffmpeg',
    });

    let settled = false;
    const settle = (outcome: JobOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
      child.kill();
    };

    child.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') {
        onProgress?.(message.ratio);
      } else if (message.type === 'done') {
        settle(message);
      }
    });
    child.on('error', (type) => {
      settle({
        ok: false,
        code: 'failed',
        message: `utility process failed: ${type}`,
      });
    });
    child.on('exit', (code) => {
      settle({
        ok: false,
        code: 'failed',
        message: `utility process exited with code ${code}`,
      });
    });

    child.once('spawn', () => child.postMessage(job));
  });

let yt: Innertube;
let win: BrowserWindow;
let playingUrl: string;

const sendError = (error: Error, source?: string) => {
  win.setProgressBar(-1); // Close progress bar
  setBadge(0); // Close badge
  sendFeedback_(win); // Reset feedback

  const songNameMessage = source ? `\nin ${source}` : '';
  const cause = error.cause
    ? `\n\n${
        // oxlint-disable-next-line typescript/no-base-to-string,typescript/restrict-template-expressions
        error.cause instanceof Error ? error.cause.toString() : error.cause
      }`
    : '';
  const message = `${error.toString()}${songNameMessage}${cause}`;

  console.error(message);
  console.trace(error);
  dialog.showMessageBox(win, {
    type: 'info',
    buttons: [t('plugins.downloader.backend.dialog.error.buttons.ok')],
    title: t('plugins.downloader.backend.dialog.error.title'),
    message: t('plugins.downloader.backend.dialog.error.message'),
    detail: message,
  });
};

let config: DownloaderPluginConfig;
let cleanupFinishSetup: (() => void) | undefined;
let initialization: Promise<Innertube> | undefined;

/** Creates the shared Innertube session on first download, retrying a failure. */
const ensureInitialized = async () => {
  initialization ??= getInnertubeSession(win).catch((error: unknown) => {
    initialization = undefined; // A transient failure must not stick.
    throw error;
  });
  yt = await initialization;
};
export const onMainLoad = async ({
  window: _win,
  getConfig,
  ipc,
}: BackendContext<DownloaderPluginConfig>) => {
  win = _win;
  config = await getConfig();

  ipc.handle('download-song', (url: string) => downloadSong(url));
  ipc.on('peard:video-src-changed', (data: GetPlayerResponse) => {
    playingUrl = data.microformat.microformatDataRenderer.urlCanonical;
  });
  ipc.handle('download-playlist-request', async (url: string) =>
    downloadPlaylist(url),
  );

  cleanupFinishSetup = downloadSongOnFinishSetup({ ipc, getConfig });
};

export const onConfigChange = (newConfig: DownloaderPluginConfig) => {
  config = newConfig;
};

export const onStop = () => {
  cleanupFinishSetup?.();
};

export async function downloadSong(
  url: string,
  playlistFolder?: string,
  trackId?: string,
  increasePlaylistProgress: (value: number) => void = () => {},
) {
  let resolvedName;
  try {
    await ensureInitialized();
    await downloadSongUnsafe(
      false,
      url,
      (name: string) => (resolvedName = name),
      playlistFolder,
      trackId,
      increasePlaylistProgress,
    );
  } catch (error: unknown) {
    sendError(error as Error, resolvedName || url);
  }
}

export async function downloadSongFromId(
  id: string,
  playlistFolder?: string,
  trackId?: string,
  increasePlaylistProgress: (value: number) => void = () => {},
) {
  let resolvedName;
  try {
    await ensureInitialized();
    await downloadSongUnsafe(
      true,
      id,
      (name: string) => (resolvedName = name),
      playlistFolder,
      trackId,
      increasePlaylistProgress,
    );
  } catch (error: unknown) {
    sendError(error as Error, resolvedName || id);
  }
}

function downloadSongOnFinishSetup({
  ipc,
}: Pick<BackendContext<DownloaderPluginConfig>, 'ipc' | 'getConfig'>) {
  let currentUrl: string | undefined;
  let duration: number | undefined;
  let time = 0;

  const songInfoCallback = (songInfo: SongInfo, event: SongInfoEvent) => {
    if (event === SongInfoEvent.TimeChanged) {
      const elapsedSeconds = songInfo.elapsedSeconds ?? 0;
      if (elapsedSeconds > time) time = elapsedSeconds;
      return;
    }
    if (
      !songInfo.isPaused &&
      songInfo.url !== currentUrl &&
      config.downloadOnFinish?.enabled
    ) {
      if (typeof currentUrl === 'string' && duration && duration > 0) {
        if (
          config.downloadOnFinish.mode === 'seconds' &&
          duration - time <= config.downloadOnFinish.seconds
        ) {
          downloadSong(
            currentUrl,
            getFolder(config.downloadOnFinish.folder ?? config.downloadFolder),
          );
        } else if (
          config.downloadOnFinish.mode === 'percent' &&
          time >= duration * (config.downloadOnFinish.percent / 100)
        ) {
          downloadSong(
            currentUrl,
            getFolder(config.downloadOnFinish.folder ?? config.downloadFolder),
          );
        }
      }

      currentUrl = songInfo.url;
      duration = songInfo.songDuration;
      time = 0;
    }
  };

  registerCallback(songInfoCallback);

  const onPlayerApiLoaded = () => {
    ipc.send(SONG_INFO_SETUP_CHANNEL, SongInfoEventFlag.TimeChanged);
  };

  ipcMain.on('peard:player-api-loaded', onPlayerApiLoaded);

  return () => {
    unregisterCallback(songInfoCallback);
    ipcMain.removeListener('peard:player-api-loaded', onPlayerApiLoaded);
  };
}

async function downloadSongUnsafe(
  isId: boolean,
  idOrUrl: string,
  setName: (name: string) => void,
  playlistFolder?: string,
  trackId?: string,
  increasePlaylistProgress: (value: number) => void = () => {},
) {
  // Playlist downloads show their own counter instead of per-song feedback.
  const isPlaylistDownload = Boolean(playlistFolder);

  let lastPhase = '';
  const sendPhase = (message: string, progress?: number) => {
    if (isPlaylistDownload || message === lastPhase) return;
    lastPhase = message;
    sendFeedback_(win, message);
    if (progress !== undefined && !isNaN(progress)) {
      win.setProgressBar(progress);
    }
  };

  // A chunk can be a few kilobytes: rebuild and send only on percent changes.
  let lastDownloadPercent = -1;
  const reportDownloadProgress = (ratio: number) => {
    const percent = Math.floor(ratio * 100);
    if (percent === lastDownloadPercent) return;
    lastDownloadPercent = percent;
    if (!isPlaylistDownload) {
      sendPhase(
        t('plugins.downloader.backend.feedback.download-progress', {
          percent,
        }),
        ratio,
      );
    }
    // Rough split: 15% download, 85% conversion, to make the bar look nice.
    increasePlaylistProgress(ratio * 0.15);
  };

  let lastConversionPercent = -1;
  const reportConversionProgress = (ratio: number) => {
    const percent = Math.floor(ratio * 100);
    if (percent === lastConversionPercent) return;
    lastConversionPercent = percent;
    if (!isPlaylistDownload) {
      sendPhase(
        t('plugins.downloader.backend.feedback.conversion-progress', {
          percent,
        }),
        0.15 + ratio * 0.85,
      );
    }
    increasePlaylistProgress(0.15 + ratio * 0.85);
  };

  const resetFeedback = () => {
    if (isPlaylistDownload) return;
    sendFeedback_(win);
    win.setProgressBar(-1);
  };

  sendPhase(t('plugins.downloader.backend.feedback.downloading'), 2);

  let id: string | null;
  if (isId) {
    id = idOrUrl;
  } else {
    id = getVideoId(idOrUrl);
    if (typeof id !== 'string')
      throw new Error(
        t('plugins.downloader.backend.feedback.video-id-not-found'),
      );
  }

  let info: YTMusic.TrackInfo | YT.VideoInfo = await yt.music.getInfo(id);

  if (!info) {
    throw new Error(
      t('plugins.downloader.backend.feedback.video-id-not-found'),
    );
  }

  const metadata = getMetadata(info);
  if (metadata.album === 'N/A') {
    metadata.album = '';
  }

  metadata.trackId = trackId;

  const dir = playlistFolder || getFolder(config.downloadFolder);
  const name = `${metadata.artist ? `${metadata.artist} - ` : ''}${
    metadata.title
  }`;
  setName(name);

  let playabilityStatus = info.playability_status;
  let bypassedResult: YT.VideoInfo;
  if (playabilityStatus?.status === 'LOGIN_REQUIRED') {
    // LOGIN_REQUIRED here means an age gate, which the TV client skips.
    bypassedResult = await getAndroidTvInfo(id);
    playabilityStatus = bypassedResult.playability_status;

    if (playabilityStatus?.status === 'LOGIN_REQUIRED') {
      throw new Error(
        `[${playabilityStatus.status}] ${playabilityStatus.reason}`,
      );
    }

    info = bypassedResult;
  }

  if (playabilityStatus?.status === 'UNPLAYABLE') {
    const errorScreen =
      playabilityStatus.error_screen as YTNodes.PlayerErrorMessage | null;
    throw new Error(
      `[${playabilityStatus.status}] ${errorScreen?.reason.text}: ${errorScreen?.subreason.text}`,
    );
  }

  const selectedPreset = config.selectedPreset ?? 'mp3 (256kbps)';
  let presetSetting: Preset;
  if (selectedPreset === 'Custom') {
    presetSetting = config.customPresetSetting ?? DefaultPresetList['Custom'];
  } else if (selectedPreset === 'Source') {
    presetSetting = DefaultPresetList['Source'];
  } else {
    presetSetting = DefaultPresetList['mp3 (256kbps)'];
  }

  const downloadOptions: Types.FormatOptions = {
    type: (await isPremium(win)) ? 'audio' : 'video+audio', // Audio, video or video+audio
    quality: 'best', // Best, bestefficiency, 144p, 240p, 480p, 720p and so on.
    format: 'any', // Media container format
  };

  const format = info.chooseFormat(downloadOptions);

  // ffmpeg picks its muxer from the extension, and `m4a`/`mp4` are one container.
  const sourceContainer =
    VideoFormatList.find((it) => it.itag === format.itag)?.container ??
    format.mime_type.split(';')[0]?.split('/')[1]?.trim().toLowerCase();
  const targetFileExtension =
    presetSetting?.extension ?? sourceContainer ?? 'mp3';
  const sameContainer =
    sourceContainer !== undefined &&
    (sourceContainer === 'm4a' ? 'mp4' : sourceContainer) ===
      (targetFileExtension === 'm4a' ? 'mp4' : targetFileExtension);

  let filename = filenamify(`${name}.${targetFileExtension}`, {
    replacement: '_',
    maxLength: 255,
  });
  if (!is.macOS()) {
    filename = filename.normalize('NFC');
  }
  const filePath = join(dir, filename);

  if (
    config.skipExisting &&
    (await access(filePath).then(
      () => true,
      () => false,
    ))
  ) {
    resetFeedback();
    return;
  }

  await mkdir(dir, { recursive: true });

  console.info(
    t('plugins.downloader.backend.feedback.download-info', {
      artist: metadata.artist,
      title: metadata.title,
      videoId: metadata.videoId,
    }),
  );

  // Download outside the mutex: only the conversion has to run one at a time.
  const tempBase = `.pear-${randomBytes(8).toString('hex')}`;
  const downloadPath = join(dir, `${tempBase}.${sourceContainer ?? 'source'}`);
  const convertedPath = join(dir, `${tempBase}.${targetFileExtension}`);

  let outputPath = downloadPath;
  try {
    await streamDownload(
      info,
      downloadOptions,
      format.content_length ?? 0,
      downloadPath,
      reportDownloadProgress,
    );

    const ffmpegArgs = presetSetting?.ffmpegArgs ?? [];
    const needsConversion = ffmpegArgs.length > 0 || !sameContainer;

    if (needsConversion && ffmpegMissing && !sameContainer) {
      throw new Error(t('plugins.downloader.backend.feedback.ffmpeg-missing'));
    }

    if (needsConversion && !ffmpegMissing) {
      sendPhase(t('plugins.downloader.backend.feedback.converting'), 0.15);
      const outcome = await ffmpegMutex.runExclusive(() =>
        runDownloadJob(
          {
            inputPath: downloadPath,
            outputPath: convertedPath,
            convert: {
              args: [...ffmpegArgs, ...getFFmpegMetadataArgs(metadata)],
              durationSeconds: metadata.songDuration ?? 0,
            },
            tags: null,
          },
          reportConversionProgress,
        ),
      );

      if (outcome.ok) {
        outputPath = convertedPath;
      } else if (outcome.code === 'ffmpeg-not-found') {
        noteMissingFfmpeg();
        // The download already is the requested container: keep it, unconverted.
        if (!sameContainer) {
          throw new Error(
            t('plugins.downloader.backend.feedback.ffmpeg-missing'),
          );
        }
      } else {
        throw new Error(outcome.message);
      }
    }

    // Tags are best effort and never cost the file: a failure still renames.
    if (targetFileExtension === 'mp3') {
      sendPhase(t('plugins.downloader.backend.feedback.writing-id3'));
      const outcome = await runDownloadJob({
        inputPath: outputPath,
        outputPath,
        convert: null,
        tags: await getTagPayload(metadata),
      });
      if (!outcome.ok || outcome.tagError) {
        console.warn(
          `Could not write ID3 tags for ${metadata.artist} - ${metadata.title}`,
          outcome.ok ? outcome.tagError : outcome.message,
        );
      }
    }

    await rm(filePath, { force: true });
    await rename(outputPath, filePath);
    outputPath = filePath;
  } finally {
    if (outputPath !== filePath) {
      await rm(outputPath, { force: true }).catch(() => {});
    }
    await rm(downloadPath, { force: true }).catch(() => {});
    // A failed conversion can leave a half-written file behind; the download
    // path and the final file are cleaned above, but not this one.
    await rm(convertedPath, { force: true }).catch(() => {});
  }

  increasePlaylistProgress(1);
  resetFeedback();
  console.info(
    t('plugins.downloader.backend.feedback.done', {
      filePath,
    }),
  );
}

/** Streams the track straight to `downloadPath`, never through a buffer. */
async function streamDownload(
  info: YT.VideoInfo | YTMusic.TrackInfo,
  downloadOptions: Types.FormatOptions,
  contentLength: number,
  downloadPath: string,
  onProgress: (ratio: number) => void,
) {
  const stream = await info.download(downloadOptions);
  const iterableStream = Utils.streamToIterable(stream);

  let downloaded = 0;
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloaded += chunk.length;
      // contentLength can be 0 or missing for some formats: avoid Infinity/NaN.
      onProgress(contentLength > 0 ? downloaded / contentLength : 0);
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.from(iterableStream),
    progress,
    createWriteStream(downloadPath),
  );
}

async function getTagPayload(metadata: CustomSongInfo): Promise<TagPayload> {
  let coverPng: Uint8Array | undefined;
  try {
    coverPng = (await getCoverBuffer(metadata.imageSrc ?? '')) ?? undefined;
  } catch (error: unknown) {
    console.warn('Could not load cover art for ID3 tags', error);
  }

  return {
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album || undefined,
    trackNumber: metadata.trackId,
    coverPng,
  };
}

const getCoverBuffer = async (url: string) => {
  const nativeImage = cropMaxWidth(await getImage(url));
  return nativeImage && !nativeImage.isEmpty() ? nativeImage.toPNG() : null;
};

export async function downloadPlaylist(givenUrl?: string | URL) {
  try {
    await ensureInitialized();
  } catch (error: unknown) {
    sendError(error as Error);
    return;
  }

  try {
    givenUrl = new URL(givenUrl ?? '');
  } catch {
    givenUrl = new URL(win.webContents.getURL());
  }

  const playlistId =
    getPlaylistID(givenUrl) ||
    (playingUrl ? getPlaylistID(new URL(playingUrl)) : undefined);

  if (!playlistId) {
    sendError(
      new Error(t('plugins.downloader.backend.feedback.playlist-id-not-found')),
    );
    return;
  }

  const sendFeedback = (message?: unknown) => sendFeedback_(win, message);

  // Cap the playlist before the first download; continuations are skipped once
  // the cap is reached instead of paging the whole playlist in.
  const maxItems = config.playlistMaxItems;
  const itemLimit = maxItems && maxItems > 0 ? maxItems : Infinity;

  console.log(
    t('plugins.downloader.backend.feedback.trying-to-get-playlist-id', {
      playlistId,
    }),
  );
  sendFeedback(t('plugins.downloader.backend.feedback.getting-playlist-info'));
  let playlist: YTMusic.Playlist;
  const items: YTNodes.MusicResponsiveListItem[] = [];
  try {
    playlist = await yt.music.getPlaylist(playlistId);
    if (playlist?.items) {
      const filteredItems = playlist.items.filter(
        (item): item is YTNodes.MusicResponsiveListItem =>
          item instanceof YTNodes.MusicResponsiveListItem,
      );

      items.push(...filteredItems);
    }
  } catch (error: unknown) {
    sendError(
      Error(
        t('plugins.downloader.backend.feedback.playlist-is-mix-or-private', {
          error: String(error),
        }),
      ),
    );
    return;
  }

  if (!playlist || !playlist.items || playlist.items.length === 0) {
    sendError(
      new Error(t('plugins.downloader.backend.feedback.playlist-is-empty')),
    );
    return;
  }

  const normalPlaylistTitle =
    playlist.header && 'title' in playlist.header
      ? playlist.header?.title?.text
      : undefined;
  const playlistTitle =
    normalPlaylistTitle ??
    playlist.page.contents_memo
      ?.get('MusicResponsiveListItemFlexColumn')
      ?.at(2)
      ?.as(YTNodes.MusicResponsiveListItemFlexColumn)?.title?.text ??
    'NO_TITLE';
  const isAlbum = !normalPlaylistTitle;

  while (playlist.has_continuation && items.length < itemLimit) {
    playlist = await playlist.getContinuation();

    const filteredItems = playlist.items.filter(
      (item): item is YTNodes.MusicResponsiveListItem =>
        item instanceof YTNodes.MusicResponsiveListItem,
    );

    items.push(...filteredItems);
  }

  if (items.length > itemLimit) {
    items.length = itemLimit;
  }

  if (items.length === 1) {
    sendFeedback(
      t('plugins.downloader.backend.feedback.playlist-has-only-one-song'),
    );
    await downloadSongFromId(items.at(0)!.id!);
    return;
  }

  let safePlaylistTitle = filenamify(playlistTitle, { replacement: ' ' });
  if (!is.macOS()) {
    safePlaylistTitle = safePlaylistTitle.normalize('NFC');
  }

  const folder = getFolder(config.downloadFolder);
  const playlistFolder = join(folder, safePlaylistTitle);
  const playlistFolderExists = await access(playlistFolder).then(
    () => true,
    () => false,
  );
  if (playlistFolderExists) {
    if (!config.skipExisting) {
      sendError(
        new Error(
          t('plugins.downloader.backend.feedback.folder-already-exists', {
            playlistFolder,
          }),
        ),
      );
      return;
    }
  } else {
    await mkdir(playlistFolder, { recursive: true });
  }

  dialog.showMessageBox(win, {
    type: 'info',
    buttons: [
      t('plugins.downloader.backend.dialog.start-download-playlist.buttons.ok'),
    ],
    title: t('plugins.downloader.backend.dialog.start-download-playlist.title'),
    message: t(
      'plugins.downloader.backend.dialog.start-download-playlist.message',
      {
        playlistTitle,
      },
    ),
    detail: t(
      'plugins.downloader.backend.dialog.start-download-playlist.detail',
      {
        playlistSize: items.length,
      },
    ),
  });

  if (is.dev()) {
    console.log(
      t('plugins.downloader.backend.feedback.downloading-playlist', {
        playlistTitle,
        playlistSize: items.length,
        playlistId,
      }),
    );
  }

  win.setProgressBar(2); // Starts with indefinite bar

  setBadge(items.length);

  let counter = 1;

  const progressStep = 1 / items.length;

  const increaseProgress = (itemPercentage: number) => {
    const currentProgress = (counter - 1) / (items.length ?? 1);
    const newProgress = currentProgress + progressStep * itemPercentage;
    win.setProgressBar(newProgress);
  };

  try {
    for (const song of items) {
      sendFeedback(
        t('plugins.downloader.backend.feedback.downloading-counter', {
          current: counter,
          total: items.length,
        }),
      );
      const trackId = isAlbum ? counter : undefined;
      await downloadSongFromId(
        song.id!,
        playlistFolder,
        trackId?.toString(),
        increaseProgress,
      ).catch((error) =>
        sendError(
          new Error(
            t('plugins.downloader.backend.feedback.error-while-downloading', {
              author: song.author!.name,
              title: song.title!,
              error: String(error),
            }),
          ),
        ),
      );

      win.setProgressBar(counter / items.length);
      setBadge(items.length - counter);
      counter++;
    }
  } catch (error: unknown) {
    sendError(error as Error);
  } finally {
    win.setProgressBar(-1); // Close progress bar
    setBadge(0); // Close badge counter
    sendFeedback(); // Clear feedback
  }
}

function getFFmpegMetadataArgs(metadata: CustomSongInfo) {
  if (!metadata) {
    return [];
  }

  return [
    ...(metadata.title ? ['-metadata', `title=${metadata.title}`] : []),
    ...(metadata.artist ? ['-metadata', `artist=${metadata.artist}`] : []),
    ...(metadata.album ? ['-metadata', `album=${metadata.album}`] : []),
    ...(metadata.trackId ? ['-metadata', `track=${metadata.trackId}`] : []),
  ];
}

// Radio modifier that has to be stripped off a playlist ID.
const INVALID_PLAYLIST_MODIFIER = 'RDAMPL';

const getPlaylistID = (aURL?: URL): string | null | undefined => {
  const result =
    aURL?.searchParams.get('list') || aURL?.searchParams.get('playlist');
  if (result?.startsWith(INVALID_PLAYLIST_MODIFIER)) {
    return result.slice(INVALID_PLAYLIST_MODIFIER.length);
  }

  return result;
};

const getVideoId = (url: URL | string): string | null => {
  const parsedUrl = URL.parse(url);
  if (!parsedUrl) return null;
  return parsedUrl.searchParams.get('v');
};

const getMetadata = (info: YTMusic.TrackInfo): CustomSongInfo => ({
  videoId: info.basic_info.id!,
  title: cleanupName(info.basic_info.title!),
  artist: cleanupName(info.basic_info.author!),
  album: info.player_overlays?.browser_media_session?.as(
    YTNodes.BrowserMediaSession,
  ).album?.text,
  imageSrc: info.basic_info.thumbnail?.find((t) => !t.url.endsWith('.webp'))
    ?.url,
  views: info.basic_info.view_count!,
  songDuration: info.basic_info.duration!,
  mediaType: MediaType.Audio,
});

// TV_EMBEDDED bypasses age restrictions. getInfo 404s with it, so getBasicInfo
// is used instead — only the streaming data is needed.
const getAndroidTvInfo = async (id: string): Promise<YT.VideoInfo> => {
  return await yt.getBasicInfo(id, {
    client: 'TV_EMBEDDED',
  });
};
