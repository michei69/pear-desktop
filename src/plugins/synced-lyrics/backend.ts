import { net } from 'electron';

import { createBackend } from '@/utils';

import {
  buildCacheKey,
  buildSourceHash,
  clearCache,
  readCache,
  writeCache,
} from './translation/cache';
import { getTranslationModelId } from './translation/model-id';
import { runTranslation } from './translation/translate';
import { TRANSLATION_STRATEGY_VERSION } from './translation/version';

import type { TranslationRequest } from './translation/types';
import type {
  TranslationProviderName,
  TranslationProviderSettings,
} from './types';

const debugListener = (message: string, data?: unknown) => {
  console.info(`[synced-lyrics] ${message}`, data ?? '');
};

const handlers = {
  // Note: This will only be used for Forbidden headers, e.g. User-Agent, Authority, Cookie, etc.
  // See: https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header
  async fetch(
    url: string,
    init: RequestInit,
  ): Promise<[number, string, Record<string, string>]> {
    const res = await net.fetch(url, init);
    return [
      res.status,
      await res.text(),
      Object.fromEntries(res.headers.entries()),
    ];
  },
};

interface TranslateInvokeArgs {
  videoId: string;
  request: TranslationRequest;
  provider: TranslationProviderName;
  settings: TranslationProviderSettings[TranslationProviderName];
}

const handleTranslate = async (
  args: TranslateInvokeArgs,
): Promise<{ lines: string[]; fromCache: boolean; error?: string }> => {
  const model = getTranslationModelId(args.provider, args.settings);
  const sourceHash = buildSourceHash(args.request.lines);
  const cacheKey = buildCacheKey({
    videoId: args.videoId,
    targetLanguage: args.request.resolvedTargetLanguage,
    provider: args.provider,
    model,
    sourceHash,
  });

  const cached = await readCache(cacheKey);
  if (
    cached &&
    cached.strategyVersion === TRANSLATION_STRATEGY_VERSION &&
    cached.lines.length === args.request.lines.length
  ) {
    console.info('[synced-lyrics] translation cache hit', {
      videoId: args.videoId,
      provider: args.provider,
      model,
      targetLanguage: args.request.resolvedTargetLanguage,
      strategyVersion: TRANSLATION_STRATEGY_VERSION,
      lines: cached.lines.length,
    });
    return { lines: cached.lines, fromCache: true };
  }

  console.info('[synced-lyrics] translation request', {
    videoId: args.videoId,
    provider: args.provider,
    model,
    targetLanguage: args.request.resolvedTargetLanguage,
    strategyVersion: TRANSLATION_STRATEGY_VERSION,
    lines: args.request.lines.length,
  });

  const lines = await runTranslation(
    args.provider,
    args.settings,
    args.request,
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[synced-lyrics] translation request failed', {
      videoId: args.videoId,
      provider: args.provider,
      model,
      message,
    });
    return null;
  });

  if (!lines) {
    return {
      lines: [],
      fromCache: false,
      error: 'Translation provider did not return parseable lyrics',
    };
  }

  await writeCache({
    key: cacheKey,
    strategyVersion: TRANSLATION_STRATEGY_VERSION,
    title: args.request.title,
    artists: args.request.artists,
    targetLanguage: args.request.resolvedTargetLanguage,
    provider: args.provider,
    model,
    sourceHash,
    sourceLines: args.request.lines,
    createdAt: Date.now(),
    lines,
  });

  return { lines, fromCache: false };
};

export const backend = createBackend({
  start(ctx) {
    ctx.ipc.handle('synced-lyrics:fetch', (url: string, init: RequestInit) =>
      handlers.fetch(url, init),
    );
    ctx.ipc.handle('synced-lyrics:translate', (args: TranslateInvokeArgs) =>
      handleTranslate(args),
    );
    ctx.ipc.handle('synced-lyrics:translate-clear-cache', () => clearCache());
    ctx.ipc.on('synced-lyrics:translation-debug', debugListener);
  },
  stop(ctx) {
    ctx.ipc.removeHandler('synced-lyrics:fetch');
    ctx.ipc.removeHandler('synced-lyrics:translate');
    ctx.ipc.removeHandler('synced-lyrics:translate-clear-cache');
    ctx.ipc.removeAllListeners('synced-lyrics:translation-debug');
  },
});
