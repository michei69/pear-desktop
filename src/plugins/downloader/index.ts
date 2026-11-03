import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onConfigChange, onMainLoad, onStop } from './main';
import { onMenu } from './menu';
import { onRendererLoad, onRendererStop } from './renderer';
import { CustomPresetField } from './settings/CustomPresetField';
import style from './style.css?inline';
import { DefaultPresetList, type Preset } from './types';

const PRESET_LABEL_KEYS: Record<string, string> = {
  'mp3 (256kbps)': 'plugins.downloader.presets.mp3-256kbps',
  'Source': 'plugins.downloader.presets.source',
  'Custom': 'plugins.downloader.presets.custom',
};

export const presetLabel = (preset: string) => {
  const key = PRESET_LABEL_KEYS[preset];
  return key ? t(key) : preset;
};

export type DownloaderPluginConfig = {
  enabled: boolean;
  downloadFolder?: string;
  downloadOnFinish?: {
    enabled: boolean;
    seconds: number;
    percent: number;
    mode: 'percent' | 'seconds';
    folder?: string;
  };
  selectedPreset: string;
  customPresetSetting: Preset;
  skipExisting: boolean;
  playlistMaxItems?: number;
};

export const defaultConfig: DownloaderPluginConfig = {
  enabled: false,
  downloadFolder: undefined,
  downloadOnFinish: {
    enabled: false,
    seconds: 20,
    percent: 10,
    mode: 'seconds',
    folder: undefined,
  },
  selectedPreset: 'mp3 (256kbps)', // Selected preset
  customPresetSetting: DefaultPresetList['mp3 (256kbps)'], // Presets
  skipExisting: false,
  playlistMaxItems: undefined,
};

export default createPlugin({
  name: () => t('plugins.downloader.name'),
  description: () => t('plugins.downloader.description'),
  restartNeeded: true,
  config: defaultConfig,
  stylesheets: [style],
  settings: [
    {
      fields: [
        {
          type: 'select',
          variant: 'dropdown',
          key: 'selectedPreset',
          label: () => t('plugins.downloader.menu.presets'),
          options: Object.keys(DefaultPresetList).map((name) => ({
            value: name,
            label: () => presetLabel(name),
          })),
        },
        {
          type: 'custom',
          key: 'customPresetSetting',
          label: () => t('plugins.downloader.settings.custom-preset'),
          description: () =>
            t('plugins.downloader.settings.custom-preset-description'),
          component: 'downloader.customPreset',
        },
        {
          type: 'action',
          key: 'downloadFolder',
          label: () => t('plugins.downloader.menu.choose-download-folder'),
          buttons: [
            {
              label: () => t('plugins.downloader.menu.choose-download-folder'),
              onClick: async ({ pickDirectory, setValue }) => {
                const dir = await pickDirectory();
                if (dir) setValue('downloadFolder', dir);
              },
            },
          ],
        },
        {
          type: 'switch',
          key: 'skipExisting',
          label: () => t('plugins.downloader.menu.skip-existing'),
        },
        {
          type: 'number',
          key: 'playlistMaxItems',
          label: () => t('plugins.downloader.settings.playlist-max-items'),
          description: () =>
            t('plugins.downloader.settings.playlist-max-items-description'),
          min: 0,
          step: 1,
        },
      ],
    },
    {
      title: () => t('plugins.downloader.menu.download-finish-settings.label'),
      fields: [
        {
          type: 'switch',
          key: 'downloadOnFinish.enabled',
          label: () =>
            t(
              'plugins.downloader.menu.download-finish-settings.submenu.enabled',
            ),
        },
        {
          type: 'select',
          key: 'downloadOnFinish.mode',
          label: () =>
            t('plugins.downloader.menu.download-finish-settings.submenu.mode'),
          options: [
            {
              value: 'seconds',
              label: () =>
                t(
                  'plugins.downloader.menu.download-finish-settings.submenu.seconds',
                ),
            },
            {
              value: 'percent',
              label: () =>
                t(
                  'plugins.downloader.menu.download-finish-settings.submenu.percent',
                ),
            },
          ],
        },
        {
          type: 'number',
          key: 'downloadOnFinish.seconds',
          label: () =>
            t(
              'plugins.downloader.menu.download-finish-settings.prompt.last-seconds',
            ),
          min: 0,
          step: 1,
          unit: 's',
        },
        {
          type: 'number',
          key: 'downloadOnFinish.percent',
          label: () =>
            t(
              'plugins.downloader.menu.download-finish-settings.prompt.last-percent',
            ),
          min: 1,
          max: 100,
          step: 1,
          unit: '%',
        },
        {
          type: 'action',
          key: 'downloadOnFinish.folder',
          label: () => t('plugins.downloader.settings.finish-folder'),
          description: () =>
            t('plugins.downloader.settings.finish-folder-description'),
          buttons: [
            {
              label: () => t('plugins.downloader.menu.choose-download-folder'),
              onClick: async ({ pickDirectory, setValue }) => {
                const dir = await pickDirectory();
                if (dir) setValue('downloadOnFinish.folder', dir);
              },
            },
          ],
        },
      ],
    },
  ],
  menu: onMenu,
  backend: {
    start: onMainLoad,
    stop: onStop,
    onConfigChange,
  },
  renderer: {
    components: {
      customPreset: CustomPresetField,
    },
    start: onRendererLoad,
    stop: onRendererStop,
  },
});
