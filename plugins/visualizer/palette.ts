import type { PageContextOf } from "@pear/sdk";

// The ThemeSong visualizers color themselves from the track's artwork. The fork
// read the colors album-color-theme published as CSS variables; the rewrite has
// no such page API, so sample the artwork image itself.

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface ArtworkPalette {
  readonly colors: readonly Hsl[];
  readonly accent: Hsl;
}

/** Sampled small: enough for the dominant hues, and cheap to read back. */
const SAMPLE_SIZE = 32;
const HUE_BUCKETS = 12;
const MAX_COLORS = 6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** pear-desktop's vivid fallback, for when there is no artwork (or it can't be read). */
const FALLBACK = (["#ff006e", "#fb5607", "#ffbe0b", "#3a86ff", "#8338ec", "#06d6a0"] as const).map((hex) => rgbToHsl(hexToRgb(hex)));

function hexToRgb(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => part + part)
          .join("")
      : normalized.padEnd(6, "0").slice(0, 6);
  const channel = Number.parseInt(value, 16);
  return { r: (channel >> 16) & 255, g: (channel >> 8) & 255, b: channel & 255 };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
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

/** The first palette entry, or the fork's default accent when the palette is empty. */
export function accentOf(palette: readonly Hsl[]): Hsl {
  return palette[0] ?? FALLBACK[0] ?? { h: 326, s: 1, l: 0.5 };
}

type PaletteContext = Pick<PageContextOf<{}>, "player" | "log" | "signal">;

/**
 * A live palette: starts with the artwork that is there, then follows track
 * changes. The renderers read it every frame, so a late sample or a new track
 * recolors the running visualizer without restarting it.
 */
export function artworkPalette(ctx: PaletteContext): ArtworkPalette {
  let colors: readonly Hsl[] = FALLBACK;
  let accent: Hsl = accentOf(FALLBACK);
  let generation = 0;

  const sample = async () => {
    const current = ++generation;
    const fallback = () => {
      colors = FALLBACK;
      accent = accentOf(FALLBACK);
    };
    try {
      const url = ctx.player.state.track?.artworkUrl;
      if (!url) {
        fallback();
        return;
      }
      const sampled = await sampleArtwork(url);
      if (current !== generation || ctx.signal.aborted) return;
      colors = sampled;
      accent = accentOf(sampled);
    } catch (error) {
      if (current !== generation || ctx.signal.aborted) return;
      // Cross-origin images without CORS headers taint the canvas.
      fallback();
      ctx.log.warn("couldn't sample the artwork", error);
    }
  };

  ctx.player.on("trackChange", () => void sample());
  void sample();
  return {
    get colors() {
      return colors;
    },
    get accent() {
      return accent;
    },
  };
}

async function sampleArtwork(url: string): Promise<readonly Hsl[]> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return quantize(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
}

interface Bucket {
  weight: number;
  saturation: number;
  lightness: number;
}

/**
 * The dominant vivid hues of the artwork, most prominent first. Greys carry no
 * identity, so they are skipped; the palette is padded with the fallback colors
 * so every visualizer has enough entries for its modulo indexing.
 */
function quantize(pixels: Uint8ClampedArray): readonly Hsl[] {
  const buckets: Bucket[] = Array.from({ length: HUE_BUCKETS }, () => ({ weight: 0, saturation: 0, lightness: 0 }));

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3]! < 128) continue;
    const { h, s, l } = rgbToHsl({ r: pixels[index]!, g: pixels[index + 1]!, b: pixels[index + 2]! });
    if (s < 0.12 || l < 0.08 || l > 0.94) continue;
    // Vivid mid-tones say more about the artwork than washed-out or near-black pixels.
    const weight = s * (1 - Math.abs(l - 0.5));
    const bucket = buckets[Math.floor((h / 360) * HUE_BUCKETS) % HUE_BUCKETS]!;
    bucket.weight += weight;
    bucket.saturation += s * weight;
    bucket.lightness += l * weight;
  }

  const colors = buckets
    .map((bucket, index) => ({ bucket, hue: ((index + 0.5) / HUE_BUCKETS) * 360 }))
    .filter(({ bucket }) => bucket.weight > 0)
    .sort((a, b) => b.bucket.weight - a.bucket.weight)
    .slice(0, MAX_COLORS)
    .map(({ bucket, hue }) => ({
      h: hue,
      // Keep the theme recognisable but saturated enough to read over black.
      s: clamp(Math.max(bucket.saturation / bucket.weight, 0.55), 0, 1),
      l: clamp(bucket.lightness / bucket.weight, 0.45, 0.66),
    }));

  return colors.length > 0 ? [...colors, ...FALLBACK.slice(colors.length)] : FALLBACK;
}
