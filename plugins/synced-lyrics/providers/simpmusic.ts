// SimpMusic: a YTM-id-keyed lyrics API. Its rich sync is Apple-Music-style
// (`[line]v1:<word time>text`), so the word tags are kept and the singer prefix
// dropped before the line parser turns them into karaoke words.

import { parseLrc } from "../lrc.ts";
import type { LyricResult, SearchQuery } from "../types.ts";
import type { Fetch } from "./http.ts";

const BASE = "https://api-lyrics.simpmusic.org";
/** The API only answers clients that identify themselves as SimpMusic. */
const CLIENT_USER_AGENT = "SimpMusicLyrics/1.0";

interface SimpMusicEntry {
  songTitle?: unknown;
  artistName?: unknown;
  plainLyric?: unknown;
  syncedLyrics?: unknown;
  richSyncLyrics?: unknown;
  vote?: unknown;
}

const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const NAMED_ENTITIES: Record<string, string> = {
  "amp": "&",
  "lt": "<",
  "gt": ">",
  "quot": '"',
  "apos": "'",
  "nbsp": "\u00a0",
  "hellip": "…",
  "mdash": "—",
  "ndash": "–",
  "lsquo": "‘",
  "rsquo": "’",
  "ldquo": "“",
  "rdquo": "”",
  "middot": "·",
  "bull": "•",
  "copy": "©",
  "reg": "®",
  "trade": "™",
  "deg": "°",
};

const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;

/** SimpMusic puts HTML entities in its payloads, numeric ones included. */
export function decodeHtmlEntities(text: string) {
  return text.replace(ENTITY, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const codePoint = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const RICH_LINE = /^\[(\d+):(\d+(?:[.:]\d+)?)\](?:v\d+:\s*)?(.*)$/;

/** Apple-Music-style rich sync to enhanced LRC, minus the singer prefix. */
export function richSyncToLrc(rich: string): string {
  return rich
    .split(/\r?\n/)
    .map((raw) => {
      const match = RICH_LINE.exec(raw.trim());
      if (!match) return "";
      const [, minutes, seconds, rest] = match;
      return rest!.trim() ? `[${minutes}:${seconds}]${rest!.trim()}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Rich sync beats line sync beats plain; the entry's votes break near-ties. */
const rankEntry = (entry: SimpMusicEntry): number => {
  const vote = Number(entry.vote);
  const voteScore = Number.isFinite(vote) ? Math.max(-9, Math.min(9, vote)) : 0;

  if (textOf(entry.richSyncLyrics)) return 100 + voteScore;
  if (textOf(entry.syncedLyrics)) return 50 + voteScore;
  if (textOf(entry.plainLyric)) return 10 + voteScore;
  return -1;
};

export function pickBestSimpMusicEntry(entries: SimpMusicEntry[]): SimpMusicEntry | null {
  let best: SimpMusicEntry | null = null;
  let bestScore = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const score = rankEntry(entry);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

const splitArtists = (artists: string) =>
  artists
    .split(/[&,]|\s+(?:feat\.?|ft\.?)\s+/i)
    .map((artist) => artist.trim())
    .filter(Boolean);

async function fetchEntry(fetch: Fetch, videoId: string): Promise<[number, string]> {
  const response = await fetch(`${BASE}/v1/${encodeURIComponent(videoId)}`, {
    headers: { "Accept": "application/json", "User-Agent": CLIENT_USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  return [response.status, await response.text()];
}

export async function simpmusic(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  // The API is keyed by YTM video id only.
  if (!query.videoId) return null;

  const [status, text] = await fetchEntry(fetch, query.videoId);
  if (status === 404) return null;
  if (status < 200 || status >= 300) throw new Error(`${new URL(BASE).host} responded ${status}`);

  let parsed: { type?: unknown; data?: unknown } | null;
  try {
    parsed = JSON.parse(text) as { type?: unknown; data?: unknown } | null;
  } catch {
    return null;
  }
  if (!parsed || parsed.type !== "success" || !Array.isArray(parsed.data)) return null;

  const entry = pickBestSimpMusicEntry(parsed.data as SimpMusicEntry[]);
  if (!entry) return null;

  const rich = decodeHtmlEntities(textOf(entry.richSyncLyrics));
  const lrc = (rich ? richSyncToLrc(rich) : "") || decodeHtmlEntities(textOf(entry.syncedLyrics));
  const plain = decodeHtmlEntities(textOf(entry.plainLyric));

  const lines = lrc ? parseLrc(lrc, query.durationSeconds * 1000) : [];
  if (lines.length === 0 && !plain) return null;

  const artists = splitArtists(textOf(entry.artistName) || query.artist);
  const result: LyricResult = {
    title: textOf(entry.songTitle) || query.title,
    artists: artists.length > 0 ? artists : splitArtists(query.artist),
  };
  if (lines.length > 0) result.lines = lines;
  if (plain) result.plain = plain;
  return result;
}
