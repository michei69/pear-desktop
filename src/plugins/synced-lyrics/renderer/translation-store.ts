import { createStore } from 'solid-js/store';
import { detectAll } from 'tinyld';

import { getSongInfo } from '@/providers/song-info-front';

import { translationDebug } from './debug';
import { translateInvoke } from './index';
import { config } from './renderer';

import { hasLyricText } from '../providers';
import { getTranslationModelId } from '../translation/model-id';
import { TRANSLATION_STRATEGY_VERSION } from '../translation/version';

import type { TranslationRequest } from '../translation/types';
import type {
  TranslationTargetLanguage,
  TranslationProviderName,
  TranslationProviderSettings,
} from '../types';

type LineState = 'idle' | 'fetching' | 'done' | 'error';

interface VideoTranslation {
  state: LineState;
  // Indexed by line index in the lyrics' lines[] array.
  lines: string[];
  error?: string;
  /** Language it was translated into, for the WebSocket payload. */
  language?: string;
  /** Provider that produced it (`official-lyrics` for bundled translations). */
  provider?: string;
}

interface TranslationStore {
  current: VideoTranslation | null;
  videoId: string | null;
  key: string | null;
}

export const [translationStore, setTranslationStore] =
  createStore<TranslationStore>({
    current: null,
    videoId: null,
    key: null,
  });

const cache = new Map<string, VideoTranslation>();

export const resolveTargetLanguage = (
  target: TranslationTargetLanguage,
): string => {
  if (target !== 'auto') return target;
  // Try to follow the app's i18n language; fall back to navigator/document.
  const docLang = document.documentElement?.lang;
  return (
    docLang || (typeof navigator !== 'undefined' && navigator.language) || 'en'
  );
};

export const isChineseTranslationTarget = (
  target: TranslationTargetLanguage,
): boolean => resolveTargetLanguage(target).toLowerCase().startsWith('zh');

const normalizeLanguageFamily = (language: string): string => {
  const normalized = language.toLowerCase().replace('_', '-');
  const primary = normalized.split('-')[0] ?? normalized;
  if (primary === 'cmn' || primary === 'yue') return 'zh';
  if (primary === 'nb' || primary === 'nn') return 'no';
  if (primary === 'tl') return 'fil';
  return primary;
};

const detectLyricsLanguage = (
  lines: string[],
): { language: string; accuracy: number } | null => {
  const text = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  if (text.length < 24) return null;

  const [best] = detectAll(text);
  if (!best || best.accuracy < 0.55) return null;

  return { language: best.lang, accuracy: best.accuracy };
};

export const sourceLanguageMatchesTarget = (
  lines: string[],
  targetLanguage: string,
): { language: string; accuracy: number } | null => {
  const detected = detectLyricsLanguage(lines);
  if (!detected) return null;

  return normalizeLanguageFamily(detected.language) ===
    normalizeLanguageFamily(targetLanguage)
    ? detected
    : null;
};

const cacheKeyFor = (
  videoId: string,
  language: string,
  provider: string,
  model: string,
  lineCount: number,
  sourceSignature: string,
) =>
  `${TRANSLATION_STRATEGY_VERSION}::${videoId}::${language}::${provider}::${model}::${lineCount}::${sourceSignature}`;

const toPlainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const plainProviderSettings = (
  providerName: TranslationProviderName,
  settings: TranslationProviderSettings[TranslationProviderName],
): TranslationProviderSettings[TranslationProviderName] => {
  switch (providerName) {
    case 'openai-compatible': {
      const s = settings as TranslationProviderSettings['openai-compatible'];
      return {
        baseUrl: String(s.baseUrl ?? ''),
        apiKey: String(s.apiKey ?? ''),
        model: String(s.model ?? ''),
        apiMode: s.apiMode ?? 'responses',
      } satisfies TranslationProviderSettings['openai-compatible'];
    }
    case 'anthropic': {
      const s = settings as TranslationProviderSettings['anthropic'];
      return {
        apiKey: String(s.apiKey ?? ''),
        model: String(s.model ?? ''),
      } satisfies TranslationProviderSettings['anthropic'];
    }
    case 'gemini': {
      const s = settings as TranslationProviderSettings['gemini'];
      return {
        apiKey: String(s.apiKey ?? ''),
        model: String(s.model ?? ''),
      } satisfies TranslationProviderSettings['gemini'];
    }
    case 'local-cli': {
      const s = settings as TranslationProviderSettings['local-cli'];
      const engine = ['claude', 'codex', 'gemini'].includes(s.engine)
        ? s.engine
        : 'claude';
      return {
        engine,
        command: '',
        model: '',
        timeoutSeconds: Number(s.timeoutSeconds ?? 120),
      } satisfies TranslationProviderSettings['local-cli'];
    }
    case 'google-translate': {
      const s = settings as TranslationProviderSettings['google-translate'];
      return {
        host: String(s.host ?? 'translate.google.com'),
      } satisfies TranslationProviderSettings['google-translate'];
    }
  }
};

export const clearCurrentTranslation = () => {
  setTranslationStore({ current: null, videoId: null, key: null });
};

