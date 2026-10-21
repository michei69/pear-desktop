import { clearAudioChain, setAudioChain } from '@/providers/audio-graph';

import { normalizeConfig, type EqualizerPluginConfig } from './config';

const dbToLinear = (db: number) => 10 ** (db / 20);

/** Owns the equalizer's serial insert, from filter chain through output trim. */
export class EqualizerAudioChain {
  private source: MediaElementAudioSourceNode | null = null;
  private context: AudioContext | null = null;
  private filters: BiquadFilterNode[] = [];
  private outputGain: GainNode | null = null;
  private stopped = false;

  get audioContext() {
    return this.context;
  }

  private disconnectNodes() {
    clearAudioChain('equalizer');
    for (const filter of this.filters) {
      try {
        filter.disconnect();
      } catch {
        // Already disconnected by a rebuilt graph.
      }
    }
    try {
      this.outputGain?.disconnect();
    } catch {
      // Already disconnected.
    }
    this.filters = [];
    this.outputGain = null;
  }

  private build(source: MediaElementAudioSourceNode, context: AudioContext) {
    this.disconnectNodes();
    this.source = source;
    this.context = context;

    const filters = Array.from({ length: 11 }, (_, index) => {
      const filter = context.createBiquadFilter();
      filter.type =
        index === 0 ? 'lowshelf' : index === 10 ? 'highshelf' : 'peaking';
      return filter;
    });
    const outputGain = context.createGain();
    let previous: AudioNode = filters[0];
    for (const filter of filters.slice(1)) {
      previous.connect(filter);
      previous = filter;
    }
    previous.connect(outputGain);

    this.filters = filters;
    this.outputGain = outputGain;
    // The shared owner connects source -> filters[0] and outputGain -> next.
    setAudioChain('equalizer', filters[0], outputGain);
  }

  /** Reuse the filter topology while editing so dragging a slider has no clicks. */
  apply(rawConfig: EqualizerPluginConfig) {
    if (this.stopped || !this.source || !this.context || !this.outputGain) {
      return false;
    }
    const config = normalizeConfig(rawConfig);
    const now = this.context.currentTime;
    const nyquist = this.context.sampleRate / 2;
    const maxFrequency = Math.min(20000, Math.max(20, nyquist - 1));
    const smooth = (param: AudioParam, value: number) => {
      if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(now);
      }
      param.setTargetAtTime(value, now, 0.01);
    };

    smooth(this.outputGain.gain, dbToLinear(config.outputGainDb));
    this.filters.forEach((filter, index) => {
      const band = config.filters[index];
      filter.type =
        index === 0
          ? 'lowshelf'
          : index === this.filters.length - 1
            ? 'highshelf'
            : 'peaking';
      smooth(
        filter.frequency,
        Math.min(maxFrequency, Math.max(20, band.frequency)),
      );
      smooth(filter.Q, Math.max(0.0001, band.Q));
      smooth(filter.gain, config.bypass ? 0 : band.gain);
    });
    return true;
  }

  /** Attach to the shared graph; a changed source/context rebuilds the insert. */
  connect(source: MediaElementAudioSourceNode, context: AudioContext) {
    if (this.stopped) return;
    if (
      this.source !== source ||
      this.context !== context ||
      !this.outputGain
    ) {
      this.build(source, context);
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.disconnectNodes();
    this.source = null;
    this.context = null;
  }
}
