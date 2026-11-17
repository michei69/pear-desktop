// KuGou's public lyrics endpoints, after Metrolist's KuGouLyricsProvider:
// search by a cleaned title/artist (and album as a fallback) for an id and
// access key, then download a base64-encoded LRC. Candidates are duration
// matched because the search is fuzzy; credit-only lines are dropped.

import { parseLrc } from "../lrc.ts";
import type { LyricResult, SearchQuery } from "../types.ts";
import { request, type Fetch } from "./http.ts";
import { splitArtists, textOf } from "./shared.ts";

const SEARCH_URL = "https://lyrics.kugou.com/search";
const DOWNLOAD_URL = "https://lyrics.kugou.com/download";
const DURATION_TOLERANCE_SECONDS = 8;

interface Candidate {
  id: number;
  accesskey: string;
  duration: number;
}

const BRACKETS = [/\(.*\)/, /（.*）/, /「.*」/, /『.*』/, /<.*>/, /《.*》/, /〈.*〉/, /＜.*＞/];
const LRC_TIME = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/;
const CREDIT =
  /^(?:作词|作曲|词|曲|编曲|制作人|词曲|填词|混音|录音|监制|Lyrics|Composer|Composed by|Written by|Arranger|Producer)\s*[:：]/i;

/** Parenthesised and angled extras confuse KuGou's search. */
export function cleanTitle(title: string) {
  return BRACKETS.reduce((text, pattern) => text.replace(pattern, ""), title).trim();
}

/** Artist separators KuGou understands, plus the common Chinese "and". */
export function cleanArtist(artist: string) {
  return BRACKETS.reduce(
    (text, pattern) => text.replace(pattern, ""),
    artist
      .replace(/, | & /g, "、")
      .replace(/\./g, "")
      .replace(/和/g, "、"),
  ).trim();
}

/** KuGou mixes credits into the LRC; only timed, non-credit lines are lyrics. */
export function cleanLrc(lrc: string) {
  return lrc
    .split(/\r?\n/)
    .filter((line) => LRC_TIME.test(line) && !CREDIT.test(line.replace(LRC_TIME, "").trim()))
    .join("\n");
}

/** KuGou reports either seconds or milliseconds, so take the closer interpretation. */
export function durationDiff(candidate: number, targetSeconds: number) {
  return Math.min(Math.abs(candidate - targetSeconds), Math.abs(candidate - targetSeconds * 1000) / 1000);
}

/** Parses the candidates array of a `search` answer, keeping only usable ids and keys. */
export function parseCandidates(value: unknown): Candidate[] {
  const candidates = (value as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((raw) => {
    const entry = raw as { id?: unknown; accesskey?: unknown; duration?: unknown };
    const id = Number(entry?.id);
    const duration = Number(entry?.duration);
    if (!Number.isFinite(id) || typeof entry?.accesskey !== "string" || !Number.isFinite(duration)) return [];
    return [{ id, accesskey: entry.accesskey, duration }];
  });
}

/** The search query is `title - artist album`; build it without awkward separators. */
function searchKeyword(query: SearchQuery, album: string | undefined) {
  const title = cleanTitle(query.title);
  const artist = cleanArtist(query.artist);
  const parts = artist ? [`${title} - ${artist}`] : [title];
  if (album?.trim()) parts.push(album.trim());
  return parts.join(" ").trim();
}

async function searchSongs(fetch: Fetch, query: SearchQuery, album: string | undefined): Promise<Candidate[]> {
  const params: Record<string, string> = {
    ver: "1",
    man: "yes",
    client: "pc",
    keyword: searchKeyword(query, album),
  };
  if (query.durationSeconds > 0) params.duration = String(Math.round(query.durationSeconds * 1000));
  const response = await request(fetch, `${SEARCH_URL}?${new URLSearchParams(params)}`, {
    headers: { Accept: "application/json" },
  });
  const candidates = parseCandidates(await response.json());
  if (query.durationSeconds <= 0 || candidates.length === 0) return candidates;

  const best = candidates.reduce((a, b) =>
    durationDiff(b.duration, query.durationSeconds) < durationDiff(a.duration, query.durationSeconds) ? b : a,
  );
  return durationDiff(best.duration, query.durationSeconds) <= DURATION_TOLERANCE_SECONDS ? [best] : [];
}

async function downloadLyrics(fetch: Fetch, candidate: Candidate): Promise<string | null> {
  const params = new URLSearchParams({
    fmt: "lrc",
    charset: "utf8",
    client: "pc",
    ver: "1",
    id: String(candidate.id),
    accesskey: candidate.accesskey,
  });
  const response = await request(fetch, `${DOWNLOAD_URL}?${params}`, { headers: { Accept: "application/json" } });
  const content = textOf(((await response.json()) as { content?: unknown } | null)?.content);
  if (!content) return null;
  return Buffer.from(content, "base64").toString("utf8");
}

export async function kugou(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  const album = query.album?.trim() || undefined;
  let candidates: Candidate[];
  try {
    candidates = await searchSongs(fetch, query, album);
    if (candidates.length === 0 && album) candidates = await searchSongs(fetch, query, undefined);
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;

  let lrc: string | null;
  try {
    lrc = await downloadLyrics(fetch, candidates[0]!);
  } catch {
    return null;
  }
  if (!lrc) return null;

  const lines = parseLrc(cleanLrc(lrc), query.durationSeconds * 1000).filter((line) => line.text);
  if (lines.length === 0) return null;
  const artists = splitArtists(query.artist);
  return { title: query.title, artists: artists.length ? artists : [], lines };
}
