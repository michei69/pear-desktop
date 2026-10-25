// NetEase Cloud Music lyrics, through its desktop EAPI.
//
// Adapted from a greasyfork userscript (MIT), which in turn follows
// pear-desktop's provider. The EAPI request is
// signed the same way, with node:crypto instead of crypto-js: MD5 for the
// signature, AES-128-ECB for the payload. NetEase answers with a lot of songs
// that merely share a word with the query, so candidates are scored by title and
// artist and filtered by duration before any lyrics are fetched.

import { createCipheriv, createHash } from "node:crypto";
import Kuroshiro from "kuroshiro";
import { parseLrc } from "../lrc.ts";
import type { LyricLine, LyricResult, SearchQuery } from "../types.ts";
import type { Fetch } from "./http.ts";

const EAPI_AES_KEY = "e82ckenh8dichen8";
const EAPI_ENCODE_KEY = "3go8&$8*3*3h0k(2)2";
const EAPI_CHECK_TOKEN =
  "9ca17ae2e6ffcda170e2e6ee8ad85dba908ca4d74da9ac8ea2d44e938f9eadc66da5a8979af572a5a9b68ac12af0feaec3b92aa69af9b1d372f6b8adccb35e968b9bb6c14f908d0099fb6ff48efdacd361f5b6ee9e";
const EAPI_BASE_URL = "https://interface.music.163.com";
const EAPI_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) NeteaseMusicDesktop/3.0.14.2534",
};
const EAPI_COOKIES = { os: "osx", appver: "3.0.14", requestId: 0, osver: "15.6.1" } as const;
const DEVICE_ID = "7B79802670C7A45DB9091976D71E0AE829E28926C6C34A1B8644";

/** NetEase tracks further than this from the playing song are skipped. */
export const MAX_DURATION_DELTA_SECONDS = 15;
/** Minimum title+artist score a candidate needs; unrelated results score below 3. */
export const MIN_MATCH_SCORE = 4.5;
/** How many candidates, best first, are probed for lyrics before giving up. */
export const MAX_CANDIDATE_PROBES = 5;
/** Weight of the title relative to the artist in the candidate score. */
const SCORE_TITLE_WEIGHT = 10;

export interface NeteaseSong {
  id: number;
  name: string;
  artists: string[];
  durationMs: number;
}

interface LyricsPayload {
  lrc?: string;
  tlyric?: string;
  romalrc?: string;
  /** `data.lrc` and friends, in case the response is wrapped. */
  [key: string]: unknown;
}

export type MatchQuery = { title: string; artist: string; parts: string[] };
export type MatchCandidate = { title: string; artists: string[] };

/** `kuroshiro` is CommonJS, so the default import is the class (or a wrapper) with a static `Util`. */
const kuroshiroModule = Kuroshiro as unknown as {
  Util?: { kanaToRomaji(text: string, mode?: string): string };
  default?: { Util?: { kanaToRomaji(text: string, mode?: string): string } };
};
const kanaToRomaji = kuroshiroModule.Util?.kanaToRomaji ?? kuroshiroModule.default?.Util?.kanaToRomaji;

/** Characters that can be romanized; NFKC folds half-width kana into them. */
const KANA_PATTERN = /[\u3040-\u30ff\u31f0-\u31ff]/;
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const normalizeText = (value: string) => value.normalize("NFKC");

/** Folds a title or artist into a form comparable across scripts. */
export function comparableText(value: string) {
  const normalized = normalizeText(value);
  const romanized = KANA_PATTERN.test(normalized) && kanaToRomaji ? kanaToRomaji(normalized, "hepburn") : normalized;
  return romanized
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC")
    .toLowerCase();
}

const levenshtein = (a: string, b: string) => {
  const aLength = a.length;
  const bLength = b.length;
  if (aLength === 0) return bLength;
  if (bLength === 0) return aLength;

  const matrix = Array.from({ length: bLength + 1 }, () => Array.from({ length: aLength + 1 }, () => 0));
  for (let i = 0; i <= aLength; i += 1) matrix[0]![i] = i;
  for (let j = 0; j <= bLength; j += 1) matrix[j]![0] = j;
  for (let j = 1; j <= bLength; j += 1) {
    for (let i = 1; i <= aLength; i += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j]![i] = Math.min(matrix[j]![i - 1]! + 1, matrix[j - 1]![i]! + 1, matrix[j - 1]![i - 1]! + cost);
    }
  }
  return matrix[bLength]![aLength]!;
};

