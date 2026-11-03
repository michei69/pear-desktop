import { LRC } from '../parsers/lrc';
import { netFetch } from '../renderer/ipc-bridge';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

const BASE_URL = 'https://api-lyrics.simpmusic.org';
/**
 * The API only answers clients that identify themselves as SimpMusic. A normal
 * browser fetch cannot set User-Agent (forbidden header), which is why this
 * goes through the main-process netFetch bridge.
 */
const CLIENT_USER_AGENT = 'SimpMusicLyrics/1.0';

type SimpMusicEntry = {
  songTitle?: unknown;
  artistName?: unknown;
  plainLyric?: unknown;
  syncedLyrics?: unknown;
  richSyncLyrics?: unknown;
  vote?: unknown;
};

const textOf = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const ENTITIES: Record<string, string> = {
  'amp': '&',
  'lt': '<',
  'gt': '>',
  'quot': '"',
  'apos': "'",
  '#39': "'",
};

export const decodeHtmlEntities = (text: string) =>
  text.replace(/&(#?\w+);/g, (match, name: string) => {
    return ENTITIES[name.toLowerCase()] ?? match;
  });

const RICH_LINE = /^\[(\d+):(\d+(?:[.:]\d+)?)\](.*)$/;
const WORD_TAG = /<\d+:\d+[.:]\d+>/g;
/** Apple Music marks the singer of a word-synced line with `v1:`/`v2:`. */
const SINGER_PREFIX = /^v\d+:\s*/;

/** Apple-Music-style rich sync (`[line]<word time>...`) to line-synced LRC. */
export const richSyncToLrc = (rich: string): string =>
  rich
    .split(/\r?\n/)
    .map((raw) => {
      const match = RICH_LINE.exec(raw.trim());
      if (!match) return '';

      const [, minutes, seconds, rest] = match;
      const text = rest
        .replace(WORD_TAG, '')
        .replace(SINGER_PREFIX, '')
        .replace(/\s+/g, ' ')
        .trim();

      return text ? `[${minutes}:${seconds}]${text}` : '';
    })
    .filter(Boolean)
    .join('\n');

const rankEntry = (entry: SimpMusicEntry): number => {
  const vote = Number(entry.vote);
  const voteScore = Number.isFinite(vote) ? Math.max(-9, Math.min(9, vote)) : 0;

  if (textOf(entry.richSyncLyrics)) return 100 + voteScore;
  if (textOf(entry.syncedLyrics)) return 50 + voteScore;
  if (textOf(entry.plainLyric)) return 10 + voteScore;
  return -1;
};

export const pickBestSimpMusicEntry = (
  entries: SimpMusicEntry[],
): SimpMusicEntry | null => {
  let best: SimpMusicEntry | null = null;
  let bestScore = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;

    const score = rankEntry(entry);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  return best;
};

const splitArtists = (artists: string) =>
  artists
    .split(/[&,]|\s+(?:feat\.?|ft\.?)\s+/i)
    .map((artist) => artist.trim())
    .filter(Boolean);

const fetchEntry = async (videoId: string): Promise<[number, string]> => {
  const url = `${BASE_URL}/v1/${encodeURIComponent(videoId)}`;
  const init: RequestInit = {
    headers: {
      'Accept': 'application/json',
      'User-Agent': CLIENT_USER_AGENT,
    },
  };

  if (typeof netFetch === 'function') {
    const [status, text] = await netFetch(url, init);
    return [status, text];
  }

  const response = await fetch(url, init);
  return [response.status, await response.text()];
};

export class SimpMusic implements LyricProvider {
  name = 'SimpMusic';
  baseUrl = BASE_URL;

  async search({
    videoId,
    title,
    artist,
  }: SearchSongInfo): Promise<LyricResult | null> {
    // The API is keyed by YouTube video id only.
    if (!videoId) return null;

    const [status, text] = await fetchEntry(videoId);

    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      throw new Error(`bad HTTPStatus(${status})`);
    }

    let parsed: { type?: unknown; data?: unknown } | null;
    try {
      parsed = JSON.parse(text) as { type?: unknown; data?: unknown } | null;
    } catch {
      return null;
    }
    if (!parsed || parsed.type !== 'success' || !Array.isArray(parsed.data)) {
      return null;
    }

    const entry = pickBestSimpMusicEntry(parsed.data as SimpMusicEntry[]);
    if (!entry) return null;

    const rich = decodeHtmlEntities(textOf(entry.richSyncLyrics));
    const lrc =
      (rich ? richSyncToLrc(rich) : '') ||
      decodeHtmlEntities(textOf(entry.syncedLyrics));
    const plain = decodeHtmlEntities(textOf(entry.plainLyric));

    const lines = lrc
      ? LRC.parse(lrc).lines.map((line) => ({
          ...line,
          status: 'upcoming' as const,
        }))
      : undefined;

    if (!lines?.length && !plain) return null;

    const artists = splitArtists(textOf(entry.artistName) || artist);

    return {
      title: textOf(entry.songTitle) || title,
      artists: artists.length > 0 ? artists : splitArtists(artist),
      lines: lines?.length ? lines : undefined,
      lyrics: lines?.length ? plain || undefined : plain,
    };
  }
}
