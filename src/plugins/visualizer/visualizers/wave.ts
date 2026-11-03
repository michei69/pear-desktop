import { Wave } from '@foobar404/wave';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class WaveVisualizer extends Visualizer {
  private readonly visualizer: Wave;
  private readonly animations: VisualizerPluginConfig['wave']['animations'];
  private paused = false;

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioSource, audioNode);

    this.animations = config.wave.animations;
    this.visualizer = new Wave(
      { context: audioContext, source: audioSource },
      canvas,
      true,
    );
    this.addAnimations();
  }

  private addAnimations() {
    for (const animation of this.animations) {
      const TargetVisualizer =
        this.visualizer.animations[
          animation.type as keyof typeof this.visualizer.animations
        ];

      this.visualizer.addAnimation(
        new TargetVisualizer(animation.config as never), // Magic of Typescript
      );
    }
  }

  resize(_: number, __: number) {}

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.visualizer.clearAnimations();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.addAnimations();
  }

  destroy() {
    this.visualizer.clearAnimations();
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}

export default WaveVisualizer;
