// Code adapted from https://greasyfork.org/en/scripts/548724-youtube-music-spotify-%E7%BD%91%E6%98%93%E4%BA%91%E6%AD%8C%E8%AF%8D%E6%98%BE%E7%A4%BA
// which is licenced under the MIT licence
// The search ranking follows the script's 0.281 release.

import CryptoJS from 'crypto-js';
import Kuroshiro from 'kuroshiro';
import { z } from 'zod';

import { LRC } from '../parsers/lrc';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

const EAPI_AES_KEY = 'e82ckenh8dichen8';
const EAPI_ENCODE_KEY = '3go8&$8*3*3h0k(2)2';
const EAPI_CHECK_TOKEN =
  '9ca17ae2e6ffcda170e2e6ee8ad85dba908ca4d74da9ac8ea2d44e938f9eadc66da5a8979af572a5a9b68ac12af0feaec3b92aa69af9b1d372f6b8adccb35e968b9bb6c14f908d0099fb6ff48efdacd361f5b6ee9e';
const EAPI_BASE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) NeteaseMusicDesktop/3.0.14.2534',
};
const EAPI_BASE_COOKIES = {
  os: 'osx',
  appver: '3.0.14',
  requestId: 0,
  osver: '15.6.1',
};

/** NetEase tracks further than this from the playing song are skipped. */
const MAX_DURATION_DELTA_SECONDS = 15;

/**
 * Lowest score a search result may have to be considered the same song.
 * Matching the whole title is worth 10 points and a perfect artist adds 1, so
 * 4.5 admits re-recordings and translated titles while dropping unrelated
 * results, which score below 3.
 */
const MIN_MATCH_SCORE = 4.5;

/** How many candidates, best first, are probed for lyrics before giving up. */
const MAX_CANDIDATE_PROBES = 5;

/** Weight of the title relative to the artist in the candidate score. */
const SCORE_TITLE_WEIGHT = 10;

/**
 * `kuroshiro` ships as CommonJS with an `__esModule` marker, so the default
 * import is either the class itself (bundlers) or a wrapper around it (plain
 * Node ESM, as used by the tests).
 */
const { Util } =
  (Kuroshiro as unknown as { default?: typeof Kuroshiro }).default ?? Kuroshiro;

const artistSchema = z.object({ id: z.number(), name: z.string() });
const songSchema = z.object({
  resourceId: z.coerce.number(),
  baseInfo: z.object({
    simpleSongData: z.object({
      name: z.string(),
      ar: z.array(artistSchema).optional(),
      dt: z.number(),
    }),
  }),
});
const searchResponseDataSchema = z.object({
  // NetEase answers with `resources: null` when a keyword has no match.
  resources: z.array(songSchema).nullish(),
});
const searchResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: searchResponseDataSchema.nullish(),
});
type Song = z.infer<typeof songSchema>;
type SongInfo = Song['baseInfo']['simpleSongData'];

const lyricPartSchema = z.object({ lyric: z.string().nullable() });
const lyricResponseSchema = z.object({
  lrc: lyricPartSchema.optional(),
  tlyric: lyricPartSchema.optional(),
  romalrc: lyricPartSchema.optional(),
});

/** Characters that can be romanized; NFKC folds half-width kana into them. */
const KANA_PATTERN = /[\u3040-\u30ff\u31f0-\u31ff]/;

const normalizeText = (value: string) => value.normalize('NFKC');

/**
 * Folds a title or an artist into a form that can be compared across scripts:
 * full-width characters are normalized, kana are romanized so that a Japanese
 * title matches its romaji spelling, long vowels lose their macron (romaji is
 * usually written without one) and the result is lowercased.
 */
export const comparableText = (value: string) => {
  const normalized = normalizeText(value);
  const romanized = KANA_PATTERN.test(normalized)
    ? Util.kanaToRomaji(normalized, 'hepburn')
    : normalized;

  return romanized
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .toLowerCase();
};

const levenshtein = (a: string, b: string) => {
  const aLength = a.length;
  const bLength = b.length;
  if (aLength === 0) return bLength;
  if (bLength === 0) return aLength;

  const matrix = Array.from({ length: bLength + 1 }, () =>
    Array.from({ length: aLength + 1 }, () => 0),
  );

  for (let i = 0; i <= aLength; i += 1) {
    matrix[0][i] = i;
  }
  for (let j = 0; j <= bLength; j += 1) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= bLength; j += 1) {
    for (let i = 1; i <= aLength; i += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost,
      );
    }
  }

  return matrix[bLength][aLength];
};

/** Levenshtein similarity in [0, 1], where 1 means the strings are equal. */
export const normalizedLevenshtein = (a: string, b: string) => {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - levenshtein(a, b) / longest;
};

/**
 * Similarity of two titles in [0, 1] where a title that starts with, or
 * contains, the other one is weighted up: a song that only adds a version
 * suffix should rank above an unrelated song sharing a few characters.
 */
