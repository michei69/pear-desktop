import type { Renderer, Stage } from "../config.ts";
import type { ArtworkPalette } from "../palette.ts";

/**
 * Shared analyser and clock for the 2D visualizers ported from ThemeSong.
 *
 * The player already routes its audio through the shared graph; these renderers
 * tap it with a private analyser and never connect to the destination, so they
 * cannot change the volume or double playback. The plugin's frame loop calls
 * `render`, and already pauses it while the window is hidden.
 */
export abstract class ThemeSongRenderer implements Renderer {
  protected readonly canvas: HTMLCanvasElement;
  protected readonly context: CanvasRenderingContext2D;
  protected readonly analyser: AnalyserNode;
  protected readonly frequencyData: Uint8Array<ArrayBuffer>;
  protected readonly timeDomainData: Uint8Array<ArrayBuffer>;
  protected readonly palette: ArtworkPalette;
  protected width = 1;
  protected height = 1;
  protected elapsed = 0;
  private lastFrame: number | undefined;

  protected constructor({ ctx, graph, canvas, palette }: Stage, fftSize: number, smoothingTimeConstant: number) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("visualizer: a 2D canvas context is required");
    this.canvas = canvas;
    this.context = context;
    this.palette = palette;

    this.analyser = graph.context.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.maxDecibels = -18;
    this.analyser.smoothingTimeConstant = smoothingTimeConstant;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeDomainData = new Uint8Array(this.analyser.fftSize);
    graph.tap(this.analyser);
    ctx.onCleanup(() => this.analyser.disconnect());
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    if (this.canvas.width !== this.width) this.canvas.width = this.width;
    if (this.canvas.height !== this.height) this.canvas.height = this.height;
  }

  // An arrow so the plugin's loop can call a detached `render`.
  render = (): void => {
    const now = performance.now();
    // The loop may have been paused while hidden; never advance more than a frame.
    if (this.lastFrame !== undefined) this.elapsed += Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeDomainData);
    this.draw(this.context, this.width, this.height, this.elapsed);
  };

  /** Draws one frame; the analyser data was refreshed just before. */
  protected abstract draw(context: CanvasRenderingContext2D, width: number, height: number, elapsedSeconds: number): void;
}
