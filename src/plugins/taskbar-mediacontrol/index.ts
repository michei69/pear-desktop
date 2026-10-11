import dislikeHollowIconBlack from '@assets/media-icons-black/dislike-hollow.png?asset&asarUnpack';
import dislikeIconBlack from '@assets/media-icons-black/dislike.png?asset&asarUnpack';
import likeHollowIconBlack from '@assets/media-icons-black/like-hollow.png?asset&asarUnpack';
import likeIconBlack from '@assets/media-icons-black/like.png?asset&asarUnpack';
import nextIconBlack from '@assets/media-icons-black/next.png?asset&asarUnpack';
import pauseIconBlack from '@assets/media-icons-black/pause.png?asset&asarUnpack';
import playIconBlack from '@assets/media-icons-black/play.png?asset&asarUnpack';
import previousIconBlack from '@assets/media-icons-black/previous.png?asset&asarUnpack';
import dislikeHollowIconWhite from '@assets/media-icons-white/dislike-hollow.png?asset&asarUnpack';
import dislikeIconWhite from '@assets/media-icons-white/dislike.png?asset&asarUnpack';
import likeHollowIconWhite from '@assets/media-icons-white/like-hollow.png?asset&asarUnpack';
import likeIconWhite from '@assets/media-icons-white/like.png?asset&asarUnpack';
import nextIconWhite from '@assets/media-icons-white/next.png?asset&asarUnpack';
import pauseIconWhite from '@assets/media-icons-white/pause.png?asset&asarUnpack';
import playIconWhite from '@assets/media-icons-white/play.png?asset&asarUnpack';
import previousIconWhite from '@assets/media-icons-white/previous.png?asset&asarUnpack';
import { ipcMain, nativeImage, nativeTheme, type NativeImage } from 'electron';

import { t } from '@/i18n';
import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { LikeType } from '@/types/datahost-get-state';
import { Platform } from '@/types/plugins';
import { createPlugin } from '@/utils';

export default createPlugin({
  name: () => t('plugins.taskbar-mediacontrol.name'),
  description: () => t('plugins.taskbar-mediacontrol.description'),
  restartNeeded: true,
  platform: Platform.Windows,
  config: {
    enabled: false,
  },

  backend({ window }) {
    let currentSongInfo: SongInfo;
    let currentLikeStatus: LikeType = LikeType.Indifferent;

    const { playPause, next, previous, like, dislike } =
      getSongControls(window);

    const getImages = (): Record<
      | 'play'
      | 'pause'
      | 'next'
      | 'previous'
      | 'like'
      | 'dislike'
      | 'likeHollow'
      | 'dislikeHollow',
      NativeImage
    > => {
      const isDark = nativeTheme.shouldUseDarkColors;
      return {
        play: nativeImage.createFromPath(
          isDark ? playIconWhite : playIconBlack,
        ),
        pause: nativeImage.createFromPath(
          isDark ? pauseIconWhite : pauseIconBlack,
        ),
        next: nativeImage.createFromPath(
          isDark ? nextIconWhite : nextIconBlack,
        ),
        previous: nativeImage.createFromPath(
          isDark ? previousIconWhite : previousIconBlack,
        ),
        like: nativeImage.createFromPath(
          isDark ? likeIconWhite : likeIconBlack,
        ),
        dislike: nativeImage.createFromPath(
          isDark ? dislikeIconWhite : dislikeIconBlack,
        ),
        likeHollow: nativeImage.createFromPath(
          isDark ? likeHollowIconWhite : likeHollowIconBlack,
        ),
        dislikeHollow: nativeImage.createFromPath(
          isDark ? dislikeHollowIconWhite : dislikeHollowIconBlack,
        ),
      };
    };
    let images = getImages();

    nativeTheme.on('updated', () => {
      images = getImages();
      setThumbar(currentSongInfo);
    });

    const setThumbar = (songInfo: SongInfo) => {
      // Wait for the song to start.
      if (!songInfo?.title) {
        return;
      }

      // Win32 needs the whole component list rewritten.
      window.setThumbarButtons([
        {
          tooltip: 'Dislike',
          icon:
            currentLikeStatus === LikeType.Dislike
              ? images.dislike
              : images.dislikeHollow,
          click() {
            dislike(); // frontend toggles: re-disliking clears it
          },
        },
        {
          tooltip: 'Previous',
          icon: images.previous,
          click() {
            previous();
          },
        },
        {
          tooltip: 'Play/Pause',
          icon: songInfo.isPaused ? images.play : images.pause,
          click() {
            playPause();
          },
        },
        {
          tooltip: 'Next',
          icon: images.next,
          click() {
            next();
          },
        },
        {
          tooltip: 'Like',
          icon:
            currentLikeStatus === LikeType.Like
              ? images.like
              : images.likeHollow,
          click() {
            like(); // frontend toggles: re-liking clears it
          },
        },
      ]);
    };

    window.webContents.send('peard:setup-like-changed-listener');

    ipcMain.on('peard:like-changed', (_, status: LikeType) => {
      currentLikeStatus = status;
      if (currentSongInfo) {
        setThumbar(currentSongInfo);
      }
    });

    registerCallback((songInfo, event) => {
      if (event !== SongInfoEvent.TimeChanged) {
        currentSongInfo = songInfo; // kept for win.on('show')
        setThumbar(songInfo);
      }
    });

    // win.show() drops the thumbar, so it has to be set again.
    window.on('show', () => setThumbar(currentSongInfo));
  },
});
