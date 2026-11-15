import type { Renderer, Stage } from "../config.ts";
import { ThemeSongRenderer } from "./theme-song.ts";

interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
}

const STAR_COUNT = 1000;
const MIN_STAR_SIZE = 3;
const MAX_STAR_SIZE = 6;
const MIN_STAR_SPEED = 0.1;
const MAX_STAR_SPEED = 1;

const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;

/** A starfield that drifts downward; the particles sit above the spectrum. */
export function snowfallRenderer(stage: Stage): Renderer {
  return new SnowfallRenderer(stage);
}

class SnowfallRenderer extends ThemeSongRenderer {
  private readonly stars: Star[];
  private lastElapsed = 0;

  constructor(stage: Stage) {
    super(stage, 2048, 0.85);
    this.stars = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: randomBetween(MIN_STAR_SIZE, MAX_STAR_SIZE),
      speed: randomBetween(MIN_STAR_SPEED, MAX_STAR_SPEED),
    }));
  }

  protected draw(context: CanvasRenderingContext2D, width: number, height: number, elapsedSeconds: number): void {
    const deltaSeconds = Math.min(0.1, Math.max(0, elapsedSeconds - this.lastElapsed));
    this.lastElapsed = elapsedSeconds;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(0, 0, 40, 0.4)";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#ffffff";

    for (const star of this.stars) {
      // The original speeds are per animation frame; 60fps keeps their feel.
      star.y += (star.speed * deltaSeconds * 60) / Math.max(1, height);
      if (star.y > 1) star.y -= 1;

      context.beginPath();
      context.arc(star.x * width, star.y * height, star.size / 2, 0, Math.PI * 2);
      context.fill();
    }
  }
}
