import { ThemeSongVisualizer } from './theme-song-base';
import {
  getAccentHsl,
  getThemeSongPalette,
  hslToCss,
  type Hsl,
} from './theme-song-palette';

import type { VisualizerPluginConfig } from '../index';

const CIRCUMFERENCE = 2 * Math.PI;
const HSL_PATTERN =
  /^hsla?\(\s*(-?[\d.]+)\s*(?:deg)?[\s,]+(-?[\d.]+)%[\s,]+(-?[\d.]+)%(?:\s*\/\s*[-\d.]+%?)?\s*\)$/i;

interface CircleSpec {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speedX: number;
  speedY: number;
  frequency: number;
  minByte: number;
  minRadius: number;
  growRate: number;
  color: string;
  lineWidth: number;
}

interface CircleState extends CircleSpec {
  radius: number;
}

type ResetMode = 'clamp' | 'random';

function cloneCircle(spec: CircleSpec): CircleState {
  return { ...spec, radius: 0 };
}

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

export class CirclesVisualizer extends ThemeSongVisualizer {
  private readonly config: VisualizerPluginConfig;
  private readonly accent: Hsl;
  private readonly palette: Hsl[];
  private circles: CircleState[];

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioContext, audioSource, canvas, audioNode, 512, 0.85);

    this.config = config;
    this.accent = getAccentHsl();
    this.palette = getThemeSongPalette().map((color) =>
      parseHslCss(color, this.accent),
    );
    this.circles = this.createCircles(config.circles.variant);
  }

  private createCircles(
    variant: VisualizerPluginConfig['circles']['variant'],
  ): CircleState[] {
    switch (variant) {
      case 'rgb':
        return [
          {
            x: 160,
            y: 350,
            dirX: 1,
            dirY: 1,
            speedX: 0.7,
            speedY: 0.2,
            frequency: 0,
            minByte: 190,
            minRadius: 1,
            growRate: 300,
            color: '',
            lineWidth: 6,
          },
          {
            x: 450,
            y: 310,
            dirX: -1,
            dirY: 1,
            speedX: 0.7,
            speedY: 1.2,
            frequency: 20,
            minByte: 20,
            minRadius: 0.5,
            growRate: 700,
            color: '',
            lineWidth: 5,
          },
          {
            x: 310,
            y: 450,
            dirX: -1,
            dirY: 1,
            speedX: 1.4,
            speedY: 1.2,
            frequency: 160,
            minByte: 10,
            minRadius: 0.33,
            growRate: 600,
            color: '',
            lineWidth: 3,
          },
        ].map(cloneCircle);
      case 'accent':
        return [
          {
            x: 160,
            y: 350,
            dirX: 1,
            dirY: -1,
            speedX: 0.4,
            speedY: 0.7,
            frequency: 0,
            minByte: 200,
            minRadius: 1,
            growRate: 300,
            color: '',
            lineWidth: 5,
          },
          {
            x: 150,
            y: 410,
            dirX: 1,
            dirY: -1,
            speedX: 1.2,
            speedY: 1,
            frequency: 190,
            minByte: 0,
            minRadius: 0.32,
            growRate: 800,
            color: '',
            lineWidth: 3,
          },
        ].map(cloneCircle);
      case 'palette':
        return [
          {
            x: 160,
            y: 350,
            dirX: 1,
            dirY: -1,
            speedX: 0.7,
            speedY: 0.2,
            frequency: 0,
            minByte: 200,
            minRadius: 1,
            growRate: 300,
            color: '',
            lineWidth: 4,
          },
          {
            x: 450,
            y: 310,
            dirX: -1,
            dirY: 1,
            speedX: 0.7,
            speedY: 1.2,
            frequency: 40,
            minByte: 20,
            minRadius: 0.6,
            growRate: 500,
            color: '',
            lineWidth: 3,
          },
          {
            x: 230,
            y: 460,
            dirX: -1,
            dirY: -1,
            speedX: 0.8,
            speedY: 0.9,
            frequency: 100,
            minByte: 0,
            minRadius: 0.38,
            growRate: 500,
            color: '',
            lineWidth: 3,
          },
          {
            x: 150,
            y: 420,
            dirX: 1,
            dirY: -1,
            speedX: 0.6,
            speedY: 2,
            frequency: 120,
            minByte: 0,
            minRadius: 0.37,
            growRate: 500,
            color: '',
            lineWidth: 2,
          },
          {
            x: 310,
            y: 450,
            dirX: -1,
            dirY: 1,
            speedX: 1,
            speedY: 0.8,
            frequency: 160,
            minByte: 10,
            minRadius: 0.36,
            growRate: 400,
            color: '',
            lineWidth: 2,
          },
          {
            x: 160,
            y: 310,
            dirX: -1,
            dirY: 1,
            speedX: 0.7,
            speedY: 1,
            frequency: 190,
            minByte: 0,
            minRadius: 0.34,
            growRate: 1000,
            color: '',
            lineWidth: 2,
          },
        ].map(cloneCircle);
      case 'party':
        return [
          this.partyCircle(
            160,
            350,
            1,
            -1,
            0.3,
            0.6,
            0,
            190,
            0.5,
            300,
            'hsla(0, 100%, 45%, 1)',
            5,
          ),
          this.partyCircle(
            450,
            310,
            -1,
            1,
            0.8,
            0.5,
            1,
            100,
            0.3,
            500,
            'hsla(130, 100%, 40%, 1)',
            5,
          ),
          this.partyCircle(
            230,
            460,
            -1,
            -1,
            0.8,
            1.2,
            40,
            0,
            0.3,
            600,
            'hsla(350, 80%, 50%, 1)',
            4,
          ),
          this.partyCircle(
            310,
            450,
            -1,
            1,
            1.4,
            1,
            80,
            0,
            0.3,
            600,
            'hsla(265, 90%, 70%, 1)',
            4,
          ),
          this.partyCircle(
            160,
            310,
            -1,
            1,
            1,
            1.3,
            120,
            10,
            0.3,
            600,
            'hsla(35, 100%, 50%, 1)',
            4,
          ),
          this.partyCircle(
            400,
            100,
            1,
            -1,
            1.5,
            0.8,
            140,
            10,
            0.3,
            600,
            'hsla(170, 100%, 40%, 1)',
            5,
          ),
          this.partyCircle(
            150,
            410,
            1,
            -1,
            1,
            3,
            190,
            0,
            0.3,
            800,
            'hsla(100, 100%, 50%, 1)',
            3,
          ),
          this.partyCircle(
            400,
            290,
            -1,
            -1,
            1.1,
            1.8,
            190,
            0,
            0.3,
            800,
            'hsla(195, 100%, 55%, 1)',
            3,
          ),
          this.partyCircle(
            200,
            310,
            1,
            1,
            0.9,
            0.6,
            200,
            0,
            0.3,
            800,
            'hsla(10, 100%, 50%, 1)',
            3,
          ),
          this.partyCircle(
            160,
            350,
            -1,
            -1,
            0.3,
            0.8,
            0,
            150,
            0.3,
            500,
            'hsla(230, 100%, 50%, 1)',
            5,
          ),
          this.partyCircle(
            420,
            310,
            -1,
            -1,
            0.9,
            0.5,
            0,
            150,
            0.3,
            500,
            'hsla(30, 90%, 50%, 1)',
            5,
          ),
          this.partyCircle(
            230,
            460,
            -1,
            1,
            0.9,
            1.2,
            30,
            0,
            0.3,
            600,
            'hsla(20, 100%, 50%, 1)',
            4,
          ),
          this.partyCircle(
            310,
            450,
            -1,
            -1,
            1.2,
            1,
            70,
            0,
            0.3,
            600,
            'hsla(300, 100%, 70%, 1)',
            4,
          ),
          this.partyCircle(
            160,
            310,
            -1,
            -1,
            1,
            1.4,
            110,
            10,
            0.3,
            600,
            'hsla(350, 100%, 50%, 1)',
            4,
          ),
          this.partyCircle(
            400,
            100,
            -1,
            -1,
            1.5,
            0.5,
            120,
            10,
            0.3,
            600,
            'hsla(210, 100%, 40%, 1)',
            5,
          ),
          this.partyCircle(
            150,
            410,
            1,
            1,
            4,
            1,
            150,
            0,
            0.3,
            800,
            'hsla(280, 100%, 40%, 1)',
            3,
          ),
          this.partyCircle(
            400,
            290,
            1,
            -1,
            1.2,
            1.2,
            170,
            0,
            0.3,
            800,
            'hsla(290, 100%, 50%, 1)',
            3,
          ),
          this.partyCircle(
            200,
            310,
            -1,
            1,
            0.9,
            0.3,
            210,
            0,
            0.3,
            800,
            'hsla(320, 100%, 50%, 1)',
            3,
          ),
        ];
      case 'bubbles':
        return [
          this.partyCircle(
            160,
            350,
            1,
            -1,
            0.3,
            0.6,
            0,
            190,
            0.8,
            200,
            'hsla(0, 100%, 45%, 0.8)',
            1,
          ),
          this.partyCircle(
            450,
            310,
            -1,
            1,
            0.8,
            0.5,
            1,
            100,
            0.5,
            500,
            'hsla(130, 100%, 40%, 0.8)',
            1,
          ),
          this.partyCircle(
            230,
            460,
            -1,
            -1,
            0.8,
            1.2,
            40,
            0,
            0.38,
            600,
            'hsla(40, 100%, 50%, 0.8)',
            1,
          ),
          this.partyCircle(
            310,
            450,
            -1,
            1,
            1.4,
            1,
            80,
            0,
            0.37,
            600,
            'hsla(265, 90%, 70%, 0.8)',
            1,
          ),
          this.partyCircle(
            160,
            310,
            -1,
            1,
            1,
            1.3,
            120,
            10,
            0.36,
            600,
            'hsla(35, 100%, 50%, 0.8)',
            1,
          ),
          this.partyCircle(
            400,
            100,
            1,
            -1,
            1.5,
            0.8,
            140,
            10,
            0.35,
            600,
            'hsla(170, 100%, 40%, 0.8)',
            1,
          ),
          this.partyCircle(
            150,
            410,
            1,
            -1,
            0.6,
            1,
            190,
            0,
            0.32,
            800,
            'hsla(150, 100%, 40%, 0.8)',
            3,
          ),
          this.partyCircle(
            400,
            290,
            -1,
            -1,
            1.1,
            1.8,
            190,
            0,
            0.32,
            800,
            'hsla(350, 90%, 45%, 0.8)',
            3,
          ),
          this.partyCircle(
            200,
            310,
            1,
            1,
            0.9,
            0.6,
            200,
            0,
            0.3,
            800,
            'hsla(10, 100%, 50%, 0.8)',
            3,
          ),
          this.partyCircle(
            160,
            350,
            -1,
            -1,
            0.3,
            0.8,
            0,
            150,
            0.5,
            300,
            'hsla(230, 100%, 50%, 0.8)',
            3,
          ),
          this.partyCircle(
            420,
            310,
            -1,
            -1,
            0.9,
            0.5,
            0,
            150,
            0.5,
            300,
            'hsla(30, 90%, 50%, 0.8)',
            3,
          ),
          this.partyCircle(
            230,
            460,
            -1,
            1,
            0.9,
            1.2,
            30,
            0,
            0.38,
            600,
            'hsla(60, 100%, 50%, 0.8)',
            3,
          ),
          this.partyCircle(
            310,
            450,
            -1,
            -1,
            1.2,
            1,
            70,
            0,
            0.37,
            600,
            'hsla(300, 100%, 70%, 0.8)',
            3,
          ),
          this.partyCircle(
            160,
            310,
            -1,
            -1,
            1,
            1.4,
            110,
            10,
            0.36,
            600,
            'hsla(200, 100%, 50%, 0.8)',
            3,
          ),
          this.partyCircle(
            400,
            100,
            -1,
            -1,
            1.5,
            0.5,
            120,
            10,
            0.35,
            600,
            'hsla(210, 100%, 40%, 0.8)',
            3,
          ),
          this.partyCircle(
            150,
            410,
            1,
            1,
            2,
            0.8,
            150,
            0,
            0.32,
            800,
            'hsla(280, 100%, 40%, 0.8)',
            3,
          ),
          this.partyCircle(
            400,
            290,
            1,
            -1,
            1.2,
            1.2,
            170,
            0,
            0.32,
            800,
            'hsla(290, 100%, 50%, 0.8)',
            3,
          ),
          this.partyCircle(
            200,
            310,
            -1,
            1,
            0.9,
            0.3,
            210,
            0,
            0.3,
            800,
            'hsla(320, 100%, 50%, 0.8)',
            3,
          ),
        ];
      case 'twice':
        return [
          this.partyCircle(
            160,
            350,
            1,
            -1,
            0.3,
            0.6,
            0,
            190,
            1,
            300,
            'hsla(195, 100%, 55%, 0.9)',
            5,
          ),
          this.partyCircle(
            450,
            310,
            -1,
            1,
            0.8,
            0.5,
            2,
            40,
            0.6,
            600,
            'hsla(130, 90%, 45%, 0.9)',
            5,
          ),
          this.partyCircle(
            230,
            460,
            -1,
            -1,
            0.8,
            1.2,
            20,
            0,
            0.38,
            600,
            'hsla(330, 85%, 70%, 0.9)',
            4,
          ),
          this.partyCircle(
            310,
            450,
            -1,
            1,
            1.4,
            1,
            40,
            0,
            0.37,
            600,
            'hsla(275, 85%, 65%, 0.9)',
            4,
          ),
          this.partyCircle(
            160,
            310,
            -1,
            1,
            1,
            1.3,
            80,
            10,
            0.36,
            400,
            'hsla(35, 100%, 50%, 0.9)',
            4,
          ),
          this.partyCircle(
            400,
            100,
            1,
            -1,
            1.5,
            0.8,
            120,
            10,
            0.35,
            600,
            'hsla(170, 100%, 35%, 0.9)',
            5,
          ),
          this.partyCircle(
            150,
            410,
            1,
            -1,
            1,
            3,
            150,
            0,
            0.33,
            800,
            'hsla(0, 0%, 100%, 0.8)',
            3,
          ),
          this.partyCircle(
            400,
            290,
            1,
            1,
            1.5,
            1.2,
            170,
            0,
            0.32,
            900,
            'hsla(0, 100%, 50%, 0.9)',
            3,
          ),
          this.partyCircle(
            200,
            310,
            1,
            1,
            0.9,
            0.6,
            190,
            0,
            0.3,
            800,
            'hsla(230, 100%, 50%, 0.9)',
            3,
          ),
        ];
      case 'stayc':
        return [
          this.partyCircle(
            160,
            350,
            1,
            -1,
            0.3,
            0.6,
            0,
            190,
            1,
            300,
            'hsl(155 81% 30% / 0.9)',
            5,
          ),
          this.partyCircle(
            450,
            310,
            -1,
            1,
            0.8,
            0.5,
            2,
            40,
            0.6,
            600,
            'hsl(12 80% 51% / 0.9)',
            5,
          ),
          this.partyCircle(
            230,
            460,
            -1,
            -1,
            0.8,
            1.2,
            20,
            0,
            0.38,
            600,
            'hsl(40 100% 53% / 0.9)',
            4,
          ),
          this.partyCircle(
            160,
            310,
            -1,
            1,
            1,
            1.3,
            80,
            10,
            0.36,
            400,
            'hsl(303 80% 80% / 0.9)',
            4,
          ),
          this.partyCircle(
            400,
            100,
            1,
            -1,
            1.5,
            0.8,
            120,
            10,
            0.35,
            600,
            'hsl(222 94% 66% / 0.9)',
            5,
          ),
          this.partyCircle(
            150,
            410,
            1,
            -1,
            1,
            3,
            150,
            0,
            0.33,
            800,
            'hsl(278 44% 56% / 0.9)',
            3,
          ),
        ];
    }
  }

  private partyCircle(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    speedX: number,
    speedY: number,
    frequency: number,
    minByte: number,
    minRadius: number,
    growRate: number,
    color: string,
    lineWidth: number,
  ): CircleState {
    return {
      x,
      y,
      dirX,
      dirY,
      speedX,
      speedY,
      frequency,
      minByte,
      minRadius,
      growRate,
      color,
      lineWidth,
      radius: 0,
    };
  }

  private updateCircle(
    circle: CircleState,
    shorterCanvasSide: number,
    resetMode: ResetMode,
  ): void {
    if (circle.y + circle.radius > this.height) {
      circle.dirY = -Math.abs(circle.dirY);
    } else if (circle.y - circle.radius < 0) {
      circle.dirY = Math.abs(circle.dirY);
    }
    if (circle.x + circle.radius > this.width) {
      circle.dirX = -Math.abs(circle.dirX);
    } else if (circle.x - circle.radius < 0) {
      circle.dirX = Math.abs(circle.dirX);
    }

    const movementScale = shorterCanvasSide / 500;
    circle.x += circle.dirX * circle.speedX * movementScale;
    circle.y += circle.dirY * circle.speedY * movementScale;

    if (resetMode === 'random') {
      const resetMargin = 300;
      if (circle.x + circle.radius - resetMargin > this.width) {
        circle.x = Math.random() * this.width;
      } else if (circle.x - circle.radius + resetMargin < 0) {
        circle.x = circle.radius + resetMargin;
      }
      if (circle.y + circle.radius - resetMargin > this.height) {
        circle.y = Math.random() * this.height;
      } else if (circle.y - circle.radius + resetMargin < 0) {
        circle.y = circle.radius + resetMargin;
      }
    } else {
      const edgeMargin = 10;
      if (circle.x + circle.radius - edgeMargin > this.width) {
        circle.x = this.width - circle.radius - edgeMargin;
      } else if (circle.x - circle.radius + edgeMargin < 0) {
        circle.x = circle.radius + edgeMargin;
      }
      if (circle.y + circle.radius - edgeMargin > this.height) {
        circle.y = this.height - circle.radius - edgeMargin;
      } else if (circle.y - circle.radius + edgeMargin < 0) {
        circle.y = circle.radius + edgeMargin;
      }
    }

    const frequency = this.frequencyData[circle.frequency] ?? 0;
    circle.radius =
      (Math.max(frequency - circle.minByte, 0) / circle.growRate +
        circle.minRadius) *
      (shorterCanvasSide / 5);
  }

  private updateCircles(resetMode: ResetMode): number {
    const shorterCanvasSide = Math.min(this.width, this.height);
    for (const circle of this.circles) {
      this.updateCircle(circle, shorterCanvasSide, resetMode);
    }
    return shorterCanvasSide;
  }

  private drawSolidCircle(
    ctx: CanvasRenderingContext2D,
    circle: CircleState,
    fillStyle: string,
    lineWidth: number,
    highlightAlpha?: number,
  ): void {
    ctx.beginPath();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = fillStyle;
    ctx.arc(circle.x, circle.y, circle.radius, 0, CIRCUMFERENCE);
    ctx.fill();
    ctx.stroke();

    if (highlightAlpha !== undefined) {
      ctx.beginPath();
      ctx.moveTo(
        circle.x - circle.radius * 0.55,
        circle.y - circle.radius * 0.5,
      );
      ctx.fillStyle = `rgb(255 255 255 / ${highlightAlpha})`;
      ctx.ellipse(
        circle.x - circle.radius * 0.55,
        circle.y - circle.radius * 0.55,
        circle.radius * 0.08,
        circle.radius * 0.18,
        Math.PI / 4,
        0,
        CIRCUMFERENCE,
      );
      ctx.fill();
    }
  }

  private drawRgbCircles(ctx: CanvasRenderingContext2D): void {
    const first = this.frequencyData[0] ?? 0;
    const fortieth = this.frequencyData[40] ?? 0;
    const oneHundredSixtieth = this.frequencyData[160] ?? 0;
    const colors = [
      hslToCss(
        { h: 345 + Math.max(first - 190, 0) * 0.4 + 1, s: 1, l: 0.5 },
        0.9,
      ),
      hslToCss({ h: 210 + fortieth * 0.4, s: 1, l: 0.5 }, 0.9),
      hslToCss({ h: 105 + oneHundredSixtieth * 0.5, s: 1, l: 0.4 }, 0.9),
    ];

    this.circles.forEach((circle, index) => {
      this.drawSolidCircle(
        ctx,
        circle,
        colors[index] ?? this.accentColor(),
        circle.lineWidth,
      );
    });
  }

  private accentColor(): string {
    return hslToCss(this.accent);
  }

  private drawAccentCircles(
    ctx: CanvasRenderingContext2D,
    shorterCanvasSide: number,
  ): void {
    this.circles.forEach((circle, index) => {
      const base = this.palette[index % this.palette.length] ?? this.accent;
      const lightness = clamp01(
        shorterCanvasSide / (circle.radius / 2.5) / 100 + 0.4,
      );
      this.drawSolidCircle(
        ctx,
        circle,
        hslToCss({ h: base.h, s: base.s, l: lightness }, 0.95),
        circle.lineWidth,
      );
    });
  }

  private drawPaletteCircles(ctx: CanvasRenderingContext2D): void {
    this.circles.forEach((circle, index) => {
      const swatch = this.palette[index % this.palette.length] ?? this.accent;
      this.drawSolidCircle(
        ctx,
        circle,
        hslToCss(swatch, 0.9),
        circle.lineWidth,
      );
    });
  }

  protected draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    ctx.clearRect(0, 0, width, height);

    const variant = this.config.circles.variant;
    const resetMode: ResetMode =
      variant === 'rgb' || variant === 'palette' ? 'clamp' : 'random';
    const shorterCanvasSide = this.updateCircles(resetMode);

    switch (variant) {
      case 'rgb':
        this.drawRgbCircles(ctx);
        break;
      case 'accent':
        this.drawAccentCircles(ctx, shorterCanvasSide);
        break;
      case 'palette':
        this.drawPaletteCircles(ctx);
        break;
      case 'party':
        for (const circle of this.circles) {
          this.drawSolidCircle(ctx, circle, circle.color, circle.lineWidth);
        }
        break;
      case 'bubbles':
        for (const circle of this.circles) {
          this.drawSolidCircle(ctx, circle, circle.color, 1, 0.7);
        }
        break;
      case 'twice':
        for (const circle of this.circles) {
          this.drawSolidCircle(ctx, circle, circle.color, 1, 0.9);
        }
        break;
      case 'stayc':
        for (const circle of this.circles) {
          this.drawSolidCircle(ctx, circle, circle.color, 1, 0.9);
        }
        break;
    }
  }
}

export default CirclesVisualizer;
