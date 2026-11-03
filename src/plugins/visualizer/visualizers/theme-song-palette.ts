export type Rgb = { r: number; g: number; b: number };
export type Hsl = { h: number; s: number; l: number };

const FALLBACK = [
  '#ff006e',
  '#fb5607',
  '#ffbe0b',
  '#3a86ff',
  '#8338ec',
  '#06d6a0',
] as const;

const HEX_PATTERN = /^#([\da-f]{3}|[\da-f]{6})$/i;
const RGB_PATTERN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;
const HSL_PATTERN =
  /^hsla?\(\s*(-?[\d.]+)\s*(?:deg)?[\s,]+(-?[\d.]+)%[\s,]+(-?[\d.]+)%(?:\s*\/\s*[-\d.]+%?)?\s*\)$/i;

export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));

export function hexToRgb(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, '');
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((part) => part + part)
          .join('')
      : normalized.padEnd(6, '0').slice(0, 6);
  const channel = Number.parseInt(value, 16);
  return {
    r: (channel >> 16) & 255,
    g: (channel >> 8) & 255,
    b: channel & 255,
  };
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: lightness };

  const saturation = clamp01(delta / (1 - Math.abs(2 * lightness - 1)));
  let hue: number;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;

  return {
    h: (hue * 60 + 360) % 360,
    s: saturation,
    l: clamp01(lightness),
  };
}

export function hslToCss({ h, s, l }: Hsl, alpha = 1): string {
  return `hsla(${h.toFixed(1)} ${clamp01(s) * 100}% ${clamp01(l) * 100}% / ${alpha})`;
}

const channel = (value: string | undefined): number =>
  Math.min(255, Math.max(0, Number(value ?? 0)));

export function parseCssColor(color: string): Hsl | null {
  const value = color.trim();
  if (HEX_PATTERN.test(value)) return rgbToHsl(hexToRgb(value));
  const rgb = RGB_PATTERN.exec(value);
  if (rgb) {
    return rgbToHsl({
      r: channel(rgb[1]),
      g: channel(rgb[2]),
      b: channel(rgb[3]),
    });
  }

  const hsl = HSL_PATTERN.exec(value);
  if (!hsl) return null;
  return {
    h: Number(hsl[1] ?? 0),
    s: clamp01(Number(hsl[2] ?? 0) / 100),
    l: clamp01(Number(hsl[3] ?? 0) / 100),
  };
}

/**
 * ThemeSong normally receives the album's Vibrant palette from its global
 * store. Pear's visualizer is independent from the album-color-theme plugin,
 * so read the colors that plugin publishes as CSS custom properties and fall
 * back to its own vivid defaults. This keeps the Palette/Accent variants
 * useful in every theme.
 */
export function getThemeSongPalette(): Hsl[] {
  const fallback = FALLBACK.map((color) => rgbToHsl(hexToRgb(color)));
  if (typeof document === 'undefined') return fallback;

  const style = getComputedStyle(document.documentElement);
  const parsed = [
    '--paper-progress-active-color-1',
    '--yt-spec-static-brand-red',
    '--ytmusic-color-white1',
    '--yt-spec-text-primary',
  ]
    .map((property) => style.getPropertyValue(property).trim())
    .filter((color) => /^(#|rgb|hsl)/i.test(color))
    .map(parseCssColor)
    .filter((color): color is Hsl => color !== null);

  return parsed.length > 0
    ? [...parsed, ...fallback.slice(parsed.length)]
    : fallback;
}

export function getAccentHsl(): Hsl {
  return getThemeSongPalette()[0] ?? rgbToHsl(hexToRgb(FALLBACK[0]));
}
