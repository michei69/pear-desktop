import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { createPlugin } from '@/utils';

import { renderer } from './renderer';

export interface CustomOutputPluginConfig {
  enabled: boolean;
  output: string;
  /** `[deviceId, label]` pairs: an array so a config write replaces the list. */
  devices: [string, string][];
}

export default createPlugin({
  name: () => t('plugins.custom-output-device.name'),
  description: () => t('plugins.custom-output-device.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    output: 'default',
    devices: [],
  } as CustomOutputPluginConfig,
  settings: [
    {
      type: 'select',
      variant: 'dropdown',
      key: 'output',
      label: () => t('plugins.custom-output-device.menu.device-selector'),
      options: async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return [
          { value: 'default', label: () => 'Default' },
          ...devices
            .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default')
            .map((d) => ({
              value: d.deviceId,
              label: () => d.label || d.deviceId,
            })),
        ];
      },
    },
  ],
  menu: ({ setConfig, getConfig, window }) => {
    const promptDeviceSelector = async () => {
      const options = await getConfig();

      // Older builds stored the list as a record; deepmerge cannot delete its
      // keys, so it is written as pairs now.
      const storedDevices: unknown = options.devices;
      const selectOptions = Array.isArray(storedDevices)
        ? Object.fromEntries(storedDevices as [string, string][])
        : (storedDevices as Record<string, string>);

      const response = await prompt(
        {
          title: t('plugins.custom-output-device.prompt.device-selector.title'),
          label: t('plugins.custom-output-device.prompt.device-selector.label'),
          value: options.output || 'default',
          type: 'select',
          selectOptions,
          width: 500,
          ...promptOptions(),
        },
        window,
      ).catch(console.error);

      if (!response) return;
      options.output = response;
      setConfig(options);
    };

    return [
      {
        label: t('plugins.custom-output-device.menu.device-selector'),
        click: promptDeviceSelector,
      },
    ];
  },

  renderer,
});
