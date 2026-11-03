import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  components,
  onPlayerApiReady,
  onUnload,
  onConfigChange,
} from './renderer';

export type PlaybackSpeedConfig = {
  enabled: boolean;
  noPreservesPitch: boolean;
  /** Playback rate applied when the plugin starts and from the settings slider. */
  playbackSpeed: number;
};

export default createPlugin({
  name: () => t('plugins.playback-speed.name'),
  description: () => t('plugins.playback-speed.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    noPreservesPitch: false,
    playbackSpeed: 1,
  } satisfies PlaybackSpeedConfig as PlaybackSpeedConfig,
  settings: [
    {
      type: 'custom',
      key: 'playbackSpeed',
      label: () => t('plugins.playback-speed.settings.playback-speed'),
      description: () =>
        t('plugins.playback-speed.settings.playback-speed-description'),
      component: 'playback-speed.settingsSlider',
    },
    {
      type: 'switch',
      key: 'noPreservesPitch',
      label: () => t('plugins.playback-speed.menu.no-preserves-pitch'),
    },
  ],
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    return [
      {
        label: t('plugins.playback-speed.menu.no-preserves-pitch'),
        type: 'checkbox',
        checked: config.noPreservesPitch,
        click(item: Electron.MenuItem) {
          setConfig({ noPreservesPitch: item.checked });
        },
      },
    ];
  },
  renderer: {
    components,
    stop: onUnload,
    onPlayerApiReady,
    onConfigChange,
  },
});
