// Paxsenix, after Metrolist's PaxsenixLyricsProvider: search Apple Music with
// a token scraped from the Apple Music web app, score the hits against the
// playing track, then fetch the matched song's lyrics from Paxsenix (TTML,
// enhanced LRC or plain) and turn them into the plugin's line format.

import { parseLrc } from "../lrc.ts";
import type { LyricLine, LyricResult, LyricWord, SearchQuery } from "../types.ts";
import { parseJson, type Fetch } from "./http.ts";
import { ttmlToResult } from "./ttml-result.ts";
import { splitArtists } from "./shared.ts";

const APPLE_MUSIC_API_BASE = "https://amp-api.music.apple.com/v1/catalog";
const LYRICS_URL = "https://lyrics.paxsenix.org/apple-music/lyrics";
const LOCALE = "us";
const LANGUAGE = "en-US";
const APPLE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:95.0) Gecko/20100101 Firefox/95.0";
const TIMEOUT_MS = 15_000;

interface PaxsenixHit {
  id: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  durationMs?: number;
}

type SearchOutcome = { unauthorized: true } | PaxsenixHit[];

interface LyricsPayload {
  type?: unknown;
  content?: unknown;
  elrc?: unknown;
  elrcMultiPerson?: unknown;
  ttmlContent?: unknown;
  plain?: unknown;
}

interface ContentWord {
  text?: unknown;
  timestamp?: unknown;
  endtime?: unknown;
}

interface ContentLine {
  timestamp?: unknown;
  endtime?: unknown;
  duration?: unknown;
  text?: unknown;
  oppositeTurn?: unknown;
}

// ---- Apple Music token ------------------------------------------------------

let cachedToken: Promise<string> | null = null;

/** Forgets the scraped Apple Music token (tests, or after a 401). */
export function resetPaxsenixToken() {
  cachedToken = null;
}

async function fetchToken(fetch: Fetch): Promise<string> {
  const page = await (await fetch("https://beta.music.apple.com", { headers: { "User-Agent": APPLE_USER_AGENT } })).text();
  const scriptPath = /\/assets\/index~[^/]+\.js/.exec(page)?.[0];
  if (!scriptPath) throw new Error("Apple Music index JS not found");
  const script = await (await fetch(`https://beta.music.apple.com${scriptPath}`, { headers: { "User-Agent": APPLE_USER_AGENT } })).text();
  const token = /eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+/.exec(script)?.[0];
  if (!token) throw new Error("Apple Music token not found");
  return token;
}

function getToken(fetch: Fetch): Promise<string> {
  cachedToken ??= fetchToken(fetch).catch((error: unknown) => {
    cachedToken = null;
    throw error;
  });
  return cachedToken;
}

// ---- search and matching ----------------------------------------------------

const MIXED = /\bmixed\b/i;
const REMIX = /\bremix\b/i;
const BRACKETS = /\(.*?\)|\[.*?]|【.*?】/g;
const FEATURED = /\bfeat\.?.*$|\bft\.?.*$/i;
const NON_ALNUM = /[^a-z0-9]+/g;
const WHITESPACE = /\s+/g;
const ARTIST_SPLIT = /,|&|\+|\/|\bx\b|\bvs\.?\b|\band\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b/i;
const VARIANT_TAG =
  /\((?:[^()]*\b(?:ver\.?|version|remix|acoustic|live|instrumental|extended|radio\s*edit|remaster(?:ed)?|clean|explicit|english|japanese|korean|chinese|mandarin|cantonese|spanish|thai|vietnamese|german|french|italian|portuguese|russian|hindi|indonesian|malay|arabic|filipino|tagalog)\b[^()]*)\)|\[(?:[^[\]]*\b(?:ver\.?|version|remix|acoustic|live|instrumental|extended|radio\s*edit|remaster(?:ed)?|clean|explicit|english|japanese|korean|chinese|mandarin|cantonese|spanish|thai|vietnamese|german|french|italian|portuguese|russian|hindi|indonesian|malay|arabic|filipino|tagalog)\b[^[\]]*)]/gi;
