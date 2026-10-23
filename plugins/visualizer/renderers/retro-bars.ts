import type { Renderer, Stage } from "../config.ts";
import { ThemeSongRenderer } from "./theme-song.ts";

const BAR_WIDTH = 34;
const BAR_GAP = 4;
const BLOCK_STEP = 20;
const STATIC_HEIGHT = 500;

const hueForY = (y: number, lightness: number): string => `hsl(${(((y / 2 - 190) % 360) + 360) % 360}, 100%, ${lightness}%)`;

const drawBlock = (context: CanvasRenderingContext2D, x: number, y: number, blockHeight: number): void => {
  context.beginPath();
  context.roundRect(x, y, BAR_WIDTH, blockHeight, 4);
  context.fill();
};

/**
 * ThemeSong's two-canvas block equalizer. The back layer is a static dark block
 * wall; the front layer is a spectrum-driven bright copy. Both layers live in
 * this single canvas, drawn back to front.
 */
export function retroBarsRenderer(stage: Stage): Renderer {
  return new RetroBarsRenderer(stage);
}

class RetroBarsRenderer extends ThemeSongRenderer {
  constructor(stage: Stage) {
    super(stage, 2048, 0.8);
  }

  protected draw(context: CanvasRenderingContext2D, width: number, height: number): void {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(0, 0, 0, 0.2)";
    context.fillRect(0, 0, width, height);

    const barCount = Math.max(1, Math.ceil(width / (BAR_WIDTH + BAR_GAP)));
    const data = this.frequencyData;
    const blockHeight = Math.max(4, BAR_WIDTH - 20);
    const staticHeight = Math.min(height, STATIC_HEIGHT);

    // Back layer: dim blocks form the recognisable RetroBars skyline.
    for (let bar = 0; bar < barCount; bar += 1) {
      const x = bar * (BAR_WIDTH + BAR_GAP);
      for (let offset = 0; offset < staticHeight; offset += BLOCK_STEP) {
        const y = height - blockHeight - offset;
        context.fillStyle = hueForY(y, 15);
        drawBlock(context, x, y, blockHeight);
      }
    }

    // Front layer: the same geometry, with a full-height spectrum reading.
    for (let bar = 0; bar < barCount; bar += 1) {
      const frequencyIndex = Math.min(data.length - 1, Math.floor((bar / barCount) * Math.min(data.length, 1024)));
      const barHeight = Math.min(height, Math.max((data[frequencyIndex] ?? 0) * 2, 50));
      const x = bar * (BAR_WIDTH + BAR_GAP);

      for (let offset = 0; offset < barHeight; offset += BLOCK_STEP) {
        const y = height - blockHeight - offset;
        if (y + blockHeight < 0) break;
        context.fillStyle = hueForY(y, 50);
        drawBlock(context, x, y, blockHeight);
      }
    }
  }
}
