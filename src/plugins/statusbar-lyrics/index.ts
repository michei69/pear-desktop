import { t } from '@/i18n';
import { Platform } from '@/types/plugins';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { menu } from './menu';
import { renderer } from './renderer';

export interface StatusbarLyricsPluginConfig {
  enabled: boolean;
  maxLength: number;
  includePronunciation: boolean;
}

export const defaultConfig: StatusbarLyricsPluginConfig = {
  enabled: false,
  maxLength: 55,
  includePronunciation: false,
};

export default createPlugin({
  name: () => t('plugins.statusbar-lyrics.name'),
  description: () => t('plugins.statusbar-lyrics.description'),
  restartNeeded: false,
  platform: Platform.macOS,
  config: defaultConfig,
  settings: [
    {
      type: 'slider',
      key: 'maxLength',
      label: () => t('plugins.statusbar-lyrics.settings.max-length'),
      min: 16,
      max: 200,
      step: 1,
    },
    {
      type: 'switch',
      key: 'includePronunciation',
      label: () => t('plugins.statusbar-lyrics.settings.include-pronunciation'),
    },
  ],
  menu,
  backend,
  renderer,
});
