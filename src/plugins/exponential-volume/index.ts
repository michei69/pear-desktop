import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';

let playerApi: MusicPlayer | null = null;
let syncVolume: (() => void) | null = null;
let restoreVolumeDescriptor: (() => void) | null = null;

const onStateChange = () => {
  syncVolume?.();
};

const teardown = () => {
  playerApi?.removeEventListener('onStateChange', onStateChange);
  playerApi = null;
  syncVolume = null;
  restoreVolumeDescriptor?.();
  restoreVolumeDescriptor = null;
};

export default createPlugin({
  name: () => t('plugins.exponential-volume.name'),
  description: () => t('plugins.exponential-volume.description'),
  restartNeeded: true,
  config: {
    enabled: false,
  },
  renderer: {
    onPlayerApiReady(api) {
      // Re-enabling can call this again; restore first so the descriptor
      // captured below is always the native one.
      teardown();

      playerApi = api;

      // "fix volume ratio 0.4" by Marco Pfeiffer
      // https://bit.ly/4nMu2WF

      // Manipulation exponent: higher = lower volume. 3 is what pulseaudio uses,
      // per Barteks2x (https://gist.github.com/Barteks2x/a4e189a36a10c159bb1644ffca21c02a);
      // 0.05 (5%), the lowest the UI offers, becomes 0.000125 at this exponent.
      const EXPONENT = 3;

      const storedOriginalVolumes = new WeakMap<HTMLMediaElement, number>();
      const propertyDescriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'volume',
      );
      Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
        get(this: HTMLMediaElement) {
          const lowVolume =
            (propertyDescriptor?.get?.call(this) as number) ?? 0;
          const calculatedOriginalVolume = lowVolume ** (1 / EXPONENT);

          // The calculated value is not exact, so the unmodified volume is stored and
          // returned on read; the initial read has no stored value and the volume can
          // change externally, so the stored value is used only within 0.01 of it.
          const storedOriginalVolume = storedOriginalVolumes.get(this) ?? 0;
          const storedDeviation = Math.abs(
            storedOriginalVolume - calculatedOriginalVolume,
          );

          return storedDeviation < 0.01
            ? storedOriginalVolume
            : calculatedOriginalVolume;
        },
        set(this: HTMLMediaElement, originalVolume: number) {
          const lowVolume = originalVolume ** EXPONENT;
          storedOriginalVolumes.set(this, originalVolume);
          propertyDescriptor?.set?.call(this, lowVolume);
        },
      });

      restoreVolumeDescriptor = () => {
        if (propertyDescriptor) {
          Object.defineProperty(
            HTMLMediaElement.prototype,
            'volume',
            propertyDescriptor,
          );
        }
      };

      syncVolume = () => {
        // The player rejects volume changes while buffering; retry on the
        // next state change instead of polling.
        if (api.getPlayerState() === 3) return;

        api.setVolume(api.getVolume());
      };

      api.addEventListener('onStateChange', onStateChange);
      syncVolume();
    },

    stop() {
      teardown();
    },
  },
});
