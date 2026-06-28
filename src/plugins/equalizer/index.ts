import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  defaultPresets,
  presetConfigs,
  type Preset,
  type FilterConfig,
} from './presets';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export type EqualizerPluginConfig = {
  enabled: boolean;
  filters: FilterConfig[];
  presets: { [preset in Preset]: boolean };
};

let appliedFilters: BiquadFilterNode[] = [];
let audioSourceNode: AudioNode | null = null;
let audioCtx: AudioContext | null = null;

export default createPlugin({
  name: () => t('plugins.equalizer.name'),
  description: () => t('plugins.equalizer.description'),
  restartNeeded: false,
  addedVersion: '3.7.X',
  config: {
    enabled: false,
    filters: [],
    presets: { 'bass-booster': false },
  } as EqualizerPluginConfig,
  menu: async ({
    getConfig,
    setConfig,
  }: MenuContext<EqualizerPluginConfig>): Promise<MenuTemplate> => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.equalizer.menu.presets.label'),
        type: 'submenu',
        submenu: defaultPresets.map((preset) => ({
          label: t(`plugins.equalizer.menu.presets.list.${preset}`),
          type: 'radio',
          checked: config.presets[preset],
          click() {
            setConfig({
              presets: { ...config.presets, [preset]: !config.presets[preset] },
            });
          },
        })),
      },
    ];
  },
  renderer: {
    async start({ getConfig }) {
      const config = await getConfig();

      document.addEventListener(
        'peard:audio-can-play',
        ({ detail: { audioSource, audioContext } }) => {
          const filtersToApply = config.filters.concat(
            defaultPresets
              .filter((preset) => config.presets[preset])
              .map((preset) => presetConfigs[preset]),
          );

          if (filtersToApply.length === 0) return;

          // Clean up previous filters if they exist
          appliedFilters.forEach((filter) => filter.disconnect());
          appliedFilters = [];

          audioSourceNode = audioSource;
          audioCtx = audioContext;

          // Disconnect default path to avoid parallel audio
          audioSource.disconnect(audioContext.destination);

          let lastNode: AudioNode = audioSource;
          filtersToApply.forEach((filter) => {
            const biquadFilter = audioContext.createBiquadFilter();
            biquadFilter.type = filter.type;
            biquadFilter.frequency.value = filter.frequency;
            biquadFilter.Q.value = filter.Q;
            biquadFilter.gain.value = filter.gain;

            lastNode.connect(biquadFilter);
            lastNode = biquadFilter;

            appliedFilters.push(biquadFilter);
          });
          lastNode.connect(audioContext.destination);
        },
      );
    },
    stop() {
      appliedFilters.forEach((filter) => filter.disconnect());
      appliedFilters = [];

      // Restore default audio path
      if (audioSourceNode && audioCtx) {
        audioSourceNode.connect(audioCtx.destination);
        audioSourceNode = null;
        audioCtx = null;
      }
    },
  },
});
