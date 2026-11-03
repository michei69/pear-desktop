import { ipcMain, nativeTheme, type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
  unregisterCallback,
} from '@/providers/song-info';
import { LikeType } from '@/types/datahost-get-state';
import { Platform } from '@/types/plugins';
import {
  SONG_INFO_SETUP_CHANNEL,
  SongInfoEventFlag,
} from '@/types/song-info-events';
import { createPlugin } from '@/utils';

import { getImages, type ThumbarImages } from './images';

type TaskbarState = {
  window: BrowserWindow | null;
  currentSongInfo: SongInfo | undefined;
  currentLikeStatus: LikeType;
  images: ThumbarImages | undefined;
  lastThumbarImages: ThumbarImages | undefined;
  lastThumbarPaused: boolean | undefined;
  lastThumbarLikeStatus: LikeType | undefined;
  themeListener: (() => void) | null;
  likeChangedListener:
    | ((_: Electron.IpcMainEvent, status: LikeType) => void)
    | null;
  songInfoCallback: ((songInfo: SongInfo, event: SongInfoEvent) => void) | null;
  showListener: (() => void) | null;
};

export default createPlugin<
  TaskbarState,
  unknown,
  unknown,
  { enabled: boolean }
>({
  name: () => t('plugins.taskbar-mediacontrol.name'),
  description: () => t('plugins.taskbar-mediacontrol.description'),
  restartNeeded: true,
  platform: Platform.Windows,
  config: {
    enabled: false,
  },

  backend: {
    window: null,
    currentSongInfo: undefined,
    currentLikeStatus: LikeType.Indifferent,
    images: undefined,
    lastThumbarImages: undefined,
    lastThumbarPaused: undefined,
    lastThumbarLikeStatus: undefined,
    themeListener: null,
    likeChangedListener: null,
    songInfoCallback: null,
    showListener: null,

    start({ window }) {
      this.window = window;
      this.currentSongInfo = undefined;
      this.currentLikeStatus = LikeType.Indifferent;
      this.images = getImages();
      this.lastThumbarImages = undefined;
      this.lastThumbarPaused = undefined;
      this.lastThumbarLikeStatus = undefined;

      const { playPause, next, previous, like, dislike } =
        getSongControls(window);

      const setThumbar = (songInfo: SongInfo | undefined, force = false) => {
        if (!songInfo?.title || !this.images) return;
        if (window.isDestroyed()) return;

        const images = this.images;
        const isPaused = songInfo.isPaused ?? false;

        if (
          !force &&
          this.lastThumbarImages === images &&
          this.lastThumbarPaused === isPaused &&
          this.lastThumbarLikeStatus === this.currentLikeStatus
        ) {
          return;
        }
        this.lastThumbarImages = images;
        this.lastThumbarPaused = isPaused;
        this.lastThumbarLikeStatus = this.currentLikeStatus;

        window.setThumbarButtons([
          {
            tooltip: t('plugins.taskbar-mediacontrol.tooltip.dislike'),
            icon:
              this.currentLikeStatus === LikeType.Dislike
                ? images.dislike
                : images.dislikeHollow,
            click() {
              dislike();
            },
          },
          {
            tooltip: t('plugins.taskbar-mediacontrol.tooltip.previous'),
            icon: images.previous,
            click() {
              previous();
            },
          },
          {
            tooltip: t('plugins.taskbar-mediacontrol.tooltip.play-pause'),
            icon: isPaused ? images.play : images.pause,
            click() {
              playPause();
            },
          },
          {
            tooltip: t('plugins.taskbar-mediacontrol.tooltip.next'),
            icon: images.next,
            click() {
              next();
            },
          },
          {
            tooltip: t('plugins.taskbar-mediacontrol.tooltip.like'),
            icon:
              this.currentLikeStatus === LikeType.Like
                ? images.like
                : images.likeHollow,
            click() {
              like();
            },
          },
        ]);
      };

      this.themeListener = () => {
        this.images = getImages();
        setThumbar(this.currentSongInfo);
      };
      nativeTheme.on('updated', this.themeListener);

      window.webContents.send(
        SONG_INFO_SETUP_CHANNEL,
        SongInfoEventFlag.LikeChanged,
      );

      this.likeChangedListener = (_, status) => {
        this.currentLikeStatus = status;
        setThumbar(this.currentSongInfo);
      };
      ipcMain.on('peard:like-changed', this.likeChangedListener);

      this.songInfoCallback = (songInfo, event) => {
        if (event === SongInfoEvent.TimeChanged) return;
        this.currentSongInfo = songInfo;
        setThumbar(songInfo);
      };
      registerCallback(this.songInfoCallback);

      this.showListener = () => setThumbar(this.currentSongInfo, true);
      window.on('show', this.showListener);
    },

    stop({ window }) {
      if (this.themeListener) {
        nativeTheme.off('updated', this.themeListener);
        this.themeListener = null;
      }
      if (this.likeChangedListener) {
        ipcMain.off('peard:like-changed', this.likeChangedListener);
        this.likeChangedListener = null;
      }
      if (this.songInfoCallback) {
        unregisterCallback(this.songInfoCallback);
        this.songInfoCallback = null;
      }
      if (this.showListener) {
        window.off('show', this.showListener);
        this.showListener = null;
      }
      if (!window.isDestroyed()) {
        window.setThumbarButtons([]);
      }

      this.window = null;
      this.currentSongInfo = undefined;
      this.images = undefined;
      this.lastThumbarImages = undefined;
      this.lastThumbarPaused = undefined;
      this.lastThumbarLikeStatus = undefined;
    },
  },
});
