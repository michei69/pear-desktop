import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import emptyStyle from './empty-player.css?inline';
import {
  ButterchurnVisualizer as butterchurn,
  VudioVisualizer as vudio,
  WaveVisualizer as wave,
} from './visualizers';
import { type Visualizer } from './visualizers/visualizer';

/** Effects the bundled vudio build can draw. */
export type VudioEffect = 'waveform' | 'circlewave' | 'circlebar' | 'lighting';

type WaveColor = {
  gradient: string[];
  rotate?: number;
};

export type VisualizerPluginConfig = {
  enabled: boolean;
  type: 'butterchurn' | 'vudio' | 'wave';
  butterchurn: {
    preset: string;
    blendTimeInSeconds: number;
  };
  vudio: {
    effect: VudioEffect;
    accuracy: number;
    lighting: {
      maxHeight: number;
      maxSize: number;
      lineWidth: number;
      color: string;
      shadowBlur: number;
      shadowColor: string;
      fadeSide: boolean;
      prettify: boolean;
      horizontalAlign: 'left' | 'center' | 'right';
      verticalAlign: 'top' | 'middle' | 'bottom';
      dottify: boolean;
    };
  };
  wave: {
    animations: {
      type: string;
      config: {
        bottom?: boolean;
        top?: boolean;
        count?: number;
        cubeHeight?: number;
        lineWidth?: number;
        diameter?: number;
        fillColor?: string | WaveColor;
        lineColor?: string | WaveColor;
        radius?: number;
        frequencyBand?: string;
      };
    }[];
  };
};

type RenderProps = {
  visualizerInstance: Visualizer | null;
  audioContext: AudioContext | null;
  audioSource: MediaElementAudioSourceNode | null;
  observer: ResizeObserver | null;
  gainNode: GainNode | null;
};

