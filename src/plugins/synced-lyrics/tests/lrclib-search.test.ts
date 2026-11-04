import { expect, test } from '@playwright/test';

import {
  buildSearchQueries,
  cleanTrackTitle,
  isRetryableStatus,
  isUsableSearchRecord,
  isWithinDurationTolerance,
  parseSearchResponse,
  rankSearchResults,
  retryDecision,
  splitArtists,
  type LRCLIBSearchRecord,
} from '../providers/lrclib-utils';

const record = (
  overrides: Partial<LRCLIBSearchRecord> = {},
): LRCLIBSearchRecord => ({
  trackName: 'Song',
  artistName: 'Artist',
  duration: 200,
  syncedLyrics: '[00:00.00] line',
  plainLyrics: 'line',
  ...overrides,
});

test('cleans video-title noise before searching', () => {
  expect(cleanTrackTitle('Song (Official Video)')).toBe('Song');
  expect(cleanTrackTitle('Song (Video Oficial)')).toBe('Song');
  expect(cleanTrackTitle('Song [Audio Oficial]')).toBe('Song');
  expect(cleanTrackTitle('Song (Visualizer)')).toBe('Song');
  expect(cleanTrackTitle('Song (Official Music Video)')).toBe('Song');
  expect(cleanTrackTitle('Song | Remastered')).toBe('Song');
  expect(cleanTrackTitle('Song')).toBe('Song');
  expect(cleanTrackTitle('(Official Video)')).toBe('(Official Video)');
});

test('builds candidate queries, widening them only for inexact mode', () => {
  const exact = buildSearchQueries({
    title: 'Song (Official Video)',
    alternativeTitle: 'Chanson',
    artist: 'Artist',
    allowInexact: false,
  });

  expect(exact).toEqual(['Artist Song', 'Artist Song (Official Video)']);

  const inexact = buildSearchQueries({
    title: 'Song (Official Video)',
    alternativeTitle: 'Chanson',
    artist: 'Artist',
    allowInexact: true,
  });

  expect(inexact).toEqual([
    'Artist Song',
    'Artist Song (Official Video)',
    'Chanson',
    'Song',
    'Song (Official Video)',
  ]);
});

test('splits collaborators and strip diacritics for artist matching', () => {
  expect(splitArtists('Beyoncé & Jay-Z')).toEqual([
    'beyonce & jay-z',
    'beyonce',
    'jay-z',
  ]);
  expect(splitArtists('Artist feat. Other')).toContain('other');
  expect(splitArtists('Artist ft. Other')).toContain('other');
  expect(splitArtists('Artist y Other')).toContain('other');
  expect(splitArtists('Artist and Other')).toContain('other');
  expect(splitArtists('Artist with Other')).toContain('other');
});

test('marks overloaded and rate-limited statuses as retryable', () => {
  expect(isRetryableStatus(429)).toBe(true);
  expect(isRetryableStatus(500)).toBe(true);
  expect(isRetryableStatus(502)).toBe(true);
  expect(isRetryableStatus(503)).toBe(true);
  expect(isRetryableStatus(504)).toBe(true);
  expect(isRetryableStatus(404)).toBe(false);
  expect(isRetryableStatus(403)).toBe(false);
});

test('retries only transient statuses, with bounded backoff', () => {
  expect(retryDecision({ status: 200, attempt: 1, maxAttempts: 4 })).toEqual({
    retry: false,
  });
  expect(retryDecision({ status: 429, attempt: 1, maxAttempts: 4 })).toEqual({
    retry: true,
    delayMs: 1000,
  });
  expect(retryDecision({ status: 503, attempt: 3, maxAttempts: 4 })).toEqual({
    retry: true,
    delayMs: 3000,
  });
  expect(retryDecision({ status: 502, attempt: 4, maxAttempts: 4 })).toEqual({
    retry: false,
  });
  expect(retryDecision({ status: 404, attempt: 1, maxAttempts: 4 })).toEqual({
    retry: false,
  });
  expect(
    retryDecision({
      status: 429,
      attempt: 1,
      maxAttempts: 4,
      retryAfterHeader: '3',
    }),
  ).toEqual({ retry: true, delayMs: 3000 });
  expect(
    retryDecision({
      status: 429,
      attempt: 1,
      maxAttempts: 4,
      retryAfterHeader: '11',
    }),
  ).toEqual({ retry: false });
  expect(
    retryDecision({
      status: 500,
      attempt: 2,
      maxAttempts: 4,
      retryAfterHeader: 'not-a-number',
    }),
  ).toEqual({ retry: true, delayMs: 2000 });
});

test('parses only JSON arrays and rejects gateway pages', () => {
  expect(parseSearchResponse('[]')).toEqual([]);
  expect(parseSearchResponse('[{"trackName":"Song"}]')).toEqual([
    { trackName: 'Song' },
  ]);
  expect(() => parseSearchResponse('')).toThrow('empty response');
  expect(() => parseSearchResponse('<html>bad gateway</html>')).toThrow('HTML');
  expect(() => parseSearchResponse('{"error":"rate limited"}')).toThrow(
    'Expected an array',
  );
  expect(() => parseSearchResponse('not json')).toThrow('non-JSON');
});

test('rejects instrumental and lyric-less records', () => {
  expect(isUsableSearchRecord(record())).toBe(true);
  expect(isUsableSearchRecord(record({ syncedLyrics: null }))).toBe(true);
  expect(
    isUsableSearchRecord(record({ syncedLyrics: null, plainLyrics: null })),
  ).toBe(false);
  expect(isUsableSearchRecord(record({ instrumental: true }))).toBe(false);
});

test('prefers synced lyrics only inside the duration tolerance', () => {
  const synced = record({ trackName: 'Synced', duration: 203 });
  const plain = record({
    trackName: 'Plain',
    duration: 200,
    syncedLyrics: null,
  });

  expect(rankSearchResults([plain, synced], 200)[0].trackName).toBe('Synced');

  const farSynced = record({ trackName: 'Far', duration: 260 });
  expect(rankSearchResults([farSynced, plain], 200)[0].trackName).toBe('Plain');
  expect(isWithinDurationTolerance(farSynced, 200)).toBe(false);
  expect(isWithinDurationTolerance(synced, 200)).toBe(true);
});
