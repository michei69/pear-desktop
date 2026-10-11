import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { startFeatureFlags } from './flags-preload';
import { renderer } from './renderer';
import style from './styles.css?inline';

export interface SettingsUIConfig {
  enabled: boolean;
  /** Adds the settings entry to YTM's sidebar; the menu entry works regardless. */
  showButton: boolean;
  /** Opens the standalone window instead of the in-app panel, like the tray. */
  separateWindow: boolean;
}

export default createPlugin({
  name: () => t('settings-ui.name'),
  description: () => t('settings-ui.description'),
  restartNeeded: false,
  essential: true,
  config: {
    enabled: true,
    showButton: true,
    separateWindow: false,
  } as SettingsUIConfig,
  settings: [
    {
      type: 'switch',
      key: 'showButton',
      label: () => t('settings-ui.settings.show-button'),
      description: () => t('settings-ui.settings.show-button-description'),
    },
    {
      type: 'switch',
      key: 'separateWindow',
      label: () => t('settings-ui.settings.separate-window'),
      description: () => t('settings-ui.settings.separate-window-description'),
    },
  ],
  stylesheets: [style],
  preload: {
    start: startFeatureFlags,
  },
  backend,
  renderer,
});
