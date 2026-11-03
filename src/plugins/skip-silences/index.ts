import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  onRendererConfigChange,
  onRendererLoad,
  onRendererUnload,
} from './renderer';

export type SkipSilencesPluginConfig = {
  enabled: boolean;
  onlySkipBeginning: boolean;
};

export default createPlugin({
  name: () => t('plugins.skip-silences.name'),
  description: () => t('plugins.skip-silences.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    onlySkipBeginning: false,
  } as SkipSilencesPluginConfig,
  settings: [
    {
      type: 'switch',
      key: 'onlySkipBeginning',
      label: () => t('plugins.skip-silences.settings.only-skip-beginning'),
    },
  ],
  renderer: {
    start: onRendererLoad,
    stop: onRendererUnload,
    onConfigChange: onRendererConfigChange,
  },
});
