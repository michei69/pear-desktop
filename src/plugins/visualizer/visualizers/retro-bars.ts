import { ThemeSongVisualizer } from './theme-song-base';

import type { VisualizerPluginConfig } from '../index';

const BAR_WIDTH = 34;
const BAR_GAP = 4;
const BLOCK_STEP = 20;
const STATIC_HEIGHT = 500;

const hueForY = (y: number, lightness: number): string =>
  `hsl(${(((y / 2 - 190) % 360) + 360) % 360}, 100%, ${lightness}%)`;

const drawBlock = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  blockHeight: number,
): void => {
  ctx.beginPath();
  ctx.roundRect(x, y, BAR_WIDTH, blockHeight, 4);
  ctx.fill();
};

/**
 * RetroBars is ThemeSong's two-canvas block equalizer. The back layer is a
 * static dark block wall; the front layer is a spectrum-driven bright copy.
 * Both layers live in this single canvas, drawn back-to-front.
 */
export class RetroBarsVisualizer extends ThemeSongVisualizer {
  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream | null,
    _config: VisualizerPluginConfig,
  ) {
    super(audioContext, audioSource, canvas, audioNode, 2048, 0.8);
  }

  protected override draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);

    const barCount = Math.max(1, Math.ceil(width / (BAR_WIDTH + BAR_GAP)));
    const data = this.frequencyData;
    const blockHeight = Math.max(4, BAR_WIDTH - 20);
    const staticHeight = Math.min(height, STATIC_HEIGHT);

    // Back layer: dim blocks form the recognisable RetroBars skyline.
    for (let bar = 0; bar < barCount; bar += 1) {
      const x = bar * (BAR_WIDTH + BAR_GAP);
      for (let offset = 0; offset < staticHeight; offset += BLOCK_STEP) {
        const y = height - blockHeight - offset;
        ctx.fillStyle = hueForY(y, 15);
        drawBlock(ctx, x, y, blockHeight);
      }
    }

    // Front layer: the same geometry, with a full-height spectrum reading.
    for (let bar = 0; bar < barCount; bar += 1) {
      const frequencyIndex = Math.min(
        data.length - 1,
        Math.floor((bar / barCount) * Math.min(data.length, 1024)),
      );
      const barHeight = Math.min(
        height,
        Math.max((data[frequencyIndex] ?? 0) * 2, 50),
      );
      const x = bar * (BAR_WIDTH + BAR_GAP);

      for (let offset = 0; offset < barHeight; offset += BLOCK_STEP) {
        const y = height - blockHeight - offset;
        if (y + blockHeight < 0) break;
        ctx.fillStyle = hueForY(y, 50);
        drawBlock(ctx, x, y, blockHeight);
      }
    }
  }
}

export default RetroBarsVisualizer;
