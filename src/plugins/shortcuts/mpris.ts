import MprisPlayer, {
  type LoopStatus,
  type PlayBackStatus,
  type PlayerOptions,
  type Position,
  type Track,
} from '@jellybrick/mpris-service';
import { type BrowserWindow, ipcMain } from 'electron';

import * as config from '@/config';
import { APPLICATION_NAME } from '@/i18n';
import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  unregisterCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import {
  SONG_INFO_SETUP_CHANNEL,
  SongInfoEventFlag,
} from '@/types/song-info-events';
import { LoggerPrefix } from '@/utils';

import type { RepeatMode, VolumeState } from '@/types/datahost-get-state';
import type { GetPlayerResponse } from '@/types/get-player-response';
import type { QueueResponse } from '@/types/music-player-desktop-internal';

class YTPlayer extends MprisPlayer {
  /** Current position in microseconds. */
  private currentPosition: number = 0;
  canUsePlayerControls: boolean = false;

  constructor(opts: PlayerOptions) {
    super(opts);
  }

  setPosition(t: number) {
    this.currentPosition = t;
  }

  override getPosition(): number {
    return this.currentPosition;
  }

  setLoopStatus(status: LoopStatus) {
    this.loopStatus = status;
  }

  isPlaying(): boolean {
    return this.playbackStatus === MprisPlayer.PLAYBACK_STATUS_PLAYING;
  }

  isPaused(): boolean {
    return this.playbackStatus === MprisPlayer.PLAYBACK_STATUS_PAUSED;
  }

  isStopped(): boolean {
    return this.playbackStatus === MprisPlayer.PLAYBACK_STATUS_STOPPED;
  }

  setPlaybackStatus(status: PlayBackStatus) {
    this.playbackStatus = status;
  }
}

function setupMPRIS() {
  const instance = new YTPlayer({
    name: '\u0059\u006f\u0075\u0074\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063',
    identity: APPLICATION_NAME,
    supportedMimeTypes: ['audio/mpeg'],
    supportedInterfaces: ['player'],
  });

  instance.canRaise = true;
  instance.canQuit = false;
  instance.canUsePlayerControls = true;
  instance.supportedUriSchemes = ['http', 'https'];
  instance.desktopEntry =
    '\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063';
  return instance;
}

let teardownMPRIS: (() => void) | undefined;

/** Detaches every handler the last `registerMPRIS` installed. */
export const unregisterMPRIS = () => {
  teardownMPRIS?.();
};

