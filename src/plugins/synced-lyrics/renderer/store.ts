import { createEffect, createMemo, runWithOwner, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';

import { getSongInfo } from '@/providers/song-info-front';
import { bylineParts, queueRenderer, yearPattern } from '@/utils/queue';

import { getCustomQuery } from './custom-query-store';
import { translationDebug } from './debug';
import { reactiveOwner } from './reactive-root';
import { config } from './renderer';
import {
  clearCurrentTranslation,
  fetchTranslation,
  isChineseTranslationTarget,
  resolveTargetLanguage,
  sourceLanguageMatchesTarget,
  setOfficialTranslation,
} from './translation-store';

import { LRC } from '../parsers/lrc';
import {
  hasLyricText,
  pickWithStar,
  type ProviderName,
  providerNames,
  type ProviderState,
  readStarredProvider,
  resolvePriority,
} from '../providers';
import { providers } from '../providers/renderer';

import type { NextData } from '../providers/YTMusic';
import type {
  LineLyrics,
  LyricProvider,
  LyricResult,
  SearchSongInfo,
} from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { QueueItem } from '@/types/datahost-get-state';
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';

type LyricsStore = {
  videoId: string | null;
  provider: ProviderName;
  current: ProviderState;
  lyrics: Record<ProviderName, ProviderState>;
};

const fetchingProviderState = (): ProviderState => ({
  state: 'fetching',
  data: null,
  error: null,
});

const initialData = () =>
  providerNames.reduce(
    (acc, name) => {
      acc[name] = fetchingProviderState();
      return acc;
    },
    {} as LyricsStore['lyrics'],
  );

export const [lyricsStore, setLyricsStore] = createStore<LyricsStore>({
  videoId: null,
  provider: providerNames[0],
  lyrics: initialData(),
  get current(): ProviderState {
    return this.lyrics[this.provider];
  },
});

export const currentLyrics = runWithOwner(reactiveOwner, () =>
  createMemo(() => {
    const provider = lyricsStore.provider;
    return lyricsStore.lyrics[provider];
  }),
)!;

type VideoId = string;

type SearchCacheData = Record<ProviderName, ProviderState>;
interface SearchCache {
  data: SearchCacheData;
  /** Settles once every provider has answered, so callers can await a fetch. */
  settled?: Promise<void>;
}

// TODO: Maybe use localStorage for the cache.
const MAX_SEARCH_CACHE_SIZE = 50;
const searchCache = new Map<VideoId, SearchCache>();

export const clearSearchCacheForVideo = (videoId: string) => {
  searchCache.delete(videoId);
};

const pruneSearchCache = () => {
  const excess = searchCache.size - MAX_SEARCH_CACHE_SIZE;
  if (excess <= 0) return;
  const toEvict = Array.from(searchCache.keys()).slice(0, excess);
  for (const key of toEvict) searchCache.delete(key);
};
let activeSongInfo: SongInfo | null = null;
let lastRefreshKey = '';
let lastRefreshAt = 0;

export const splitPlainLyrics = (lyrics: string): string[] =>
  lyrics
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const getLyricLineTexts = (data?: LyricResult | null): string[] => {
  if (!data || !hasLyricText(data)) return [];
  if (data.lines?.some((line) => line.text.trim())) {
    return data.lines.map((line) => line.text);
  }
  return data.lyrics ? splitPlainLyrics(data.lyrics) : [];
};

const cloneLyricResult = (data: LyricResult): LyricResult => ({
  ...data,
  artists: [...data.artists],
  lines: data.lines?.map((line) => ({ ...line })),
  translation: data.translation
    ? {
        ...data.translation,
        lines: data.translation.lines?.map((line) => ({ ...line })),
      }
    : undefined,
});

const cloneProviderState = (state: ProviderState): ProviderState => ({
  state: state.state,
  data: state.data ? cloneLyricResult(state.data) : null,
  error: state.error,
});

const cloneSearchData = (data: SearchCacheData): SearchCacheData =>
  providerNames.reduce((acc, provider) => {
    acc[provider] = cloneProviderState(data[provider]);
    return acc;
  }, {} as SearchCacheData);

const activateLyricsData = (videoId: string, data: SearchCacheData) => {
  if (activeSongInfo?.videoId !== videoId) return;

  if (lyricsStore.videoId !== videoId) {
    clearCurrentTranslation();
  }
  setLyricsStore({
    videoId,
    lyrics: cloneSearchData(data),
  });
};

const isStillActiveVideo = (videoId: string): boolean => {
  return (
    activeSongInfo?.videoId === videoId &&
    untrack(() => lyricsStore.videoId) === videoId
  );
};

const alignSyncedTranslations = (
  sourceLines: LineLyrics[],
  translationLines: LineLyrics[],
): string[] | null => {
  const output = sourceLines.map(() => '');
  const used = new Set<number>();
  let matches = 0;

  for (const [sourceIndex, sourceLine] of sourceLines.entries()) {
    if (!sourceLine.text.trim()) continue;

    let bestIndex = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const [
      translationIndex,
      translationLine,
    ] of translationLines.entries()) {
      if (used.has(translationIndex) || !translationLine.text.trim()) continue;
      const delta = Math.abs(translationLine.timeInMs - sourceLine.timeInMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = translationIndex;
      }
    }

    if (bestIndex !== -1 && bestDelta <= 350) {
      used.add(bestIndex);
      output[sourceIndex] = translationLines[bestIndex].text.trim();
      matches += 1;
    }
  }

  const sourceTextLines = sourceLines.filter((line) => line.text.trim()).length;
  const translationTextLines = translationLines.filter((line) =>
    line.text.trim(),
  ).length;
  const comparableLines = Math.min(sourceTextLines, translationTextLines);
  if (matches >= 3 && matches / Math.max(1, comparableLines) >= 0.6) {
    return output;
  }

  return null;
};