/** Levenshtein similarity in [0, 1], where 1 means the strings are equal. */
export function normalizedLevenshtein(a: string, b: string) {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - levenshtein(a, b) / longest;
}

/** Similarity of two titles in [0, 1], weighting up a title that starts with or contains the other. */
export function bonusCompare(fullTitle: string, searchTitle: string) {
  const full = comparableText(fullTitle);
  const search = comparableText(searchTitle);
  const weight = full.startsWith(search) ? 1 : full.includes(search) ? 0.75 : 0.5;
  return weight * normalizedLevenshtein(full, search);
}

/** Splits a title into its meaningful parts, dropping version/bracket noise. */
export function splitTitle(title: string): string[] {
  const masterPattern = /(?:[「『](?<content>.+?)[」』])|(?:【.*?】|〖.*?〗|\(.*?\)|（.*?）)|(?<delimiter>\s+-\s+|\s*[/／|:|│]\s*)/i;
  const noiseWords = /\b(MV|PV)\b|\b(?:covered by|feat?|ft?)\b.+/gi;

  const parse = (value: string): string[] => {
    if (!value?.trim()) return [];
    const match = value.match(masterPattern);
    if (!match || match.index === undefined) return [value];

    const before = value.substring(0, match.index);
    const after = value.substring(match.index + match[0].length);
    const { delimiter, content } = match.groups ?? {};

    if (delimiter && (before.trim().length < 2 || after.trim().length < 2)) {
      const remaining = parse(after);
      return [before + match[0] + (remaining[0] || ""), ...remaining.slice(1)];
    }
    return [...parse(before), ...(content ? [content] : []), ...parse(after)];
  };

  return [
    ...new Set(
      parse(title)
        .map((part) => part.replace(noiseWords, "").trim())
        .filter((part) => part.length > 0),
    ),
  ];
}

/** Scores a search result the way the userscript does: title is worth ten times artist. */
export function scoreCandidate(candidate: MatchCandidate, query: MatchQuery) {
  const cleanedTitle = splitTitle(candidate.title).join("");

  let partsScore = 0;
  query.parts.forEach((part, index) => {
    const weight = 1 / (index * 2 + 1);
    partsScore += (bonusCompare(cleanedTitle, part) * weight) / query.parts.length;
  });

  const titleScore = Math.max(bonusCompare(candidate.title, query.title) + 0.01, partsScore);
  const artistScore = candidate.artists.length > 0 ? Math.max(...candidate.artists.map((artist) => bonusCompare(artist, query.artist))) : 0;

  return titleScore * SCORE_TITLE_WEIGHT + artistScore;
}

export function buildQuery(title: string, artist: string): MatchQuery {
  const normalizedTitle = normalizeText(title);
  const parts = splitTitle(normalizedTitle);
  return { title: normalizedTitle, artist: normalizeText(artist), parts: parts.length > 0 ? parts : [normalizedTitle] };
}

/** The CJK title YTM offers when the shown title is a translation, or null. */
export function pickOriginalTitle(title: string, alternativeTitle?: string): string | null {
  const original = normalizeText(alternativeTitle ?? "").trim();
  if (!original || original === normalizeText(title).trim()) return null;
  if (CJK_PATTERN.test(normalizeText(title))) return null;
  return CJK_PATTERN.test(original) ? original : null;
}

