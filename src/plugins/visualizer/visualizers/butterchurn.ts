import Butterchurn, {
  type Visualizer as ButterchurnInstance,
} from 'butterchurn';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class ButterchurnVisualizer extends Visualizer {
  private readonly visualizer: ButterchurnInstance;
  private destroyed: boolean = false;
  private presetLoaded: boolean = false;
  private animFrameHandle: number | null = null;

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioSource, audioNode);

    this.visualizer = Butterchurn.createVisualizer(audioContext, canvas, {
      width: canvas.width,
      height: canvas.height,
      // The canvas is already sized in CSS pixels: rendering a DPR-scaled
      // buffer only multiplies GPU work for a picture that gets scaled back.
      pixelRatio: 1,
    });
    this.visualizer.connectAudio(audioNode);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // Presets are ~1 MB and this visualizer is off by default, so they are
    // loaded on demand rather than pulled into the static import graph.
    this.loadPreset(config);
  }

  private async loadPreset(config: VisualizerPluginConfig) {
    try {
      const { default: presets } = await import('butterchurn-presets');
      if (this.destroyed) return;
      await this.visualizer.loadPreset(
        presets[config.butterchurn.preset],
        config.butterchurn.blendTimeInSeconds,
      );
    } catch (error) {
      console.error('visualizer: could not load butterchurn preset', error);
      return;
    }
    if (this.destroyed) return;
    this.presetLoaded = true;
    this.startLoop();
  }

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') this.stopLoop();
    else this.startLoop();
  };

  private readonly renderFrame = () => {
    this.animFrameHandle = null;
    if (this.destroyed || document.visibilityState === 'hidden') return;
    this.visualizer.render();
    this.animFrameHandle = requestAnimationFrame(this.renderFrame);
  };

  private startLoop() {
    if (this.animFrameHandle !== null || this.destroyed || !this.presetLoaded)
      return;
    if (document.visibilityState === 'hidden') return;
    this.animFrameHandle = requestAnimationFrame(this.renderFrame);
  }

  private stopLoop() {
    if (this.animFrameHandle === null) return;
    cancelAnimationFrame(this.animFrameHandle);
    this.animFrameHandle = null;
  }

  resize(width: number, height: number) {
    this.visualizer.setRendererSize(width, height);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
    try {
      this.visualizer.loseGLContext();
    } catch {
      // The context is already gone, or WEBGL_lose_context is unavailable.
    }
  }
}

export default ButterchurnVisualizer;