const alignIndexTranslations = (
  sourceLines: string[],
  translationLines: string[],
): string[] | null => {
  const output = sourceLines.map(() => '');
  const nonEmptySourceIndexes = sourceLines
    .map((line, index) => (line.trim() ? index : -1))
    .filter((index) => index !== -1);
  const nonEmptyTranslations = translationLines
    .map((line) => line.trim())
    .filter(Boolean);

  if (translationLines.length === sourceLines.length) {
    const normalized = translationLines.map((line) => line.trim());
    const translatedCount = normalized.filter(Boolean).length;
    if (translatedCount >= Math.min(3, nonEmptySourceIndexes.length)) {
      return normalized;
    }
  }

  if (nonEmptyTranslations.length === nonEmptySourceIndexes.length) {
    for (const [idx, sourceIndex] of nonEmptySourceIndexes.entries()) {
      output[sourceIndex] = nonEmptyTranslations[idx];
    }
    return output;
  }

  return null;
};

const splitTranslatedLyrics = (lyrics: string): string[] => {
  const parsedLines = LRC.parse(lyrics).lines;
  if (parsedLines.some((line) => line.text.trim())) {
    return parsedLines.map((line) => line.text);
  }

  return splitPlainLyrics(lyrics).map((line) =>
    line.replace(/^\[\d+:\d+[.:]\d+\]\s*/, '').trim(),
  );
};

const getOfficialChineseTranslationLines = (
  data: LyricResult,
  sourceTexts: string[],
): string[] | null => {
  const translation = data.translation;
  if (!translation) return null;

  if (data.lines?.length && translation.lines?.length) {
    const byTimestamp = alignSyncedTranslations(data.lines, translation.lines);
    if (byTimestamp) return byTimestamp;

    const byIndex = alignIndexTranslations(
      data.lines.map((line) => line.text),
      translation.lines.map((line) => line.text),
    );
    if (byIndex) return byIndex;
  }

  if (translation.lyrics?.trim()) {
    return alignIndexTranslations(
      sourceTexts,
      splitTranslatedLyrics(translation.lyrics),
    );
  }

  return null;
};