export function registerMPRIS(win: BrowserWindow) {
  // Re-activation must replace the previous registration instead of stacking a
  // second set of handlers on the same channels.
  teardownMPRIS?.();
  teardownMPRIS = undefined;

  const songControls = getSongControls(win);
  const {
    playPause,
    next,
    previous,
    setVolume,
    shuffle,
    switchRepeat,
    setFullscreen,
    requestShuffleInformation,
    requestFullscreenInformation,
    requestQueueInformation,
  } = songControls;
  try {
    let currentSongInfo: SongInfo | null = null;
    const secToMicro = (n: number) => Math.round(Number(n) * 1e6);
    const microToSec = (n: number) => Math.round(Number(n) / 1e6);

    const correctId = (videoId: string) => {
      return videoId.replace(/-/g, '_MINUS_');
    };

    const player = setupMPRIS();
    let pendingArtwork: { videoId: string; url?: string } | null = null;

    // SongInfo waits for artwork validation and native image decoding. Publish
    // the remote artwork URL now so MPRIS clients can fetch it in parallel.
    const onVideoSrcChanged = (
      _: Electron.IpcMainEvent,
      data: GetPlayerResponse,
    ) => {
      const video = data.videoDetails;
      if (!video?.videoId) {
        pendingArtwork = null;
        return;
      }

      const artUrl = video.thumbnail?.thumbnails?.at(-1)?.url;
      pendingArtwork = { videoId: video.videoId, url: artUrl };
      // Lives have no meaningful length; never publish NaN over D-Bus.
      const lengthSeconds = Number(video.lengthSeconds);
      player.metadata = {
        ...(Number.isFinite(lengthSeconds)
          ? { 'mpris:length': secToMicro(lengthSeconds) }
          : undefined),
        ...(artUrl ? { 'mpris:artUrl': artUrl } : undefined),
        'xesam:title': video.title,
        'xesam:artist': [video.author],
        'mpris:trackid': player.objectPath(`Track/${correctId(video.videoId)}`),
      };
    };
    ipcMain.on('peard:video-src-changed', onVideoSrcChanged);

    const seekTo = (event: Position) => {
      if (
        currentSongInfo?.videoId &&
        event.trackId.endsWith(correctId(currentSongInfo.videoId))
      ) {
        win.webContents.send('peard:seek-to', microToSec(event.position ?? 0));
        player.setPosition(event.position ?? 0);
      }
    };
    const seekBy = (offset: number) => {
      win.webContents.send('peard:seek-by', microToSec(offset));
      player.setPosition(player.getPosition() + offset);
    };

    const onPlayerApiLoaded = (_: Electron.IpcMainEvent) => {
      win.webContents.send(
        SONG_INFO_SETUP_CHANNEL,
        SongInfoEventFlag.Seeked |
          SongInfoEventFlag.TimeChanged |
          SongInfoEventFlag.RepeatChanged |
          SongInfoEventFlag.VolumeChanged |
          SongInfoEventFlag.ShuffleChanged |
          SongInfoEventFlag.FullscreenChanged |
          SongInfoEventFlag.AutoPlayChanged,
      );
      requestShuffleInformation();
      requestFullscreenInformation();
      requestQueueInformation();
    };
    ipcMain.on('peard:player-api-loaded', onPlayerApiLoaded);

    const onSeeked = (_: Electron.IpcMainEvent, t: number) => {
      player.setPosition(secToMicro(t));
      player.seeked(secToMicro(t));
    };
    ipcMain.on('peard:seeked', onSeeked);

    const onRepeatChanged = (_: Electron.IpcMainEvent, mode: RepeatMode) => {
      switch (mode) {
        case 'NONE': {
          player.setLoopStatus(MprisPlayer.LOOP_STATUS_NONE);
          break;
        }
        case 'ONE': {
          player.setLoopStatus(MprisPlayer.LOOP_STATUS_TRACK);
          break;
        }
        case 'ALL': {
          player.setLoopStatus(MprisPlayer.LOOP_STATUS_PLAYLIST);
          // No default
          break;
        }
      }
      requestQueueInformation();
    };
    ipcMain.on('peard:repeat-changed', onRepeatChanged);

    const onShuffleChanged = (
      _: Electron.IpcMainEvent,
      shuffleEnabled: boolean,
    ) => {
      if (player.shuffle === undefined || !player.canUsePlayerControls) {
        return;
      }

      player.shuffle = shuffleEnabled ?? !player.shuffle;
    };
    ipcMain.on('peard:shuffle-changed', onShuffleChanged);

    const onFullscreenChanged = (
      _: Electron.IpcMainEvent,
      changedTo: boolean,
    ) => {
      if (player.fullscreen === undefined || !player.canUsePlayerControls) {
        return;
      }

      player.fullscreen =
        changedTo !== undefined ? changedTo : !player.fullscreen;
    };
    ipcMain.on('peard:fullscreen-changed', onFullscreenChanged);

    const onSetFullscreen = (
      _: Electron.IpcMainEvent,
      isFullscreen: boolean | undefined,
    ) => {
      if (!player.canUsePlayerControls || isFullscreen === undefined) {
        return;
      }

      player.fullscreen = isFullscreen;
    };
    ipcMain.on('peard:set-fullscreen', onSetFullscreen);

    const onFullscreenChangedSupported = (
      _: Electron.IpcMainEvent,
      isFullscreenSupported: boolean,
    ) => {
      player.canUsePlayerControls = isFullscreenSupported;
    };
    ipcMain.on(
      'peard:fullscreen-changed-supported',
      onFullscreenChangedSupported,
    );

    const onAutoplayChanged = (_: Electron.IpcMainEvent) => {
      requestQueueInformation();
    };
    ipcMain.on('peard:autoplay-changed', onAutoplayChanged);

    const onGetQueueResponse = (
      _: Electron.IpcMainEvent,
      queue: QueueResponse,
    ) => {
      if (!queue) {
        return;
      }

      const currentPosition =
        queue.items?.findIndex(
          (it) =>
            it?.playlistPanelVideoRenderer?.selected ||
            it?.playlistPanelVideoWrapperRenderer?.primaryRenderer
              ?.playlistPanelVideoRenderer?.selected,
        ) ?? 0;
      player.canGoPrevious = currentPosition !== 0;

      let hasNext: boolean;
      if (queue.autoPlaying) {
        hasNext = true;
      } else if (player.loopStatus === MprisPlayer.LOOP_STATUS_PLAYLIST) {
        hasNext = true;
      } else {
        // e.g. position 0 with 29 queued items still has a next track
        hasNext = !!(currentPosition - ((queue?.items?.length ?? 0) - 1));
      }

      player.canGoNext = hasNext;
    };
    ipcMain.on('peard:get-queue-response', onGetQueueResponse);

    player.on('loopStatus', (status: LoopStatus) => {
      // Order matters: switchRepeat steps through these in sequence.
      const switches = [
        MprisPlayer.LOOP_STATUS_NONE,
        MprisPlayer.LOOP_STATUS_PLAYLIST,
        MprisPlayer.LOOP_STATUS_TRACK,
      ];
      const currentIndex = switches.indexOf(player.loopStatus);
      const targetIndex = switches.indexOf(status);

      // Steps forward, in the range [0,2]
      const delta = (targetIndex - currentIndex + 3) % 3;
      switchRepeat(delta);
    });

    player.on('raise', () => {
      if (!player.canRaise) {
        return;
      }

      win.setSkipTaskbar(false);
      win.show();
    });

    player.on('fullscreen', (fullscreenEnabled: boolean) => {
      setFullscreen(fullscreenEnabled);
    });

    player.on('play', () => {
      if (!player.isPlaying()) {
        player.setPlaybackStatus(MprisPlayer.PLAYBACK_STATUS_PLAYING);
        playPause();
      }
    });
    player.on('pause', () => {
      if (!player.isPaused()) {
        player.setPlaybackStatus(MprisPlayer.PLAYBACK_STATUS_PAUSED);
        playPause();
      }
    });
    player.on('playpause', () => {
      player.setPlaybackStatus(
        player.isPlaying()
          ? MprisPlayer.PLAYBACK_STATUS_PAUSED
          : MprisPlayer.PLAYBACK_STATUS_PLAYING,
      );
      playPause();
    });

    player.on('next', () => {
      next();
    });

    player.on('previous', () => {
      previous();
    });

    player.on('seek', seekBy);
    player.on('position', seekTo);

    player.on('shuffle', (enableShuffle) => {
      if (!player.canUsePlayerControls || enableShuffle === undefined) {
        return;
      }

      player.shuffle = enableShuffle;

      if (enableShuffle) {
        shuffle();
        requestQueueInformation();
      }
    });
    player.on('open', (args: { uri: string }) => {
      win.loadURL(args.uri).then(() => {
        requestQueueInformation();
      });
    });

    player.on('error', (error: Error) => {
      console.error(LoggerPrefix, 'Error in MPRIS');
      console.trace(error);
    });

    const onVolumeChanged = (
      _: Electron.IpcMainEvent,
      newVolumeState: VolumeState,
    ) => {
      player.volume = newVolumeState.isMuted
        ? 0
        : Number.parseFloat((newVolumeState.state / 100).toFixed(2));
    };
    ipcMain.on('peard:volume-changed', onVolumeChanged);

    player.on('volume', async (newVolume: number) => {
      if (await config.plugins.isEnabled('precise-volume')) {
        // Precise volume takes an exact value.
        win.webContents.send('setVolume', ~~(newVolume * 100));
      } else {
        setVolume(newVolume * 100);
      }
    });

    const onSongInfo = (songInfo: SongInfo, event: SongInfoEvent) => {
      if (event === SongInfoEvent.TimeChanged) {
        player.setPosition(secToMicro(songInfo.elapsedSeconds ?? 0));
        return;
      }
      if (player) {
        if (
          event === SongInfoEvent.VideoSrcChanged &&
          pendingArtwork &&
          songInfo.videoId !== pendingArtwork.videoId
        ) {
          return;
        }

        const artUrl =
          pendingArtwork?.videoId === songInfo.videoId
            ? pendingArtwork.url
            : songInfo.imageSrc;
        const songDuration = Number(songInfo.songDuration);
        const data: Track = {
          ...(Number.isFinite(songDuration)
            ? { 'mpris:length': secToMicro(songDuration) }
            : undefined),
          ...(artUrl ? { 'mpris:artUrl': artUrl } : undefined),
          'xesam:title': songInfo.title,
          'xesam:url': songInfo.url,
          'xesam:artist': [songInfo.artist],
          'mpris:trackid': player.objectPath(
            `Track/${correctId(songInfo.videoId)}`,
          ),
        };
        if (songInfo.album) {
          data['xesam:album'] = songInfo.album;
        }
        currentSongInfo = songInfo;

        player.metadata = data;

        const currentElapsedMicroSeconds = secToMicro(
          songInfo.elapsedSeconds ?? 0,
        );
        player.setPosition(currentElapsedMicroSeconds);
        player.seeked(currentElapsedMicroSeconds);

        player.setPlaybackStatus(
          songInfo.isPaused
            ? MprisPlayer.PLAYBACK_STATUS_PAUSED
            : MprisPlayer.PLAYBACK_STATUS_PLAYING,
        );
      }
      requestQueueInformation();
    };
    registerCallback(onSongInfo);

    // Every handler is registered with raw `ipcMain`, so removal has to target
    // the same instance and the exact references registered above.
    teardownMPRIS = () => {
      ipcMain.removeListener('peard:video-src-changed', onVideoSrcChanged);
      ipcMain.removeListener('peard:player-api-loaded', onPlayerApiLoaded);
      ipcMain.removeListener('peard:seeked', onSeeked);
      ipcMain.removeListener('peard:repeat-changed', onRepeatChanged);
      ipcMain.removeListener('peard:shuffle-changed', onShuffleChanged);
      ipcMain.removeListener('peard:fullscreen-changed', onFullscreenChanged);
      ipcMain.removeListener('peard:set-fullscreen', onSetFullscreen);
      ipcMain.removeListener(
        'peard:fullscreen-changed-supported',
        onFullscreenChangedSupported,
      );
      ipcMain.removeListener('peard:autoplay-changed', onAutoplayChanged);
      ipcMain.removeListener('peard:get-queue-response', onGetQueueResponse);
      ipcMain.removeListener('peard:volume-changed', onVolumeChanged);
      unregisterCallback(onSongInfo);
      // mpris-service keeps its bus private and offers no close method; drop
      // the connection so a re-registration can own the service name again.
      const bus: unknown = Reflect.get(player, '_bus');
      if (bus && typeof bus === 'object' && 'disconnect' in bus) {
        const disconnect = bus.disconnect;
        if (typeof disconnect === 'function') disconnect.call(bus);
      }
      // Keep the 'error' listener: a bus error can still surface after
      // disconnect, and an unhandled 'error' event would throw.
      const playerEvents = [
        'loopStatus',
        'raise',
        'fullscreen',
        'play',
        'pause',
        'playpause',
        'next',
        'previous',
        'seek',
        'position',
        'shuffle',
        'open',
        'volume',
      ] as const;
      for (const event of playerEvents) player.removeAllListeners(event);
      teardownMPRIS = undefined;
    };
  } catch (error) {
    console.error(LoggerPrefix, 'Error in MPRIS');
    console.trace(error);
  }
}
