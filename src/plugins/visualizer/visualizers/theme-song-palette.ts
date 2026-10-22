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

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

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

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;

  return { h: (hue * 60 + 360) % 360, s: saturation, l: lightness };
}

export function hslToCss({ h, s, l }: Hsl, alpha = 1): string {
  return `hsla(${h.toFixed(1)} ${clamp(s, 0, 1) * 100}% ${clamp(l, 0, 1) * 100}% / ${alpha})`;
}

/**
 * ThemeSong normally receives the album's Vibrant palette from its global
 * store. Pear's visualizer is independent from the album-color-theme plugin,
 * so read the colors that plugin publishes and fall back to its own vivid
 * defaults. This keeps the Palette/Accent variants useful in every theme.
 */
export function getThemeSongPalette(): string[] {
  if (typeof document === 'undefined') return [...FALLBACK];
  const style = getComputedStyle(document.documentElement);
  const candidates = [
    '--paper-progress-active-color-1',
    '--yt-spec-static-brand-red',
    '--ytmusic-color-white1',
    '--yt-spec-text-primary',
  ]
    .map((property) => style.getPropertyValue(property).trim())
    .filter((color) => /^(#|rgb|hsl)/i.test(color));

  const parsed = candidates
    .map((color) => {
      const match = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
      if (!match) return null;
      const rgb = hexToRgb(color);
      const hsl = rgbToHsl(rgb);
      return hslToCss(hsl);
    })
    .filter((color): color is string => color !== null);

  return parsed.length > 0
    ? [...parsed, ...FALLBACK.slice(parsed.length)]
    : [...FALLBACK];
}

export function getAccentHsl(): Hsl {
  const first = getThemeSongPalette()[0] ?? FALLBACK[0];
  const hexMatch = first.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!hexMatch) return { h: 326, s: 1, l: 0.5 };
  return rgbToHsl(hexToRgb(first));
}
