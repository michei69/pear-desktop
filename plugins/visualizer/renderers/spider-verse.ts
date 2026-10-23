import type { Renderer, Stage } from "../config.ts";
import { ThemeSongRenderer } from "./theme-song.ts";

const BAR_WIDTH = 16;
const BAR_GAP = 2;
const BLOCK_STEP = 15;
const DOT_SIZE = 4;
const DOT_SPACING = 6;

const blockColor = (topDistance: number, barHeight: number, canvasHeight: number): string => {
  const y = canvasHeight - topDistance;
  if (topDistance > barHeight - BAR_WIDTH) return "#ff683b";
  if (y > canvasHeight - 50) return "green";
  if (y > canvasHeight - 240) return "#44d5fc";
  if (y > canvasHeight - 300) return "#e28cff";
  if (y > canvasHeight - 380) return "turquoise";
  if (y > canvasHeight - 480) return "#6c259c";
  return "#ffff78";
};

/** A deep-blue gradient, a dot field and a spectrum block wall. */
export function spiderVerseRenderer(stage: Stage): Renderer {
  return new SpiderVerseRenderer(stage);
}

class SpiderVerseRenderer extends ThemeSongRenderer {
  constructor(stage: Stage) {
    super(stage, 2048, 0.8);
  }

  protected draw(context: CanvasRenderingContext2D, width: number, height: number): void {
    context.clearRect(0, 0, width, height);

    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "rgba(0, 0, 60, 0.1)");
    background.addColorStop(0.65, "rgba(0, 0, 60, 0.85)");
    background.addColorStop(1, "rgba(0, 0, 60, 0.95)");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    this.drawBlocks(context, width, height);
    this.drawDotField(context, width, height);

    const bottomGlow = context.createLinearGradient(0, 0, 0, height);
    bottomGlow.addColorStop(0.85, "rgba(255, 255, 255, 0)");
    bottomGlow.addColorStop(0.93, "rgba(200, 200, 255, 0.1)");
    bottomGlow.addColorStop(1, "rgba(200, 200, 255, 0.4)");
    context.fillStyle = bottomGlow;
    context.fillRect(0, 0, width, height);

    const sideGlow = context.createLinearGradient(width, height, 0, 0);
    sideGlow.addColorStop(0.65, "rgba(255, 255, 255, 0)");
    sideGlow.addColorStop(0.85, "rgba(200, 200, 255, 0.2)");
    sideGlow.addColorStop(1, "rgba(200, 200, 255, 0.4)");
    context.fillStyle = sideGlow;
    context.fillRect(0, 0, width, height);
  }

  private drawBlocks(context: CanvasRenderingContext2D, width: number, height: number): void {
    const data = this.frequencyData;
    const barCount = Math.max(1, Math.ceil(width / (BAR_WIDTH + BAR_GAP)));
    const blockHeight = BAR_WIDTH - 4;

    for (let bar = 0; bar < barCount; bar += 1) {
      const frequencyIndex = Math.min(data.length - 1, Math.floor((bar / barCount) * Math.min(data.length, 1024)));
      const barHeight = Math.min(height, Math.max((data[frequencyIndex] ?? 0) * 3, 220));
      const x = bar * (BAR_WIDTH + BAR_GAP);

      for (let offset = 0; offset < barHeight; offset += BLOCK_STEP) {
        const y = height - blockHeight - offset;
        if (y + blockHeight < 0) break;
        context.fillStyle = blockColor(offset, barHeight, height);
        context.fillRect(x, y, BAR_WIDTH, blockHeight);
      }
    }
  }

  private drawDotField(context: CanvasRenderingContext2D, width: number, height: number): void {
    const rows = Math.ceil(height / DOT_SPACING);
    const cols = Math.ceil(width / DOT_SPACING);

    for (let row = 0; row < rows; row += 1) {
      const y = row * DOT_SPACING;
      const opacity = Math.max(0, y / Math.max(1, height / 3) - 1);
      context.fillStyle = `rgba(255, 255, 255, ${opacity * 0.07})`;

      for (let col = 0; col < cols; col += 1) {
        const x = col * DOT_SPACING + (row % 2 === 0 ? DOT_SPACING / 2 : 0);
        context.beginPath();
        context.arc(x, y, DOT_SIZE / 2, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
}
