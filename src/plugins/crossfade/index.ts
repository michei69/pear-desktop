import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { menu } from './menu';
import { renderer } from './renderer';

import type { CrossfadePluginConfig } from './types';

export default createPlugin<
  typeof backend,
  unknown,
  typeof renderer,
  CrossfadePluginConfig
>({
  name: () => t('plugins.crossfade.name'),
  description: () => t('plugins.crossfade.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    fadeInDuration: 5000,
    fadeOutDuration: 5000,
    secondsBeforeEnd: 10,
    fadeScaling: 'equalPower',
  },
  menu,
  backend,
  renderer,
});
