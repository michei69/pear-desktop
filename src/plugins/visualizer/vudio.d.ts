declare module 'vudio/umd/vudio' {
  interface NoneWaveformOptions {
    maxHeight?: number;
    minHeight?: number;
    spacing?: number;
    color?: string | string[];
    shadowBlur?: number;
    shadowColor?: string;
    fadeSide?: boolean;
  }

  interface WaveformOptions extends NoneWaveformOptions {
    horizontalAlign: 'left' | 'center' | 'right';
    verticalAlign: 'top' | 'middle' | 'bottom';
  }

  interface LightingOptions extends WaveformOptions {
    maxSize?: number;
    lineWidth?: number;
    prettify?: boolean;
    dottify?: boolean;
  }

  interface VudioOptions {
    effect?: 'waveform' | 'circlewave' | 'circlebar' | 'lighting';
    accuracy?: number;
    width?: number;
    height?: number;
    waveform?: WaveformOptions;
    lighting?: LightingOptions;
  }

  class Vudio {
    constructor(
      audio: HTMLAudioElement | MediaStream,
      canvas: HTMLCanvasElement,
      options: VudioOptions = {},
    );

    readonly analyser: AnalyserNode;

    dance(): void;
    pause(): void;
    setOption(options: VudioOptions): void;
  }

  export default Vudio;
}
