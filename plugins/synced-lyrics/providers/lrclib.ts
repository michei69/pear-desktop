import { parse as parseYaml } from "yaml";
import { finishLines, parseLrc } from "../lrc.ts";
import { queryArtistSimilarity, queryTitleSimilarity } from "../match.ts";
import type { LyricLine, LyricResult, LyricWord, SearchQuery } from "../types.ts";
import { HttpError, request, type Fetch } from "./http.ts";

const BASE = "https://lrclib.net/api";
const MAX_DURATION_DIFF = 15;
const CLIENT_ID = "Pear Desktop (synced-lyrics; https://github.com/pear-devs/pear-desktop)";
export const MAX_SEARCH_ATTEMPTS = 4;
const MAX_RETRY_AFTER_SECONDS = 10;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

interface Entry {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number;
  instrumental: boolean;
  hasWordSync?: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  lyricsfile?: string | null;
}

/** LRCLIB is overloaded or rate limited, not broken: retrying now will not help. */
export const isRetryableStatus = (status: number) => RETRYABLE_STATUSES.has(status);

const NOISE_TAG_PATTERN =
  /\s*[([](?:video\s+oficial|v[ií]deo\s+oficial|letra\s+oficial|video\s+musical|audio\s+oficial|lyric\s+video|official\s+[^)\]]*|visualizer)[)\]]/gi;

/** Video-title noise ("Song (Official Video)") confuses the full-text search. */
export function cleanTrackTitle(rawTitle: string) {
  const cleaned = (rawTitle.replace(NOISE_TAG_PATTERN, "").split(" | ")[0] ?? "").trim();
  return cleaned || rawTitle;
}

/** The full-text searches to try, best first; inexact mode widens them (as pear-desktop). */
export function buildSearchQueries(input: { title: string; alternativeTitle?: string; artist: string; allowInexact: boolean }) {
  const cleanedTitle = cleanTrackTitle(input.title);
  const alternative = input.alternativeTitle ? cleanTrackTitle(input.alternativeTitle) : undefined;
  const candidates: (string | undefined)[] = input.allowInexact
    ? [`${input.artist} ${cleanedTitle}`, `${input.artist} ${input.title}`, alternative, cleanedTitle, input.title]
    : [`${input.artist} ${cleanedTitle}`, `${input.artist} ${input.title}`];
  return Array.from(new Set(candidates.filter((candidate): candidate is string => Boolean(candidate?.trim()))));
}

export type RetryDecision = { retry: true; delayMs: number } | { retry: false };

/** Retry only transient statuses, with bounded backoff; a long `Retry-After` gives up. */
export function retryDecision(options: {
  status: number;
  attempt: number;
  maxAttempts: number;
  retryAfterHeader?: string | undefined;
}): RetryDecision {
  if (!isRetryableStatus(options.status) || options.attempt >= options.maxAttempts) return { retry: false };
  const retryAfter = options.retryAfterHeader ? Number.parseInt(options.retryAfterHeader, 10) : Number.NaN;
  if (retryAfter > MAX_RETRY_AFTER_SECONDS) return { retry: false };
  return {
    retry: true,
    delayMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * options.attempt,
  };
}

