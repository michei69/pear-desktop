import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

const elementsToRemove = [
  '.sign-in-link.ytmusic-nav-bar',
  '.ytmusic-pivot-bar-renderer[tab-id="FEmusic_liked"]',
];

export default createPlugin({
  name: () => t('plugins.no-google-login.name'),
  description: () => t('plugins.no-google-login.description'),
  restartNeeded: true,
  config: {
    enabled: false,
  },
  stylesheets: [style],
  renderer: {
    start() {
      for (const selector of elementsToRemove) {
        document.querySelector(selector)?.remove();
      }
    },
  },
});
