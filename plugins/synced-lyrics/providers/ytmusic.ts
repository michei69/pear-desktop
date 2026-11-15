// YTM's own lyrics (mostly LyricFind), fetched straight from
// InnerTube. The mobile client returns timed lines when YTM has them.

import { finishLines } from "../lrc.ts";
import type { LyricLine, LyricResult, SearchQuery } from "../types.ts";
import { getJson, type Fetch } from "./http.ts";

const API = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/\u0079\u006f\u0075\u0074\u0075\u0062\u0065i/v1";
const WEB_CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20250101.01.00", hl: "en" };
const MOBILE_CLIENT = { clientName: "26", clientVersion: "7.01.05", hl: "en" };

interface TimedLine {
  lyricLine?: string;
  cueRange?: { startTimeMilliseconds: string; endTimeMilliseconds: string };
}

/** pear-desktop's public browse proxy, used before the direct browse unless turned off. */
const PROXY = "https://ytmbrowseproxy.zvz.be";

export interface YtmusicOptions {
  /** Ask the public browse proxy first and fall back to the direct request. */
  useProxy?: boolean;
}

/** The InnerTube `/next` answer for a video (the page's queue is in it). */
export function nextForVideo(fetch: Fetch, videoId: string) {
  return getJson<unknown>(fetch, `${API}/next?prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com" },
    body: JSON.stringify({ videoId, context: { client: WEB_CLIENT } }),
  });
}

/** Title, artist, album and length of a video, read from its watch-next queue entry. */
export interface VideoInfo {
  title: string;
  artist: string;
  album?: string;
  durationSeconds: number;
}

const BYLINE_DIVIDER = " • ";
const YEAR = /^\d{4}$/;

function bylineParts(runs?: { text?: string }[]): string[] {
  return (runs ?? [])
    .map((run) => run.text ?? "")
    .join("")
    .split(BYLINE_DIVIDER)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** "4:21" or "1:02:03", in seconds; 0 when the length is missing or malformed. */
export function bylineDuration(text?: string): number {
  const parts = (text ?? "").split(":").map(Number);
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * The queue entry of `videoId` in a `/next` answer. Lets the API (and a queued
 * next track) look up lyrics for a video the player is not on.
 */
export function queueTrackFromNext(next: unknown, videoId: string): VideoInfo | null {
  const data = next as Record<string, any>;
  const tabs = data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
  const contents = tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents;
  if (!Array.isArray(contents)) return null;

  for (const item of contents as Record<string, any>[]) {
    const renderer =
      item?.playlistPanelVideoRenderer ?? item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    if (renderer?.videoId !== videoId) continue;
    const title = (renderer.title?.runs ?? [])
      .map((run: { text?: string }) => run.text ?? "")
      .join("")
      .trim();
    const parts = bylineParts(renderer.longBylineText?.runs);
    const year = parts.filter((part) => YEAR.test(part)).at(-1);
    const album = parts.slice(1).find((part) => part !== year);
    const info: VideoInfo = {
      title,
      artist: parts[0] ?? "",
      durationSeconds: bylineDuration(renderer.lengthText?.runs?.[0]?.text),
    };
    if (album) info.album = album;
    return info;
  }
  return null;
}

export async function ytmusic(query: SearchQuery, fetch: Fetch, options?: YtmusicOptions): Promise<LyricResult | null> {
  const next = await nextForVideo(fetch, query.videoId);
  const browseId = findLyricsBrowseId(next);
  if (!browseId) return null;

  const browse = await fetchBrowse(fetch, browseId, options);
  const result: LyricResult = { title: query.title, artists: [query.artist] };

  const timed = findDeep(browse, (node) => Array.isArray(node.timedLyricsData))?.timedLyricsData as TimedLine[] | undefined;
  if (timed?.length) {
    if (timed.every((line) => line.cueRange)) {
      const lines: LyricLine[] = timed.map((line) => {
        const text = (line.lyricLine ?? "").trim();
        return {
          startMs: Number(line.cueRange!.startTimeMilliseconds),
          endMs: Number(line.cueRange!.endTimeMilliseconds),
          text: text === "♪" ? "" : text,
        };
      });
      result.lines = finishLines(lines, query.durationSeconds * 1000);
    } else {
      result.plain = timed.map((line) => line.lyricLine ?? "").join("\n");
    }
    return result;
  }

  const shelf = findDeep(browse, (node) => !!node.musicDescriptionShelfRenderer)?.musicDescriptionShelfRenderer;
  const text = runsText(shelf?.description);
  if (!text?.trim()) return null;
  result.plain = text;
  return result;
}

function findLyricsBrowseId(next: unknown): string | undefined {
  const endpoint = findDeep(
    next,
    (node) =>
      node.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ===
      "MUSIC_PAGE_TYPE_TRACK_LYRICS",
  );
  return endpoint?.browseEndpoint?.browseId;
}

/**
 * As pear-desktop: the proxy first (it works where the direct InnerTube browse
 * is blocked or captcha'd) and the direct request when it fails; direct only
 * when the "without proxy" switch is on.
 */
function fetchBrowse(fetch: Fetch, browseId: string, options?: YtmusicOptions) {
  return options?.useProxy
    ? fetchBrowseProxied(fetch, browseId).then((proxied) => proxied ?? fetchBrowseDirect(fetch, browseId))
    : fetchBrowseDirect(fetch, browseId);
}

function fetchBrowseDirect(fetch: Fetch, browseId: string): Promise<Record<string, any>> {
  return getJson<Record<string, any>>(fetch, `${API}/browse?prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com" },
    body: JSON.stringify({ browseId, context: { client: MOBILE_CLIENT } }),
  });
}

async function fetchBrowseProxied(fetch: Fetch, browseId: string): Promise<Record<string, any> | null> {
  try {
    return await getJson<Record<string, any>>(fetch, `${PROXY}/browse?prettyPrint=false`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify({ browseId, context: { client: WEB_CLIENT } }),
    });
  } catch (error) {
    console.warn("[pear:synced-lyrics] proxied YTM browse failed; retrying directly", error);
    return null;
  }
}

/** One line per run: the shelf holds plain lyrics that way, as pear-desktop read it. */
function runsText(value: any): string | undefined {
  return Array.isArray(value?.runs) ? value.runs.map((run: { text?: string }) => run.text ?? "").join("\n") : undefined;
}

/** Depth-first search for the first object matching `predicate` (InnerTube shapes shift a lot). */
function findDeep(root: unknown, predicate: (node: Record<string, any>) => boolean): Record<string, any> | undefined {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (!Array.isArray(node) && predicate(node as Record<string, any>)) return node as Record<string, any>;
    const values = Object.values(node);
    for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
  }
}