/** LRCLIB answers with JSON arrays; an HTML gateway page is an error, not an empty result. */
export function parseSearchResponse(body: string): Entry[] {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("LRCLIB returned an empty response");
  if (trimmed.startsWith("<")) throw new Error("LRCLIB returned HTML instead of JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error("LRCLIB returned a non-JSON response", { cause: error });
  }
  if (!Array.isArray(parsed)) throw new Error(`Expected an array, instead got ${typeof parsed}`);
  return parsed as Entry[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchSearch(fetch: Fetch, q: string, maxAttempts: number): Promise<Entry[]> {
  const url = `${BASE}/search?${new URLSearchParams({ q }).toString()}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await request(fetch, url, { headers: { Accept: "application/json", "Lrclib-Client": CLIENT_ID } });
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError) {
        const decision = retryDecision({
          status: error.status,
          attempt,
          maxAttempts,
          retryAfterHeader: error.retryAfter,
        });
        if (!decision.retry) break;
        await sleep(decision.delayMs);
        continue;
      }
      // Network failures are worth retrying too.
      if (attempt === maxAttempts) break;
      await sleep(1000 * attempt);
      continue;
    }
    return parseSearchResponse(await response.text());
  }

  throw lastError instanceof Error ? lastError : new Error("LRCLIB search failed");
}

export async function lrclib(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  const candidates = buildSearchQueries({
    title: query.title,
    ...(query.alternativeTitle ? { alternativeTitle: query.alternativeTitle } : {}),
    artist: query.artist,
    allowInexact: query.inexact,
  });

  let entries: Entry[] = [];
  let lastError: Error | undefined;
  for (const [index, candidate] of candidates.entries()) {
    const isLast = index === candidates.length - 1;
    try {
      const found = await fetchSearch(fetch, candidate, isLast ? MAX_SEARCH_ATTEMPTS : 2);
      lastError = undefined;
      if (found.length > 0) {
        entries = found;
        break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const status = error instanceof HttpError ? error.status : undefined;
      if (isLast || status === 429 || status === 503) break;
    }
  }

  if (entries.length === 0 && lastError) {
    // Overloaded, not broken: no lyrics from this provider right now.
    if (lastError instanceof HttpError && isRetryableStatus(lastError.status)) return null;
    throw lastError;
  }

  const best = pick(entries, query);
  if (!best || best.instrumental) return null;

  const durationMs = best.duration * 1000;
  const lines =
    (best.hasWordSync && best.lyricsfile ? parseLyricsfile(best.lyricsfile, durationMs) : undefined) ??
    (best.syncedLyrics ? parseLrc(best.syncedLyrics, durationMs) : undefined);
  const plain = best.plainLyrics ?? undefined;
  if (!lines?.length && !plain?.trim()) return null;

  const result: LyricResult = { title: best.trackName, artists: [best.artistName] };
  if (lines?.length) result.lines = lines;
  if (plain) result.plain = plain;
  return result;
}

/** Closest duration among entries by the right artist; word sync and synced lyrics win ties. */
export function pick(entries: readonly Entry[], query: SearchQuery): Entry | undefined {
  const minArtist = query.inexact ? 0.8 : 0.9;
  const candidates = entries.filter(
    (entry) =>
      Math.abs(entry.duration - query.durationSeconds) <= MAX_DURATION_DIFF &&
      queryArtistSimilarity(entry.artistName, query) >= minArtist &&
      (query.inexact || queryTitleSimilarity(entry.trackName, query) >= 0.8),
  );
  const score = (entry: Entry) =>
    // Seconds off, rounded so that richer lyrics win between near-identical durations.
    Math.round(Math.abs(entry.duration - query.durationSeconds) / 2) * 10 -
    (entry.hasWordSync ? 4 : 0) -
    (entry.syncedLyrics ? 2 : 0) -
    (entry.plainLyrics ? 1 : 0);
  return candidates.sort((a, b) => score(a) - score(b))[0];
}

/** LRCLIB's structured format; the only place it exposes word timing. */
export function parseLyricsfile(source: string, durationMs?: number): LyricLine[] | undefined {
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch {
    return;
  }
  const rawLines = (document as { lines?: unknown })?.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) return;

  const lines: LyricLine[] = [];
  for (const raw of rawLines as Record<string, unknown>[]) {
    const start = num(raw.start_ms ?? raw.startMs ?? raw.time_ms);
    if (start === undefined) continue;
    const end = num(raw.end_ms ?? raw.endMs) ?? start;
    const rawWords = Array.isArray(raw.words) ? (raw.words as Record<string, unknown>[]) : [];
    const words: LyricWord[] = [];
    rawWords.forEach((word, i) => {
      const text = String(word.text ?? word.word ?? "");
      const wordStart = num(word.start_ms ?? word.startMs ?? word.time_ms);
      if (!text || wordStart === undefined) return;
      const next = rawWords[i + 1];
      const wordEnd = num(word.end_ms ?? word.endMs) ?? num(next?.start_ms ?? next?.startMs) ?? end;
      words.push({ startMs: wordStart, endMs: wordEnd, text });
    });
    const text = typeof raw.text === "string" ? raw.text : words.map((w) => w.text).join("");
    if (words.length) spaceWords(words, text);
    lines.push({ startMs: start, endMs: end, text: text.trim(), ...(words.length ? { words } : {}) });
  }
  return lines.length ? finishLines(lines, durationMs) : undefined;
}

/** Words may come without their separators; restore them from the line text. */
function spaceWords(words: LyricWord[], text: string) {
  let cursor = 0;
  for (const word of words) {
    const at = text.indexOf(word.text.trim(), cursor);
    if (at < 0) return;
    cursor = at + word.text.trim().length;
    const gap = /^\s+/.exec(text.slice(cursor))?.[0];
    word.text = word.text.trim() + (gap ? " " : "");
  }
}

function num(value: unknown) {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}
