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
  restartNeeded: false,
  config: {
    enabled: false,
    fadeInDuration: 5000,
    fadeOutDuration: 5000,
    secondsBeforeEnd: 10,
    fadeScaling: 'equalPower',
  },
  settings: [
    {
      type: 'slider',
      key: 'fadeInDuration',
      label: () => t('plugins.crossfade.settings.fade-in'),
      min: 0,
      max: 10000,
      step: 100,
      unit: 'ms',
    },
    {
      type: 'slider',
      key: 'fadeOutDuration',
      label: () => t('plugins.crossfade.settings.fade-out'),
      min: 0,
      max: 10000,
      step: 100,
      unit: 'ms',
    },
    {
      type: 'slider',
      key: 'secondsBeforeEnd',
      label: () => t('plugins.crossfade.settings.seconds-before-end'),
      description: () =>
        t('plugins.crossfade.settings.seconds-before-end-description'),
      min: 0,
      max: 30,
      unit: 's',
    },
    {
      type: 'select',
      key: 'fadeScaling',
      label: () => t('plugins.crossfade.settings.fade-scaling'),
      options: [
        {
          value: 'linear',
          label: () =>
            t(
              'plugins.crossfade.prompt.options.multi-input.fade-scaling.linear',
            ),
        },
        {
          value: 'logarithmic',
          label: () =>
            t(
              'plugins.crossfade.prompt.options.multi-input.fade-scaling.logarithmic',
            ),
        },
        {
          value: 'equalPower',
          label: () =>
            t(
              'plugins.crossfade.prompt.options.multi-input.fade-scaling.equal-power',
            ),
        },
      ],
    },
  ],
  menu,
  backend,
  renderer,
});
