// lrc.red: TTML lyrics with word/syllable timings, duet sides, background
// vocals and translations. A track is matched by title/artist/album/duration
// (the server owns ISRC resolution); the song payload carries both the original
// TTML and a JSON rendering, used when the TTML cannot be parsed.

import { parseTTML, type TTMLParsedLine } from "../ttml.ts";
import type { LyricResult, LyricTranslation, LyricWord, SearchQuery } from "../types.ts";
import type { Fetch } from "./http.ts";

const BASE = "https://lrc.red";
const REQUEST_TIMEOUT_MS = 10_000;
const DURATION_TOLERANCE_SECONDS = 15;

/** Artist names as displayed, e.g. `ROSÉ, Bruno Mars` -> two artists. */
const splitArtists = (artists: string) =>
  artists
    .split(/[&,]|\s+(?:feat\.?|ft\.?)\s+/i)
    .map((artist) => artist.trim())
    .filter(Boolean);

/** Payload strings are untrusted, so only real strings are kept. */
const textOf = (value: unknown) => (typeof value === "string" ? value : "");

const toSeconds = (value: unknown, fallback: number) => {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : fallback;
};

const NOISE_TAG_PATTERN =
  /\s*[([](?:video\s+oficial|v[ií]deo\s+oficial|letra\s+oficial|video\s+musical|audio\s+oficial|lyric\s+video|official\s+[^)\]]*|visualizer)[)\]]/gi;

/** The title without music-video noise tags; lrc.red matches better on it. */
function cleanTrackTitle(rawTitle: string): string {
  const cleaned = rawTitle.replace(NOISE_TAG_PATTERN, "").split(" | ")[0]!.trim();
  return cleaned || rawTitle;
}

interface LrcRedHit {
  isrc?: string;
  title?: string;
  artist?: string;
  duration?: number;
}

interface LrcRedWord {
  begin?: unknown;
  end?: unknown;
  text?: unknown;
}

interface LrcRedJsonLine {
  begin?: unknown;
  end?: unknown;
  text?: unknown;
  words?: LrcRedWord[][];
}

interface LrcRedSong {
  title?: unknown;
  artist?: unknown;
  duration?: unknown;
  source?: unknown;
  lyrics?: { lines?: LrcRedJsonLine[] };
}

async function requestJson<T>(fetch: Fetch, url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status < 200 || response.status >= 300) return null;
    return (await response.json()) as T;
  } catch {
    // lrc.red is an optional source: a blocked or slow request means "no lyrics".
    return null;
  }
}

/** The words of one JSON line, flattened from its `[[syllable, ...], ...]` groups. */
function jsonLineWords(line: LrcRedJsonLine, begin: number, end: number): LyricWord[] {
  const groups = (line.words ?? []).filter((group) => Array.isArray(group));
  const words: LyricWord[] = [];

  groups.forEach((group, groupIndex) => {
    group.forEach((syllable, syllableIndex) => {
      const text = textOf(syllable.text);
      if (!text) return;
      const isLastOfGroup = syllableIndex === group.length - 1;
      words.push({
        text: isLastOfGroup && groupIndex < groups.length - 1 ? `${text} ` : text,
        startMs: toSeconds(syllable.begin, begin),
        endMs: 0,
      });
    });
  });

  words.forEach((word, index) => {
    const next = words[index + 1];
    word.endMs = Math.max(word.startMs, next ? next.startMs : end);
  });

  return words;
}

/** Fallback for payloads without TTML: the word/line-synced JSON lyrics. */
export function linesFromJson(song: LrcRedSong): LyricResult["lines"] {
  const entries = song.lyrics?.lines;
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry) => {
    const startMs = toSeconds(entry.begin, Number.NaN);
    if (!Number.isFinite(startMs)) return [];

    const endMs = toSeconds(entry.end, startMs);
    const words = jsonLineWords(entry, startMs, endMs);
    const text = words.length
      ? words
          .map((word) => word.text)
          .join("")
          .trim()
      : textOf(entry.text).trim();
    if (!text) return [];

    return [
      {
        startMs,
        endMs: Math.max(startMs, endMs),
        text,
        ...(words.length ? { words } : {}),
      },
    ];
  });
}

const toLineLyrics = (line: TTMLParsedLine) => ({
  startMs: line.startMs,
  endMs: line.endMs,
  text: line.text,
  ...(line.words.length ? { words: line.words } : {}),
  ...(line.background.length ? { background: line.background } : {}),
  ...(line.alignment ? { alignment: line.alignment } : {}),
  ...(line.rtl ? { rtl: true } : {}),
});

/**
 * lrc.red: TTML lyrics with word and syllable timings. A track is matched by
 * title/artist/album/duration, then the song payload is read.
 */
export async function lrcred(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  const track = cleanTrackTitle(query.title || query.alternativeTitle || "");
  if (!track && !query.artist) return null;

  const params = new URLSearchParams();
  if (track) params.set("track", track);
  if (query.artist) params.set("artist", query.artist);
  if (query.album) params.set("album", query.album);
  if (query.durationSeconds > 0) params.set("duration", String(Math.round(query.durationSeconds)));

  const payload = await requestJson<{ hits?: LrcRedHit[] } | LrcRedHit[]>(fetch, `${BASE}/match.json?${params.toString()}`);
  const hits = Array.isArray(payload) ? payload : (payload?.hits ?? []);

  const hit =
    hits.find((entry) => {
      if (typeof entry.isrc !== "string" || !entry.isrc) return false;
      // The server ranks the hits; keep the best one that is not a different
      // recording (live, remix, another song with a similar name).
      if (!query.durationSeconds || !Number.isFinite(entry.duration)) return true;
      return Math.abs(Number(entry.duration) - query.durationSeconds) <= DURATION_TOLERANCE_SECONDS;
    }) ?? null;
  if (!hit?.isrc) return null;

  const song = await requestJson<LrcRedSong>(fetch, `${BASE}/s/${encodeURIComponent(hit.isrc)}.song.json`);
  if (!song) return null;

  const parsed = typeof song.source === "string" && song.source.trim() ? parseTTML(song.source) : null;

  let lines: NonNullable<LyricResult["lines"]>;
  let translation: LyricTranslation | undefined;

  if (parsed?.lines.length) {
    lines = parsed.lines.map(toLineLyrics);

    const translationLines = parsed.lines.flatMap((line) => {
      const text = line.key ? parsed.translations[line.key] : undefined;
      return text ? [{ startMs: line.startMs, endMs: line.endMs, text }] : [];
    });

    if (translationLines.length > 0) {
      translation = { lines: translationLines, provider: "lrc.red" };
      if (parsed.translationLanguage) translation.language = parsed.translationLanguage;
    }
  } else {
    lines = linesFromJson(song) ?? [];
  }

  if (lines.length === 0) return null;

  const plain = song.lyrics?.lines
    ?.map((entry) => textOf(entry.text).trim())
    .filter(Boolean)
    .join("\n");

  const artists = splitArtists(textOf(song.artist) || hit.artist || query.artist);

  return {
    title: textOf(song.title) || hit.title || query.title,
    artists: artists.length > 0 ? artists : splitArtists(query.artist),
    lines,
    ...(plain ? { plain } : {}),
    ...(translation ? { translation } : {}),
  };
}
