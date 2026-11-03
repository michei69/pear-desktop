import { LRC } from '../parsers/lrc';
import { netFetch } from '../renderer/ipc-bridge';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

const BASE_URL = 'https://lrchub.coreone.work';

type LrchubRecord = {
  found?: unknown;
  track?: unknown;
  artist?: unknown;
  artist_name?: unknown;
  synced_lyrics?: unknown;
  lyrics?: unknown;
  dynamic_lrc?: unknown;
  plain_lyrics?: unknown;
};

const textOf = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

/** Inline word timings (`<mm:ss.xx>`) from a word-synced LRC, not displayable. */
const WORD_TAG = /<\d+:\d+[.:]\d+>/g;

export const stripWordTags = (lrc: string) => lrc.replace(WORD_TAG, '');

/**
 * The line-synced LRC LRCHub has for a record. `/api/lyrics` returns a clean
 * `synced_lyrics`; the record/fallback fields can be word-synced, so their
 * inline timings are stripped before the text is shown as lines.
 */
export const pickLrchubLrc = (record: LrchubRecord): string => {
  const synced = textOf(record.synced_lyrics);
  if (synced) return synced;

  const lyrics = stripWordTags(textOf(record.lyrics));
  if (lyrics.trim()) return lyrics;

  return stripWordTags(textOf(record.dynamic_lrc));
};

const splitArtists = (artists: string) =>
  artists
    .split(/[&,]|\s+(?:feat\.?|ft\.?)\s+/i)
    .map((artist) => artist.trim())
    .filter(Boolean);

const requestLyrics = async (body: object): Promise<[number, string]> => {
  const url = `${BASE_URL}/api/lyrics`;
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };

  if (typeof netFetch === 'function') {
    const [status, text] = await netFetch(url, init);
    return [status, text];
  }

  const response = await fetch(url, init);
  return [response.status, await response.text()];
};

export class LRCHub implements LyricProvider {
  name = 'LRCHub';
  baseUrl = BASE_URL;

  async search({
    title,
    artist,
    videoId,
  }: SearchSongInfo): Promise<LyricResult | null> {
    // The endpoint resolves the track itself (video id first, then title and
    // artist), so no separate search/record round trip is needed.
    const [status, text] = await requestLyrics({
      track: title,
      artist,
      video_id: videoId,
    });

    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      throw new Error(`bad HTTPStatus(${status})`);
    }

    let parsed: (LrchubRecord & { record?: LrchubRecord }) | null;
    try {
      parsed = JSON.parse(text) as LrchubRecord & { record?: LrchubRecord };
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const record =
      parsed.record && typeof parsed.record === 'object'
        ? parsed.record
        : parsed;
    if (record.found === false) return null;

    const lrc = pickLrchubLrc(record);
    const plain = textOf(record.plain_lyrics);
    const lines = lrc
      ? LRC.parse(lrc).lines.map((line) => ({
          ...line,
          status: 'upcoming' as const,
        }))
      : undefined;

    if (!lines?.length && !plain) return null;

    const artists = splitArtists(
      textOf(record.artist) || textOf(record.artist_name) || artist,
    );

    return {
      title: textOf(record.track) || title,
      artists: artists.length > 0 ? artists : splitArtists(artist),
      lines: lines?.length ? lines : undefined,
      lyrics: lines?.length ? plain || undefined : plain,
    };
  }
}
