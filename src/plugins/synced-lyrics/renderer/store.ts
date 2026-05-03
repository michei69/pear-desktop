import { createStore } from 'solid-js/store';
import { createEffect, createMemo, untrack } from 'solid-js';

import { getSongInfo } from '@/providers/song-info-front';

import { translationDebug } from './debug';
import { config } from './renderer';
import {
  clearCurrentTranslation,
  fetchTranslation,
  isChineseTranslationTarget,
  resolveTargetLanguage,
  sourceLanguageMatchesTarget,
  setOfficialTranslation,
} from './translation-store';

import {
  type ProviderName,
  providerNames,
  type ProviderState,
} from '../providers';
import { providers } from '../providers/renderer';
import { LRC } from '../parsers/lrc';

import type { LineLyrics, LyricProvider, LyricResult } from '../types';
import type { SongInfo } from '@/providers/song-info';

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

export const currentLyrics = createMemo(() => {
  const provider = lyricsStore.provider;
  if (!lyricsStore.videoId) return fetchingProviderState();
  return lyricsStore.lyrics[provider];
});

type VideoId = string;

type SearchCacheData = Record<ProviderName, ProviderState>;
interface SearchCache {
  state: 'loading' | 'done';
  data: SearchCacheData;
}

// TODO: Maybe use localStorage for the cache.
const MAX_SEARCH_CACHE_SIZE = 50;
const searchCache = new Map<VideoId, SearchCache>();

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

export const hasLyricText = (data?: LyricResult | null): boolean =>
  Boolean(
    data?.lines?.some((line) => line.text.trim()) || data?.lyrics?.trim(),
  );

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

export const fetchLyrics = (info: SongInfo) => {
  if (activeSongInfo?.videoId !== info.videoId) return;

  if (searchCache.has(info.videoId)) {
    const cache = searchCache.get(info.videoId)!;

    activateLyricsData(info.videoId, cache.data);

    return;
  }

  const cache: SearchCache = {
    state: 'loading',
    data: initialData(),
  };

  searchCache.set(info.videoId, cache);
  pruneSearchCache();
  activateLyricsData(info.videoId, cache.data);

  const tasks: Promise<void>[] = [];

  // prettier-ignore
  for (
    const [providerName, provider] of Object.entries(providers) as [
    ProviderName,
    LyricProvider,
  ][]
    ) {
    const pCache = cache.data[providerName];

    tasks.push(
      provider
        .search(info)
        .then((res) => {
          pCache.state = 'done';
          pCache.data = res;

          if (isStillActiveVideo(info.videoId)) {
            setLyricsStore('lyrics', (old) => {
              return {
                ...old,
                [providerName]: {
                  state: 'done',
                  data: res ? { ...res } : null,
                  error: null,
                },
              };
            });
          }
        })
        .catch((error: Error) => {
          pCache.state = 'error';
          pCache.error = error;

          console.error(error);

          if (isStillActiveVideo(info.videoId)) {
            setLyricsStore('lyrics', (old) => {
              return {
                ...old,
                [providerName]: { state: 'error', error, data: null },
              };
            });
          }
        }),
    );
  }

  Promise.allSettled(tasks).then(() => {
    cache.state = 'done';
    searchCache.set(info.videoId, cache);
    pruneSearchCache();
  });
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

// Whenever the active provider's lyrics resolve, kick off a translation pass
// for the current song. Switching provider/song re-fires this. The translation
// store does its own dedupe + on-disk caching, so this is cheap to re-run.
createEffect(() => {
  translateCurrentLyrics();
});