export default createPlugin({
  name: () => t('plugins.visualizer.name'),
  description: () => t('plugins.visualizer.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    type: 'butterchurn',
    butterchurn: {
      preset: 'martin [shadow harlequins shape code] - fata morgana',
      blendTimeInSeconds: 2.7,
    },
    vudio: {
      effect: 'lighting',
      accuracy: 128,
      lighting: {
        maxHeight: 160,
        maxSize: 12,
        lineWidth: 1,
        color: '#49f3f7',
        shadowBlur: 2,
        shadowColor: 'rgba(244,244,244,.5)',
        fadeSide: true,
        prettify: false,
        horizontalAlign: 'center',
        verticalAlign: 'middle',
        dottify: true,
      },
    },
    wave: {
      animations: [
        {
          type: 'Cubes',
          config: {
            bottom: true,
            count: 30,
            cubeHeight: 5,
            fillColor: { gradient: ['#FAD961', '#F76B1C'] },
            lineColor: 'rgba(0,0,0,0)',
            radius: 20,
          },
        },
        {
          type: 'Cubes',
          config: {
            top: true,
            count: 12,
            cubeHeight: 5,
            fillColor: { gradient: ['#FAD961', '#F76B1C'] },
            lineColor: 'rgba(0,0,0,0)',
            radius: 10,
          },
        },
        {
          type: 'Circles',
          config: {
            lineColor: {
              gradient: ['#FAD961', '#FAD961', '#F76B1C'],
              rotate: 90,
            },
            lineWidth: 4,
            diameter: 20,
            count: 10,
            frequencyBand: 'base',
          },
        },
      ],
    },
  } as VisualizerPluginConfig,
  stylesheets: [emptyStyle],
  settings: [
    {
      fields: [
        {
          type: 'select',
          key: 'type',
          label: () => t('plugins.visualizer.menu.visualizer-type'),
          options: (['butterchurn', 'vudio', 'wave'] as const).map((value) => ({
            value,
            label: () => value,
          })),
        },
      ],
    },
    {
      title: () => 'Butterchurn',
      fields: [
        {
          type: 'text',
          key: 'butterchurn.preset',
          label: () => t('plugins.visualizer.settings.preset'),
          placeholder: () => 'Flexi - mindblob',
        },
        {
          type: 'slider',
          key: 'butterchurn.blendTimeInSeconds',
          label: () => t('plugins.visualizer.settings.blend-time'),
          min: 0,
          max: 10,
          step: 0.1,
          unit: 's',
        },
      ],
    },
    {
      title: () => 'Vudio',
      fields: [
        {
          type: 'select',
          variant: 'dropdown',
          key: 'vudio.effect',
          label: () => t('plugins.visualizer.settings.effect'),
          options: ['waveform', 'circlewave', 'circlebar', 'lighting'].map(
            (value) => ({ value, label: () => value }),
          ),
        },
        {
          type: 'select',
          variant: 'dropdown',
          key: 'vudio.accuracy',
          label: () => t('plugins.visualizer.settings.accuracy'),
          // Vudio sets fftSize = accuracy * 2, so only powers of two are valid.
          options: [32, 64, 128, 256, 512, 1024].map((value) => ({
            value,
            label: () => String(value),
          })),
        },
        {
          type: 'slider',
          key: 'vudio.lighting.maxHeight',
          label: () => t('plugins.visualizer.settings.max-height'),
          min: 10,
          max: 500,
          step: 5,
          unit: 'px',
        },
        {
          type: 'slider',
          key: 'vudio.lighting.maxSize',
          label: () => t('plugins.visualizer.settings.max-size'),
          min: 1,
          max: 50,
          step: 1,
          unit: 'px',
        },
        {
          type: 'slider',
          key: 'vudio.lighting.lineWidth',
          label: () => t('plugins.visualizer.settings.line-width'),
          min: 1,
          max: 10,
          step: 1,
          unit: 'px',
        },
        {
          type: 'text',
          key: 'vudio.lighting.color',
          label: () => t('plugins.visualizer.settings.color'),
          placeholder: () => '#49f3f7',
        },
        {
          type: 'slider',
          key: 'vudio.lighting.shadowBlur',
          label: () => t('plugins.visualizer.settings.shadow-blur'),
          min: 0,
          max: 20,
          step: 1,
          unit: 'px',
        },
        {
          type: 'text',
          key: 'vudio.lighting.shadowColor',
          label: () => t('plugins.visualizer.settings.shadow-color'),
          placeholder: () => 'rgba(244,244,244,.5)',
        },
        {
          type: 'switch',
          key: 'vudio.lighting.fadeSide',
          label: () => t('plugins.visualizer.settings.fade-side'),
        },
        {
          type: 'switch',
          key: 'vudio.lighting.prettify',
          label: () => t('plugins.visualizer.settings.prettify'),
          description: () =>
            t('plugins.visualizer.settings.prettify-description'),
        },
        {
          type: 'switch',
          key: 'vudio.lighting.dottify',
          label: () => t('plugins.visualizer.settings.dottify'),
          description: () =>
            t('plugins.visualizer.settings.dottify-description'),
        },
        {
          type: 'select',
          variant: 'dropdown',
          key: 'vudio.lighting.horizontalAlign',
          label: () => t('plugins.visualizer.settings.horizontal-align'),
          options: ['left', 'center', 'right'].map((value) => ({
            value,
            label: () => value,
          })),
        },
        {
          type: 'select',
          variant: 'dropdown',
          key: 'vudio.lighting.verticalAlign',
          label: () => t('plugins.visualizer.settings.vertical-align'),
          options: ['top', 'middle', 'bottom'].map((value) => ({
            value,
            label: () => value,
          })),
        },
      ],
    },
  ],
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    const visualizerTypes = ['butterchurn', 'vudio', 'wave'] as const; // For bundling

    return [
      {
        label: t('plugins.visualizer.menu.visualizer-type'),
        submenu: visualizerTypes.map((visualizerType) => ({
          label: visualizerType,
          type: 'radio',
          checked: config.type === visualizerType,
          click() {
            setConfig({ type: visualizerType });
          },
        })),
      },
    ];
  },

  renderer: {
    props: {
      visualizerInstance: null,
      audioContext: null,
      audioSource: null,
      observer: null,
      gainNode: null,
      audioCanPlayHandler: undefined,
    } as RenderProps & { audioCanPlayHandler?: EventListener },

    createVisualizer(
      this: { props: RenderProps },
      config: VisualizerPluginConfig,
    ) {
      this.props.visualizerInstance?.destroy();
      this.props.visualizerInstance = null;

      if (!this.props.audioContext || !this.props.audioSource) return;
      if (!config.enabled) return;

      const video = document.querySelector<
        HTMLVideoElement & { captureStream(): MediaStream }
      >('video');
      if (!video) {
        return;
      }

      const visualizerContainer =
        document.querySelector<HTMLElement>('#player');
      if (!visualizerContainer) {
        return;
      }

      let canvas = document.querySelector<HTMLCanvasElement>('#visualizer');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'visualizer';
        visualizerContainer?.prepend(canvas);
      }

      if (this.props.gainNode) {
        this.props.gainNode.disconnect();
      }

      const gainNode = this.props.audioContext.createGain();
      gainNode.gain.value = 1.25;
      this.props.gainNode = gainNode;
      this.props.audioSource.connect(gainNode);

      let visualizerType: {
        new (...args: ConstructorParameters<typeof vudio>): Visualizer;
      } = vudio;
      if (config.type === 'wave') {
        visualizerType = wave;
      } else if (config.type === 'butterchurn') {
        visualizerType = butterchurn;
      }
      this.props.visualizerInstance = new visualizerType(
        this.props.audioContext,
        this.props.audioSource,
        canvas,
        gainNode,
        video.captureStream(),
        config,
      );

      const resizeVisualizer = () => {
        if (canvas && visualizerContainer) {
          const { width, height } =
            window.getComputedStyle(visualizerContainer);
          const w = parseFloat(width);
          const h = parseFloat(height);
          // Skip hidden/non-px containers (NaN) and zero sizes: never 0×0.
          if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            canvas.width = Math.ceil(w);
            canvas.height = Math.ceil(h);
          }
        }
        this.props.visualizerInstance?.resize(canvas.width, canvas.height);
      };
      resizeVisualizer();

      this.props.observer?.disconnect();
      this.props.observer = new ResizeObserver(resizeVisualizer);
      this.props.observer.observe(visualizerContainer);
    },

    // createVisualizer destroys the previous instance and returns early when
    // no audio is ready, so this is safe on a menu toggle.
    onConfigChange(newConfig) {
      this.createVisualizer(newConfig);
    },

    onPlayerApiReady(_, { getConfig }) {
      if (this.props.audioCanPlayHandler) return;
      this.props.audioCanPlayHandler = async (e: Event) => {
        const detail = (
          e as CustomEvent<{
            audioContext: AudioContext;
            audioSource: MediaElementAudioSourceNode;
          }>
        ).detail;
        // Re-emitted per track, but the graph (and so the source node) only
        // changes on a rebind. Rebuilding on the same source would drop the
        // GL context and restart the loop for nothing.
        const { audioContext, audioSource } = detail;
        const sameGraph =
          this.props.audioContext === audioContext &&
          this.props.audioSource === audioSource;
        this.props.audioContext = audioContext;
        this.props.audioSource = audioSource;
        if (sameGraph && this.props.visualizerInstance) return;
        this.createVisualizer(await getConfig());
      };
      document.addEventListener(
        'peard:audio-can-play',
        this.props.audioCanPlayHandler,
        { passive: true },
      );
    },

    stop() {
      if (this.props.audioCanPlayHandler) {
        document.removeEventListener(
          'peard:audio-can-play',
          this.props.audioCanPlayHandler,
        );
        this.props.audioCanPlayHandler = undefined;
      }
      this.props.visualizerInstance?.destroy();
      this.props.visualizerInstance = null;
      this.props.observer?.disconnect();
      this.props.observer = null;
      if (this.props.gainNode) {
        this.props.gainNode.disconnect();
        this.props.gainNode = null;
      }
      this.props.audioContext = null;
      this.props.audioSource = null;
      document.querySelector('#visualizer')?.remove();
    },
  },
});
