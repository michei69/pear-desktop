import { ThemeSongVisualizer } from './theme-song-base';

import type { VisualizerPluginConfig } from '../index';

type Rgb = readonly [number, number, number];
type Vec3 = readonly [number, number, number];
type DiscoFace = readonly [Vec3, Vec3, Vec3];

type Beam = {
  readonly angle: number;
  readonly phase: number;
  readonly speed: number;
  readonly band: readonly [number, number];
  readonly color: Rgb;
};

type ColoredLight = {
  readonly direction: Vec3;
  readonly half: Vec3;
  readonly band: readonly [number, number];
  readonly color: Rgb;
};

type Sparkle = {
  readonly phase: number;
  readonly speed: number;
  readonly elevation: number;
  readonly orbit: number;
  readonly size: number;
  readonly band: readonly [number, number];
  readonly color: Rgb;
};

type DustParticle = {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
  readonly rise: number;
  readonly size: number;
  readonly color: Rgb;
};

type RenderedFace = {
  readonly a: Readonly<{ x: number; y: number }>;
  readonly b: Readonly<{ x: number; y: number }>;
  readonly c: Readonly<{ x: number; y: number }>;
  readonly depth: number;
  readonly color: string;
};

type ProjectedPoint = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
};

type RenderedSparkle = ProjectedPoint & {
  readonly size: number;
  readonly alpha: number;
  readonly color: Rgb;
};

const TAU = Math.PI * 2;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const rgba = (color: Rgb, alpha: number) =>
  `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${clamp(alpha, 0, 1).toFixed(3)})`;

const normalize3 = (x: number, y: number, z: number): Vec3 => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};

const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
};

const LIGHT_COLORS: readonly Rgb[] = [
  [255, 145, 36],
  [42, 255, 118],
  [44, 106, 255],
  [255, 48, 78],
  [255, 226, 58],
  [137, 82, 255],
  [42, 158, 255],
  [255, 255, 255],
];

const makeLight = (
  position: Vec3,
  color: Rgb,
  band: readonly [number, number],
): ColoredLight => {
  const direction = normalize3(position[0], position[1], position[2]);
  return {
    direction,
    half: normalize3(direction[0], direction[1], direction[2] + 1),
    band,
    color,
  };
};

// The light positions mirror the seven point lights in ThemeSong's reference
// scene. A white rim light keeps the unlit side of the sphere readable.
const LIGHTS: readonly ColoredLight[] = [
  makeLight([10, 10, 10], LIGHT_COLORS[0] ?? [255, 145, 36], [0.03, 0.12]),
  makeLight([-10, 10, -10], LIGHT_COLORS[1] ?? [42, 255, 118], [0.15, 0.32]),
  makeLight([10, -50, 10], LIGHT_COLORS[2] ?? [44, 106, 255], [0, 0.05]),
  makeLight([10, 10, -10], LIGHT_COLORS[3] ?? [255, 48, 78], [0.08, 0.2]),
  makeLight([10, -10, -10], LIGHT_COLORS[4] ?? [255, 226, 58], [0.2, 0.4]),
  makeLight([-10, 5, 8], LIGHT_COLORS[5] ?? [137, 82, 255], [0.3, 0.55]),
  makeLight([-20, 0, 8], LIGHT_COLORS[6] ?? [42, 158, 255], [0.45, 0.75]),
  makeLight([0, 8, 12], LIGHT_COLORS[7] ?? [255, 255, 255], [0.55, 1]),
];