export const bonusCompare = (fullTitle: string, searchTitle: string) => {
  const [full, search] = [
    comparableText(fullTitle),
    comparableText(searchTitle),
  ];

  const weight = full.startsWith(search)
    ? 1 // Bonus for prefix match
    : full.includes(search)
      ? 0.75 // Bonus for substring match
      : 0.5;

  return weight * normalizedLevenshtein(full, search);
};

/** Splits a title into its meaningful parts, dropping version/bracket noise. */
export const splitTitle = (title: string): string[] => {
  const masterPattern =
    /(?:[「『](?<content>.+?)[」』])|(?:【.*?】|〖.*?〗|\(.*?\)|（.*?）)|(?<delimiter>\s+-\s+|\s*[/／|:|│]\s*)/i;
  const noiseWords = /\b(MV|PV)\b|\b(?:covered by|feat?|ft?)\b.+/gi;

  const parse = (str: string): string[] => {
    if (!str?.trim()) return [];

    const match = str.match(masterPattern);
    if (!match || match.index === undefined) return [str];

    const before = str.substring(0, match.index);
    const after = str.substring(match.index + match[0].length);
    const { delimiter, content } = match.groups || {};

    if (delimiter && (before.trim().length < 2 || after.trim().length < 2)) {
      const remaining = parse(after);
      return [before + match[0] + (remaining[0] || ''), ...remaining.slice(1)];
    }

    return [...parse(before), ...(content ? [content] : []), ...parse(after)];
  };

  return [
    ...new Set(
      parse(title)
        .map((part) => part.replace(noiseWords, '').trim())
        .filter((part) => part.length > 0),
    ),
  ];
};

type MatchQuery = {
  title: string;
  artist: string;
  parts: string[];
};

type MatchCandidate = {
  title: string;
  artists: string[];
};

/**
 * Scores a search result the way the userscript does: the title similarity is
 * worth ten times the artist similarity, so a cover by another artist still
 * beats an unrelated song by the same artist.
 */
export const scoreCandidate = (
  candidate: MatchCandidate,
  query: MatchQuery,
): number => {
  // Version suffixes are dropped so a re-recording still matches its title.
  const cleanedTitle = splitTitle(candidate.title).join('');

  let partsScore = 0;
  query.parts.forEach((part, index) => {
    const weight = 1 / (index * 2 + 1); // Earlier parts have higher weight
    partsScore +=
      (bonusCompare(cleanedTitle, part) * weight) / query.parts.length;
  });

  const titleScore = Math.max(
    bonusCompare(candidate.title, query.title) + 0.01,
    partsScore,
  );
  const artistScore =
    candidate.artists.length > 0
      ? Math.max(
          ...candidate.artists.map((artist) =>
            bonusCompare(artist, query.artist),
          ),
        )
      : 0;

  return titleScore * SCORE_TITLE_WEIGHT + artistScore;
};

type RankedSong = {
  song: Song;
  info: SongInfo;
  score: number;
};

/** Deduplicates search results and sorts them best match first. */
const rankSongs = (songs: Song[], query: MatchQuery): RankedSong[] => {
  const seenIds = new Set<number>();

  return songs
    .filter((song) => {
      if (!song.resourceId || seenIds.has(song.resourceId)) return false;
      seenIds.add(song.resourceId);
      return true;
    })
    .map((song) => {
      const info = song.baseInfo.simpleSongData;
      const title = normalizeText(info.name);
      const artists = (info.ar ?? []).map((artist) =>
        normalizeText(artist.name),
      );

      return { song, info, score: scoreCandidate({ title, artists }, query) };
    })
    .sort((a, b) => b.score - a.score);
};

export class Netease implements LyricProvider {
  name = 'Netease';
  baseUrl = 'https://interface.music.163.com';
  cookies: Record<string, string> = {};
  initialized = false;

  private encode(id: string): string {
    // XOR step (unchanged)
    let xoredString = '';
    for (let i = 0; i < id.length; i++) {
      const charCode =
        id.charCodeAt(i) ^
        EAPI_ENCODE_KEY.charCodeAt(i % EAPI_ENCODE_KEY.length);
      xoredString += String.fromCharCode(charCode);
    }

    // MD5 -> Base64 using crypto-js
    const hash = CryptoJS.MD5(CryptoJS.enc.Latin1.parse(xoredString)).toString(
      CryptoJS.enc.Base64,
    );

    // Build a binary WordArray for "id hash"
    const combinedWordArray = CryptoJS.enc.Latin1.parse(id + ' ' + hash);

    // Convert to Base64 (replaces Buffer.from(...).toString("base64"))
    return CryptoJS.enc.Base64.stringify(combinedWordArray);
  }

