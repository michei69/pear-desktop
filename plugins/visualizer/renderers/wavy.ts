import type { Renderer, Stage } from "../config.ts";
import { hslToCss } from "../palette.ts";
import { ThemeSongRenderer } from "./theme-song.ts";

/** A soft accent glow behind a white time-domain waveform. */
export function wavyRenderer(stage: Stage): Renderer {
  return new WavyRenderer(stage);
}

class WavyRenderer extends ThemeSongRenderer {
  private readonly lineWidth: number;

  constructor(stage: Stage) {
    super(stage, 2048, 0.75);
    this.lineWidth = Math.min(20, Math.max(1, stage.ctx.config.wavyLineWidth));
  }

  protected draw(context: CanvasRenderingContext2D, width: number, height: number): void {
    context.clearRect(0, 0, width, height);
    const accent = this.palette.accent;

    const glow = context.createLinearGradient(0, 0, 0, height);
    glow.addColorStop(0, hslToCss(accent, 0));
    glow.addColorStop(0.35, hslToCss({ ...accent, l: 0.16 }, 0.5));
    glow.addColorStop(0.5, hslToCss({ ...accent, l: 0.16 }, 0.7));
    glow.addColorStop(0.65, hslToCss({ ...accent, l: 0.16 }, 0.5));
    glow.addColorStop(1, hslToCss(accent, 0));
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    const samples = this.timeDomainData;
    if (samples.length === 0) return;

    context.save();
    context.strokeStyle = "#ffffff";
    context.lineWidth = this.lineWidth;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.shadowBlur = 4;
    context.shadowOffsetY = this.lineWidth;
    context.shadowColor = hslToCss({ ...accent, l: 0.55 }, 0.9);

    context.beginPath();
    const amplitude = height * 0.175;
    const centerY = height / 2;
    for (let index = 0; index < samples.length; index += 1) {
      const value = (samples[index] ?? 128) / 128;
      const x = (index / Math.max(1, samples.length - 1)) * width;
      const y = centerY + (value - 1) * amplitude;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    context.restore();
  }
}
