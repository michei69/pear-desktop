// Plays the studio song instead of its music video while an album release is
// playing. The release's rows link to the song through an `MPTC` credits id; the
// player request and the queue's rows are rewritten to the song before playback.
//
// This runs before YTM's own scripts (runAt: "start") so the first request is
// already covered. Everything it adds is removed again on stop: the network
// requests it makes are aborted, its caches are dropped, and `window.fetch` is
// put back exactly as it was. If any lookup fails, the original music video is
// left untouched.

import { definePlugin, type PageContext } from "@pear/sdk";
import {
  collect,
  creditsVideoId,
  releaseRequestOf,
  type ReleaseRow,
  type QueueItem,
  releasePlaylistId,
  studioIdFor,
  studioMetadata,
  swappedQueueRow,
} from "./logic.ts";

/** How long one auxiliary InnerTube lookup may take before giving up. */
const LOOKUP_TIMEOUT_MS = 10_000;

interface InnertubeConfig {
  get(key: string): unknown;
}

type Ctx = PageContext<{}, {}>;

export default definePlugin({
  id: "prefer-song",
  name: "Prefer song",
  description: "Plays the album's song instead of the music video when listening to a release.",
  // It patches window.fetch before YTM's scripts load, so enabling it mid-session
  // would miss the queue YTM has already fetched (pear-desktop restarted too).
  restartRequired: true,
  page: {
    // Before YTM's scripts, so no player or queue request slips through.
    runAt: "start",
    start: start,
  },
});

