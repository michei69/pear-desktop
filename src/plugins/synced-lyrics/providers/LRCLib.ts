import { jaroWinkler } from '@skyra/jaro-winkler';

import {
  buildSearchQueries,
  isRetryableStatus,
  isUsableSearchRecord,
  isWithinDurationTolerance,
  LRCLIB_CLIENT_ID,
  MAX_SEARCH_ATTEMPTS,
  parseSearchResponse,
  rankSearchResults,
  retryDecision,
  splitArtists,
  type LRCLIBSearchResponse,
} from './lrclib-utils';

import { LRC } from '../parsers/lrc';
import { netFetch } from '../renderer/ipc-bridge';
import { config } from '../renderer/renderer';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

const sendSearchRequest = async (
  url: string,
): Promise<{
  status: number;
  statusText: string;
  body: string;
  retryAfterHeader?: string;
}> => {
  if (typeof netFetch === 'function') {
    const [status, body, responseHeaders] = await netFetch(url, {
      headers: {
        'Accept': 'application/json',
        'Lrclib-Client': LRCLIB_CLIENT_ID,
        'User-Agent': LRCLIB_CLIENT_ID,
      },
    });
    return {
      status,
      statusText: '',
      body,
      retryAfterHeader: Object.entries(responseHeaders).find(
        ([key]) => key.toLowerCase() === 'retry-after',
      )?.[1],
    };
  }

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Lrclib-Client': LRCLIB_CLIENT_ID,
    },
  });
  return {
    status: response.status,
    statusText: response.statusText,
    body: await response.text(),
    retryAfterHeader: response.headers.get('retry-after') ?? undefined,
  };
};

export class LRCLib implements LyricProvider {
  name = 'LRCLib';
  baseUrl = 'https://lrclib.net';

  private sleepWithJitter(baseDelayMs: number): Promise<void> {
    const jitter = Math.random() * 0.3;
    return new Promise((resolve) => {
      setTimeout(resolve, Math.round(baseDelayMs * (1 + jitter)));
    });
  }

  private async fetchSearch(
    q: string,
    maxAttempts = MAX_SEARCH_ATTEMPTS,
  ): Promise<LRCLIBSearchResponse> {
    const url = `${this.baseUrl}/api/search?${new URLSearchParams({ q }).toString()}`;
    let lastStatus = 0;
    let lastStatusText = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Awaited<ReturnType<typeof sendSearchRequest>>;

      try {
        response = await sendSearchRequest(url);
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        await this.sleepWithJitter(1000 * attempt);
        continue;
      }

      const { status, statusText, body, retryAfterHeader } = response;
      if (status >= 200 && status < 300) {
        return parseSearchResponse(body);
      }

      lastStatus = status;
      lastStatusText = statusText;

      const decision = retryDecision({
        status,
        attempt,
        maxAttempts,
        retryAfterHeader,
      });
      if (!decision.retry) break;
      await this.sleepWithJitter(decision.delayMs);
    }

    throw Object.assign(
      new Error(
        `bad HTTPStatus(${lastStatus}${lastStatusText ? ` ${lastStatusText}` : ''})`,
      ),
      { status: lastStatus },
    );
  }

  async search({
    title,
    alternativeTitle,
    artist,
    songDuration,
    tags,
  }: SearchSongInfo): Promise<LyricResult | null> {
    const allowInexact = Boolean(config()?.showLyricsEvenIfInexact);
    const candidateQueries = buildSearchQueries({
      title,
      alternativeTitle,
      artist,
      allowInexact,
    });

    let data: LRCLIBSearchResponse = [];
    let lastError: Error | undefined;

    for (let i = 0; i < candidateQueries.length; i++) {
      const isLast = i === candidateQueries.length - 1;

      try {
        const results = await this.fetchSearch(
          candidateQueries[i],
          isLast ? MAX_SEARCH_ATTEMPTS : 2,
        );
        lastError = undefined;
        if (results.length > 0) {
          data = results;
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const status = (error as { status?: number }).status;
        if (isLast || status === 429 || status === 503) break;
      }
    }

    if (data.length === 0 && lastError) {
      const status = (lastError as { status?: number }).status;
      if (status !== undefined && isRetryableStatus(status)) {
        // Overloaded, not broken: no lyrics from this provider right now.
        return null;
      }

      throw lastError;
    }

    const artists = splitArtists(artist);
    const filteredResults = data.filter((item) => {
      if (!isUsableSearchRecord(item)) return false;

      const itemArtists = splitArtists(item.artistName);
      const permutations: [string, string][] = [];
      for (const artistA of artists) {
        for (const artistB of itemArtists) {
          permutations.push([artistA, artistB]);
        }
      }

      let ratio = Math.max(
        0,
        ...permutations.map(([x, y]) => jaroWinkler(x, y)),
      );

      if (ratio <= 0.9 && tags && tags.length > 0) {
        const filteredTags = tags
          .filter((tag) => tag.toLowerCase() !== artist.toLowerCase())
          .flatMap((tag) => splitArtists(tag));

        const tagPermutations: [string, string][] = [];
        for (const tag of filteredTags) {
          for (const itemArtist of itemArtists) {
            tagPermutations.push([tag, itemArtist]);
          }
        }

        if (tagPermutations.length > 0) {
          ratio = Math.max(
            ratio,
            ...tagPermutations.map(([x, y]) => jaroWinkler(x, y)),
          );
        }
      }

      return ratio > 0.9;
    });

    const closestResult = rankSearchResults(filteredResults, songDuration)[0];
    if (!closestResult) {
      return null;
    }

    if (!isWithinDurationTolerance(closestResult, songDuration)) {
      return null;
    }

    const raw = closestResult.syncedLyrics;
    const plain = closestResult.plainLyrics;

    return {
      title: closestResult.trackName,
      artists: closestResult.artistName
        .split(/[&,]|\s+(?:feat\.?|ft\.?)\s+/i)
        .map((item) => item.trim())
        .filter(Boolean),
      lines: raw
        ? LRC.parse(raw).lines.map((line) => ({
            ...line,
            status: 'upcoming' as const,
          }))
        : undefined,
      lyrics: plain ?? undefined,
    };
  }
}
