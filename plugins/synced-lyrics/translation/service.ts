// Host-side translation: config → provider → disk cache. Every failure comes
// back as data, so the lyrics view and the API never see a throw.

import type { LyricsConfig } from "../schema.ts";
import type { Fetch } from "../providers/http.ts";
import { TranslationCache, buildCacheKey, buildSourceHash, TRANSLATION_STRATEGY_VERSION } from "./cache.ts";
import { detectLyricsLanguage, resolveTargetLanguage, sourceLanguageMatchesTarget } from "./language.ts";
import { getTranslationModelId } from "./model-id.ts";
import { runTranslation } from "./translate.ts";
import type { CacheEntry, TranslationConfig, TranslationResult } from "./types.ts";

/** The flat plugin config, regrouped the way providers take it. */
export function translationConfigFrom(config: Readonly<LyricsConfig>): TranslationConfig {
  return {
    enabled: config.translationEnabled,
    provider: config.translationProvider,
    targetLanguage: config.translationTargetLanguage,
    providers: {
      "openai-compatible": {
        baseUrl: config.openaiBaseUrl,
        apiKey: config.openaiApiKey,
        model: config.openaiModel,
        apiMode: config.openaiApiMode,
      },
      anthropic: { apiKey: config.anthropicApiKey, model: config.anthropicModel },
      gemini: { apiKey: config.geminiApiKey, model: config.geminiModel },
      "local-cli": {
        engine: config.localCliEngine,
        command: config.localCliCommand,
        model: config.localCliModel,
        timeoutSeconds: config.localCliTimeoutSeconds,
      },
      "google-translate": { host: config.googleTranslateHost },
    },
  };
}

export interface TranslateOptions {
  videoId: string;
  title: string;
  artists: string[];
  lines: string[];
  /** Overrides the configured target language (the API's `lang`). */
  language?: string;
  /** Ignore a cached result and ask the provider again. */
  force?: boolean;
}

export interface TranslationServiceOptions {
  userData: string;
  locale: string;
  fetch: Fetch;
}

export class TranslationService {
  readonly #cache: TranslationCache;
  readonly #locale: string;
  readonly #fetch: Fetch;
  readonly #userData: string;

  constructor(options: TranslationServiceOptions) {
    this.#cache = new TranslationCache(options.userData);
    this.#locale = options.locale;
    this.#fetch = options.fetch;
    this.#userData = options.userData;
  }

  get locale() {
    return this.#locale;
  }

  async translate(options: TranslateOptions, config: Readonly<LyricsConfig>): Promise<TranslationResult> {
    const translation = translationConfigFrom(config);
    const providerName = translation.provider;

    if (!translation.enabled) {
      return {
        provider: providerName,
        language: resolveTargetLanguage(options.language || translation.targetLanguage, this.#locale),
        lines: [],
        error: "translation is disabled in the synced-lyrics config",
        reason: "disabled",
      };
    }

    const language = resolveTargetLanguage(options.language || translation.targetLanguage, this.#locale);
    if (options.lines.length === 0) {
      return { provider: providerName, language, lines: [], error: "no lyrics for this song", reason: "no-lyrics" };
    }

    const sameLanguage = sourceLanguageMatchesTarget(options.lines, language);
    if (sameLanguage) {
      console.info("[pear:synced-lyrics] translation skipped: lyrics already in the target language", {
        videoId: options.videoId,
        language,
        detected: sameLanguage.language,
      });
      return { provider: null, language, lines: options.lines.slice(), sameLanguage: true };
    }

    const settings = translation.providers[providerName];
    const model = getTranslationModelId(providerName, settings);
    const sourceHash = buildSourceHash(options.lines);
    const key = buildCacheKey({
      videoId: options.videoId,
      targetLanguage: language,
      provider: providerName,
      model,
      sourceHash,
    });

    if (!options.force) {
      const cached = await this.#cache.read(key);
      if (cached && cached.strategyVersion === TRANSLATION_STRATEGY_VERSION && cached.lines.length === options.lines.length) {
        console.info("[pear:synced-lyrics] translation cache hit", {
          videoId: options.videoId,
          provider: providerName,
          model,
          language,
          lines: cached.lines.length,
        });
        return { provider: providerName, language, lines: cached.lines, fromCache: true };
      }
    }

    console.info("[pear:synced-lyrics] translation request", {
      videoId: options.videoId,
      provider: providerName,
      model,
      language,
      detected: detectLyricsLanguage(options.lines)?.language ?? "unknown",
      lines: options.lines.length,
    });

    let lines: string[];
    try {
      lines = await runTranslation(
        providerName,
        settings,
        {
          title: options.title,
          artists: options.artists,
          targetLanguage: language,
          resolvedTargetLanguage: language,
          lines: options.lines,
        },
        { fetch: this.#fetch, userData: this.#userData },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[pear:synced-lyrics] translation failed", { videoId: options.videoId, provider: providerName, message });
      return { provider: providerName, language, lines: [], error: message, reason: "provider-error" };
    }

    if (lines.length !== options.lines.length || !lines.some((line) => line.trim())) {
      return {
        provider: providerName,
        language,
        lines: [],
        error: "Translation provider returned no usable lines",
        reason: "provider-error",
      };
    }

    try {
      await this.#cache.write({
        key,
        strategyVersion: TRANSLATION_STRATEGY_VERSION,
        title: options.title,
        artists: options.artists,
        targetLanguage: language,
        provider: providerName,
        model,
        sourceHash,
        sourceLines: options.lines,
        createdAt: Date.now(),
        lines,
      });
    } catch (error) {
      // A cache write failure must not discard the translation we already have.
      console.warn("[pear:synced-lyrics] failed to write translation cache", error);
    }

    return { provider: providerName, language, lines };
  }

  list(videoId: string): Promise<CacheEntry[]> {
    return this.#cache.forVideo(videoId);
  }

  clear() {
    return this.#cache.clear();
  }
}
