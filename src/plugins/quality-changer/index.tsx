import { dialog } from 'electron';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { QualitySettingButton } from './templates/quality-setting-button';

import type { MusicPlayer } from '@/types/music-player';

// The player UI is rebuilt at runtime and takes the button with it, so the
// newest api must stay reachable from the re-attach.
let playerApi: MusicPlayer | null = null;

type QualityChangerRenderer = {
  qualitySettingsButtonContainer: HTMLElement;
  observer: MutationObserver | null;
  rafId: number;
  mounted: boolean;
  sync: () => void;
};

export default createPlugin({
  name: () => t('plugins.quality-changer.name'),
  description: () => t('plugins.quality-changer.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },

  backend({ ipc, window }) {
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

  renderer: {
    qualitySettingsButtonContainer: document.createElement('div'),
    observer: null as MutationObserver | null,
    rafId: 0,
    mounted: false,
    /** Puts the button back whenever the player UI is rebuilt without it. */
    sync(this: QualityChangerRenderer) {
      if (!this.mounted) {
        return;
      }

      const topRowButtons = document.querySelector(
        '.top-row-buttons.ytmusic-player',
      );
      if (topRowButtons?.contains(this.qualitySettingsButtonContainer)) {
        return;
      }

      topRowButtons?.prepend(this.qualitySettingsButtonContainer);
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

      render(
        () => (
          <QualitySettingButton
            label={t(
              'plugins.quality-changer.renderer.quality-settings-button.label',
            )}
            onClick={chooseQuality}
          />
        ),
        this.qualitySettingsButtonContainer,
      );

      // Observing the player rather than body keeps this cheap, and it is only
      // replaced on a full page reload.
      this.observer = new MutationObserver(() => {
        cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(() => this.sync());
      });
      this.observer.observe(
        document.querySelector('ytmusic-player') ?? document.body,
        {
          childList: true,
          subtree: true,
        },
      );

      this.sync();
    },
    stop() {
      this.mounted = false;
      this.observer?.disconnect();
      this.observer = null;
      cancelAnimationFrame(this.rafId);
      playerApi = null;
      this.qualitySettingsButtonContainer.remove();
    },
  },
});
