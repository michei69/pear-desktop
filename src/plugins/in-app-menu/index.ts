import { t } from '@/i18n';
import { Platform } from '@/types/plugins';
import { createPlugin } from '@/utils';

import { defaultInAppMenuConfig } from './constants';
import { onMainLoad, onStop } from './main';
import { onMenu } from './menu';
import { onConfigChange, onRendererLoad, onRendererStop } from './renderer';
import titlebarStyle from './titlebar.css?inline';

export default createPlugin({
  name: () => t('plugins.in-app-menu.name'),
  description: () => t('plugins.in-app-menu.description'),
  restartNeeded: true,
  config: defaultInAppMenuConfig,
  stylesheets: [titlebarStyle],
  settings: [
    {
      type: 'switch',
      key: 'hideDOMWindowControls',
      label: () => t('plugins.in-app-menu.menu.hide-dom-window-controls'),
      platform: Platform.Linux,
    },
  ],
  menu: onMenu,

  backend: {
    start: onMainLoad,
    stop: onStop,
  },
  renderer: {
    start: onRendererLoad,
    stop: onRendererStop,
    onConfigChange,
  },
});
