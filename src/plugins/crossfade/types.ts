import type { RendererContext } from '@/types/contexts';

export type CrossfadePluginConfig = {
  enabled: boolean;
  /** Milliseconds the incoming track is faded in over. */
  fadeInDuration: number;
  /** Milliseconds the outgoing track is faded out over. */
  fadeOutDuration: number;
  /** Seconds before the end of a track that triggers the next one. */
  secondsBeforeEnd: number;
  /**
   * Scaling algorithm for the fade: `'linear'`, `'equalPower'`,
   * `'logarithmic'` or a positive number of dB.
   */
  fadeScaling: 'linear' | 'logarithmic' | 'equalPower' | number;
};

export type CrossfadeRendererProperties = {
  config?: CrossfadePluginConfig;
  ipc?: RendererContext<CrossfadePluginConfig>['ipc'];
  /** Video audio graph, as last announced on `peard:audio-can-play`. */
  audioGraph?: Compressor;
  /** `peard:audio-can-play` listener, so `stop` can detach it. */
  onAudioCanPlay?: (event: CustomEvent<Compressor>) => void;
  /** Splices the crossfade's gain node into the announced graph. */
  attachFadeInGain?: (graph: Compressor) => void;
  /** Drops the gain node, the listeners and the audio the plugin holds. */
  teardown?: () => void;
};
