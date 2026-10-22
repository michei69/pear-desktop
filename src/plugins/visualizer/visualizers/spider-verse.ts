import { ThemeSongVisualizer } from './theme-song-base';

import type { VisualizerPluginConfig } from '../index';

const BAR_WIDTH = 16;
const BAR_GAP = 2;
const BLOCK_STEP = 15;
const DOT_SIZE = 4;
const DOT_SPACING = 6;

const blockColor = (
  topDistance: number,
  barHeight: number,
  canvasHeight: number,
): string => {
  const y = canvasHeight - topDistance;
  if (topDistance > barHeight - BAR_WIDTH) return '#ff683b';
  if (y > canvasHeight - 50) return 'green';
  if (y > canvasHeight - 240) return '#44d5fc';
  if (y > canvasHeight - 300) return '#e28cff';
  if (y > canvasHeight - 380) return 'turquoise';
  if (y > canvasHeight - 480) return '#6c259c';
  return '#ffff78';
};

/**
 * ThemeSong's Spider-Verse visualizer. It combines a deep-blue gradient, a
 * high-frequency dot field, a spectrum block wall, and the two bright edge
 * gradients used by the original React layers.
 */
export class SpiderVerseVisualizer extends ThemeSongVisualizer {
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

    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, 'rgba(0, 0, 60, 0.1)');
    background.addColorStop(0.65, 'rgba(0, 0, 60, 0.85)');
    background.addColorStop(1, 'rgba(0, 0, 60, 0.95)');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    this.drawBlocks(ctx, width, height);
    this.drawDotField(ctx, width, height);

    const bottomGlow = ctx.createLinearGradient(0, 0, 0, height);
    bottomGlow.addColorStop(0.85, 'rgba(255, 255, 255, 0)');
    bottomGlow.addColorStop(0.93, 'rgba(200, 200, 255, 0.1)');
    bottomGlow.addColorStop(1, 'rgba(200, 200, 255, 0.4)');
    ctx.fillStyle = bottomGlow;
    ctx.fillRect(0, 0, width, height);

    const sideGlow = ctx.createLinearGradient(width, height, 0, 0);
    sideGlow.addColorStop(0.65, 'rgba(255, 255, 255, 0)');
    sideGlow.addColorStop(0.85, 'rgba(200, 200, 255, 0.2)');
    sideGlow.addColorStop(1, 'rgba(200, 200, 255, 0.4)');
    ctx.fillStyle = sideGlow;
    ctx.fillRect(0, 0, width, height);
  }

  private drawBlocks(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const data = this.frequencyData;
    const barCount = Math.max(1, Math.ceil(width / (BAR_WIDTH + BAR_GAP)));
    const blockHeight = BAR_WIDTH - 4;

    for (let bar = 0; bar < barCount; bar += 1) {
      const frequencyIndex = Math.min(
        data.length - 1,
        Math.floor((bar / barCount) * Math.min(data.length, 1024)),
      );
      const barHeight = Math.min(
        height,
        Math.max((data[frequencyIndex] ?? 0) * 3, 220),
      );
      const x = bar * (BAR_WIDTH + BAR_GAP);

      for (let offset = 0; offset < barHeight; offset += BLOCK_STEP) {
        const y = height - blockHeight - offset;
        if (y + blockHeight < 0) break;
        ctx.fillStyle = blockColor(offset, barHeight, height);
        ctx.fillRect(x, y, BAR_WIDTH, blockHeight);
      }
    }
  }

  private drawDotField(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const rows = Math.ceil(height / DOT_SPACING);
    const cols = Math.ceil(width / DOT_SPACING);

    for (let row = 0; row < rows; row += 1) {
      const y = row * DOT_SPACING;
      const opacity = Math.max(0, y / Math.max(1, height / 3) - 1);
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.07})`;

      for (let col = 0; col < cols; col += 1) {
        const x = col * DOT_SPACING + (row % 2 === 0 ? DOT_SPACING / 2 : 0);
        ctx.beginPath();
        ctx.arc(x, y, DOT_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

export default SpiderVerseVisualizer;