/** `info` with the user's custom search query for `videoId` applied, if any. */
const applyCustomQuery = <T extends SearchSongInfo>(
  info: T,
  videoId: string,
): T => {
  const customQ = getCustomQuery(videoId);
  if (!customQ) return info;

  return {
    ...info,
    title: customQ.query,
    alternativeTitle: customQ.query,
    artist: customQ.artist ?? '',
  };
};

/** A fresh search cache for `videoId`, registered before any provider answers. */
const createSearchCache = (videoId: string): SearchCache => {
  const cache: SearchCache = { data: initialData() };
  searchCache.set(videoId, cache);
  pruneSearchCache();
  return cache;
};

/**
 * Start every provider's search for `info`, recording each answer on `data`.
 * `onResult` sees the same state that was cached, so the lyrics store can follow
 * along without this helper knowing about it.
 */
const searchProviders = (
  info: SearchSongInfo,
  data: SearchCacheData,
  onResult?: (provider: ProviderName, state: ProviderState) => void,
): Promise<void>[] =>
  (Object.entries(providers) as [ProviderName, LyricProvider][]).map(
    ([name, provider]) =>
      provider
        .search(info)
        .then((res) => {
          const state: ProviderState = {
            state: 'done',
            data: res,
            error: null,
          };
          data[name] = state;
          onResult?.(name, state);
        })
        .catch((error: Error) => {
          console.error(error);
          const state: ProviderState = { state: 'error', data: null, error };
          data[name] = state;
          onResult?.(name, state);
        }),
  );

/** Mark `cache` done once every search has settled, and keep it in the map. */
const settleSearchCache = (
  videoId: string,
  cache: SearchCache,
  tasks: Promise<void>[],
): Promise<void> => {
  const settled = Promise.allSettled(tasks).then(() => {
    searchCache.set(videoId, cache);
    pruneSearchCache();
  });
  cache.settled = settled;
  return settled;
};

/**
 * Fetch every provider for `info`. Resolves once they have all settled, so a
 * caller can await a fetch the UI already started; a cached or in-flight video
 * hands back its existing promise instead of refetching.
 */
export const fetchLyrics = (info: SongInfo): Promise<void> => {
  if (activeSongInfo?.videoId !== info.videoId) return Promise.resolve();

  const cached = searchCache.get(info.videoId);
  if (cached) {
    activateLyricsData(info.videoId, cached.data);

    return cached.settled ?? Promise.resolve();
  }

  const cache = createSearchCache(info.videoId);
  activateLyricsData(info.videoId, cache.data);

  const tasks = searchProviders(
    applyCustomQuery(info, info.videoId),
    cache.data,
    (name, state) => {
      if (!isStillActiveVideo(info.videoId)) return;

      setLyricsStore('lyrics', (old) => {
        return {
          ...old,
          [name]: { ...state, data: state.data ? { ...state.data } : null },
        };
      });
    },
  );

  return settleSearchCache(info.videoId, cache, tasks);
};

/** Video id the lyrics belong to, or null when no song is playing. */
export const currentLyricsVideoId = (): string | null =>
  (activeSongInfo ?? getSongInfo())?.videoId ?? null;

/**
 * Every provider's state for the current song, waiting for a fetch already in
 * flight. Starts one when the song has none, so the API can answer without the
 * lyrics tab having been opened.
 */
export const allProviderLyrics = async (): Promise<
  Record<ProviderName, ProviderState>
> => {
  const info = activeSongInfo ?? getSongInfo();
  if (!info?.videoId) return initialData();

  await fetchLyrics(info);

  const cache = searchCache.get(info.videoId);

  return cache ? cloneSearchData(cache.data) : initialData();
};

