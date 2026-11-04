import { cleanTrackTitle, DURATION_TOLERANCE_SECONDS } from './lrclib-utils';

import { parseTTML, type TTMLParsedLine } from '../parsers/ttml';
import { netFetch } from '../renderer/ipc-bridge';

import type {
  LineLyrics,
  LyricProvider,
  LyricResult,
  LyricWord,
  SearchSongInfo,
} from '../types';

const BASE_URL = 'https://lrc.red';
const REQUEST_TIMEOUT_MS = 10_000;

/** `m:ss`, the timestamp next to a line when time codes are on. */
/** Artist names as displayed, e.g. `ROSÉ, Bruno Mars` -> two artists. */
const splitArtists = (artists: string) =>
  artists
    .split(/[&,]|\s+(?:feat\.?|ft\.?)\s+/i)
    .map((artist) => artist.trim())
    .filter(Boolean);

const displayTime = (timeInMs: number) =>
  `${Math.floor(timeInMs / 60_000)}:${String(
    Math.floor((timeInMs % 60_000) / 1000),
  ).padStart(2, '0')}`;

/** Payload strings are untrusted, so only real strings are kept. */
const textOf = (value: unknown) => (typeof value === 'string' ? value : '');

const toSeconds = (value: unknown, fallback: number) => {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : fallback;
};

type LrcRedHit = {
  isrc?: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
};

type LrcRedWord = { begin?: unknown; end?: unknown; text?: unknown };

type LrcRedJsonLine = {
  begin?: unknown;
  end?: unknown;
  text?: unknown;
  voice?: unknown;
  words?: LrcRedWord[][];
};

type LrcRedSong = {
  title?: string;
  artist?: string;
  album?: unknown;
  duration?: unknown;
  source?: unknown;
  lyrics?: { lines?: LrcRedJsonLine[] };
};

/**
 * The fetch goes through the main-process bridge (lrc.red can be blocked for
 * the renderer), and an `AbortSignal` cannot cross that IPC boundary, so the
 * timeout is raced here instead of aborting the request.
 */
const timed = <T>(work: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('lrc.red request timed out')),
      REQUEST_TIMEOUT_MS,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });

const request = async (
  url: string,
): Promise<{ status: number; text: string } | null> => {
  const init: RequestInit = {
    headers: { 'Accept': 'application/json' },
  };

  try {
    const requestPromise: Promise<[number, string]> =
      typeof netFetch === 'function'
        ? netFetch(url, init).then(
            ([status, text]) => [status, text] as [number, string],
          )
        : fetch(url, init).then(
            async (response) =>
              [response.status, await response.text()] as [number, string],
          );

    const [status, text] = await timed(requestPromise);
    return { status, text };
  } catch {
    // lrc.red is an optional source: a blocked or slow request means "no lyrics".
    return null;
  }
};

const requestJson = async <T>(url: string): Promise<T | null> => {
  const response = await request(url);
  if (!response || response.status < 200 || response.status >= 300) return null;

  try {
    return JSON.parse(response.text) as T;
  } catch {
    return null;
  }
};

/** The words of one JSON line, flattened from its `[[syllable, ...], ...]` groups. */
const jsonLineWords = (
  line: LrcRedJsonLine,
  begin: number,
  end: number,
): LyricWord[] => {
  const groups = (line.words ?? []).filter((group) => Array.isArray(group));
  const words: LyricWord[] = [];

  groups.forEach((group, groupIndex) => {
    group.forEach((syllable, syllableIndex) => {
      const text = textOf(syllable.text);
      if (!text) return;

      const isLastOfGroup = syllableIndex === group.length - 1;
      words.push({
        text:
          isLastOfGroup && groupIndex < groups.length - 1 ? `${text} ` : text,
        timeInMs: toSeconds(syllable.begin, begin),
        duration: 0,
      });
    });
  });

  words.forEach((word, index) => {
    const next = words[index + 1];
    word.duration = Math.max(
      0,
      next ? next.timeInMs - word.timeInMs : end - word.timeInMs,
    );
  });

  return words;
};

