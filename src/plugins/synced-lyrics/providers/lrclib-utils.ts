export const LRCLIB_CLIENT_ID =
  'Pear Desktop (https://github.com/pear-devs/pear-desktop)';

export const MAX_SEARCH_ATTEMPTS = 4;
export const DURATION_TOLERANCE_SECONDS = 15;
const MAX_RETRY_AFTER_SECONDS = 10;
export const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** LRCLib is overloaded or rate limited, not broken: retrying now will not help. */
export const isRetryableStatus = (status: number): boolean =>
  RETRYABLE_STATUSES.has(status);

const NOISE_TAG_PATTERN =
  /\s*[([](?:video\s+oficial|v[ií]deo\s+oficial|letra\s+oficial|video\s+musical|audio\s+oficial|lyric\s+video|official\s+[^)\]]*|visualizer)[)\]]/gi;
const ARTIST_SPLIT_PATTERN = /(?:\s+(?:feat\.?|ft\.?|y|and|with)\s+|[&,])/i;

export interface LRCLIBSearchRecord {
  id?: number;
  name?: string;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export type LRCLIBSearchResponse = LRCLIBSearchRecord[];

export type RetryDecision = { retry: true; delayMs: number } | { retry: false };

export const cleanTrackTitle = (rawTitle: string): string => {
  const cleaned = rawTitle
    .replace(NOISE_TAG_PATTERN, '')
    .split(' | ')[0]
    .trim();
  return cleaned || rawTitle;
};

export const normalizeArtist = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export const splitArtists = (value: string): string[] => {
  const full = normalizeArtist(value);
  const parts = value
    .split(ARTIST_SPLIT_PATTERN)
    .map((part) => normalizeArtist(part))
    .filter(Boolean);
  return Array.from(new Set([full, ...parts].filter(Boolean)));
};

export const buildSearchQueries = ({
  title,
  alternativeTitle,
  artist,
  allowInexact,
}: {
  title: string;
  alternativeTitle?: string;
  artist: string;
  allowInexact: boolean;
}): string[] => {
  const cleanedTitle = cleanTrackTitle(title);
  const altCleaned = alternativeTitle
    ? cleanTrackTitle(alternativeTitle)
    : undefined;

  const candidates: (string | undefined)[] = allowInexact
    ? [
        `${artist} ${cleanedTitle}`,
        `${artist} ${title}`,
        altCleaned,
        cleanedTitle,
        title,
      ]
    : [`${artist} ${cleanedTitle}`, `${artist} ${title}`];

  return Array.from(
    new Set(
      candidates.filter((query): query is string => Boolean(query?.trim())),
    ),
  );
};

export const retryDecision = ({
  status,
  attempt,
  maxAttempts,
  retryAfterHeader,
}: {
  status: number;
  attempt: number;
  maxAttempts: number;
  retryAfterHeader?: string;
}): RetryDecision => {
  if (!RETRYABLE_STATUSES.has(status) || attempt >= maxAttempts) {
    return { retry: false };
  }

  const retryAfter = retryAfterHeader
    ? Number.parseInt(retryAfterHeader, 10)
    : Number.NaN;
  if (retryAfter > MAX_RETRY_AFTER_SECONDS) {
    return { retry: false };
  }

  return {
    retry: true,
    delayMs:
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1000 * attempt,
  };
};

export const parseSearchResponse = (body: string): LRCLIBSearchResponse => {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error('LRCLib returned an empty response');
  }
  if (trimmed.startsWith('<')) {
    throw new Error('LRCLib returned HTML instead of JSON');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error('LRCLib returned a non-JSON response', { cause: error });
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected an array, instead got ${typeof parsed}`);
  }

  return parsed as LRCLIBSearchResponse;
};

export const isUsableSearchRecord = (record: LRCLIBSearchRecord): boolean =>
  !record.instrumental && Boolean(record.syncedLyrics || record.plainLyrics);

export const isWithinDurationTolerance = (
  record: LRCLIBSearchRecord,
  songDuration: number,
): boolean =>
  Math.abs(record.duration - songDuration) <= DURATION_TOLERANCE_SECONDS;

export const rankSearchResults = (
  results: LRCLIBSearchResponse,
  songDuration: number,
): LRCLIBSearchResponse =>
  [...results].sort((a, b) => {
    const left = Math.abs(a.duration - songDuration);
    const right = Math.abs(b.duration - songDuration);

    if (
      left <= DURATION_TOLERANCE_SECONDS &&
      right <= DURATION_TOLERANCE_SECONDS
    ) {
      const aSynced = Boolean(a.syncedLyrics);
      const bSynced = Boolean(b.syncedLyrics);
      if (aSynced !== bSynced) return aSynced ? -1 : 1;
    }

    return left - right;
  });
