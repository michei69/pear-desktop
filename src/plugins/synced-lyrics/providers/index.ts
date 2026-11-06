import * as z from 'zod';

import { normalizeOrder } from '@/types/settings';

import type { LyricResult } from '../types';

export enum ProviderNames {
  // lrc.red first: it is the only provider with word/syllable-synced TTML for
  // most tracks, and the request in issue #86 asks for it ahead of the rest.
  LrcRed = 'lrc.red',
  YTMusic = 'YTMusic',
  LRCLib = 'LRCLib',
  MusixMatch = 'MusixMatch',
  NetEase = 'NetEase',
  LRCHub = 'LRCHub',
  SimpMusic = 'SimpMusic',
  // Megalobiz = 'Megalobiz',
}

export const ProviderNameSchema = z.enum(ProviderNames);
export type ProviderName = z.infer<typeof ProviderNameSchema>;
export const providerNames = ProviderNameSchema.options;

/** How a provider times its lyrics. Declared best-first: the default priority. */
export const LyricsTypeSchema = z.enum(['word', 'synced', 'plain']);
export type LyricsType = z.infer<typeof LyricsTypeSchema>;
export const lyricsTypes = LyricsTypeSchema.options;

export type ProviderState = {
  state: 'fetching' | 'done' | 'error';
  data: LyricResult | null;
  error: Error | null;
};

/** Time-synced lyrics, as opposed to a plain text block. */
const hasSyncedText = (data?: LyricResult | null): boolean =>
  Boolean(data?.lines?.some((line) => line.text.trim()));

/** Any lyrics at all, synced or a plain text block. */
export const hasLyricText = (data?: LyricResult | null): boolean =>
  Boolean(
    data?.lines?.some((line) => line.text.trim()) || data?.lyrics?.trim(),
  );

/**
 * Order to try providers in. Providers added since the order was saved are
 * appended, so they are still tried.
 */
export const resolvePriority = (
  configured: readonly ProviderName[] | undefined,
): ProviderName[] => normalizeOrder(configured, providerNames);

/**
 * Order to prefer lyrics types in. Types added since the order was saved are
 * appended, so they are still tried.
 */
export const resolveTypePriority = (
  configured: readonly LyricsType[] | undefined,
): LyricsType[] => normalizeOrder(configured, lyricsTypes);

/** How `data` is timed; null when it has no lyrics at all. */
export const lyricType = (data?: LyricResult | null): LyricsType | null => {
  if (!hasLyricText(data)) return null;
  if (data?.lines?.some((line) => line.words?.length)) return 'word';

  return hasSyncedText(data) ? 'synced' : 'plain';
};

/**
 * The provider to show: walk the types in `typePriority`, and within a type the
 * providers in `priority`, so a word-by-word result beats a synced one beats a
 * plain text block. Falls back to `priority[0]` while nothing has arrived.
 */
const pickByType = (
  priority: readonly ProviderName[],
  lyrics: Record<ProviderName, ProviderState>,
  typePriority: readonly LyricsType[],
): ProviderName | undefined => {
  for (const type of typePriority) {
    const hit = priority.find(
      (provider) => lyricType(lyrics[provider]?.data) === type,
    );
    if (hit !== undefined) return hit;
  }

  return undefined;
};

/** `priority` best-first by how good each provider's result looks. */
const orderByBias = (
  priority: readonly ProviderName[],
  lyrics: Record<ProviderName, ProviderState>,
  wantsOfficialTranslation: boolean,
): ProviderName[] => {
  const bias = (provider: ProviderName): number => {
    const { state, data } = lyrics[provider];
    const synced = hasSyncedText(data);
    const plain = Boolean(data?.lyrics?.trim());
    const wordSynced = Boolean(data?.lines?.some((line) => line.words?.length));
    const officialTranslation = Boolean(
      data?.translation?.lines?.some((line) => line.text.trim()) ||
      data?.translation?.lyrics?.trim(),
    );

    return (
      (state === 'done' ? 1 : -1) +
      (hasLyricText(data) ? 2 : -2) +
      (officialTranslation && wantsOfficialTranslation ? 3 : 0) +
      (synced ? 2 : -1) +
      (wordSynced ? 2 : 0) +
      (synced && provider === ProviderNames.YTMusic ? 1 : 0) +
      (plain ? 1 : -1)
    );
  };

  return [...priority].sort((a, b) => bias(b) - bias(a));
};

/** `ytmd-sl-starred-<videoId>` — the provider a song is pinned to. */
export const starredProviderKey = (videoId: string) =>
  `ytmd-sl-starred-${videoId}`;

/** Stored shape: `{ provider }`, so entries written before the picker rewrite still load. */
const StarredProviderSchema = z.object({ provider: ProviderNameSchema });

/** The provider pinned to `videoId`, or null; a stale entry never pins. */
export const readStarredProvider = (videoId: string): ProviderName | null => {
  const stored = localStorage.getItem(starredProviderKey(videoId));
  if (!stored) return null;

  try {
    const parsed = StarredProviderSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data.provider : null;
  } catch {
    return null;
  }
};

export const writeStarredProvider = (
  videoId: string,
  provider: ProviderName | null,
) => {
  if (provider === null) localStorage.removeItem(starredProviderKey(videoId));
  else
    localStorage.setItem(
      starredProviderKey(videoId),
      JSON.stringify({ provider }),
    );
};

/**
 * The provider to show: the one starred for this song while it has lyrics,
 * otherwise the best type in `typePriority` walking `priority`. A starred
 * provider that cannot serve the song falls back to the order, so pinning never
 * leaves a blank tab. With `usePriorityList` off the provider order is ranked by
 * result quality instead, and `typePriority` still ranks the types ahead of it.
 */
export const pickWithStar = (options: {
  priority: readonly ProviderName[];
  lyrics: Record<ProviderName, ProviderState>;
  typePriority: readonly LyricsType[];
  starred: ProviderName | null;
  usePriorityList: boolean;
  wantsOfficialTranslation: boolean;
}): ProviderName | undefined => {
  const {
    priority,
    lyrics,
    typePriority,
    starred,
    usePriorityList,
    wantsOfficialTranslation,
  } = options;

  if (starred && hasLyricText(lyrics[starred]?.data)) return starred;

  const ranked = usePriorityList
    ? priority
    : orderByBias(priority, lyrics, wantsOfficialTranslation);

  return pickByType(ranked, lyrics, typePriority) ?? ranked[0];
};
