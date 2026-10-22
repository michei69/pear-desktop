import { Visualizer } from './visualizer';

/**
 * Shared clock + analyser plumbing for the visualizers ported from ThemeSong.
 *
 * The player's audio graph already owns the source -> destination path. These
 * visualizers are pure taps: they connect the shared source to a private
 * AnalyserNode and never connect that analyser to the destination, so enabling
 * a visualizer cannot change the volume or double the audio.
 */
export abstract class ThemeSongVisualizer extends Visualizer {
  protected readonly audioContext: AudioContext;
  protected readonly canvas: HTMLCanvasElement;
  protected readonly ctx: CanvasRenderingContext2D;
  protected readonly analyser: AnalyserNode;
  protected readonly frequencyData: Uint8Array<ArrayBuffer>;
  protected readonly timeDomainData: Uint8Array<ArrayBuffer>;
  protected width = 1;
  protected height = 1;
  protected elapsed = 0;

  private animationFrame: number | null = null;
  private lastFrameTime: number | null = null;
  private destroyed = false;
  private readonly onVisibilityChange = () => this.syncAnimationLoop();
  private readonly onPlaybackChange = () => this.syncAnimationLoop();

  protected constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    fftSize = 2048,
    smoothingTimeConstant = 0.85,
  ) {
    super(audioSource, audioNode);
    this.audioContext = audioContext;
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('visualizer: a 2D canvas context is required');
    }
    this.ctx = context;

    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.maxDecibels = -18;
    this.analyser.smoothingTimeConstant = smoothingTimeConstant;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeDomainData = new Uint8Array(this.analyser.fftSize);

    try {
      audioSource.connect(this.analyser);
    } catch (error) {
      console.error('visualizer: could not connect analyser', error);
    }

    const mediaElement = audioSource.mediaElement;
    mediaElement?.addEventListener('play', this.onPlaybackChange);
    mediaElement?.addEventListener('pause', this.onPlaybackChange);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.syncAnimationLoop();
  }

  /** Draw one frame. Frequency data is refreshed immediately before this call. */
  protected abstract draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    elapsedSeconds: number,
  ): void;

  /** Optional hook after the backing-store size changes. */
  protected onResize(): void {}

  protected getPaletteColor(index: number): string {
    const palette = [
      '#ff006e',
      '#fb5607',
      '#ffbe0b',
      '#3a86ff',
      '#8338ec',
      '#06d6a0',
    ];
    return palette[index % palette.length];
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    if (this.canvas.width !== this.width) this.canvas.width = this.width;
    if (this.canvas.height !== this.height) this.canvas.height = this.height;
    this.onResize();
  }

  private shouldAnimate() {
    if (this.destroyed || document.visibilityState === 'hidden') return false;
    const mediaElement = this.audioSource.mediaElement;
    return !mediaElement || !mediaElement.paused;
  }

  private syncAnimationLoop() {
    if (this.destroyed) return;
    if (!this.shouldAnimate()) {
      this.stopAnimationLoop();
      return;
    }
    if (this.animationFrame === null) {
      this.lastFrameTime = null;
      this.animationFrame = requestAnimationFrame(this.renderFrame);
    }
  }

  private readonly renderFrame = (time: number) => {
    this.animationFrame = null;
    if (!this.shouldAnimate()) return;

    if (this.lastFrameTime !== null) {
      this.elapsed += Math.min((time - this.lastFrameTime) / 1000, 0.1);
    }
    this.lastFrameTime = time;

    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeDomainData);
    this.draw(this.ctx, this.width, this.height, this.elapsed);
    this.animationFrame = requestAnimationFrame(this.renderFrame);
  };

  private stopAnimationLoop() {
    if (this.animationFrame === null) return;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.lastFrameTime = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopAnimationLoop();
    const mediaElement = this.audioSource.mediaElement;
    mediaElement?.removeEventListener('play', this.onPlaybackChange);
    mediaElement?.removeEventListener('pause', this.onPlaybackChange);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    try {
      this.audioSource.disconnect(this.analyser);
    } catch {
      // The graph may already have been re-cut by the audio owner.
    }
    this.analyser.disconnect();
  }
}

export const fillBackground = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: string | CanvasGradient,
) => {
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, width, height);
};
