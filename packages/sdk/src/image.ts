export interface ThumbnailSource {
  url: string;
  width: number;
  height: number;
}

export function largestThumbnailUrl(thumbnails: readonly ThumbnailSource[] | undefined): string | undefined {
  const best = thumbnails?.toSorted((a, b) => b.width * b.height - a.width * a.height)[0];
  return best?.url.split("?")[0];
}

export async function sampleImagePixels(url: string, size = 32): Promise<Uint8ClampedArray> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, size, size);
  return context.getImageData(0, 0, size, size).data;
}

const pixelCache = new Map<string, Promise<Uint8ClampedArray>>();
const PIXEL_CACHE_LIMIT = 100;

/**
 * `sampleImagePixels` with an LRU by URL: the album theme and the visualizer
 * both sample the same artwork, and a repeat/seek must not re-download it.
 * Failed samples are not cached, so an offline start retries later.
 */
export function sampleImagePixelsCached(url: string, size = 32): Promise<Uint8ClampedArray> {
  const key = `${size}:${url}`;
  const hit = pixelCache.get(key);
  if (hit) {
    pixelCache.delete(key);
    pixelCache.set(key, hit);
    return hit;
  }
  const pending = sampleImagePixels(url, size).catch((error: unknown) => {
    pixelCache.delete(key);
    throw error;
  });
  pixelCache.set(key, pending);
  while (pixelCache.size > PIXEL_CACHE_LIMIT) {
    const oldest = pixelCache.keys().next();
    if (oldest.done) break;
    pixelCache.delete(oldest.value);
  }
  return pending;
}
