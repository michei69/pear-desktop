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
  name: () => 'Status Bar Lyrics',
  description: () =>
    'Show the current lyric line in the macOS menu bar title. Requires Synced Lyrics to be enabled.',
  restartNeeded: false,
  platform: Platform.macOS,
  config: defaultConfig,
  settings: [
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
