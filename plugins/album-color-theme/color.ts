// Just enough color math for the theme: averaging artwork pixels and darkening
// the result until it is dark enough to sit behind white text.

export type Rgb = readonly [r: number, g: number, b: number];

/**
 * Average of RGBA pixels, weighted by alpha. Squares are averaged (then rooted)
 * so the result matches how the image looks rather than its raw sRGB numbers.
 */
export function averageColor(pixels: ArrayLike<number>): Rgb | undefined {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3]! / 255;
    if (a === 0) continue;
    r += pixels[i]! ** 2 * a;
    g += pixels[i + 1]! ** 2 * a;
    b += pixels[i + 2]! ** 2 * a;
    weight += a;
  }
  if (weight === 0) return;
  return [Math.sqrt(r / weight), Math.sqrt(g / weight), Math.sqrt(b / weight)].map(Math.round) as unknown as Rgb;
}

/** WCAG relative luminance, 0–1. */
export function luminance([r, g, b]: Rgb) {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Scales HSL lightness by `1 - amount`, keeping hue and saturation. */
export function darken(color: Rgb, amount: number): Rgb {
  const [h, s, l] = toHsl(color);
  return fromHsl(h, s, l * (1 - amount));
}

/** The base and dark theme colors for an artwork's average color. */
export function themeColors(average: Rgb): { color: Rgb; dark: Rgb } {
  let color = darken(average, 0.15);
  let dark = darken(average, 0.3);
  for (let i = 0; i < 100 && luminance(color) > 0.5; i++) {
    color = darken(color, 0.05);
    dark = darken(dark, 0.05);
  }
  return { color, dark };
}

export const formatRgb = (color: Rgb) => color.map((c) => Math.round(c)).join(", ");

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Hex or rgb()/rgba(); the bases mixed with artwork colors are all of those. */
export function parseColor(value: string): Rgba | undefined {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex) {
    const digits = hex[1]!;
    const short = digits.length <= 4;
    const channel = (index: number) => {
      const part = short ? digits[index]!.repeat(2) : digits.slice(index * 2, index * 2 + 2);
      return Number.parseInt(part, 16);
    };
    if (![3, 4, 6, 8].includes(digits.length)) return;
    return {
      r: channel(0),
      g: channel(1),
      b: channel(2),
      a: digits.length === 4 ? Number.parseInt(digits[3]!.repeat(2), 16) / 255 : digits.length === 8 ? channel(3) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (!rgb) return;
  const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return;
  const number = (part: string | undefined) => Number.parseFloat(part ?? "");
  const [r, g, b, a] = parts;
  if (![r, g, b].every((part) => Number.isFinite(number(part)))) return;
  return { r: number(r), g: number(g), b: number(b), a: a === undefined ? 1 : number(a) };
}

/**
 * Resolves `color-mix(in srgb, base, tint ratio)` in JS, so the browser does
 * not re-resolve a color-mix() expression for every property on every style
 * recalc. `alpha` is the tint's opacity (the transparent-player setting).
 */
export function mixColor(base: string, tint: Rgb, alpha: number, ratio: number): string {
  const underneath = parseColor(base);
  if (!underneath) return base;

  const tintWeight = Math.min(Math.max(ratio, 0), 1);
  const baseWeight = 1 - tintWeight;
  const tintAlpha = Math.min(Math.max(alpha, 0), 1);
  const outAlpha = underneath.a * baseWeight + tintAlpha * tintWeight;
  if (outAlpha <= 0) return "rgba(0, 0, 0, 0)";

  const channel = (baseChannel: number, tintChannel: number) =>
    Math.round((baseChannel * underneath.a * baseWeight + tintChannel * tintAlpha * tintWeight) / outAlpha);
  return `rgba(${channel(underneath.r, tint[0])}, ${channel(underneath.g, tint[1])}, ${channel(underneath.b, tint[2])}, ${+outAlpha.toFixed(3)})`;
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}
