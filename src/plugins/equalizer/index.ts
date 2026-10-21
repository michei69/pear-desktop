import { t } from '@/i18n';
import { getAudioGraph, rebindAudioGraphSource } from '@/providers/audio-graph';
import { createPlugin } from '@/utils';

import {
  builtInProfile,
  clamp,
  defaultConfig,
  flatProfile,
  MAX_OUTPUT_GAIN_DB,
  MAX_RECENT_PRESETS,
  MIN_OUTPUT_GAIN_DB,
  normalizeConfig,
  type EqualizerPluginConfig,
} from './config';
import { EqualizerAudioChain } from './controller';
import { EqualizerCurve } from './EqualizerCurve';
import { EqualizerPresets } from './EqualizerPresets';
import { defaultPresets } from './presets';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export type { EqualizerPluginConfig } from './config';

type Runtime = {
  controller: EqualizerAudioChain;
  raw: EqualizerPluginConfig;
  listener: (event: CustomEvent<Compressor>) => void;
};

let runtime: Runtime | null = null;

const attachCurrentGraph = (state: Runtime) => {
  // The shared graph is created before media loads. Reading it here also lets a
  // plugin enabled mid-session start working without waiting for another track.
  const video = document.querySelector<HTMLVideoElement>('video');
  if (!video) return;
  const graph = getAudioGraph(video);
  // The graph can still be bound to the previous <video> element after a seek
  // or navigation. The equalizer must follow the live element just like the
  // compressor does, otherwise it keeps processing a detached source.
  const source = rebindAudioGraphSource(video) ?? graph.source;
  state.controller.connect(source, graph.context);
  state.controller.apply(state.raw);
};

const applyConfig = (state: Runtime, raw: EqualizerPluginConfig) => {
  state.raw = normalizeConfig(raw);
  if (!state.controller.audioContext) attachCurrentGraph(state);
  state.controller.apply(state.raw);
};

const stopRuntime = () => {
  if (!runtime) return;
  document.removeEventListener('peard:audio-can-play', runtime.listener);
  runtime.controller.stop();
  runtime = null;
};

const presetFromId = (config: EqualizerPluginConfig, id: string) => {
  if (id === 'flat' || id === 'bass-booster') {
    return builtInProfile(id);
  }
  return config.userPresets.find((preset) => preset.id === id);
};

const applyPreset = (
  setConfig: MenuContext<EqualizerPluginConfig>['setConfig'],
  config: EqualizerPluginConfig,
  id: string,
) => {
  const profile = presetFromId(config, id);
  if (!profile) return;
  const recentPresets = [
    id,
    ...config.recentPresets.filter((item) => item !== id),
  ].slice(0, MAX_RECENT_PRESETS);
  Promise.resolve(
    setConfig({
      filters: normalizeConfig(profile).filters,
      ...(profile.outputGainDb === undefined
        ? {}
        : {
            outputGainDb: clamp(
              profile.outputGainDb,
              MIN_OUTPUT_GAIN_DB,
              MAX_OUTPUT_GAIN_DB,
            ),
          }),
      activePreset: id,
      recentPresets,
    }),
  ).catch(console.error);
};

export default createPlugin({
  name: () => t('plugins.equalizer.name'),
  description: () => t('plugins.equalizer.description'),
  restartNeeded: false,
  addedVersion: '3.7.X',
  config: defaultConfig,
  settings: [
    {
      type: 'switch',
      key: 'bypass',
      label: () => t('plugins.equalizer.settings.bypass'),
      description: () => t('plugins.equalizer.settings.bypass-description'),
    },
    {
      type: 'slider',
      key: 'outputGainDb',
      label: () => t('plugins.equalizer.settings.output-gain'),
      description: () =>
        t('plugins.equalizer.settings.output-gain-description'),
      min: MIN_OUTPUT_GAIN_DB,
      max: MAX_OUTPUT_GAIN_DB,
      step: 0.1,
      unit: 'dB',
    },
    {
      type: 'custom',
      key: 'filters',
      label: () => t('plugins.equalizer.settings.curve'),
      description: () => t('plugins.equalizer.settings.curve-description'),
      component: 'equalizer.curve',
    },
    {
      type: 'custom',
      key: 'userPresets',
      label: () => t('plugins.equalizer.settings.presets'),
      description: () => t('plugins.equalizer.settings.presets-description'),
      component: 'equalizer.presets',
    },
  ],
  menu: async ({
    getConfig,
    setConfig,
  }: MenuContext<EqualizerPluginConfig>): Promise<MenuTemplate> => {
    const config = normalizeConfig(await getConfig());
    const presetItems = [
      ...defaultPresets.map((id) => ({
        id,
        label:
          id === 'flat'
            ? t('plugins.equalizer.settings.flat')
            : t(`plugins.equalizer.menu.presets.list.${id}`),
      })),
      ...config.userPresets.map((preset) => ({
        id: preset.id,
        label: preset.name,
      })),
    ];
    return [
      {
        label: t('plugins.equalizer.menu.presets.label'),
        submenu: presetItems.map((preset) => ({
          label: preset.label,
          type: 'radio' as const,
          checked: config.activePreset === preset.id,
          click() {
            applyPreset(setConfig, config, preset.id);
          },
        })),
      },
      {
        label: t('plugins.equalizer.settings.reset-eq'),
        click() {
          const profile = flatProfile();
          Promise.resolve(
            setConfig({
              filters: profile.filters,
              outputGainDb: profile.outputGainDb,
              activePreset: 'flat',
            }),
          ).catch(console.error);
        },
      },
      {
        label: t('plugins.equalizer.settings.bypass'),
        type: 'checkbox',
        checked: config.bypass,
        click(item) {
          Promise.resolve(setConfig({ bypass: item.checked })).catch(
            console.error,
          );
        },
      },
    ];
  },
  renderer: {
    components: {
      curve: EqualizerCurve,
      presets: EqualizerPresets,
    },
    async start({ getConfig }) {
      stopRuntime();
      const state: Runtime = {
        controller: new EqualizerAudioChain(),
        raw: normalizeConfig(undefined),
        listener: ({ detail }) => {
          const video = document.querySelector<HTMLVideoElement>('video');
          const source =
            video && detail.audioSource.mediaElement !== video
              ? (rebindAudioGraphSource(video) ?? detail.audioSource)
              : detail.audioSource;
          state.controller.connect(source, detail.audioContext);
          state.controller.apply(state.raw);
        },
      };
      runtime = state;
      // Register before awaiting config so the first track's can-play event is
      // never missed. The listener closes over the mutable state, not config.
      document.addEventListener('peard:audio-can-play', state.listener, {
        passive: true,
      });
      const config = await getConfig();
      if (runtime !== state) return;
      applyConfig(state, config);
    },
    onConfigChange(newConfig: EqualizerPluginConfig) {
      if (!runtime) return;
      applyConfig(runtime, newConfig);
    },
    stop: stopRuntime,
  },
});
