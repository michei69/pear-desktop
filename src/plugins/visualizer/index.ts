import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import emptyStyle from './empty-player.css?inline';
import {
  ButterchurnVisualizer as butterchurn,
  VudioVisualizer as vudio,
  WaveVisualizer as wave,
} from './visualizers';
import { type Visualizer } from './visualizers/visualizer';

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
    effect: string;
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
      horizontalAlign: string;
      verticalAlign: string;
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
    // Config per visualizer
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

      // Disconnect previous gainNode if present
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
          // Guard against non-px / hidden containers (NaN) and zero-size
          // containers so the canvas is never resized to 0×0.
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

    // Rebuild immediately when the user changes the visualizer type/enabled
    // via the menu. createVisualizer destroys the previous instance and is
    // safe to call before audio is ready (it returns early with no audio).
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
        this.props.audioContext = detail.audioContext;
        this.props.audioSource = detail.audioSource;
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