export const setOfficialTranslation = (
  videoId: string,
  language: string,
  provider: string,
  sourceLines: string[],
  translatedLines: string[],
) => {
  const key = cacheKeyFor(
    videoId,
    language,
    'official-lyrics',
    provider,
    sourceLines.length,
    JSON.stringify(sourceLines),
  );
  const done: VideoTranslation = {
    state: 'done',
    lines: translatedLines,
    language,
    provider,
  };

  cache.set(key, done);
  if (translationStore.videoId === videoId && translationStore.key === key) {
    return;
  }

  translationDebug('official translation ready', {
    videoId,
    provider,
    language,
    strategyVersion: TRANSLATION_STRATEGY_VERSION,
    lines: translatedLines.length,
  });
  setTranslationStore({ current: done, videoId, key });
};

export const fetchTranslation = async (
  videoId: string,
  title: string,
  artists: string[],
  lines: string[],
) => {
  const cfg = config();
  if (!cfg?.translation?.enabled) {
    translationDebug('translation disabled in config', { videoId });
    clearCurrentTranslation();
    return;
  }
  if (!lines.length) {
    translationDebug('translation skipped: empty line list', { videoId });
    clearCurrentTranslation();
    return;
  }

  const providerName = cfg.translation.provider;
  const settings = plainProviderSettings(
    providerName,
    cfg.translation.providers[providerName],
  );
  const language = resolveTargetLanguage(cfg.translation.targetLanguage);
  const sameLanguage = sourceLanguageMatchesTarget(lines, language);
  if (sameLanguage) {
    translationDebug('translation skipped: source language matches target', {
      videoId,
      sourceLanguage: sameLanguage.language,
      targetLanguage: language,
      accuracy: sameLanguage.accuracy,
    });
    clearCurrentTranslation();
    return;
  }

  const model = getTranslationModelId(providerName, settings);
  const sourceSignature = JSON.stringify(lines);
  const key = cacheKeyFor(
    videoId,
    language,
    providerName,
    model,
    lines.length,
    sourceSignature,
  );

  // In-renderer memoisation: avoids re-invoking IPC for the same song/config in a
  // session (the main process also caches to disk).
  const memo = cache.get(key);
  if (memo) {
    if (translationStore.videoId === videoId && translationStore.key === key) {
      return;
    }
    translationDebug('translation renderer cache hit', {
      videoId,
      provider: providerName,
      model,
      language,
      strategyVersion: TRANSLATION_STRATEGY_VERSION,
      state: memo.state,
    });
    setTranslationStore({ current: memo, videoId, key });
    return;
  }

  const pending: VideoTranslation = {
    state: 'fetching',
    lines: [],
    language,
    provider: providerName,
  };
  cache.set(key, pending);
  setTranslationStore({ current: pending, videoId, key });

  const request: TranslationRequest = toPlainJson({
    title,
    artists,
    targetLanguage: cfg.translation.targetLanguage,
    resolvedTargetLanguage: language,
    lines,
  });

  try {
    translationDebug('translating lyrics', {
      videoId,
      provider: providerName,
      model,
      language,
      strategyVersion: TRANSLATION_STRATEGY_VERSION,
      lines: lines.length,
    });
    const result = await translateInvoke(
      toPlainJson({
        videoId,
        request,
        provider: providerName,
        settings,
      }),
    );
    if (result.error || result.lines.length === 0) {
      const message = result.error || 'Translation provider returned no lines';
      cache.delete(key);
      if (
        translationStore.videoId === videoId &&
        translationStore.key === key
      ) {
        setTranslationStore({
          current: {
            state: 'error',
            lines: [],
            error: message,
            language,
            provider: providerName,
          },
          videoId,
          key,
        });
        translationDebug('translation failed', { videoId, message });
      }
      return;
    }
    translationDebug('translation ready', {
      videoId,
      provider: providerName,
      model,
      language,
      fromCache: result.fromCache,
      strategyVersion: TRANSLATION_STRATEGY_VERSION,
      lines: result.lines.length,
    });
    const done: VideoTranslation = {
      state: 'done',
      lines: result.lines,
      language,
      provider: providerName,
    };
    cache.set(key, done);
    if (translationStore.videoId === videoId && translationStore.key === key) {
      setTranslationStore({ current: done, videoId, key });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed: VideoTranslation = {
      state: 'error',
      lines: [],
      error: message,
      language,
      provider: providerName,
    };
    cache.delete(key);
    if (translationStore.videoId === videoId && translationStore.key === key) {
      setTranslationStore({ current: failed, videoId, key });
      translationDebug('translation failed', { videoId, message });
      console.error('[synced-lyrics] translation failed:', message);
    }
  }
};

export const getLineTranslation = (
  videoId: string,
  index: number,
): string | undefined => {
  const cur = translationStore.current;
  if (!cur || translationStore.videoId !== videoId) return undefined;
  if (cur.state !== 'done') return undefined;
  return cur.lines[index];
};

/** Why a language translation produced no lines. */
export type LanguageTranslationReason =
  | 'disabled'
  | 'no-lyrics'
  | 'same-language'
  | 'provider-error';

export interface LanguageTranslationResult {
  provider: TranslationProviderName | null;
  language: string;
  lines: string[];
  fromCache?: boolean;
  /** Set when the lyrics were already in the requested language. */
  sameLanguage?: boolean;
  error?: string;
  /** Present exactly when `lines` is empty, so a caller can switch on it. */
  reason?: LanguageTranslationReason;
}

/**
 * The song to translate, with the best provider's lines — synced lines when it
 * has any, plain lyrics otherwise. `videoId` asks about another video; omitted,
 * it is the song the UI is on, picked across every provider rather than
 * `lyricsStore.current` because the lyrics panel may never have mounted.
 *
 * `store` is imported lazily because it imports this module back; a static
 * import would make the app's translation setup depend on module order.
 */
const songLines = async (
  videoId?: string,
): Promise<{
  videoId: string;
  title: string;
  artists: string[];
  lines: string[];
} | null> => {
  const {
    lyricsStore,
    splitPlainLyrics,
    allProviderLyrics,
    lyricsForVideo,
    pickProvider,
  } = await import('./store');

  // For the current song this waits for providers still fetching and starts a
  // fetch when the lyrics tab never did; for another video it fills the same
  // per-video cache from that video's own page.
  const states = videoId
    ? await lyricsForVideo(videoId)
    : await allProviderLyrics();
  const sourceVideoId = videoId ?? lyricsStore.videoId;
  const provider = pickProvider(sourceVideoId, states);

  const data = provider ? states[provider]?.data : null;
  if (!sourceVideoId || !data || !hasLyricText(data)) return null;

  const lines = data.lines?.some((line) => line.text.trim())
    ? data.lines.map((line) => line.text)
    : data.lyrics
      ? splitPlainLyrics(data.lyrics)
      : [];
  if (!lines.length) return null;

  // The player's own song info only describes the current song.
  const info = videoId ? null : getSongInfo();
  return {
    videoId: sourceVideoId,
    title: data.title || info?.title || '',
    artists: data.artists?.length
      ? data.artists
      : info?.artist
        ? [info.artist]
        : [],
    lines,
  };
};

/**
 * Translate a song into `language` on behalf of the API. `videoId` asks about
 * another video; omitted, it is the current song.
 *
 * Same setup as `fetchTranslation` — config, provider settings, model, request —
 * but the target language comes from the caller and nothing here writes to
 * `translationStore`, so the lyrics the app is showing stay exactly as they were.
 * The main process caches the result on disk; a failure comes back as data so a
 * route can answer with a status instead of a 500.
 */
export const translateForLanguage = async (
  language: string,
  videoId?: string,
): Promise<LanguageTranslationResult> => {
  const cfg = config();
  const providerName = cfg?.translation?.provider ?? null;
  if (!cfg?.translation?.enabled || !providerName) {
    translationDebug('language translation skipped: disabled in config', {
      language,
    });
    return {
      provider: providerName,
      language,
      lines: [],
      error: 'translation is disabled in the synced-lyrics config',
      reason: 'disabled',
    };
  }

  const song = await songLines(videoId);
  if (!song) {
    translationDebug('language translation skipped: no lyrics', {
      language,
      videoId,
    });
    return {
      provider: providerName,
      language,
      lines: [],
      error: 'no lyrics for the current song',
      reason: 'no-lyrics',
    };
  }

  const target = resolveTargetLanguage(language as TranslationTargetLanguage);
  const sameLanguage = sourceLanguageMatchesTarget(song.lines, target);
  if (sameLanguage) {
    translationDebug('language translation skipped: source matches target', {
      videoId: song.videoId,
      language: target,
      sourceLanguage: sameLanguage.language,
    });
    // Already in the requested language: the original lines are the answer, not
    // an error.
    return {
      provider: null,
      language: target,
      lines: song.lines,
      sameLanguage: true,
    };
  }

  const settings = plainProviderSettings(
    providerName,
    cfg.translation.providers[providerName],
  );
  const request: TranslationRequest = toPlainJson({
    title: song.title,
    artists: song.artists,
    targetLanguage: target as TranslationTargetLanguage,
    resolvedTargetLanguage: target,
    lines: song.lines,
  });

  try {
    translationDebug('translating lyrics for language', {
      videoId: song.videoId,
      provider: providerName,
      language: target,
      model: getTranslationModelId(providerName, settings),
      lines: song.lines.length,
    });
    const result = await translateInvoke(
      toPlainJson({
        videoId: song.videoId,
        request,
        provider: providerName,
        settings,
      }),
    );
    if (result.error || result.lines.length === 0) {
      return {
        provider: providerName,
        language: target,
        lines: [],
        error: result.error || 'Translation provider returned no lines',
        reason: 'provider-error',
      };
    }
    return {
      provider: providerName,
      language: target,
      lines: result.lines,
      fromCache: result.fromCache,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    translationDebug('language translation failed', {
      videoId: song.videoId,
      provider: providerName,
      language: target,
      message,
    });
    return {
      provider: providerName,
      language: target,
      lines: [],
      error: message,
      reason: 'provider-error',
    };
  }
};
