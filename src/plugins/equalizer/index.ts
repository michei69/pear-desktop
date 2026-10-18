import { t } from '@/i18n';
import { clearAudioChain, setAudioChain } from '@/providers/audio-graph';
import { createPlugin } from '@/utils';

import { EqualizerPresets } from './EqualizerPresets';
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
let audioCanPlayListener:
  | ((event: CustomEvent<Compressor>) => void)
  | undefined;

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
  settings: [
    {
      type: 'custom',
      key: 'presets',
      label: () => t('plugins.equalizer.menu.presets.label'),
      component: 'equalizer.presets',
      // Presets are read once on renderer start, so a toggle needs a restart.
      restartNeeded: true,
    },
  ],
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
    components: { presets: EqualizerPresets },
    async start({ getConfig }) {
      const config = await getConfig();

      // Keep a reference so `stop` can detach it.
      const listener = ({
        detail: { audioContext },
      }: CustomEvent<Compressor>) => {
        const filtersToApply = config.filters.concat(
          defaultPresets
            .filter((preset) => config.presets[preset])
            .map((preset) => presetConfigs[preset]),
        );

        appliedFilters.forEach((filter) => filter.disconnect());
        appliedFilters = [];

        if (filtersToApply.length === 0) {
          clearAudioChain('equalizer');
          return;
        }

        // The shared owner wires source → filters → destination, so another
        // plugin splicing its own chain cannot lose its edges here.
        let first: BiquadFilterNode | null = null;
        let last: BiquadFilterNode | null = null;
        for (const filter of filtersToApply) {
          const biquadFilter = audioContext.createBiquadFilter();
          biquadFilter.type = filter.type;
          biquadFilter.frequency.value = filter.frequency;
          biquadFilter.Q.value = filter.Q;
          biquadFilter.gain.value = filter.gain;

          if (last) last.connect(biquadFilter);
          else first = biquadFilter;
          last = biquadFilter;

          appliedFilters.push(biquadFilter);
        }
        if (first && last) setAudioChain('equalizer', first, last);
      };

      if (audioCanPlayListener) {
        document.removeEventListener(
          'peard:audio-can-play',
          audioCanPlayListener,
        );
      }
      audioCanPlayListener = listener;
      document.addEventListener('peard:audio-can-play', listener);
    },
    stop() {
      if (audioCanPlayListener) {
        document.removeEventListener(
          'peard:audio-can-play',
          audioCanPlayListener,
        );
        audioCanPlayListener = undefined;
      }

      appliedFilters.forEach((filter) => filter.disconnect());
      appliedFilters = [];

      // The owner restores the default source → destination path.
      clearAudioChain('equalizer');
    },
  },
});