/** Deduplicates search results and sorts them best match first. */
function rankSongs(songs: readonly NeteaseSong[], queries: readonly MatchQuery[]) {
  const seen = new Set<number>();
  return songs
    .filter((song) => {
      if (!song.id || seen.has(song.id)) return false;
      seen.add(song.id);
      return true;
    })
    .map((song) => {
      const title = normalizeText(song.name);
      const artists = song.artists.map(normalizeText);
      const score = Math.max(...queries.map((query) => scoreCandidate({ title, artists }, query)));
      return { song, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** NetEase's search payload, or no songs when it is empty or malformed. */
export function parseSearchResponse(value: unknown): NeteaseSong[] {
  const resources = (value as { data?: { resources?: unknown } } | null)?.data?.resources;
  if (!Array.isArray(resources)) return [];

  const songs: NeteaseSong[] = [];
  for (const raw of resources) {
    if (!raw || typeof raw !== "object") continue;
    const resource = raw as { resourceId?: unknown; baseInfo?: { simpleSongData?: unknown } };
    const info = resource.baseInfo?.simpleSongData as { name?: unknown; dt?: unknown; ar?: { name?: unknown }[] } | undefined;
    const id = Number(resource.resourceId);
    const name = typeof info?.name === "string" ? info.name : "";
    const durationMs = Number(info?.dt);
    if (!Number.isFinite(id) || !name || !Number.isFinite(durationMs) || durationMs <= 0) continue;
    const artists =
      info && Array.isArray(info.ar) ? info.ar.flatMap((artist) => (typeof artist?.name === "string" ? [artist.name] : [])) : [];
    songs.push({ id, name, artists, durationMs });
  }
  return songs;
}

/** The lyric variants of a `song/lyric/v1` answer, keeping only usable strings. */
export function parseLyricResponse(value: unknown): LyricsPayload {
  const data = ((value as { data?: unknown } | null)?.data ?? value) as Record<string, unknown> | null;
  const part = (key: string) => {
    const lyric = (data?.[key] as { lyric?: unknown } | undefined)?.lyric;
    return typeof lyric === "string" && lyric.trim() ? lyric : undefined;
  };
  const lrc = part("lrc");
  const tlyric = part("tlyric");
  const romalrc = part("romalrc");
  return {
    ...(lrc !== undefined && { lrc }),
    ...(tlyric !== undefined && { tlyric }),
    ...(romalrc !== undefined && { romalrc }),
  };
}

interface Session {
  cookies: Record<string, string>;
  registered: Promise<void> | null;
}
const session: Session = { cookies: {}, registered: null };

/** Forgets the anonymous login (tests, or after NetEase invalidated it). */
export function resetNeteaseSession() {
  session.cookies = {};
  session.registered = null;
}

const md5 = (data: string | Buffer) => createHash("md5").update(data).digest();

/** The anonymous-login username: the device id xor'd with the encode key, then its MD5. */
function encodeDeviceId(id: string) {
  let xored = "";
  for (let i = 0; i < id.length; i++) {
    xored += String.fromCharCode(id.charCodeAt(i) ^ EAPI_ENCODE_KEY.charCodeAt(i % EAPI_ENCODE_KEY.length));
  }
  const hash = md5(Buffer.from(xored, "latin1")).toString("base64");
  return Buffer.from(`${id} ${hash}`, "latin1").toString("base64");
}

/** The EAPI payload: MD5 signature, then AES-128-ECB, hex uppercase. */
function encryptPayload(payload: string) {
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(EAPI_AES_KEY, "utf8"), null);
  return Buffer.concat([cipher.update(payload, "utf8"), cipher.final()])
    .toString("hex")
    .toUpperCase();
}

async function eapi(fetch: Fetch, path: string, data: Record<string, unknown>, params: Record<string, string> = {}) {
  const body = JSON.stringify({ ...data, header: JSON.stringify(EAPI_COOKIES) });
  const sign = createHash("md5").update(`nobody/api${path}use${body}md5forencrypt`).digest("hex");
  const encrypted = encryptPayload(`/api${path}-36cd479b6b5-${body}-36cd479b6b5-${sign}`);

  const cookieString = Object.entries(session.cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
  const query = new URLSearchParams(params).toString();
  const url = `${EAPI_BASE_URL}/eapi${path}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...EAPI_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookieString ? { Cookie: cookieString } : {}),
    },
    body: `params=${encodeURIComponent(encrypted)}`,
  });

  const setCookie =
    (response.headers as Headers & { getSetCookie?(): string[] }).getSetCookie?.() ??
    (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
  for (const cookie of setCookie) {
    for (const pair of cookie.split(/,(?=\s*[^=;\s]+=)/)) {
      const [name, ...rest] = pair.split(";")[0]!.split("=");
      if (name && rest.length > 0) session.cookies[name.trim()] = rest.join("=").trim();
    }
  }

  if (!response.ok) throw new Error(`NetEase responded ${response.status}`);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error("NetEase responded with malformed JSON");
  }
  if ((json as { code?: unknown } | null)?.code !== 200) throw new Error("NetEase rejected the request");
  return json;
}

function ensureRegistered(fetch: Fetch) {
  session.registered ??= eapi(fetch, "/register/anonimous", { username: encodeDeviceId(DEVICE_ID) }, { _nmclfl: "1" })
    .then(() => undefined)
    .catch((error: unknown) => {
      session.registered = null;
      throw error;
    });
  return session.registered;
}

async function searchSongs(fetch: Fetch, keyword: string, limit = 10) {
  try {
    const response = await eapi(
      fetch,
      "/search/song/list/page",
      {
        offset: "0",
        scene: "NORMAL",
        needCorrect: "true",
        checkToken: EAPI_CHECK_TOKEN,
        keyword,
        limit: String(limit),
        verifyId: 1,
      },
      { _nmclfl: "1" },
    );
    return parseSearchResponse(response);
  } catch (error) {
    // A malformed or empty page is no match; a dead session is retried next time.
    console.warn("[pear:synced-lyrics] NetEase search failed", keyword, error);
    return [];
  }
}

async function getLyric(fetch: Fetch, id: number) {
  return parseLyricResponse(
    await eapi(fetch, "/song/lyric/v1", { id, tv: "-1", yv: "-1", rv: "-1", lv: "-1", verifyId: 1 }, { _nmclfl: "1" }),
  );
}

/** Drop NetEase's per-line JSON credits (`{"t":0,...}`) that some sheets embed. */
function stripMetadata(lyrics: string) {
  return lyrics
    .split("\n")
    .filter((line) => {
      if (!line.includes("{")) return true;
      try {
        JSON.parse(line);
        return false;
      } catch {
        return true;
      }
    })
    .join("\n");
}

/** Official romanization, matched to the source lines by start time (or index when the lists align). */
function alignTexts(source: readonly LyricLine[], other: readonly LyricLine[]) {
  if (other.length === source.length) return other.map((line) => (line.text.trim() ? line.text.trim() : null));
  const byStart = new Map(
    other.filter((line) => line.text.trim()).map((line): [number, string] => [Math.round(line.startMs), line.text.trim()]),
  );
  return source.map((line) => byStart.get(Math.round(line.startMs)) ?? null);
}

/** Best-ranked candidates are probed for lyrics; the first with text wins. */
export async function netease(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  await ensureRegistered(fetch);

  const originalTitle = pickOriginalTitle(query.title, query.alternativeTitle);
  const match = buildQuery(originalTitle ?? query.title, query.artist);
  const romanized = originalTitle ? buildQuery(query.title, query.artist) : null;

  const keywords = [...match.parts];
  if (match.artist && match.parts[0] !== match.artist) keywords.push(`${match.parts[0]} ${match.artist}`);
  if (romanized) keywords.push(romanized.parts[0]!);

  const results = await Promise.all([...new Set(keywords)].map((keyword) => searchSongs(fetch, keyword)));
  const ranked = rankSongs(results.flat(), romanized ? [match, romanized] : [match]);

  for (const { song, score } of ranked.slice(0, MAX_CANDIDATE_PROBES)) {
    if (score < MIN_MATCH_SCORE) break;
    if (query.durationSeconds > 0 && Math.abs(song.durationMs / 1000 - query.durationSeconds) > MAX_DURATION_DELTA_SECONDS) {
      continue;
    }

    let lyric: LyricsPayload;
    try {
      lyric = await getLyric(fetch, song.id);
    } catch (error) {
      // One dead candidate must not hide the next one.
      console.warn("[pear:synced-lyrics] NetEase lyrics failed", song.id, error);
      continue;
    }

    const source = lyric.lrc ? stripMetadata(lyric.lrc) : "";
    if (!source.trim()) continue;

    const durationMs = query.durationSeconds > 0 ? query.durationSeconds * 1000 : song.durationMs;
    const lines = parseLrc(source, durationMs);
    if (!lines.some((line) => line.text)) continue;

    const result: LyricResult = {
      title: normalizeText(song.name),
      artists: song.artists.map(normalizeText),
      lines,
    };

    if (lyric.tlyric) {
      const translated = parseLrc(stripMetadata(lyric.tlyric), durationMs);
      if (translated.some((line) => line.text)) {
        result.translation = { lines: translated, plain: lyric.tlyric, language: "zh-CN", provider: "NetEase" };
      }
    }
    if (lyric.romalrc) {
      const romanizedLines = parseLrc(stripMetadata(lyric.romalrc), durationMs);
      if (romanizedLines.some((line) => line.text)) result.romanization = alignTexts(lines, romanizedLines);
    }
    return result;
  }

  return null;
}

/** Exported for the tests: the provider's rank of a candidate list. */
export function rankCandidates(songs: readonly NeteaseSong[], queries: readonly MatchQuery[]) {
  return rankSongs(songs, queries);
}