/** Fallback for payloads without TTML: the word/line-synced JSON lyrics. */
export const linesFromJson = (song: LrcRedSong): LineLyrics[] => {
  const entries = song.lyrics?.lines;
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry): LineLyrics[] => {
    const timeInMs = toSeconds(entry.begin, Number.NaN);
    if (!Number.isFinite(timeInMs)) return [];

    const end = toSeconds(entry.end, timeInMs);
    const words = jsonLineWords(entry, timeInMs, end);
    const text = words.length
      ? words
          .map((word) => word.text)
          .join('')
          .trim()
      : textOf(entry.text).trim();

    if (!text) return [];

    return [
      {
        time: displayTime(timeInMs),
        timeInMs,
        duration: Math.max(0, end - timeInMs),
        text,
        words: words.length ? words : undefined,
        status: 'upcoming',
      },
    ];
  });
};

const toLineLyrics = (line: TTMLParsedLine): LineLyrics => ({
  time: displayTime(line.timeInMs),
  timeInMs: line.timeInMs,
  duration: line.duration,
  text: line.text,
  status: 'upcoming',
  words: line.words.length ? line.words : undefined,
  background: line.background.length ? line.background : undefined,
  alignment: line.alignment,
  rtl: line.rtl,
});

/**
 * lrc.red: TTML lyrics with word and syllable timings. A track is matched by
 * title/artist/album/duration (the server owns ISRC resolution), then the
 * song payload carries both the original TTML and its JSON rendering.
 */
export class LrcRed implements LyricProvider {
  name = 'lrc.red';
  baseUrl = BASE_URL;

  private async matchSong({
    title,
    alternativeTitle,
    artist,
    album,
    songDuration,
  }: SearchSongInfo): Promise<LrcRedHit | null> {
    const track = cleanTrackTitle(title || alternativeTitle || '');
    const searchArtist = artist?.trim();
    if (!track && !searchArtist) return null;

    const params = new URLSearchParams();
    if (track) params.set('track', track);
    if (searchArtist) params.set('artist', searchArtist);
    if (album) params.set('album', album);
    if (songDuration > 0)
      params.set('duration', String(Math.round(songDuration)));

    const payload = await requestJson<{ hits?: LrcRedHit[] } | LrcRedHit[]>(
      `${BASE_URL}/match.json?${params.toString()}`,
    );
    const hits = Array.isArray(payload) ? payload : (payload?.hits ?? []);

    return (
      hits.find((hit) => {
        if (typeof hit.isrc !== 'string' || !hit.isrc) return false;
        // The server ranks the hits; keep the best one that is not a different
        // recording (live, remix, another song with a similar name).
        if (!songDuration || !Number.isFinite(hit.duration)) return true;
        return (
          Math.abs(Number(hit.duration) - songDuration) <=
          DURATION_TOLERANCE_SECONDS
        );
      }) ?? null
    );
  }

  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    const hit = await this.matchSong(info);
    if (!hit?.isrc) return null;

    const song = await requestJson<LrcRedSong>(
      `${BASE_URL}/s/${encodeURIComponent(hit.isrc)}.song.json`,
    );
    if (!song) return null;

    const parsed =
      typeof song.source === 'string' && song.source.trim()
        ? parseTTML(song.source)
        : null;

    let lines: LineLyrics[];
    let translation: LyricResult['translation'];

    if (parsed?.lines.length) {
      lines = parsed.lines.map(toLineLyrics);

      const translationLines = parsed.lines.flatMap((line): LineLyrics[] => {
        const text = line.key ? parsed.translations[line.key] : undefined;
        return text
          ? [
              {
                time: displayTime(line.timeInMs),
                timeInMs: line.timeInMs,
                duration: line.duration,
                text,
                status: 'upcoming' as const,
              },
            ]
          : [];
      });

      if (translationLines.length) {
        translation = {
          lines: translationLines,
          language: parsed.translationLanguage,
          provider: this.name,
        };
      }
    } else {
      lines = linesFromJson(song);
    }

    if (!lines.length) return null;

    const plain = song.lyrics?.lines
      ?.map((entry) => textOf(entry.text).trim())
      .filter(Boolean)
      .join('\n');

    const artists = splitArtists(
      String(song.artist ?? '') || hit.artist || info.artist,
    );

    return {
      title: String(song.title ?? '') || hit.title || info.title,
      artists: artists.length ? artists : splitArtists(info.artist),
      lines,
      lyrics: plain || undefined,
      translation,
    };
  }
}
