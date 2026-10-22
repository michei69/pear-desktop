import { ThemeSongVisualizer } from './theme-song-base';
import { getAccentHsl, hslToCss, type Hsl } from './theme-song-palette';

import type { VisualizerPluginConfig } from '../index';

/**
 * ThemeSong's Wavy visualizer: a soft accent-coloured glow behind a white
 * time-domain waveform. The original component paints the glow with CSS and
 * the waveform on a 1920x512 canvas; both are folded into this canvas so the
 * visualizer remains a single, self-contained layer.
 */
export class WavyVisualizer extends ThemeSongVisualizer {
  private readonly lineWidth: number;
  private readonly accent: Hsl;

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream | null,
    config: VisualizerPluginConfig,
  ) {
    super(audioContext, audioSource, canvas, audioNode, 2048, 0.75);
    const configuredWidth = config.wavy.lineWidth;
    this.lineWidth = Number.isFinite(configuredWidth)
      ? Math.min(20, Math.max(1, configuredWidth))
      : 8;
    this.accent = getAccentHsl();
  }

  protected override draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    ctx.clearRect(0, 0, width, height);

    const glow = ctx.createLinearGradient(0, 0, 0, height);
    glow.addColorStop(0, hslToCss(this.accent, 0));
    glow.addColorStop(0.35, hslToCss({ ...this.accent, l: 0.16 }, 0.5));
    glow.addColorStop(0.5, hslToCss({ ...this.accent, l: 0.16 }, 0.7));
    glow.addColorStop(0.65, hslToCss({ ...this.accent, l: 0.16 }, 0.5));
    glow.addColorStop(1, hslToCss(this.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const samples = this.timeDomainData;
    if (samples.length === 0) return;

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = this.lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = this.lineWidth;
    ctx.shadowColor = hslToCss({ ...this.accent, l: 0.55 }, 0.9);

    ctx.beginPath();
    const amplitude = height * 0.175;
    const centerY = height / 2;
    for (let index = 0; index < samples.length; index += 1) {
      const value = (samples[index] ?? 128) / 128;
      const x = (index / Math.max(1, samples.length - 1)) * width;
      const y = centerY + (value - 1) * amplitude;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export default WavyVisualizer;
