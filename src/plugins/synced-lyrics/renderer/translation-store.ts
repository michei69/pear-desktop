import { createStore } from 'solid-js/store';
import { detectAll } from 'tinyld';

import { translationDebug } from './debug';
import { translateInvoke } from './index';
import { config } from './renderer';

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
  const done: VideoTranslation = { state: 'done', lines: translatedLines };

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

  // In-renderer memoisation: avoids re-invoking IPC for the same song/config
  // within a single session (the main process also caches to disk).
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

  const pending: VideoTranslation = { state: 'fetching', lines: [] };
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
          current: { state: 'error', lines: [], error: message },
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
    const done: VideoTranslation = { state: 'done', lines: result.lines };
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
