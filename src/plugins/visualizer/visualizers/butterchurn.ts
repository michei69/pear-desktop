import Butterchurn, {
  type Visualizer as ButterchurnInstance,
} from 'butterchurn';

import { Visualizer } from './visualizer';

import { BUTTERCHURN_DEFAULT_PRESET } from '../constants';

import type { VisualizerPluginConfig } from '../index';

class ButterchurnVisualizer extends Visualizer {
  private readonly visualizer: ButterchurnInstance;
  private destroyed: boolean = false;
  private presetLoaded: boolean = false;
  private paused: boolean = false;
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

    // Presets are ~1 MB and this visualizer is off by default, so they are
    // loaded on demand rather than pulled into the static import graph.
    this.loadPreset(config);
  }

  private async loadPreset(config: VisualizerPluginConfig) {
    try {
      const { default: presets } = await import('butterchurn-presets');
      if (this.destroyed) return;
      const requested = config.butterchurn.preset;
      const preset =
        presets[requested] ??
        presets[BUTTERCHURN_DEFAULT_PRESET] ??
        Object.values(presets)[0];
      if (!preset) {
        console.error('visualizer: no butterchurn preset available');
        return;
      }
      if (!presets[requested]) {
        console.warn(
          `visualizer: unknown butterchurn preset "${requested}", using the default`,
        );
      }
      await this.visualizer.loadPreset(
        preset,
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

  private readonly renderFrame = () => {
    this.animFrameHandle = null;
    if (this.destroyed || this.paused) return;
    this.visualizer.render();
    this.animFrameHandle = requestAnimationFrame(this.renderFrame);
  };

  private startLoop() {
    if (
      this.animFrameHandle !== null ||
      this.destroyed ||
      this.paused ||
      !this.presetLoaded
    )
      return;
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

  pause() {
    if (this.paused || this.destroyed) return;
    this.paused = true;
    this.stopLoop();
    try {
      this.visualizer.disconnectAudio(this.audioNode);
    } catch {}
  }

  resume() {
    if (!this.paused || this.destroyed) return;
    this.paused = false;
    try {
      this.visualizer.connectAudio(this.audioNode);
    } catch {}
    this.startLoop();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
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
