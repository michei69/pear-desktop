import { ThemeSongVisualizer } from './theme-song-base';
import {
  getAccentHsl,
  getThemeSongPalette,
  hslToCss,
} from './theme-song-palette';

import type { ExperimentalVariant, VisualizerPluginConfig } from '../index';

type Particle = {
  x: number;
  y: number;
  angle: number;
  velocity: number;
  color: string;
};

const PARTICLE_COUNT = 5000;
const RING_POINTS = 200;

const fftSizeForVariant = (variant: ExperimentalVariant): number =>
  variant === 'e2' || variant === 'e5' || variant === 'e7' ? 4096 : 2048;

const hue = (value: number): number => ((value % 360) + 360) % 360;

/**
 * The ThemeSong "Experimental" collection. Each variant has its own drawing
 * routine, but all share the base analyser clock and one canvas. E14 originally
 * used react-three-fiber; because this plugin deliberately stays 2D, it gets a
 * self-contained geometric fallback instead of pulling in a renderer.
 */
export class ExperimentalVisualizer extends ThemeSongVisualizer {
  private readonly variant: ExperimentalVariant;
  private readonly particles: Particle[];
  private zoom = 1;
  private lastElapsed = 0;

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream | null,
    config: VisualizerPluginConfig,
  ) {
    const variant = config.experimental.variant;
    super(
      audioContext,
      audioSource,
      canvas,
      audioNode,
      fftSizeForVariant(variant),
      0.8,
    );
    this.variant = variant;
    this.particles =
      variant === 'e5'
        ? Array.from({ length: PARTICLE_COUNT }, () => ({
            x: Math.random(),
            y: Math.random(),
            angle: Math.random() * Math.PI * 2,
            velocity: Math.random() * 2,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
          }))
        : [];
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

    switch (this.variant) {
      case 'e1':
        this.drawE1(ctx, width, height);
        break;
      case 'e2':
        this.drawE2(ctx, width, height);
        break;
      case 'e4':
        this.drawE4(ctx, width, height, elapsedSeconds, deltaSeconds);
        break;
      case 'e5':
        this.drawE5(ctx, width, height, deltaSeconds);
        break;
      case 'e7':
        this.drawE7(ctx, width, height, elapsedSeconds, deltaSeconds);
        break;
      case 'e8':
        this.drawE8(ctx, width, height, elapsedSeconds);
        break;
      case 'e14':
        this.drawE14(ctx, width, height, elapsedSeconds);
        break;
    }
  }

  /** E1: a ring of rainbow dots indexed by the frequency bins. */
  private drawE1(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    this.fillBackground(ctx, width, height, 'rgba(0, 0, 0, 0.6)');

    const data = this.frequencyData;
    const pointCount = Math.min(data.length, 1024);
    const centerX = width / 2;
    const centerY = height / 2;
    const shortSide = Math.min(width, height);
    const innerRadius = shortSide * 0.18;
    const maxRadius = shortSide * 0.42;
    const dotRadius = Math.max(2, Math.min(6, shortSide / 160));

    for (let index = 0; index < pointCount; index += 1) {
      const angle = (index / pointCount) * Math.PI * 2;
      const distance =
        ((data[index] ?? 0) / 255) * (maxRadius - innerRadius) + innerRadius;
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance;

      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${(index / pointCount) * 360}, 100%, 55%)`;
      ctx.fill();
    }
  }

  /** E2: a mirrored, rainbow frequency waveform across the centre line. */
  private drawE2(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    this.fillBackground(ctx, width, height, 'rgba(0, 0, 0, 0.6)');

    const data = this.frequencyData;
    const sampleCount = Math.min(data.length, 1024);
    const centerY = height / 2;
    const lineWidth = Math.max(1, width / sampleCount);

    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    for (let index = 0; index < sampleCount; index += 1) {
      const x = (index / Math.max(1, sampleCount - 1)) * width;
      const amplitude = ((data[index] ?? 0) / 255) * height * 0.45;
      ctx.strokeStyle = `hsl(${hue((index / sampleCount) * 1000)}, 100%, 60%)`;
      ctx.beginPath();
      ctx.moveTo(x, centerY - amplitude);
      ctx.lineTo(x, centerY + amplitude);
      ctx.stroke();
    }
  }

  /** E4: a zooming-in frequency ring with a slowly rotating camera. */
  private drawE4(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    elapsedSeconds: number,
    deltaSeconds: number,
  ): void {
    this.fillBackground(ctx, width, height, 'rgba(0, 0, 0, 0.45)');
    this.zoom = Math.max(0.08, this.zoom - deltaSeconds * 0.006);
    if (this.zoom <= 0.081) this.zoom = 1;

    this.strokeFrequencyRing(ctx, width, height, {
      radius: Math.min(width, height) * 0.3,
      frequencyDivisor: 255,
      zoom: this.zoom,
      rotation: elapsedSeconds,
      lineWidth: 3,
    });
  }

  /** E5: 5,000 drifting, individually coloured particles. */
  private drawE5(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    deltaSeconds: number,
  ): void {
    this.fillBackground(ctx, width, height, 'rgba(0, 0, 0, 0.6)');

    for (const particle of this.particles) {
      particle.x +=
        (Math.cos(particle.angle) * particle.velocity * deltaSeconds * 60) /
        Math.max(1, width);
      particle.y +=
        (Math.sin(particle.angle) * particle.velocity * deltaSeconds * 60) /
        Math.max(1, height);

      if (particle.x < 0) particle.x += 1;
      else if (particle.x >= 1) particle.x -= 1;
      if (particle.y < 0) particle.y += 1;
      else if (particle.y >= 1) particle.y -= 1;

      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x * width, particle.y * height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** E7: the same rotating ring as E4, but expanding towards the viewer. */
  private drawE7(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    elapsedSeconds: number,
    deltaSeconds: number,
  ): void {
    this.fillBackground(ctx, width, height, 'rgba(0, 0, 0, 0.45)');
    this.zoom += deltaSeconds * 0.6;
    if (this.zoom > 6) this.zoom = 1;

    this.strokeFrequencyRing(ctx, width, height, {
      radius: 30,
      frequencyDivisor: 255,
      zoom: this.zoom,
      rotation: elapsedSeconds,
      lineWidth: 3,
    });
  }

  /** E8: a compact frequency ring with the original black drop shadow. */
  private drawE8(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    elapsedSeconds: number,
  ): void {
    this.fillBackground(ctx, width, height, 'rgba(0, 0, 0, 0.35)');
    ctx.save();
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 8;
    ctx.shadowColor = '#000000';
    this.strokeFrequencyRing(ctx, width, height, {
      radius: Math.min(width, height) * 0.1,
      frequencyDivisor: 50,
      zoom: 1,
      rotation: elapsedSeconds,
      lineWidth: 3,
    });
    ctx.restore();
  }

  /** E14's 2D fallback: two audio-reactive, contoured geometric bodies. */
  private drawE14(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    elapsedSeconds: number,
  ): void {
    const palette = getThemeSongPalette();
    const accent = getAccentHsl();
    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, hslToCss(accent, 0.15));
    background.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const bass = (this.frequencyData[0] ?? 0) / 255;
    const mid =
      (this.frequencyData[Math.min(12, this.frequencyData.length - 1)] ?? 0) /
      255;
    const shortSide = Math.min(width, height);

    ctx.save();
    ctx.translate(width * 0.34, height * 0.5);
    ctx.rotate(elapsedSeconds * 0.7);
    ctx.scale(0.7 + bass * 0.6, 0.7 + bass * 0.6);
    const boxGradient = ctx.createLinearGradient(
      -shortSide * 0.13,
      -shortSide * 0.13,
      shortSide * 0.13,
      shortSide * 0.13,
    );
    boxGradient.addColorStop(0, palette[0] ?? '#ff006e');
    boxGradient.addColorStop(1, palette[2] ?? '#ffbe0b');
    ctx.fillStyle = boxGradient;
    ctx.fillRect(
      -shortSide * 0.13,
      -shortSide * 0.13,
      shortSide * 0.26,
      shortSide * 0.26,
    );
    ctx.restore();

    ctx.save();
    ctx.translate(width * 0.68, height * 0.5);
    ctx.rotate(-elapsedSeconds * 0.45);
    const sphereRadius = shortSide * (0.14 + mid * 0.1);
    const sphere = ctx.createRadialGradient(
      -sphereRadius * 0.35,
      -sphereRadius * 0.35,
      sphereRadius * 0.12,
      0,
      0,
      sphereRadius,
    );
    sphere.addColorStop(0, palette[4] ?? '#8338ec');
    sphere.addColorStop(0.55, palette[3] ?? '#3a86ff');
    sphere.addColorStop(1, 'rgba(5, 8, 25, 0.95)');
    ctx.fillStyle = sphere;
    ctx.beginPath();
    ctx.arc(0, 0, sphereRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.font = `${Math.max(10, shortSide * 0.022)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('E14 · 2D FALLBACK', width / 2, height - 24);
  }

  private fillBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    style: string,
  ): void {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = style;
    ctx.fillRect(0, 0, width, height);
  }

  private strokeFrequencyRing(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    options: {
      radius: number;
      frequencyDivisor: number;
      zoom: number;
      rotation: number;
      lineWidth: number;
    },
  ): void {
    const data = this.frequencyData;
    if (data.length === 0) return;

    const points: Array<{ x: number; y: number; colour: string }> = [];
    const angleIncrement = (Math.PI * 2) / RING_POINTS;
    for (let index = 0; index < RING_POINTS; index += 1) {
      const frequencyIndex = Math.floor(
        (index / RING_POINTS) * Math.min(data.length, 1024),
      );
      const value = data[frequencyIndex] ?? 0;
      const distance =
        options.radius + (value / options.frequencyDivisor) * options.radius;
      points.push({
        x: Math.cos(index * angleIncrement) * distance,
        y: Math.sin(index * angleIncrement) * distance,
        colour: `hsla(${hue(value * 2)}, 100%, 70%, 0.95)`,
      });
    }

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(options.zoom, options.zoom);
    ctx.rotate(options.rotation);
    ctx.lineWidth = options.lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      if (!current || !next) continue;
      ctx.beginPath();
      ctx.moveTo(current.x, current.y);
      ctx.lineTo(next.x, next.y);
      ctx.strokeStyle = current.colour;
      ctx.stroke();
    }
    ctx.restore();
  }
}

export default ExperimentalVisualizer;