const TITLE_CLEANUP = [
  /\s*\(.*?(official|video|audio|lyrics|lyric|visualizer|hd|hq|4k|remaster|remix|live|acoustic|version|edit|extended|radio|clean|explicit).*?\)/gi,
  /\s*\[.*?(official|video|audio|lyrics|lyric|visualizer|hd|hq|4k|remaster|remix|live|acoustic|version|edit|extended|radio|clean|explicit).*?]/gi,
  /\s*【.*?】/g,
  /\s*\|.*$/,
  /\s*-\s*(official|video|audio|lyrics|lyric|visualizer).*$/i,
  /\s*\(feat\..*?\)/gi,
  /\s*\(ft\..*?\)/gi,
  /\s*feat\..*$/i,
  /\s*ft\..*$/i,
  /\s*\([^)]*\d{4}[^)]*\)/,
];
const ARTIST_SEPARATORS = [" & ", " and ", ", ", " x ", " X ", " feat. ", " feat ", " ft. ", " ft ", " featuring ", " with "];

/** Search terms: clean title with artist, title alone, then with album. */
export function searchTerms(query: SearchQuery): string[] {
  const title = cleanTitle(query.title);
  const artist = cleanArtist(query.artist);
  return [...new Set([`${title} ${artist}`.trim(), title, query.album ? `${title} ${artist} ${query.album}`.trim() : ""].filter(Boolean))];
}

export function cleanTitle(title: string) {
  let cleaned = title.trim();
  for (const pattern of TITLE_CLEANUP) cleaned = cleaned.replace(pattern, "");
  return cleaned.trim();
}

export function cleanArtist(artist: string) {
  let cleaned = artist.trim();
  for (const separator of ARTIST_SEPARATORS) {
    if (cleaned.toLowerCase().includes(separator.toLowerCase())) {
      cleaned = cleaned.split(new RegExp(separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))[0]!;
      break;
    }
  }
  return cleaned.trim();
}

/** Apple's search response pairs `results.songs.data` ids with `resources.songs` details. */
export function parseAppleSearch(value: unknown): PaxsenixHit[] {
  const root = value as { results?: { songs?: { data?: unknown } }; resources?: { songs?: unknown } } | null;
  const data = root?.results?.songs?.data;
  const resources = root?.resources?.songs;
  if (!Array.isArray(data) || !resources || typeof resources !== "object" || Array.isArray(resources)) return [];
  return data.flatMap((raw) => {
    const id = (raw as { id?: unknown } | null)?.id;
    if (typeof id !== "string") return [];
    const attributes = (resources as Record<string, { attributes?: Record<string, unknown> } | undefined>)[id]?.attributes;
    if (!attributes || typeof attributes.name !== "string" || typeof attributes.artistName !== "string") return [];
    return [
      {
        id,
        trackName: attributes.name,
        artistName: attributes.artistName,
        ...(typeof attributes.albumName === "string" ? { albumName: attributes.albumName } : {}),
        ...(Number.isFinite(Number(attributes.durationInMillis)) ? { durationMs: Number(attributes.durationInMillis) } : {}),
      },
    ];
  });
}

