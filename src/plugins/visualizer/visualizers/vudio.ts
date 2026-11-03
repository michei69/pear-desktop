import Vudio from 'vudio/umd/vudio';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class VudioVisualizer extends Visualizer {
  private readonly visualizer: Vudio;
  private readonly stream: MediaStream;
  private readonly previousOnResize: Window['onresize'];
  private readonly vudioResizeHandler: Window['onresize'];
  private paused = false;

  constructor(
    _audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioSource, audioNode);

    this.stream = stream;
    this.previousOnResize = window.onresize;
    this.visualizer = new Vudio(stream, canvas, {
      width: canvas.width,
      height: canvas.height,
      ...config.vudio,
    });
    this.vudioResizeHandler = window.onresize;

    this.visualizer.dance();
  }

  resize(width: number, height: number) {
    this.visualizer.setOption({
      width,
      height,
    });
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.visualizer.pause();
    const context = this.visualizer.analyser.context;
    if (context instanceof AudioContext && context.state === 'running') {
      context.suspend().catch(() => {});
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.visualizer.dance();
  }

  destroy() {
    this.visualizer.pause();
    if (window.onresize && window.onresize === this.vudioResizeHandler) {
      window.onresize = this.previousOnResize;
    }
    const context = this.visualizer.analyser.context;
    if (context instanceof AudioContext) context.close().catch(() => {});
    for (const track of this.stream.getTracks()) track.stop();
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}

export default VudioVisualizer;
