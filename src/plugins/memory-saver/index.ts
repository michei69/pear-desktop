import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { DEFAULT_THRESHOLD_MB, liveBytes, thresholdBytesFor } from './usage';

const CHECK_INTERVAL_MS = 60_000;
/** Don't ask the renderer to clear twice in a row if its cache stays above the threshold. */
const CLEAR_COOLDOWN_MS = 10 * 60_000;
const MB = 1024 * 1024;

export type MemorySaverConfig = {
  enabled: boolean;
  /** Clear the renderer cache once Blink's live resource caches exceed this. */
  thresholdMB: number;
};

export default createPlugin<
  {
    interval: NodeJS.Timeout | null;
    thresholdBytes: number;
    lastClearAt: number;
    generation: number;
  },
  unknown,
  unknown,
  MemorySaverConfig
>({
  name: () => t('plugins.memory-saver.name'),
  description: () => t('plugins.memory-saver.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    thresholdMB: DEFAULT_THRESHOLD_MB,
  },
  settings: [
    {
      type: 'number',
      key: 'thresholdMB',
      label: () => t('plugins.memory-saver.settings.threshold'),
      description: () =>
        t('plugins.memory-saver.settings.threshold-description'),
      min: 8,
      max: 1024,
      step: 8,
      unit: 'MB',
    },
  ],
  backend: {
    interval: null,
    thresholdBytes: DEFAULT_THRESHOLD_MB * MB,
    lastClearAt: 0,
    generation: 0,
    async start({ window, getConfig }) {
      const generation = ++this.generation;
      this.thresholdBytes = thresholdBytesFor((await getConfig()).thresholdMB);
      if (generation !== this.generation || window.isDestroyed()) return;

      clearInterval(this.interval ?? undefined);
      this.interval = setInterval(() => {
        // Only while the user cannot see the cache being dropped.
        if (window.isDestroyed() || window.isVisible()) return;

        window.webContents
          .executeJavaScript('window.peardPerf?.getResourceUsage()')
          .then((usage: unknown) => {
            if (generation !== this.generation || window.isDestroyed()) return;
            if (liveBytes(usage) < this.thresholdBytes) return;
            if (Date.now() - this.lastClearAt < CLEAR_COOLDOWN_MS) return;

            this.lastClearAt = Date.now();
            window.webContents.send('peard:clear-cache');
          })
          .catch(() => {
            // The renderer may be gone or mid-navigation; the next tick retries.
          });
      }, CHECK_INTERVAL_MS);
    },
    stop() {
      ++this.generation;
      clearInterval(this.interval ?? undefined);
      this.interval = null;
    },
    onConfigChange(newConfig) {
      this.thresholdBytes = thresholdBytesFor(newConfig.thresholdMB);
    },
  },
});
