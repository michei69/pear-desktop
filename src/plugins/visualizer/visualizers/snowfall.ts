import { ThemeSongVisualizer } from './theme-song-base';

import type { VisualizerPluginConfig } from '../index';

type Star = {
  x: number;
  y: number;
  size: number;
  speed: number;
};

const STAR_COUNT = 1000;
const MIN_STAR_SIZE = 3;
const MAX_STAR_SIZE = 6;
const MIN_STAR_SPEED = 0.1;
const MAX_STAR_SPEED = 1;

const randomBetween = (min: number, max: number): number =>
  Math.random() * (max - min) + min;

/** ThemeSong's starfield, with stars kept in normalized canvas coordinates. */
export class SnowfallVisualizer extends ThemeSongVisualizer {
  private readonly stars: Star[];
  private lastElapsed = 0;

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream | null,
    _config: VisualizerPluginConfig,
  ) {
    super(audioContext, audioSource, canvas, audioNode, 2048, 0.85);
    this.stars = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: randomBetween(MIN_STAR_SIZE, MAX_STAR_SIZE),
      speed: randomBetween(MIN_STAR_SPEED, MAX_STAR_SPEED),
    }));
  }

  protected override draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    elapsedSeconds: number,
  ): void {
    const deltaSeconds = Math.min(
      0.1,
      Math.max(0, elapsedSeconds - this.lastElapsed),
    );
    this.lastElapsed = elapsedSeconds;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(0, 0, 40, 0.4)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';

    for (const star of this.stars) {
      // Source speeds are per animation frame; 60fps keeps their original feel.
      star.y += (star.speed * deltaSeconds * 60) / Math.max(1, height);
      if (star.y > 1) star.y -= 1;

      ctx.beginPath();
      ctx.arc(star.x * width, star.y * height, star.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export default SnowfallVisualizer;
