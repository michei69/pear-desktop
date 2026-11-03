import { dialog } from 'electron';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { observePlayerPage } from '@/providers/player-page-observer';
import { createPlugin } from '@/utils';

import { QualitySettingButton } from './templates/quality-setting-button';

import type { MusicPlayer } from '@/types/music-player';

// The player UI is rebuilt at runtime and takes the button with it, so the
// newest api must stay reachable from the re-attach.
let playerApi: MusicPlayer | null = null;

type QualityChangerRenderer = {
  qualitySettingsButtonContainer: HTMLElement | null;
  unwatchPlayer: (() => void) | null;
  rafId: number;
  mounted: boolean;
  dispose: (() => void) | null;
  sync: () => void;
};

export default createPlugin({
  name: () => t('plugins.quality-changer.name'),
  description: () => t('plugins.quality-changer.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },

  backend: {
    start({ ipc, window }) {
      ipc.handle(
        'peard:quality-changer',
        async (qualityLabels: string[], currentIndex: number) =>
          await dialog.showMessageBox(window, {
            type: 'question',
            buttons: qualityLabels,
            defaultId: currentIndex,
            title: t(
              'plugins.quality-changer.backend.dialog.quality-changer.title',
            ),
            message: t(
              'plugins.quality-changer.backend.dialog.quality-changer.message',
            ),
            detail: t(
              'plugins.quality-changer.backend.dialog.quality-changer.detail',
              {
                quality: qualityLabels[currentIndex],
              },
            ),
            cancelId: -1,
          }),
      );
    },
    stop({ ipc }) {
      ipc.removeHandler('peard:quality-changer');
    },
  },

  renderer: {
    qualitySettingsButtonContainer: null as HTMLElement | null,
    unwatchPlayer: null as (() => void) | null,
    rafId: 0,
    mounted: false,
    dispose: null as (() => void) | null,
    /** Puts the button back whenever the player UI is rebuilt without it. */
    sync(this: QualityChangerRenderer) {
      const container = this.qualitySettingsButtonContainer;
      if (!this.mounted || !container) {
        return;
      }

      const topRowButtons = document.querySelector(
        '.top-row-buttons.ytmusic-player',
      );
      if (topRowButtons?.contains(container)) {
        return;
      }

      topRowButtons?.prepend(container);
    },
    onPlayerApiReady(api: MusicPlayer, context) {
      playerApi = api;

      const chooseQuality = async (e: MouseEvent) => {
        e.stopPropagation();

        if (!playerApi) {
          return;
        }

        const qualityLevels = playerApi.getAvailableQualityLevels();

        const currentIndex = qualityLevels.indexOf(
          playerApi.getPlaybackQuality(),
        );

        const quality = (await context.ipc.invoke(
          'peard:quality-changer',
          playerApi.getAvailableQualityLabels(),
          currentIndex,
        )) as {
          response: number;
        };

        if (quality.response === -1) {
          return;
        }

        const newQuality = qualityLevels[quality.response];
        playerApi.setPlaybackQualityRange(newQuality);
        playerApi.setPlaybackQuality(newQuality);
      };

      if (this.mounted) {
        return;
      }

      this.mounted = true;
      const container = document.createElement('div');
      this.qualitySettingsButtonContainer = container;
      this.dispose = render(
        () => (
          <QualitySettingButton
            label={t(
              'plugins.quality-changer.renderer.quality-settings-button.label',
            )}
            onClick={chooseQuality}
          />
        ),
        container,
      );

      // Observing the player rather than body keeps this cheap, and it is only
      // replaced on a full page reload.
      this.unwatchPlayer = observePlayerPage(
        document.querySelector('ytmusic-player') ? 'ytmusic-player' : 'body',
        {
          childList: true,
          subtree: true,
          callback: () => {
            cancelAnimationFrame(this.rafId);
            this.rafId = requestAnimationFrame(() => this.sync());
          },
        },
      );

      this.sync();
    },
    stop() {
      this.mounted = false;
      this.unwatchPlayer?.();
      this.unwatchPlayer = null;
      cancelAnimationFrame(this.rafId);
      this.dispose?.();
      this.dispose = null;
      this.qualitySettingsButtonContainer?.remove();
      this.qualitySettingsButtonContainer = null;
      playerApi = null;
    },
  },
});
