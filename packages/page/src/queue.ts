// Maps YTM's raw queue renderers to the API's queue shape, for v2. v1 keeps
// receiving the raw items (`queue` handler), so this is additive.

import { queueRenderer, type QueueItem } from "@pear/sdk";
import { YTM_ORIGIN } from "@pear/sdk/util";

export { queueRenderer };

export interface Thumbnail {
  url: string;
  width?: number;
  height?: number;
}

interface ThumbnailDetails {
  thumbnails?: Thumbnail[];
}

interface TextRuns {
  runs?: { text?: string }[];
}

interface BylineRun {
  text: string;
  navigationEndpoint?: unknown;
}

export interface QueueRenderer {
  videoId?: string;
  title?: TextRuns;
  longBylineText?: { runs?: BylineRun[] };
  lengthText?: TextRuns;
  thumbnail?: ThumbnailDetails;
  selected?: boolean;
  playlistSetVideoId?: string;
  canReorder?: boolean;
  [key: string]: unknown;
}

/** One queue entry, mapped from its raw playlist panel renderer. */
export interface QueueItemResult {
  videoId: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  duration?: string;
  thumbnails?: Thumbnail[];
  thumbnail?: string;
  url: string;
  selected: boolean;
  index: number;
  playlistSetVideoId?: string;
  canReorder: boolean;
  renderer?: QueueRenderer;
}

export interface QueueReply {
  autoplay?: boolean;
  isInfinite?: boolean;
  items?: QueueItemResult[];
  nextQueueItemId?: string;
  playbackContentMode?: string;
  repeatMode?: string;
  currentPlayingItemId?: number;
  shuffleEnabled?: boolean;
  continuation?: string;
}

export interface AutoplayReply {
  items: QueueItemResult[];
  continuation?: string;
}

const BYLINE_DIVIDER = " • ";
const YEAR = /^\d{4}$/;

const bylineParts = (runs?: BylineRun[]) =>
  (runs ?? [])
    .map((run) => run.text)
    .join("")
    .split(BYLINE_DIVIDER)
    .map((part) => part.trim())
    .filter(Boolean);

/** `artist • album • year`: the year is the last part that reads as one. */
export function parseByline(runs?: BylineRun[]) {
  const parts = bylineParts(runs);
  const year = parts.filter((part) => YEAR.test(part)).at(-1);
  return { artist: parts[0], album: parts.slice(1).find((part) => part !== year), year };
}

/** Every size a thumbnail block carries, absent when it carries none. */
export const thumbnailSizes = (details?: ThumbnailDetails): Thumbnail[] | undefined =>
  details?.thumbnails?.length ? details.thumbnails : undefined;

/** The largest of a renderer's thumbnails. */
export const thumbnailUrl = (thumbnails?: Thumbnail[]) => thumbnails?.at(-1)?.url;

/** A queue entry from its raw renderer; items with no video id cannot be played. */
export function queueItem(renderer: QueueRenderer, index: number, raw: boolean): QueueItemResult | undefined {
  const { videoId } = renderer;
  if (!videoId) return undefined;

  const { artist, album, year } = parseByline(renderer.longBylineText?.runs);
  const thumbnails = thumbnailSizes(renderer.thumbnail);
  const thumbnail = thumbnailUrl(thumbnails);
  const title = renderer.title?.runs?.map((run) => run.text ?? "").join("");
  const duration = renderer.lengthText?.runs?.[0]?.text;

  return {
    videoId,
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(year ? { year } : {}),
    ...(duration ? { duration } : {}),
    ...(thumbnails ? { thumbnails } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    url: `${YTM_ORIGIN}/watch?v=${videoId}`,
    selected: renderer.selected === true,
    index,
    ...(renderer.playlistSetVideoId ? { playlistSetVideoId: renderer.playlistSetVideoId } : {}),
    canReorder: renderer.canReorder === true,
    ...(raw ? { renderer } : {}),
  };
}

/** Maps raw queue-style items, skipping unplayable ones. `null` slots are allowed (redux runtime data). */
export function queueItems(items: (QueueItem | null)[] | undefined, raw: boolean): QueueItemResult[] | undefined {
  return items?.flatMap((item, index) => {
    const renderer = queueRenderer(item ?? undefined) as QueueRenderer | undefined;
    const mapped = renderer ? queueItem(renderer, index, raw) : undefined;
    return mapped ? [mapped] : [];
  });
}

/** The next page token a continuations array carries, if any. */
export function continuationToken(continuations?: unknown) {
  const list = continuations as
    | { nextRadioContinuationData?: { continuation?: string }; nextContinuationData?: { continuation?: string } }[]
    | undefined;
  for (const entry of list ?? []) {
    const token = entry.nextRadioContinuationData?.continuation ?? entry.nextContinuationData?.continuation;
    if (token) return token;
  }
  return undefined;
}