  private async register() {
    const deviceId = '7B79802670C7A45DB9091976D71E0AE829E28926C6C34A1B8644';
    const username = this.encode(deviceId);
    try {
      await this.eapi('/register/anonimous', { username }, { _nmclfl: '1' });
      this.initialized = true;
    } catch (e) {
      throw new Error(
        `Registration failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  }

  private async eapi(
    path: string,
    data: Record<string, unknown> = {},
    params: Record<string, string> = {},
  ) {
    const header = { ...EAPI_BASE_COOKIES };
    const bodyData = { ...data, header: JSON.stringify(header) };
    const body = JSON.stringify(bodyData);
    const sign = CryptoJS.MD5(
      `nobody/api${path}use${body}md5forencrypt`,
    ).toString();
    const payload = `/api${path}-36cd479b6b5-${body}-36cd479b6b5-${sign}`;

    const key = CryptoJS.enc.Utf8.parse(EAPI_AES_KEY);

    const encrypted = CryptoJS.AES.encrypt(payload, key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }).ciphertext.toString(CryptoJS.enc.Hex);

    const cookieString = Object.entries({ ...this.cookies })
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    const queryStr = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/eapi${path}${queryStr ? `?${queryStr}` : ''}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...EAPI_BASE_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieString,
      },
      body: `params=${encodeURIComponent(encrypted.toUpperCase())}`,
    });

    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      const cookieStrings = setCookieHeader.split(/,(?=\s*[^=;\s]+=)/);
      for (const cookieStr of cookieStrings) {
        const parts = cookieStr.split(';')[0].split('=');
        if (parts.length === 2) {
          this.cookies[parts[0].trim()] = parts[1].trim();
        }
      }
    }

    if (!response.ok) {
      throw new Error(`bad HTTPStatus(${response.statusText})`);
    }

    const json = await response.json();
    z.object({ code: z.literal(200) }).parse(json);

    return json;
  }

  private async searchSongs(keyword: string, limit = 10): Promise<Song[]> {
    const response = await this.eapi(
      '/search/song/list/page',
      {
        offset: '0',
        scene: 'NORMAL',
        needCorrect: 'true',
        checkToken: EAPI_CHECK_TOKEN,
        keyword,
        limit: limit.toString(),
        verifyId: 1,
      },
      {
        _nmclfl: '1',
      },
    );
    const parsed = searchResponseSchema.parse(response);
    return parsed.data?.resources ?? [];
  }

  private async getLyric(id: number) {
    const response = await this.eapi(
      '/song/lyric/v1',
      {
        id,
        tv: '-1',
        yv: '-1',
        rv: '-1',
        lv: '-1',
        verifyId: 1,
      },
      {
        _nmclfl: '1',
      },
    );
    return lyricResponseSchema.parse(response);
  }

  async search({
    title,
    artist,
    songDuration,
  }: SearchSongInfo): Promise<LyricResult | null> {
    if (!this.initialized) {
      await this.register();
    }

    const query: MatchQuery = {
      title: normalizeText(title),
      artist: normalizeText(artist),
      parts: [],
    };
    query.parts = splitTitle(query.title);
    if (query.parts.length === 0) {
      query.parts.push(query.title);
    }

    const keywords = [...query.parts];
    if (query.artist && query.parts[0] !== query.artist) {
      keywords.push(`${query.parts[0]} ${query.artist}`);
    }

    const results = await Promise.all(
      keywords.map((keyword) => this.searchSongs(keyword)),
    );
    const ranked = rankSongs(results.flat(), query);

    console.debug(
      '[synced-lyrics] NetEase matches',
      ranked
        .slice(0, MAX_CANDIDATE_PROBES)
        .map(({ info, score }) => `${score.toFixed(2)} ${info.name}`),
    );

    for (const { song, info, score } of ranked.slice(0, MAX_CANDIDATE_PROBES)) {
      // Candidates are sorted, so everything from here on is worse.
      if (score < MIN_MATCH_SCORE) break;

      if (
        Math.abs(info.dt / 1000 - songDuration) > MAX_DURATION_DELTA_SECONDS
      ) {
        continue;
      }

      const lyric = await this.getLyric(song.resourceId);
      const lyrics = lyric?.lrc?.lyric ? stripMetadata(lyric.lrc.lyric) : '';
      if (!lyrics.trim()) continue;

      return {
        title: normalizeText(info.name),
        artists: (info.ar ?? []).map((item) => normalizeText(item.name)),
        lines: LRC.parse(lyrics).lines.map((line) => ({
          ...line,
          status: 'upcoming' as const,
        })),
        lyrics,
      };
    }

    return null;
  }
}

const stripMetadata = (lyrics: string) => {
  return lyrics
    .split('\n')
    .filter((line) => {
      if (!line.includes('{')) return true;
      try {
        JSON.parse(line);
        return false;
      } catch {}
      return true;
    })
    .join('\n');
};
