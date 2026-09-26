import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import type { CrossfadePluginConfig } from './types';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

const promptCrossfadeValues = async (
  { window }: MenuContext<CrossfadePluginConfig>,
  options: CrossfadePluginConfig,
): Promise<Omit<CrossfadePluginConfig, 'enabled'> | undefined> => {
  const res = await prompt(
    {
      title: t('plugins.crossfade.prompt.options'),
      type: 'multiInput',
      multiInputOptions: [
        {
          label: t(
            'plugins.crossfade.prompt.options.multi-input.fade-in-duration',
          ),
          value: options.fadeInDuration,
          inputAttrs: {
            type: 'number',
            required: true,
            min: '0',
            step: '100',
          },
        },
        {
          label: t(
            'plugins.crossfade.prompt.options.multi-input.fade-out-duration',
          ),
          value: options.fadeOutDuration,
          inputAttrs: {
            type: 'number',
            required: true,
            min: '0',
            step: '100',
          },
        },
        {
          label: t(
            'plugins.crossfade.prompt.options.multi-input.seconds-before-end',
          ),
          value: options.secondsBeforeEnd,
          inputAttrs: {
            type: 'number',
            required: true,
            min: '0',
          },
        },
        {
          label: t(
            'plugins.crossfade.prompt.options.multi-input.fade-scaling.label',
          ),
          selectOptions: {
            linear: t(
              'plugins.crossfade.prompt.options.multi-input.fade-scaling.linear',
            ),
            logarithmic: t(
              'plugins.crossfade.prompt.options.multi-input.fade-scaling.logarithmic',
            ),
            equalPower: t(
              'plugins.crossfade.prompt.options.multi-input.fade-scaling.equal-power',
            ),
          },
          value: options.fadeScaling,
        },
      ],
      resizable: true,
      height: 360,
      ...promptOptions(),
    },
    window,
  ).catch(console.error);

  if (!res) {
    return undefined;
  }

  // A number in dB, and one the fader's scaler accepts: a zero, negative or
  // non-finite dynamic range is not a fade, so the previous setting is kept.
  const decibels = Math.abs(Number(res[3]));
  let fadeScaling: CrossfadePluginConfig['fadeScaling'];

  if (
    res[3] === 'linear' ||
    res[3] === 'logarithmic' ||
    res[3] === 'equalPower'
  ) {
    fadeScaling = res[3];
  } else if (Number.isFinite(decibels) && decibels > 0) {
    fadeScaling = decibels;
  } else {
    fadeScaling = options.fadeScaling;
  }

  return {
    fadeInDuration: Number(res[0]),
    fadeOutDuration: Number(res[1]),
    secondsBeforeEnd: Number(res[2]),
    fadeScaling,
  };
};

export const menu = (ctx: MenuContext<CrossfadePluginConfig>): MenuTemplate => {
  const { getConfig, setConfig } = ctx;

  return [
    {
      label: t('plugins.crossfade.menu.advanced'),
      async click() {
        const newOptions = await promptCrossfadeValues(ctx, await getConfig());
        if (newOptions) {
          setConfig(newOptions);
        }
      },
    },
  ];
};