async function search(fetch: Fetch, term: string, token: string): Promise<SearchOutcome> {
  const params = new URLSearchParams({
    term,
    types: "songs",
    limit: "25",
    l: LANGUAGE,
    platform: "web",
    "format[resources]": "map",
    "include[songs]": "artists",
    extend: "artistUrl",
  });
  const response = await fetch(`${APPLE_MUSIC_API_BASE}/${LOCALE}/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://music.apple.com",
      Referer: "https://music.apple.com/",
      "User-Agent": APPLE_USER_AGENT,
      Accept: "application/json",
      "x-apple-renewal": "true",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401) return { unauthorized: true };
  if (!response.ok) throw new Error(`Apple Music answered ${response.status}`);
  return parseAppleSearch(parseJson(await response.text()));
}

async function searchWithRetry(fetch: Fetch, term: string): Promise<PaxsenixHit[]> {
  const first = await search(fetch, term, await getToken(fetch));
  if (!Array.isArray(first)) {
    resetPaxsenixToken();
    const retry = await search(fetch, term, await getToken(fetch));
    return Array.isArray(retry) ? retry : [];
  }
  return first;
}

const normalize = (input: string) =>
  input.slice(0, 1024).toLowerCase().replace(BRACKETS, " ").replace(FEATURED, " ").replace(NON_ALNUM, " ").trim().replace(WHITESPACE, " ");

const levenshtein = (a: string, b: string) => {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const above = previous[j + 1]!;
      previous[j + 1] = a[i] === b[j] ? diagonal : 1 + Math.min(previous[j]!, above, diagonal);
      diagonal = above;
    }
  }
  return previous[b.length]!;
};

const similarity = (a: string, b: string) => {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
};

const tokensMatch = (a: string, b: string) => a === b || a.includes(b) || b.includes(a) || similarity(a, b) >= 0.82;

const artistTokens = (artist: string) => artist.split(ARTIST_SPLIT).map(normalize).filter(Boolean);

function artistScore(target: string[], result: string[]) {
  if (!target.length || !result.length) return 0;
  const matchedTarget = target.filter((t) => result.some((r) => tokensMatch(t, r))).length;
  const matchedResult = result.filter((r) => target.some((t) => tokensMatch(t, r))).length;
  return Math.max(matchedTarget / target.length, matchedResult / result.length);
}

const variantTags = (raw: string) =>
  new Set([...raw.matchAll(VARIANT_TAG)].map((match) => normalize(match[0].replace(/^[([](?:\s*)|[)\]]$/g, ""))).filter(Boolean));

/** Scores hits the way Metrolist does and keeps only plausible matches. */
export function scoreHits(hits: PaxsenixHit[], query: SearchQuery): { hit: PaxsenixHit; score: number }[] {
  const targetTitle = normalize(cleanTitle(query.title).replace(VARIANT_TAG, " "));
  const targetTags = variantTags(query.title);
  const targetArtists = artistTokens(query.artist);
  const targetAlbum = query.album?.trim() ? normalize(query.album) : undefined;
  const targetIsMixed = MIXED.test(query.title);
  const targetIsRemix = REMIX.test(query.title);

  return hits
    .map((hit) => {
      let score = 0;
      if (query.durationSeconds > 0 && hit.durationMs) {
        const delta = Math.abs(hit.durationMs - query.durationSeconds * 1000);
        score += delta <= 2000 ? 30 : delta <= 5000 ? 20 : delta <= 10_000 ? 5 : -30;
      }

      const resultTitle = normalize(cleanTitle(hit.trackName).replace(VARIANT_TAG, " "));
      const titleSim = similarity(targetTitle, resultTitle);
      score +=
        resultTitle === targetTitle
          ? 90
          : resultTitle.includes(targetTitle) || targetTitle.includes(resultTitle)
            ? 60 + titleSim * 20
            : titleSim >= 0.75
              ? titleSim * 70
              : titleSim * 30;

      const resultTags = variantTags(hit.trackName);
      if (!targetTags.size && !resultTags.size) score += 0;
      else if (targetTags.size && resultTags.size)
        score += [...targetTags].some((tag) => [...resultTags].some((r) => tokensMatch(tag, r))) ? 25 : -70;
      else score += targetTags.size ? -50 : -35;

      if (MIXED.test(hit.trackName) && !targetIsMixed) score -= 60;
      if (REMIX.test(hit.trackName) && !targetIsRemix) score -= 40;

      const overlap = artistScore(targetArtists, artistTokens(hit.artistName));
      score += overlap * 60;
      if (overlap === 0) score -= 40;

      if (targetAlbum && hit.albumName && similarity(targetAlbum, normalize(hit.albumName)) >= 0.8) score += 15;
      return { hit, score };
    })
    .filter((entry) => entry.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// ---- lyrics payload ---------------------------------------------------------

async function fetchLyrics(fetch: Fetch, id: string): Promise<string | null> {
  try {
    const response = await fetch(`${LYRICS_URL}?${new URLSearchParams({ id })}`, {
      headers: { "User-Agent": "Metrolist", Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length <= 1024 * 1024 * 2 ? text : null;
  } catch {
    return null;
  }
}

function formatTime(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

/** Packed `<word:start:end>` markers become enhanced-LRC word tags our parser knows. */
export function normalizeElrc(elrc: string) {
  return elrc
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      const time = /^\[(\d{1,2}:\d{2}(?:[.:]\d{2,3})?)\]/.exec(line);
      if (!time) return "";
      const rest = line
        .slice(time[0].length)
        .replace(/^\(?v\d+\)?:\s*/i, "")
        .replace(
          /<([^:|<>]+):([0-9.]+):([0-9.]+)>/g,
          (_, word: string, start: string) => `<${formatTime(Math.round(Number(start) * 1000))}>${word}`,
        );
      return `${time[0]}${rest}`;
    })
    .filter(Boolean)
    .join("\n");
}

const asText = (value: unknown) => (typeof value === "string" ? value : "");

/** Converts Paxsenix's structured `content` lines into timed lines with words. */
export function contentToResult(content: unknown, title: string, artist: string): LyricResult | null {
  if (!Array.isArray(content)) return null;
  const lines: LyricLine[] = [];
  for (const raw of content) {
    const item = raw as ContentLine;
    const startMs = Math.max(0, Number(item.timestamp) || 0);
    const declaredEnd = Number(item.endtime) || 0;
    const endMs = Math.max(startMs, declaredEnd > startMs ? declaredEnd : startMs + (Number(item.duration) || 0));
    const words: LyricWord[] = (Array.isArray(item.text) ? (item.text as ContentWord[]) : []).flatMap((word, index, all) => {
      const text = asText(word.text);
      if (!text.trim()) return [];
      const spaced = /^\s/.test(text) || index === all.length - 1 ? text : `${text} `;
      return [{ text: spaced, startMs: Number(word.timestamp) || startMs, endMs: Number(word.endtime) || endMs }];
    });
    const text = (words.length ? words.map((word) => word.text).join("") : "").trim();
    if (!text) continue;
    lines.push({
      startMs,
      endMs,
      text,
      ...(words.length ? { words } : {}),
      ...(item.oppositeTurn ? { alignment: "end" as const } : {}),
    });
  }
  return lines.length ? { title, artists: splitArtists(artist), lines } : null;
}

function plainToResult(plain: string, title: string, artist: string): LyricResult {
  return { title, artists: splitArtists(artist), plain };
}

function lrcResult(lrc: string, title: string, artist: string): LyricResult | null {
  const lines = parseLrc(lrc).filter((line) => line.text);
  return lines.length ? { title, artists: splitArtists(artist), lines } : null;
}

/** Tries the payload formats Paxsenix returns, richest first. */
export function parseLyricsPayload(jsonText: string, title: string, artist: string): LyricResult | null {
  const payload = parseJson<LyricsPayload>(jsonText);
  if (!payload) return null;
  if (String(payload.type).toLowerCase() === "none" && asText(payload.plain).trim()) {
    return plainToResult(asText(payload.plain), title, artist);
  }
  const ttml = asText(payload.ttmlContent);
  if (ttml.trim()) {
    const result = ttmlToResult(ttml, title, artist, "Paxsenix");
    if (result) return result;
  }
  for (const key of ["elrcMultiPerson", "elrc"] as const) {
    const lrc = asText(payload[key]);
    if (lrc.trim()) {
      const result = lrcResult(normalizeElrc(lrc), title, artist);
      if (result) return result;
    }
  }
  const plain = asText(payload.plain);
  if (plain.trim()) return plainToResult(plain, title, artist);
  return contentToResult(payload.content, title, artist);
}

const qualityOf = (result: LyricResult) =>
  result.lines?.some((line) => line.words?.length) ? 3 : result.lines?.length ? 2 : result.plain?.trim() ? 1 : 0;

export async function paxsenix(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  const results = new Map<string, { hit: PaxsenixHit; score: number }>();
  for (const term of searchTerms(query)) {
    let hits: PaxsenixHit[];
    try {
      hits = await searchWithRetry(fetch, term);
    } catch {
      continue;
    }
    for (const entry of scoreHits(hits, query)) {
      const previous = results.get(entry.hit.id);
      if (!previous || entry.score > previous.score) results.set(entry.hit.id, entry);
    }
  }

  const ranked = [...results.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  const topScore = ranked[0]?.score ?? 0;
  let best: LyricResult | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestQuality = 0;

  for (const entry of ranked) {
    if (topScore - entry.score > 15 || (best && entry.score < bestScore)) break;
    const text = await fetchLyrics(fetch, entry.hit.id);
    if (!text) continue;
    const result = parseLyricsPayload(text, query.title, query.artist);
    if (!result) continue;
    const quality = qualityOf(result);
    if (!best || entry.score > bestScore || (entry.score === bestScore && quality > bestQuality)) {
      best = result;
      bestScore = entry.score;
      bestQuality = quality;
    }
    if (bestQuality === 3 && bestScore === topScore) break;
  }
  return best;
}
