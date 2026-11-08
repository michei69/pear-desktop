import { observePlayerPage } from '@/providers/player-page-observer';
import { createRenderer } from '@/utils';

import type { MusicWidgetConfig } from './index';
import type { MusicPlayer } from '@/types/music-player';

const isAdPlaying = (api?: MusicPlayer) => {
  const player = document.querySelector('#movie_player');
  if (player?.classList.contains('ad-showing')) return true;
  try {
    return api?.getAdState() === 1;
  } catch {
    return false;
  }
};

export const renderer = createRenderer<
  {
    unwatchPlayer?: () => void;
    /**
     * Last ad state sent over IPC. Only a send dedupe — the backend's
     * `isAdvertisement` is the single state served to clients.
     */
    lastSentAdState?: boolean;
  },
  MusicWidgetConfig
>({
  onPlayerApiReady(api, { ipc }) {
    this.unwatchPlayer?.();

    const report = () => {
      const isAd = isAdPlaying(api);
      if (isAd === this.lastSentAdState) return;
      this.lastSentAdState = isAd;
      ipc.send('peard:amuse-ad-state', isAd);
    };

    // The shared observer retargets when another plugin re-subscribes after a
    // player rebuild, so a replaced #movie_player does not stop the reports.
    this.unwatchPlayer = observePlayerPage('#movie_player', {
      attributes: ['class'],
      callback: report,
    });
    report();
  },

  stop() {
    this.unwatchPlayer?.();
    this.unwatchPlayer = undefined;
    this.lastSentAdState = undefined;
  },
});
