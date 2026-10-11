import * as z from 'zod';

import { normalizeOrder } from '@/types/settings';

import type { LyricResult } from '../types';

export enum ProviderNames {
  YTMusic = 'YTMusic',
  LRCLib = 'LRCLib',
  MusixMatch = 'MusixMatch',
  LyricsGenius = 'LyricsGenius',
  NetEase = 'NetEase',
  // Megalobiz = 'Megalobiz',
}

export const ProviderNameSchema = z.enum(ProviderNames);
export type ProviderName = z.infer<typeof ProviderNameSchema>;
export const providerNames = ProviderNameSchema.options;

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
 * First provider in `priority` with usable lyrics, falling back to `priority[0]`
 * while nothing has arrived. `preferSynced` wants time-synced lyrics but still
 * takes a plain-text provider when none are synced: unsynced beats none.
 */
const pickByPriority = (
  priority: readonly ProviderName[],
  lyrics: Record<ProviderName, ProviderState>,
  preferSynced: boolean,
): ProviderName | undefined => {
  const firstWith = (predicate: (data: LyricResult | null) => boolean) =>
    priority.find((provider) => predicate(lyrics[provider]?.data ?? null));

  return (
    (preferSynced
      ? (firstWith(hasSyncedText) ?? firstWith(hasLyricText))
      : firstWith(hasLyricText)) ?? priority[0]
  );
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
    const officialTranslation = Boolean(
      data?.translation?.lines?.some((line) => line.text.trim()) ||
      data?.translation?.lyrics?.trim(),
    );

    return (
      (state === 'done' ? 1 : -1) +
      (hasLyricText(data) ? 2 : -2) +
      (officialTranslation && wantsOfficialTranslation ? 3 : 0) +
      (synced ? 2 : -1) +
      (synced && provider === ProviderNames.YTMusic ? 1 : 0) +
      (plain ? 1 : -1)
    );
  };

  return [...priority].sort((a, b) => bias(b) - bias(a));
};

/** `ytmd-sl-starred-<videoId>` — the provider a song is pinned to. */
export const starredProviderKey = (videoId: string) =>
  `ytmd-sl-starred-${videoId}`;

/**
 * The provider to show: the one starred for this song while it has lyrics,
 * otherwise the first hit walking the order. A starred provider that cannot serve
 * the song falls back to the order, so pinning never leaves a blank tab. With
 * `usePriorityList` off the order is ranked by result quality instead.
 */
export const pickWithStar = (options: {
  priority: readonly ProviderName[];
  lyrics: Record<ProviderName, ProviderState>;
  preferSynced: boolean;
  starred: ProviderName | null;
  usePriorityList: boolean;
  wantsOfficialTranslation: boolean;
}): ProviderName | undefined => {
  const {
    priority,
    lyrics,
    preferSynced,
    starred,
    usePriorityList,
    wantsOfficialTranslation,
  } = options;

  if (starred && hasLyricText(lyrics[starred]?.data)) return starred;

  return pickByPriority(
    usePriorityList
      ? priority
      : orderByBias(priority, lyrics, wantsOfficialTranslation),
    lyrics,
    preferSynced,
  );
};
