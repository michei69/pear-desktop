import { clamp } from "@pear/sdk/util";
import type { Renderer, Stage } from "../config.ts";
import { hslToCss, type Hsl } from "../palette.ts";
import { ThemeSongRenderer } from "./theme-song.ts";

const DESIGN_WIDTH = 2400;
const DESIGN_HEIGHT = 520;
const BARS_HEIGHT_RATIO = 0.4;

/** A spectrum of rounded bars in the artwork's colors. */
export function barsRenderer(stage: Stage): Renderer {
  return new BarsRenderer(stage);
}

class BarsRenderer extends ThemeSongRenderer {
  private readonly variant: Stage["ctx"]["config"]["barsVariant"];
  private readonly barWidth: number;
  private readonly gap: number;
  /** How many bars fit the design width; the rest of the 1024 bins would draw off-canvas. */
  private readonly barCount: number;

  constructor(stage: Stage) {
    super(stage, 2048, 0.85);
    this.variant = stage.ctx.config.barsVariant;
    this.barWidth = Math.max(1, stage.ctx.config.barsBarWidth);
    this.gap = Math.max(0, stage.ctx.config.barsGap);
    this.barCount = Math.max(1, Math.floor(DESIGN_WIDTH / (this.barWidth + this.gap)));
  }

  private dancingSwatch(amplitude: number): Hsl {
    const palette = this.palette.colors;
    if (palette.length === 0) return this.palette.accent;
    const index = amplitude > 185 ? 0 : amplitude > 165 ? 1 : amplitude > 130 ? 2 : amplitude > 110 ? 3 : amplitude > 70 ? 4 : 5;
    return palette[index % palette.length] ?? this.palette.accent;
  }

  private barColor(amplitude: number, index: number): string {
    const accent = this.palette.accent;
    switch (this.variant) {
      case "rgb":
        return hslToCss({ h: amplitude * 2, s: 1, l: 0.7 });
      case "accent":
        return hslToCss({ h: accent.h, s: accent.s, l: clamp(amplitude / 500 + 0.3, 0, 1) });
      case "palette": {
        const palette = this.palette.colors;
        const swatch = palette[index % palette.length] ?? accent;
        return hslToCss({ h: swatch.h, s: swatch.s, l: clamp(amplitude / 500 + 0.3, 0, 1) });
      }
      case "dancing-palette": {
        const swatch = this.dancingSwatch(amplitude);
        return hslToCss({ h: swatch.h, s: swatch.s, l: clamp(swatch.l - (swatch.l - 0.7) / 2, 0, 1) });
      }
    }
  }

  protected draw(context: CanvasRenderingContext2D, width: number, height: number): void {
    context.clearRect(0, 0, width, height);

    const barsHeight = Math.max(1, height * BARS_HEIGHT_RATIO);
    context.save();
    context.translate(0, height - barsHeight);
    context.scale(width / DESIGN_WIDTH, barsHeight / DESIGN_HEIGHT);
    context.lineWidth = 2;
    context.strokeStyle = "#000000";

    let x = 0;
    const count = Math.min(this.frequencyData.length, this.barCount);
    for (let bar = 0; bar < count; bar += 1) {
      // Spread the whole spectrum over the bars that fit, instead of drawing the
      // lowest few bins and the rest outside the canvas.
      const index = Math.floor((bar / count) * this.frequencyData.length);
      const amplitude = this.frequencyData[index] ?? 0;
      const barHeight = amplitude * 2;
      const y = DESIGN_HEIGHT - barHeight + 6;
      context.fillStyle = this.barColor(amplitude, bar);
      context.fillRect(x, y, this.barWidth, barHeight);
      context.strokeRect(x, y, this.barWidth, barHeight);
      x += this.barWidth + this.gap;
    }

    context.restore();
  }
}
