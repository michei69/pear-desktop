import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';
import type { VideoDataChanged } from '@/types/video-data-changed';

export type AudioOnlyConfig = {
  enabled: boolean;
};

export default createPlugin<
  unknown,
  unknown,
  {
    api: MusicPlayer | null;
    playbackModeObserver: MutationObserver | null;
    videoDataListener: ((e: Event) => void) | null;
    setAudioOnly: () => void;
    applyVisualMode: () => void;
    lockPlaybackMode: (player: HTMLElement) => void;
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
    api: null,
    playbackModeObserver: null,
    videoDataListener: null,

    start() {
      // Hide video element, show album art
      this.applyVisualMode();

      // Lock playback-mode so YouTube can never flip it back
      const player = document.querySelector<HTMLElement>('ytmusic-player');
      if (player) {
        player.setAttribute('playback-mode', 'ATV_PREFERRED');
        player.style.margin = 'auto 0px';
        this.lockPlaybackMode(player);
      }
    },

    onPlayerApiReady(api) {
      this.api = api;

      // Remove a previous listener if the player API re-initialized, so
      // listeners don't stack and re-run on every song change.
      if (this.videoDataListener) {
        document.removeEventListener('videodatachange', this.videoDataListener);
      }

      // Force audio-only quality via the player API
      this.setAudioOnly();

      // Re-apply on every song change
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
      if (this.playbackModeObserver) {
        this.playbackModeObserver.disconnect();
        this.playbackModeObserver = null;
      }
      if (this.videoDataListener) {
        document.removeEventListener('videodatachange', this.videoDataListener);
        this.videoDataListener = null;
      }
    },

    // --- Internal methods ---

    setAudioOnly() {
      // 1. Set playback-mode attribute
      const player = document.querySelector<HTMLElement>('ytmusic-player');
      if (player) {
        player.setAttribute('playback-mode', 'ATV_PREFERRED');
        player.style.margin = 'auto 0px';
      }

      // 2. Use player API to set lowest quality (triggers audio-only path)
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

      // 3. Hide the video element directly
      this.applyVisualMode();
    },

    applyVisualMode() {
      const songVideo = document.querySelector<HTMLElement>(
        '#song-video.ytmusic-player',
      );
      const songImage = document.querySelector<HTMLElement>('#song-image');
      if (songVideo) songVideo.style.display = 'none';
      if (songImage) songImage.style.display = 'block';

      // Also hide the actual video element to stop rendering
      const video = document.querySelector<HTMLVideoElement>('video');
      if (video) {
        video.style.display = 'none';
      }
    },

    lockPlaybackMode(player: HTMLElement) {
      // Prevent YouTube from overriding playback-mode back to OMV_PREFERRED
      this.playbackModeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.target instanceof HTMLElement) {
            const current = mutation.target.getAttribute('playback-mode');
            if (current !== 'ATV_PREFERRED') {
              mutation.target.setAttribute('playback-mode', 'ATV_PREFERRED');
            }
          }
        }
      });
      this.playbackModeObserver.observe(player, {
        attributeFilter: ['playback-mode'],
      });
    },
  },
});
