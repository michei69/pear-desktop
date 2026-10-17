import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { startSfwMusic } from './renderer';

export default createPlugin({
  name: () => t('plugins.sfw-music.name'),
  description: () => t('plugins.sfw-music.description'),
  restartNeeded: false,
  config: { enabled: false },
  renderer: {
    cleanup: null as (() => void) | null,
    onPlayerApiReady(api) {
      // The player API can be re-created, so drop the old hooks first.
      this.cleanup?.();
      this.cleanup = startSfwMusic(api);
    },
    stop() {
      this.cleanup?.();
      this.cleanup = null;
    },
  },
});