function start(ctx: Ctx) {
  // Keep the exact original for restoring, and a bound copy for calling it.
  const originalFetch = window.fetch;
  const callOriginal = originalFetch.bind(window);
  const studioIdBySetId = new Map<string, string>();
  const releaseRequests = new Map<string, Promise<void>>();
  const playlistRequests = new Map<string, Promise<void>>();
  const studioItemRequests = new Map<string, Promise<QueueItem | undefined>>();
  /** Lookups still in flight, aborted when the plugin stops. */
  const pending = new Set<AbortController>();
  let stopped = false;

  const gunzip = (buffer: ArrayBuffer) => new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"))).text();

  const gzip = (text: string) => new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();

  /** `fetch` for this plugin's own lookups only: bounded in time and cancelled on stop. */
  const lookupFetch = async (url: string, init: RequestInit) => {
    if (stopped) throw new DOMException("prefer-song stopped", "AbortError");
    const controller = new AbortController();
    pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    const abort = () => controller.abort();
    ctx.signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await callOriginal(url, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`request failed with ${response.status}`);
      return response;
    } finally {
      clearTimeout(timeout);
      ctx.signal.removeEventListener("abort", abort);
      pending.delete(controller);
    }
  };

  const innertube = async (path: string, body: Record<string, unknown>) => {
    const config = (window as Window & { ytcfg?: InnertubeConfig }).ytcfg;
    if (!config) throw new Error("InnerTube configuration is not available yet");
    const key = config.get("INNERTUBE_API_KEY");
    if (typeof key !== "string") throw new Error("InnerTube key is not available yet");
    const response = await lookupFetch(
      "/\u0079\u006f\u0075\u0074\u0075\u0062\u0065i/v1/" + path + "?key=" + encodeURIComponent(key) + "&prettyPrint=false",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: config.get("INNERTUBE_CONTEXT"), ...body }),
      },
    );
    return (await response.json()) as unknown;
  };

  /** One `load` per key; a failed load is forgotten, so the next play tries again. */
  const memo = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
    const running = cache.get(key) ?? load();
    cache.set(key, running);
    void running.catch(() => {
      if (cache.get(key) === running) cache.delete(key);
    });
    return running;
  };

  const loadRelease = (browseId: string) =>
    memo(releaseRequests, browseId, async () => {
      const rows = collect<ReleaseRow>(await innertube("browse", { browseId }), "musicResponsiveListItemRenderer");
      for (const row of rows) {
        const studioId = creditsVideoId(row);
        const setId = row.playlistItemData?.playlistSetVideoId;
        if (studioId && setId) studioIdBySetId.set(setId, studioId);
      }
    });

  const loadReleaseOfPlaylist = (playlistId: string) =>
    memo(playlistRequests, playlistId, async () => {
      const playlist = JSON.stringify(await innertube("browse", { browseId: "VL" + playlistId }));
      const browseId = /MPREb_[A-Za-z0-9_-]+/.exec(playlist)?.[0];
      if (browseId) await loadRelease(browseId);
    });

  const studioQueueItem = (videoId: string) =>
    memo(studioItemRequests, videoId, async () => {
      const items = collect<QueueItem>(await innertube("next", { videoId }), "playlistPanelVideoRenderer");
      return items.find((item) => item.videoId === videoId);
    });

  const swapQueueItem = async (item: QueueItem) => {
    const rowId = item.videoId;
    const setId = item.playlistSetVideoId;
    if (!rowId || !setId) return;
    const studioId = studioIdFor(studioIdBySetId, setId, rowId);
    if (!studioId) return;
    const studio = await studioQueueItem(studioId);
    if (!studio || stopped) return;

    // The row carries the video id and type in several nested places, so swap
    // the whole row, then take the song row's display metadata.
    Object.assign(item, swappedQueueRow(item, studioId));
    Object.assign(item, studioMetadata(studio));
  };

  /** The request body, gzipped as YTM sends it; plain JSON is accepted too. */
  const requestBodyOf = async (request: Request): Promise<Record<string, unknown> | null> => {
    let value: unknown;
    try {
      const buffer = await request.arrayBuffer();
      try {
        value = JSON.parse(await gunzip(buffer));
      } catch {
        value = JSON.parse(new TextDecoder().decode(buffer));
      }
    } catch {
      return null;
    }
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  };

  const patchedOr = async <T>(patched: Promise<T | null>, original: T) => {
    try {
      return (await patched) ?? original;
    } catch {
      // Missing metadata, a timeout, or a stopped plugin: play the music video.
      return original;
    }
  };

  const songPlayerRequest = async (request: Request): Promise<Request | null> => {
    if (stopped) return null;
    const body = await requestBodyOf(request.clone());
    if (!body) return null;
    const requestedId = body.videoId;
    if (typeof requestedId !== "string") return null;

    const release = releaseRequestOf(body);
    if (!release) return null;
    if (!studioIdBySetId.has(release.setId)) await loadReleaseOfPlaylist(release.playlistId);

    const studioId = studioIdFor(studioIdBySetId, release.setId, requestedId);
    if (!studioId || stopped) return null;

    body.videoId = studioId;
    return new Request(request, { body: await gzip(JSON.stringify(body)) });
  };

  const songQueueResponse = async (response: Response, sent: Request): Promise<Response | null> => {
    if (stopped) return null;
    const body = await requestBodyOf(sent);
    const playlistId = releasePlaylistId(body?.playlistId);
    if (!playlistId) return null;
    await loadReleaseOfPlaylist(playlistId);
    if (stopped) return null;

    const queue: unknown = JSON.parse(await response.text());
    await Promise.all(collect<QueueItem>(queue, "playlistPanelVideoRenderer").map((item) => swapQueueItem(item)));
    if (stopped) return null;
    return new Response(JSON.stringify(queue), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  };

  const patchedFetch: typeof fetch = async (input, init) => {
    if (stopped || !(input instanceof Request)) return callOriginal(input, init);

    if (input.url.includes("/\u0079\u006f\u0075\u0074\u0075\u0062\u0065i/v1/player")) {
      return callOriginal(await patchedOr(songPlayerRequest(input), input));
    }

    if (input.url.includes("/\u0079\u006f\u0075\u0074\u0075\u0062\u0065i/v1/next")) {
      const sent = input.clone();
      const response = await callOriginal(input);
      return patchedOr(songQueueResponse(response.clone(), sent), response);
    }

    return callOriginal(input, init);
  };

  window.fetch = patchedFetch;
  ctx.log.info("fetch patched for album releases");

  return () => {
    stopped = true;
    for (const controller of pending) controller.abort();
    pending.clear();
    releaseRequests.clear();
    playlistRequests.clear();
    studioItemRequests.clear();
    studioIdBySetId.clear();

    // Another patch may have wrapped ours; only restore what is still ours.
    if (window.fetch === patchedFetch) window.fetch = originalFetch;
    ctx.log.info("fetch restored");
  };
}
