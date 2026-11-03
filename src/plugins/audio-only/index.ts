import { t } from '@/i18n';
import { observePlayerPage } from '@/providers/player-page-observer';
import { createPlugin } from '@/utils';

import type { VideoDataChanged } from '@/types/video-data-changed';

type AudioOnlyConfig = {
  enabled: boolean;
};

export default createPlugin<
  unknown,
  unknown,
  {
    unwatchPlaybackMode: (() => void) | null;
    videoDataListener: ((e: Event) => void) | null;
    setAudioOnly: () => void;
    applyVisualMode: () => void;
    lockPlaybackMode: () => void;
    restorePlayerStyles: () => void;
  },
  AudioOnlyConfig
>({
  name: () => t('plugins.audio-only.name'),
  description: () => t('plugins.audio-only.description'),
  restartNeeded: true,
  config: {
    enabled: false,
  },
  renderer: {
    unwatchPlaybackMode: null,
    videoDataListener: null,

    start() {
      // Hide video element, show album art
      this.applyVisualMode();

      // Lock playback-mode so YouTube can never flip it back
      const player = document.querySelector<HTMLElement>('ytmusic-player');
      if (player) {
        player.setAttribute('playback-mode', 'ATV_PREFERRED');
        player.style.margin = 'auto 0px';
        this.lockPlaybackMode();
      }
    },

    onPlayerApiReady() {
      // The API can re-initialize, so drop the old listener instead of stacking.
      if (this.videoDataListener) {
        document.removeEventListener('videodatachange', this.videoDataListener);
      }

      this.setAudioOnly();

      this.videoDataListener = ((event: CustomEvent<VideoDataChanged>) => {
        if (event.detail.name === 'dataloaded') {
          this.setAudioOnly();
          this.applyVisualMode();
        }
      }) as EventListener;

      document.addEventListener('videodatachange', this.videoDataListener);
      console.log('[audio-only] Renderer audio-only mode active');
    },

    stop() {
      if (this.unwatchPlaybackMode) {
        this.unwatchPlaybackMode();
        this.unwatchPlaybackMode = null;
      }
      if (this.videoDataListener) {
        document.removeEventListener('videodatachange', this.videoDataListener);
        this.videoDataListener = null;
      }

      this.restorePlayerStyles();
    },

    setAudioOnly() {
      const player = document.querySelector<HTMLElement>('ytmusic-player');
      if (player) {
        player.setAttribute('playback-mode', 'ATV_PREFERRED');
        player.style.margin = 'auto 0px';
        // start() may have run before the player existed; the player API
        // ready hook is the other chance to become the attribute's owner.
        if (!this.unwatchPlaybackMode) {
          this.lockPlaybackMode();
        }
      }

      // Lowest quality triggers the audio-only path.
      try {
        const moviePlayer = document.querySelector<
          HTMLVideoElement & {
            setPlaybackQualityRange?: (quality: string) => void;
            setPlaybackQuality?: (quality: string) => void;
          }
        >('#movie_player');
        if (moviePlayer) {
          if (moviePlayer.setPlaybackQualityRange) {
            moviePlayer.setPlaybackQualityRange('tiny');
          }
          if (moviePlayer.setPlaybackQuality) {
            moviePlayer.setPlaybackQuality('tiny');
          }
        }
      } catch {
        /* ignore */
      }

      this.applyVisualMode();
    },

    applyVisualMode() {
      const songVideo = document.querySelector<HTMLElement>(
        '#song-video.ytmusic-player',
      );
      const songImage = document.querySelector<HTMLElement>('#song-image');
      if (songVideo) songVideo.style.display = 'none';
      if (songImage) songImage.style.display = 'block';

      const video = document.querySelector<HTMLVideoElement>('video');
      if (video) {
        video.style.display = 'none';
      }
    },

    restorePlayerStyles() {
      const player = document.querySelector<HTMLElement>('ytmusic-player');
      player?.removeAttribute('playback-mode');
      player?.style.removeProperty('margin');

      document
        .querySelector<HTMLElement>('#song-video.ytmusic-player')
        ?.style.removeProperty('display');
      document
        .querySelector<HTMLElement>('#song-image')
        ?.style.removeProperty('display');
      document
        .querySelector<HTMLVideoElement>('video')
        ?.style.removeProperty('display');
    },

    lockPlaybackMode() {
      this.unwatchPlaybackMode?.();
      // Prevent YouTube from overriding playback-mode back to OMV_PREFERRED
      this.unwatchPlaybackMode = observePlayerPage('ytmusic-player', {
        attributes: ['playback-mode'],
        callback: (mutations) => {
          for (const mutation of mutations) {
            if (mutation.target instanceof HTMLElement) {
              const current = mutation.target.getAttribute('playback-mode');
              if (current !== 'ATV_PREFERRED') {
                mutation.target.setAttribute('playback-mode', 'ATV_PREFERRED');
              }
            }
          }
        },
      });
    },
  },
});