const BEAMS: readonly Beam[] = [
  {
    angle: -0.68,
    phase: 0.2,
    speed: 0.31,
    band: [0.02, 0.1],
    color: LIGHT_COLORS[0] ?? [255, 145, 36],
  },
  {
    angle: -2.32,
    phase: 1.6,
    speed: 0.24,
    band: [0.12, 0.27],
    color: LIGHT_COLORS[1] ?? [42, 255, 118],
  },
  {
    angle: 2.08,
    phase: 3.4,
    speed: 0.27,
    band: [0, 0.04],
    color: LIGHT_COLORS[2] ?? [44, 106, 255],
  },
  {
    angle: 0.16,
    phase: 4.8,
    speed: 0.35,
    band: [0.06, 0.16],
    color: LIGHT_COLORS[3] ?? [255, 48, 78],
  },
  {
    angle: -1.48,
    phase: 2.4,
    speed: 0.29,
    band: [0.18, 0.37],
    color: LIGHT_COLORS[4] ?? [255, 226, 58],
  },
  {
    angle: 2.82,
    phase: 5.3,
    speed: 0.22,
    band: [0.28, 0.5],
    color: LIGHT_COLORS[5] ?? [137, 82, 255],
  },
  {
    angle: 3.58,
    phase: 0.9,
    speed: 0.26,
    band: [0.42, 0.72],
    color: LIGHT_COLORS[6] ?? [42, 158, 255],
  },
];

const ICOSAHEDRON_VERTICES: readonly Vec3[] = [
  [-1, (1 + Math.sqrt(5)) / 2, 0],
  [1, (1 + Math.sqrt(5)) / 2, 0],
  [-1, -(1 + Math.sqrt(5)) / 2, 0],
  [1, -(1 + Math.sqrt(5)) / 2, 0],
  [0, -1, (1 + Math.sqrt(5)) / 2],
  [0, 1, (1 + Math.sqrt(5)) / 2],
  [0, -1, -(1 + Math.sqrt(5)) / 2],
  [0, 1, -(1 + Math.sqrt(5)) / 2],
  [(1 + Math.sqrt(5)) / 2, 0, -1],
  [(1 + Math.sqrt(5)) / 2, 0, 1],
  [-(1 + Math.sqrt(5)) / 2, 0, -1],
  [-(1 + Math.sqrt(5)) / 2, 0, 1],
].map(([x, y, z]) => normalize3(x, y, z));

const ICOSAHEDRON_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

/** Build a geodesic sphere so each face can be shaded as a separate mirror. */
const createDiscoFaces = (subdivisions: number): DiscoFace[] => {
  const faces: DiscoFace[] = [];
  const divisions = Math.max(1, Math.floor(subdivisions));

  for (const indices of ICOSAHEDRON_FACES) {
    const vertex0 = ICOSAHEDRON_VERTICES[indices[0]];
    const vertex1 = ICOSAHEDRON_VERTICES[indices[1]];
    const vertex2 = ICOSAHEDRON_VERTICES[indices[2]];
    if (!vertex0 || !vertex1 || !vertex2) continue;

    const pointAt = (row: number, column: number): Vec3 => {
      const weight0 = 1 - (row + column) / divisions;
      const weight1 = row / divisions;
      const weight2 = column / divisions;
      return normalize3(
        vertex0[0] * weight0 + vertex1[0] * weight1 + vertex2[0] * weight2,
        vertex0[1] * weight0 + vertex1[1] * weight1 + vertex2[1] * weight2,
        vertex0[2] * weight0 + vertex1[2] * weight1 + vertex2[2] * weight2,
      );
    };

    for (let row = 0; row < divisions; row += 1) {
      for (let column = 0; column < divisions - row; column += 1) {
        faces.push([
          pointAt(row, column),
          pointAt(row + 1, column),
          pointAt(row, column + 1),
        ]);
        if (row + column <= divisions - 2) {
          faces.push([
            pointAt(row + 1, column),
            pointAt(row + 1, column + 1),
            pointAt(row, column + 1),
          ]);
        }
      }
    }
  }

  return faces;
};

const getSensitivity = (config: VisualizerPluginConfig): number => {
  const settings = config as VisualizerPluginConfig & {
    discoBall?: { sensitivity?: number };
  };
  const value = settings.discoBall?.sensitivity;
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, 0.2, 3)
    : 1;
};

export class DiscoBallVisualizer extends ThemeSongVisualizer {
  private readonly sensitivity: number;
  private readonly faces: readonly DiscoFace[];
  private readonly sparkles: readonly Sparkle[];
  private readonly dust: readonly DustParticle[];
  private readonly spinDirection: number;