/** "4:21" or "1:02:03" as seconds; 0 when there is no usable length. */
const durationInSeconds = (text?: string) => {
  const parts = (text ?? '').split(':').map((part) => Number(part));
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

/**
 * What providers search with for a video the player is not on. The player's own
 * song info answers for the current song; anything else is read from its
 * watch-next page, where the queue items carry the title, byline and length.
 */
const searchInfoForVideo = async (
  videoId: string,
): Promise<SearchSongInfo | null> => {
  const current = getSongInfo();
  if (current?.videoId === videoId) return current;

  const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
  if (!app) return null;

  const data = await app.networkManager
    .fetch<NextData, { videoId: string }>('/next?prettyPrint=false', {
      videoId,
    })
    .catch(() => null);
  if (!data) return null;

  const items =
    data.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents ?? [];
  const renderer = items
    .map((item) => queueRenderer(item as QueueItem))
    .find((entry) => entry?.videoId === videoId);
  if (!renderer) return null;

  const parts = bylineParts(renderer.longBylineText?.runs);
  const year = parts.filter((part) => yearPattern.test(part)).at(-1);

  return {
    videoId,
    title: renderer.title?.runs?.map((run) => run.text).join('') ?? '',
    artist: parts[0] ?? '',
    album: parts.slice(1).find((part) => part !== year),
    songDuration: durationInSeconds(renderer.lengthText?.runs?.[0]?.text),
  };
};

/**
 * The provider the app would show for `videoId`, honouring a star and the
 * priority/quality config — the same rules the lyrics picker uses.
 */
export const pickProvider = (
  videoId: string | null,
  lyrics: Record<ProviderName, ProviderState>,
): ProviderName | undefined => {
  const cfg = config();
  return pickWithStar({
    priority: resolvePriority(cfg?.providerPriority),
    lyrics,
    preferSynced: cfg?.preferSynced ?? true,
    starred: videoId ? readStarredProvider(videoId) : null,
    usePriorityList: cfg?.usePriorityList ?? false,
    wantsOfficialTranslation: Boolean(
      cfg?.translation?.enabled &&
      isChineseTranslationTarget(cfg.translation.targetLanguage),
    ),
  });
};

/**
 * Lyrics for `videoId`: from the in-memory cache when the app already has that
 * song, otherwise fetched from every provider. Never touches the lyrics store,
 * so asking about another video cannot disturb what the UI is showing.
 */
export const lyricsForVideo = async (
  videoId: string,
): Promise<Record<ProviderName, ProviderState>> => {
  const cached = searchCache.get(videoId);
  if (cached) {
    await cached.settled;
    return cloneSearchData(cached.data);
  }

  const info = await searchInfoForVideo(videoId);
  if (!info) return initialData();

  const cache = createSearchCache(videoId);
  const tasks = searchProviders(applyCustomQuery(info, videoId), cache.data);

  await settleSearchCache(videoId, cache, tasks);

  return cloneSearchData(cache.data);
};

export const retrySearch = (provider: ProviderName, info: SongInfo) => {
  activeSongInfo = info;

  const pCache: ProviderState = {
    state: 'fetching',
    data: null,
    error: null,
  };

  if (lyricsStore.videoId !== info.videoId) {
    clearCurrentTranslation();
  }
  setLyricsStore({
    videoId: info.videoId,
    lyrics: {
      ...lyricsStore.lyrics,
      [provider]: pCache,
    },
  });

  providers[provider]
    .search(info)
    .then((res) => {
      if (!isStillActiveVideo(info.videoId)) return;
      setLyricsStore('lyrics', (old) => {
        return {
          ...old,
          [provider]: { state: 'done', data: res, error: null },
        };
      });
    })
    .catch((error) => {
      if (!isStillActiveVideo(info.videoId)) return;
      setLyricsStore('lyrics', (old) => {
        return {
          ...old,
          [provider]: { state: 'error', data: null, error },
        };
      });
    });
};

export const translateCurrentLyrics = (
  reason = 'effect',
  info = activeSongInfo ?? getSongInfo(),
) => {
  const cur = currentLyrics();
  const shouldLog = reason !== 'effect';
  if (!info?.videoId) {
    if (shouldLog) {
      translationDebug('translation skipped: no song info', { reason });
    }
    return;
  }
  if (lyricsStore.videoId !== info.videoId) {
    if (shouldLog) {
      translationDebug('translation waiting for current song lyrics', {
        reason,
        videoId: info.videoId,
        lyricsVideoId: lyricsStore.videoId,
      });
    }
    clearCurrentTranslation();
    return;
  }
  if (cur.state !== 'done') {
    if (shouldLog) {
      translationDebug('translation waiting for lyrics', {
        reason,
        videoId: info.videoId,
        provider: lyricsStore.provider,
        state: cur.state,
      });
    }
    clearCurrentTranslation();
    return;
  }
  const data = cur.data;
  if (!data || !hasLyricText(data)) {
    if (shouldLog) {
      translationDebug('translation skipped: no lyric result', {
        reason,
        videoId: info.videoId,
        provider: lyricsStore.provider,
      });
    }
    clearCurrentTranslation();
    return;
  }
  const lineTexts = getLyricLineTexts(data);

  if (lineTexts.length === 0) {
    if (shouldLog) {
      translationDebug('translation skipped: lyric result has no text lines', {
        reason,
        videoId: info.videoId,
        provider: lyricsStore.provider,
        title: data.title || info.title,
      });
    }
    clearCurrentTranslation();
    return;
  }

  if (shouldLog) {
    translationDebug('translation candidate ready', {
      reason,
      videoId: info.videoId,
      provider: lyricsStore.provider,
      title: data.title || info.title,
      lines: lineTexts.length,
    });
  }

  const cfg = config();
  const resolvedTargetLanguage = cfg?.translation
    ? resolveTargetLanguage(cfg.translation.targetLanguage)
    : null;
  const sameLanguage =
    resolvedTargetLanguage && cfg?.translation?.enabled
      ? sourceLanguageMatchesTarget(lineTexts, resolvedTargetLanguage)
      : null;
  if (sameLanguage) {
    translationDebug('translation skipped: source language matches target', {
      reason,
      videoId: info.videoId,
      sourceLanguage: sameLanguage.language,
      targetLanguage: resolvedTargetLanguage,
      accuracy: sameLanguage.accuracy,
    });
    clearCurrentTranslation();
    return;
  }

  if (
    cfg?.translation?.enabled &&
    isChineseTranslationTarget(cfg.translation.targetLanguage)
  ) {
    const officialLines = getOfficialChineseTranslationLines(data, lineTexts);
    if (officialLines) {
      setOfficialTranslation(
        info.videoId,
        resolvedTargetLanguage ??
          resolveTargetLanguage(cfg.translation.targetLanguage),
        data.translation?.provider || lyricsStore.provider,
        lineTexts,
        officialLines,
      );
      return;
    }
  }

  fetchTranslation(
    info.videoId,
    data.title || info.title,
    data.artists?.length ? data.artists : info.artist ? [info.artist] : [],
    lineTexts,
  ).catch((err: unknown) => {
    console.error('[synced-lyrics] fetchTranslation crashed:', err);
  });
};

export const refreshCurrentLyrics = (reason: string, info = getSongInfo()) => {
  if (reason === 'config-change' && activeSongInfo) {
    info = activeSongInfo;
  }

  if (!info?.videoId) {
    translationDebug('lyrics refresh skipped: no song info', { reason });
    translateCurrentLyrics(reason);
    return;
  }

  if (
    reason === 'document-videodatachange' &&
    activeSongInfo &&
    activeSongInfo.videoId !== info.videoId
  ) {
    return;
  }

  const refreshKey = `${reason}:${info.videoId}`;
  const now = Date.now();
  if (
    reason === 'document-videodatachange' &&
    refreshKey === lastRefreshKey &&
    now - lastRefreshAt < 750
  ) {
    return;
  }
  lastRefreshKey = refreshKey;
  lastRefreshAt = now;

  activeSongInfo = info;

  translationDebug('lyrics refresh requested', {
    reason,
    videoId: info.videoId,
    title: info.title,
  });
  fetchLyrics(info);
  translateCurrentLyrics(reason, info);
};

// Whenever the active provider's lyrics resolve, kick off a translation pass for
// the current song. The translation store dedupes and caches on disk, so re-running
// this (on every provider/song switch) is cheap.
createEffect(() => {
  translateCurrentLyrics();
});
