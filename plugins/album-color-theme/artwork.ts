// The artwork half of the theme: download, sample and remember a thumbnail's
// palette. Out of index.ts so the fallback and the cache can be tested without
// a page DOM.

import type { Logger } from "@pear/sdk";
import { averageColor, type Rgb, themeColors } from "./color.ts";

/** Artwork that cannot be sampled tints the theme black, as pear-desktop did. */
const BLACK: Rgb = [0, 0, 0];

const SAMPLE_SIZE = 32;
/** Thumbnails are re-requested for the same track (seek, repeat, page re-entry). */
const CACHE_LIMIT = 100;

export interface AlbumColors {
  color: Rgb;
  dark: Rgb;
}

/** Sampled artwork by URL, least recently used first. */
const cache = new Map<string, Promise<AlbumColors>>();

type Sample = (url: string) => Promise<Rgb | undefined>;

/** The artwork's colors, sampled once per thumbnail URL. */
export function albumColors(url: string, log: Pick<Logger, "warn">, sample: Sample = sampleImage): Promise<AlbumColors> {
  const cached = cache.get(url);
  if (cached) {
    // A hit becomes the most recently used entry, so its colors stay longer.
    cache.delete(url);
    cache.set(url, cached);
    return cached;
  }

  const pending = sample(url)
    // A transparent artwork has no average color; it tints black like a failed
    // sample instead of keeping the previous track's tint.
    .then((average) => (average ? themeColors(average) : black()))
    .catch((error: unknown) => {
      // One failed download or decode must not be remembered: dropping the
      // entry lets a later request retry (offline, blocked CDN, tainted canvas).
      cache.delete(url);
      log.warn("couldn't sample artwork", error);
      return black();
    });
  cache.set(url, pending);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  return pending;
}

function black(): AlbumColors {
  return { color: BLACK, dark: BLACK };
}

async function sampleImage(url: string): Promise<Rgb | undefined> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return averageColor(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
}
