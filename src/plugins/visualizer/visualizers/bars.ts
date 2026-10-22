import { ThemeSongVisualizer } from './theme-song-base';
import {
  getAccentHsl,
  getThemeSongPalette,
  hslToCss,
  type Hsl,
} from './theme-song-palette';

import type { VisualizerPluginConfig } from '../index';

const DESIGN_WIDTH = 2400;
const DESIGN_HEIGHT = 520;
const BARS_HEIGHT_RATIO = 0.4;
const HSL_PATTERN =
  /^hsla?\(\s*(-?[\d.]+)\s*(?:deg)?[\s,]+(-?[\d.]+)%[\s,]+(-?[\d.]+)%(?:\s*\/\s*[-\d.]+%?)?\s*\)$/i;

function parseHslCss(color: string, fallback: Hsl): Hsl {
  const match = HSL_PATTERN.exec(color);
  if (!match) return fallback;

  return {
    h: Number(match[1] ?? 0),
    s: Number(match[2] ?? 0) / 100,
    l: Number(match[3] ?? 0) / 100,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class BarsVisualizer extends ThemeSongVisualizer {
  private readonly config: VisualizerPluginConfig;
  private readonly accent: Hsl;
  private readonly palette: Hsl[];

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioContext, audioSource, canvas, audioNode, 2048, 0.85);

    this.config = config;
    this.accent = getAccentHsl();
    this.palette = getThemeSongPalette().map((color) =>
      parseHslCss(color, this.accent),
    );
  }

  private dancingSwatch(amplitude: number): Hsl {
    const palette = this.palette;
    if (palette.length === 0) return this.accent;

    const index =
      amplitude > 185
        ? 0
        : amplitude > 165
          ? 1
          : amplitude > 130
            ? 2
            : amplitude > 110
              ? 3
              : amplitude > 70
                ? 4
                : 5;

    return palette[index % palette.length] ?? this.accent;
  }

  private barColor(amplitude: number, index: number): string {
    switch (this.config.bars.variant) {
      case 'rgb':
        return hslToCss({ h: amplitude * 2, s: 1, l: 0.7 });
      case 'accent':
        return hslToCss({
          h: this.accent.h,
          s: this.accent.s,
          l: clamp01(amplitude / 500 + 0.3),
        });
      case 'palette': {
        const swatch = this.palette[index % this.palette.length] ?? this.accent;
        return hslToCss({
          h: swatch.h,
          s: swatch.s,
          l: clamp01(amplitude / 500 + 0.3),
        });
      }
      case 'dancing-palette': {
        const swatch = this.dancingSwatch(amplitude);
        return hslToCss({
          h: swatch.h,
          s: swatch.s,
          l: clamp01(swatch.l - (swatch.l - 0.7) / 2),
        });
      }
    }
  }

  protected draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    ctx.clearRect(0, 0, width, height);

    const barsHeight = Math.max(1, height * BARS_HEIGHT_RATIO);
    const barWidth = Math.max(1, this.config.bars.barWidth);
    const gap = Math.max(0, this.config.bars.gap);

    ctx.save();
    ctx.translate(0, height - barsHeight);
    ctx.scale(width / DESIGN_WIDTH, barsHeight / DESIGN_HEIGHT);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';

    let x = 0;
    for (let index = 0; index < this.frequencyData.length; index++) {
      const amplitude = this.frequencyData[index] ?? 0;
      const barHeight = amplitude * 2;
      const y = DESIGN_HEIGHT - barHeight + 6;

      ctx.fillStyle = this.barColor(amplitude, index);
      ctx.fillRect(x, y, barWidth, barHeight);
      ctx.strokeRect(x, y, barWidth, barHeight);
      x += barWidth + gap;
    }

    ctx.restore();
  }
}

export default BarsVisualizer;
