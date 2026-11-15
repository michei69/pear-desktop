// Decoded artwork shared by the host-side OS integrations (notifications, the
// Touch Bar, the Windows media control): pear-desktop's small LRU of decoded
// images plus its workaround for `.jpg` URLs that actually serve a webp.
// Host only: it imports Electron, so it is a subpath and never part of the page bundle.

import { type NativeImage, nativeImage, net } from "electron";

/** How many covers stay decoded, as pear-desktop's image cache. */
const IMAGE_CACHE_LIMIT = 10;
/** pear-desktop's bound on the hidden-webp retry. */
const MAX_RETRIES = 3;

const cache = new Map<string, Promise<NativeImage>>();

/** YTM thumbnails carry a `?sqp=` query; pear-desktop dropped it from `imageSrc`, so one cache entry covers every variant. */
function withoutQuery(url: string): string {
  const end = url.indexOf("?");
  return end === -1 ? url : url.slice(0, end);
}

/**
 * Fetches and decodes one URL. A `.jpg` URL that serves a webp decodes empty;
 * pear-desktop retried with the URL truncated at the last `.jpg`
 * (pear-desktop#315). Resolves empty when the retry is empty too; rejects only
 * when the fetch does.
 */
async function fetchImage(url: string, depth = 0): Promise<NativeImage> {
  if (depth > MAX_RETRIES) return nativeImage.createEmpty();
  const response = await net.fetch(url);
  const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
  if (image.isEmpty() && !url.endsWith(".jpg") && url.includes(".jpg")) {
    const next = url.slice(0, url.lastIndexOf(".jpg") + 4);
    if (next !== url) return fetchImage(next, depth + 1);
  }
  return image;
}

/**
 * The decoded image for `url`, fetched once and kept in a least-recently-used
 * cache, so every consumer of the same cover shares one fetch (a re-shown
 * notification or a repeat of the track does not download it again). Rejections
 * are evicted: a transient failure can be retried.
 */
export function artworkImage(url: string): Promise<NativeImage> {
  const key = withoutQuery(url);
  const cached = cache.get(key);
  if (cached) {
    // Re-insert so the map stays in least-recently-used order.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const pending = fetchImage(key).catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  if (cache.size > IMAGE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}