  private lastElapsed = -1;
  private bassLevel = 0;
  private midLevel = 0;
  private trebleLevel = 0;
  private overallLevel = 0;
  private rotationY = 0;
  private rotationX = 0.22;
  private rotationZ = 0;
  private smoothedRadius = 0;

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioContext, audioSource, canvas, audioNode, 512, 0.72);

    this.sensitivity = getSensitivity(config);
    this.spinDirection = Math.random() < 0.5 ? -1 : 1;
    this.faces = createDiscoFaces(5);

    const random = createRandom(
      0x9e3779b9 ^ Math.floor(Math.random() * 0xffffffff),
    );
    this.sparkles = Array.from(
      { length: 42 },
      (_, index): Sparkle => ({
        phase: random() * TAU,
        speed: (0.24 + random() * 0.7) * (index % 3 === 0 ? -1 : 1),
        elevation: (random() - 0.5) * 2.3,
        orbit: 1.08 + random() * 0.66,
        size: 0.012 + random() * 0.024,
        band: [random() * 0.45, 0.45 + random() * 0.55],
        color: LIGHT_COLORS[index % LIGHT_COLORS.length] ??
          LIGHT_COLORS[0] ?? [255, 255, 255],
      }),
    );
    this.dust = Array.from(
      { length: 34 },
      (_, index): DustParticle => ({
        x: random(),
        y: random(),
        phase: random() * TAU,
        rise: 0.006 + random() * 0.018,
        size: 0.6 + random() * 1.6,
        color: LIGHT_COLORS[index % LIGHT_COLORS.length] ??
          LIGHT_COLORS[0] ?? [255, 255, 255],
      }),
    );
  }

  private averageFrequency(start: number, end: number): number {
    const length = this.frequencyData.length;
    if (length === 0) return 0;
    const from = clamp(Math.floor(start * length), 0, length - 1);
    const to = clamp(Math.ceil(end * length), from + 1, length);
    let total = 0;
    for (let index = from; index < to; index += 1) {
      total += this.frequencyData[index] ?? 0;
    }
    return clamp(total / (to - from) / 255, 0, 1);
  }

  private updateLevels(dt: number, elapsedSeconds: number): void {
    const bass = this.averageFrequency(0, 0.075);
    const mid = this.averageFrequency(0.075, 0.32);
    const treble = this.averageFrequency(0.32, 0.82);
    const overall = this.averageFrequency(0, 0.82);

    const response = 1 - Math.exp(-dt * 11);
    this.bassLevel += (bass - this.bassLevel) * response;
    this.midLevel += (mid - this.midLevel) * response;
    this.trebleLevel += (treble - this.trebleLevel) * response;
    this.overallLevel += (overall - this.overallLevel) * response;

    this.rotationY +=
      dt *
      this.spinDirection *
      (0.32 + this.overallLevel * 0.86 + this.trebleLevel * 0.34);
    this.rotationX =
      0.2 + Math.sin(elapsedSeconds * 0.24) * 0.09 + this.bassLevel * 0.045;
    this.rotationZ = Math.sin(elapsedSeconds * 0.17) * 0.045;
  }

  private rotatePoint(point: Vec3): Vec3 {
    const cosY = Math.cos(this.rotationY);
    const sinY = Math.sin(this.rotationY);
    const cosX = Math.cos(this.rotationX);
    const sinX = Math.sin(this.rotationX);
    const cosZ = Math.cos(this.rotationZ);
    const sinZ = Math.sin(this.rotationZ);

    const yawX = point[0] * cosY + point[2] * sinY;
    const yawZ = -point[0] * sinY + point[2] * cosY;
    const pitchY = point[1] * cosX - yawZ * sinX;
    const pitchZ = point[1] * sinX + yawZ * cosX;

    return [yawX * cosZ - pitchY * sinZ, yawX * sinZ + pitchY * cosZ, pitchZ];
  }

  private projectPoint(
    point: Vec3,
    centerX: number,
    centerY: number,
    radius: number,
  ): ProjectedPoint {
    const scale = 1 / (1 - point[2] * 0.22);
    return {
      x: centerX + point[0] * radius * scale,
      y: centerY + point[1] * radius * scale,
      z: point[2],
      scale,
    };
  }

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    centerX: number,
    centerY: number,
    radius: number,
  ): void {
    const background = ctx.createRadialGradient(
      centerX,
      centerY,
      radius * 0.15,
      centerX,
      centerY,
      Math.max(width, height) * 0.78,
    );
    background.addColorStop(0, '#0a0d1d');
    background.addColorStop(0.42, '#04050e');
    background.addColorStop(1, '#010104');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(centerX, centerY + radius * 1.45);
    ctx.scale(1, 0.22);
    const floor = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 2.2);
    floor.addColorStop(
      0,
      `rgba(83, 111, 255, ${0.16 + this.bassLevel * 0.13})`,
    );
    floor.addColorStop(
      0.42,
      `rgba(37, 51, 126, ${0.08 + this.midLevel * 0.08})`,
    );
    floor.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 2.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawDust(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    elapsedSeconds: number,
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of this.dust) {
      const y = (((particle.y - elapsedSeconds * particle.rise) % 1) + 1) % 1;
      const x =
        particle.x + Math.sin(elapsedSeconds * 0.14 + particle.phase) * 0.012;
      const twinkle =
        0.35 +
        0.65 * (0.5 + 0.5 * Math.sin(elapsedSeconds * 1.7 + particle.phase));
      ctx.fillStyle = rgba(
        particle.color,
        twinkle * (0.06 + this.overallLevel * 0.24),
      );
      ctx.beginPath();
      ctx.arc(
        x * width,
        y * height,
        particle.size * (0.8 + this.trebleLevel * 0.6),
        0,
        TAU,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBeams(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    centerX: number,
    centerY: number,
    radius: number,
    elapsedSeconds: number,
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const beam of BEAMS) {
      const energy = this.averageFrequency(beam.band[0], beam.band[1]);
      const sweep =
        Math.sin(elapsedSeconds * beam.speed * 2 + beam.phase) * 0.13 +
        (this.bassLevel - 0.35) * 0.06;
      const angle = beam.angle + sweep;
      const reach = Math.max(width, height) * 0.92;
      const originX = centerX + Math.cos(angle) * reach;
      const originY = centerY + Math.sin(angle) * reach * 0.9;
      const endAngle =
        angle + Math.sin(elapsedSeconds * 0.37 + beam.phase) * 0.08;
      const endDistance = radius * (0.5 + energy * 0.18);
      const endX = centerX + Math.cos(endAngle) * endDistance;
      const endY = centerY + Math.sin(endAngle) * endDistance;
      const perpendicularX = -Math.sin(endAngle);
      const perpendicularY = Math.cos(endAngle);
      const halfWidth = radius * (0.26 + energy * 0.22);
      const alpha =
        (0.045 + energy * 0.16) *
        (0.78 + this.sensitivity * 0.22) *
        (0.65 + this.overallLevel * 0.5);

      const gradient = ctx.createLinearGradient(originX, originY, endX, endY);
      gradient.addColorStop(0, rgba(beam.color, 0));
      gradient.addColorStop(0.36, rgba(beam.color, alpha * 0.18));
      gradient.addColorStop(0.78, rgba(beam.color, alpha * 0.72));
      gradient.addColorStop(1, rgba(beam.color, alpha));

      const drawCone = (widthScale: number) => {
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.lineTo(
          endX + perpendicularX * halfWidth * widthScale,
          endY + perpendicularY * halfWidth * widthScale,
        );
        ctx.lineTo(
          endX - perpendicularX * halfWidth * widthScale,
          endY - perpendicularY * halfWidth * widthScale,
        );
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
      };

      drawCone(1);
      drawCone(0.38);

      ctx.strokeStyle = rgba(beam.color, alpha * 1.9);
      ctx.lineWidth = Math.max(0.8, radius * 0.007);
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawHalo(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    radius: number,
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const haloRadius = radius * (1.62 + this.bassLevel * 0.28);
    const halo = ctx.createRadialGradient(
      centerX,
      centerY,
      radius * 0.34,
      centerX,
      centerY,
      haloRadius,
    );
    halo.addColorStop(0, `rgba(98, 124, 255, ${0.04 + this.bassLevel * 0.09})`);
    halo.addColorStop(
      0.55,
      `rgba(72, 92, 220, ${0.025 + this.midLevel * 0.07})`,
    );
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(centerX, centerY, haloRadius, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawSphere(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    radius: number,
    lightLevels: readonly number[],
  ): void {
    const renderedFaces: RenderedFace[] = [];
    let identity = 0;

    for (const face of this.faces) {
      const a = this.rotatePoint(face[0]);
      const b = this.rotatePoint(face[1]);
      const c = this.rotatePoint(face[2]);
      const normal = normalize3(
        ...cross3(
          [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
          [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
        ),
      );
      if (normal[2] <= 0.015) continue;

      const depth = (a[2] + b[2] + c[2]) / 3;
      const facing = Math.max(0, normal[2]);
      let red = 13 + facing * 28;
      let green = 15 + facing * 33;
      let blue = 22 + facing * 44;

      for (let lightIndex = 0; lightIndex < LIGHTS.length; lightIndex += 1) {
        const light = LIGHTS[lightIndex];
        if (!light) continue;
        const diffuse = Math.max(
          0,
          normal[0] * light.direction[0] +
            normal[1] * light.direction[1] +
            normal[2] * light.direction[2],
        );
        const specular = Math.max(
          0,
          normal[0] * light.half[0] +
            normal[1] * light.half[1] +
            normal[2] * light.half[2],
        );
        const energy = lightLevels[lightIndex] ?? 0;
        const diffuseStrength =
          Math.pow(diffuse, 2.1) * (0.42 + energy * 1.42) * this.sensitivity;
        const specularStrength =
          Math.pow(specular, 26) * (0.35 + energy * 1.9) * this.sensitivity;
        red += light.color[0] * diffuseStrength * 0.38 + specularStrength * 155;
        green +=
          light.color[1] * diffuseStrength * 0.38 + specularStrength * 165;
        blue +=
          light.color[2] * diffuseStrength * 0.38 + specularStrength * 185;
      }

      const rim = Math.pow(1 - facing, 2.4) * (22 + this.trebleLevel * 88);
      red += rim * 0.7;
      green += rim * 0.82;
      blue += rim * 1.15;

      // Each facet gets a tiny value shift so adjacent mirrors stay distinct.
      identity = (identity + 37) % 11;
      const facetShift = identity - 5;
      const projectedA = this.projectPoint(a, centerX, centerY, radius);
      const projectedB = this.projectPoint(b, centerX, centerY, radius);
      const projectedC = this.projectPoint(c, centerX, centerY, radius);
      renderedFaces.push({
        a: projectedA,
        b: projectedB,
        c: projectedC,
        depth,
        color: `rgb(${clamp(Math.round(red + facetShift), 0, 255)}, ${clamp(
          Math.round(green + facetShift),
          0,
          255,
        )}, ${clamp(Math.round(blue + facetShift * 1.4), 0, 255)})`,
      });
    }

    renderedFaces.sort((first, second) => first.depth - second.depth);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(215, 228, 255, 0.15)';
    ctx.lineWidth = Math.max(0.45, radius * 0.004);
    for (const face of renderedFaces) {
      ctx.beginPath();
      ctx.moveTo(face.a.x, face.a.y);
      ctx.lineTo(face.b.x, face.b.y);
      ctx.lineTo(face.c.x, face.c.y);
      ctx.closePath();
      ctx.fillStyle = face.color;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderSparkles(
    centerX: number,
    centerY: number,
    radius: number,
    elapsedSeconds: number,
  ): readonly RenderedSparkle[] {
    const rendered: RenderedSparkle[] = [];
    for (const sparkle of this.sparkles) {
      const angle = sparkle.phase + elapsedSeconds * sparkle.speed;
      const orbitPlane = Math.cos(sparkle.elevation) * sparkle.orbit;
      const local: Vec3 = [
        Math.cos(angle) * orbitPlane,
        Math.sin(sparkle.elevation) * sparkle.orbit +
          Math.sin(angle * 1.7 + sparkle.phase) * 0.035,
        Math.sin(angle) * orbitPlane,
      ];
      const rotated = this.rotatePoint(local);
      const projected = this.projectPoint(rotated, centerX, centerY, radius);
      const energy = this.averageFrequency(sparkle.band[0], sparkle.band[1]);
      const twinkle =
        0.32 +
        0.68 * (0.5 + 0.5 * Math.sin(elapsedSeconds * 2.3 + sparkle.phase));
      rendered.push({
        ...projected,
        size:
          radius *
          sparkle.size *
          (0.75 + energy * 0.7 + this.trebleLevel * 0.35),
        alpha: twinkle * (0.2 + energy * 0.7) * (0.7 + this.sensitivity * 0.3),
        color: sparkle.color,
      });
    }
    return rendered;
  }

  private drawSparkles(
    ctx: CanvasRenderingContext2D,
    sparkles: readonly RenderedSparkle[],
    front: boolean,
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const sparkle of sparkles) {
      if (sparkle.z >= 0 !== front) continue;
      const size = Math.max(0.7, sparkle.size);
      const glowAlpha = sparkle.alpha * 0.16;
      ctx.fillStyle = rgba(sparkle.color, glowAlpha);
      ctx.beginPath();
      ctx.arc(sparkle.x, sparkle.y, size * 2.3, 0, TAU);
      ctx.fill();

      ctx.fillStyle = rgba(sparkle.color, sparkle.alpha);
      ctx.beginPath();
      ctx.moveTo(sparkle.x - size * 2.5, sparkle.y);
      ctx.quadraticCurveTo(
        sparkle.x,
        sparkle.y - size * 0.32,
        sparkle.x,
        sparkle.y - size * 2.5,
      );
      ctx.quadraticCurveTo(
        sparkle.x,
        sparkle.y - size * 0.32,
        sparkle.x + size * 2.5,
        sparkle.y,
      );
      ctx.quadraticCurveTo(
        sparkle.x,
        sparkle.y + size * 0.32,
        sparkle.x,
        sparkle.y + size * 2.5,
      );
      ctx.quadraticCurveTo(
        sparkle.x,
        sparkle.y + size * 0.32,
        sparkle.x - size * 2.5,
        sparkle.y,
      );
      ctx.fill();

      ctx.fillStyle = rgba([255, 255, 255], sparkle.alpha * 0.9);
      ctx.beginPath();
      ctx.arc(sparkle.x, sparkle.y, Math.max(0.5, size * 0.42), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  protected draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    elapsedSeconds: number,
  ): void {
    const dt =
      this.lastElapsed < 0
        ? 1 / 60
        : clamp(elapsedSeconds - this.lastElapsed, 0, 0.1);
    this.lastElapsed = elapsedSeconds;
    this.updateLevels(dt, elapsedSeconds);

    const centerX = width * 0.5;
    const centerY = height * (0.47 - this.bassLevel * 0.012);
    const baseRadius = Math.min(width, height) * 0.255;
    const targetRadius =
      baseRadius *
      (1 + this.bassLevel * 0.2 * this.sensitivity + this.midLevel * 0.035);
    if (this.smoothedRadius <= 0) this.smoothedRadius = targetRadius;
    this.smoothedRadius +=
      (targetRadius - this.smoothedRadius) * (1 - Math.exp(-dt * 13));
    const radius = this.smoothedRadius;

    this.drawBackground(ctx, width, height, centerX, centerY, radius);
    this.drawDust(ctx, width, height, elapsedSeconds);
    this.drawBeams(
      ctx,
      width,
      height,
      centerX,
      centerY,
      radius,
      elapsedSeconds,
    );
    this.drawHalo(ctx, centerX, centerY, radius);

    const sparkles = this.renderSparkles(
      centerX,
      centerY,
      radius,
      elapsedSeconds,
    );
    this.drawSparkles(ctx, sparkles, false);
    const lightLevels = LIGHTS.map((light) =>
      this.averageFrequency(light.band[0], light.band[1]),
    );
    this.drawSphere(ctx, centerX, centerY, radius, lightLevels);
    this.drawSparkles(ctx, sparkles, true);
  }
}

export default DiscoBallVisualizer;
