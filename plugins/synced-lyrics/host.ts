// Host-side state of a running instance: provider searches, romanization, the
// per-song custom queries, translations and the API's RPC methods.

import { join } from "node:path";
import type { Track } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import type { Translate } from "@pear/sdk/i18n";
import { net } from "electron";
import { apiCachedTranslation, apiProviderLyrics, type ApiLyrics } from "./api.ts";
import { CustomQueryStore } from "./custom-query.ts";
import { pickProvider, resolvePriority } from "./priority.ts";
import { type ProviderOptions, providers, SearchCache } from "./providers/index.ts";
import { convertChinese, Romanizer } from "./romanize.ts";
import type { LyricsConfig } from "./schema.ts";
import { resolveTargetLanguage } from "./translation/language.ts";
import { TranslationService } from "./translation/service.ts";
import type { TranslationResult } from "./translation/types.ts";
import type { CustomQuery, LyricResult, ProviderId, SearchQuery } from "./types.ts";

export interface LyricsRequest {
  track: Track | null;
  details: SongDetails | null;
  config: Readonly<LyricsConfig>;
  t: Translate;
  videoId?: string;
}

export interface TranslateLyricsRequest extends LyricsRequest {
  lang?: string;
  force?: boolean;
}

export interface PageTranslateRequest {
  videoId: string;
  title: string;
  artists: string[];
  lines: string[];
  language?: string;
}

export class LyricsHost {
  #cache = new SearchCache();
  #romanizer: Romanizer;
  #customQueries: CustomQueryStore;
  #translation: TranslationService;

  constructor(userData: string, locale: string) {
    this.#romanizer = new Romanizer(join(userData, "synced-lyrics", "kuromoji"), (url) => net.fetch(url));
    this.#customQueries = new CustomQueryStore(userData);
    this.#translation = new TranslationService({ userData, locale, fetch: (url, init) => net.fetch(url, init) });
  }

  search(provider: ProviderId, query: SearchQuery, options: ProviderOptions): Promise<LyricResult | null> {
    const run = providers[provider];
    if (!run) return Promise.reject(new Error(`unknown provider ${provider}`));
    return this.#cache.get(provider, query, () => run(query, (url, init) => net.fetch(url, init), options));
  }

  romanize(lines: string[]) {
    return this.#romanizer.romanize(lines);
  }

  convertChinese(lines: string[], mode: "s2t" | "t2s") {
    return convertChinese(lines, mode);
  }

  // ---- custom searches ----

  customQuery(videoId: string) {
    return this.#customQueries.get(videoId);
  }

  setCustomQuery(videoId: string, query: CustomQuery) {
    return this.#customQueries.set(videoId, query);
  }

  removeCustomQuery(videoId: string) {
    return this.#customQueries.remove(videoId);
  }

  // ---- translations ----

  /** One translation request from the page. Never throws: failures come back as data. */
  translate(request: PageTranslateRequest, config: Readonly<LyricsConfig>) {
    return this.#translation.translate(
      {
        videoId: request.videoId,
        title: request.title,
        artists: request.artists,
        lines: request.lines,
        ...(request.language ? { language: request.language } : {}),
      },
      config,
    );
  }

  /** Cached translations of one video, shaped for the API. */
  async translations(videoId: string | null) {
    if (!videoId) return { videoId: null, translations: [] };
    const entries = await this.#translation.list(videoId);
    return { videoId, translations: entries.map(apiCachedTranslation) };
  }

  // ---- API RPC ----

  /**
   * Lyrics from every provider for the current track (or `videoId`, when it is
   * the current one — other videos have no search metadata here), shaped like
   * pear-desktop's API. No lyrics is an empty provider list, not an error.
   */
  async lyrics(request: LyricsRequest): Promise<ApiLyrics> {
    const target = request.videoId ?? request.track?.videoId ?? null;
    if (!request.track || !target || target !== request.track.videoId) {
      return { videoId: target, activeProvider: null, providers: [] };
    }

    const query = await this.#queryFor(request.track, request.details, request.config);
    const results = await this.#searchAll(query, request.config, request.t);
    const priority = resolvePriority(request.config.providerPriority);
    const selected = pickProvider({
      priority,
      results,
      usePriorityList: request.config.usePriorityList,
      preferSynced: request.config.preferSynced,
      preferred: request.config.preferredProvider,
    });

    return {
      videoId: target,
      activeProvider: selected,
      providers: priority.flatMap((provider) => {
        const entry = apiProviderLyrics(provider, results[provider] ?? null);
        return entry ? [entry] : [];
      }),
    };
  }

  /** Translates the lyrics of the current track (or `videoId`) for the API. */
  async translateLyrics(request: TranslateLyricsRequest): Promise<TranslationResult> {
    if (!request.config.translationEnabled) {
      return this.#translation.translate(
        {
          videoId: request.videoId ?? request.track?.videoId ?? "",
          title: "",
          artists: [],
          lines: [],
          ...(request.lang ? { language: request.lang } : {}),
        },
        request.config,
      );
    }

    const lyrics = await this.lyrics(request);
    const active = lyrics.providers.find((entry) => entry.provider === lyrics.activeProvider) ?? lyrics.providers[0];
    if (!active || !lyrics.videoId) {
      return {
        provider: request.config.translationProvider,
        language: resolveTargetLanguage(request.lang || request.config.translationTargetLanguage, this.#translation.locale),
        lines: [],
        error: "no lyrics for this song",
        reason: "no-lyrics",
      };
    }

    const lines = active.lines?.length
      ? active.lines.map((line) => line.text)
      : (active.lyrics ?? "").split("\n").map((line) => line.trim());

    return this.#translation.translate(
      {
        videoId: lyrics.videoId,
        title: active.title,
        artists: active.artists,
        lines,
        ...(request.lang ? { language: request.lang } : {}),
        ...(request.force ? { force: true } : {}),
      },
      request.config,
    );
  }

  async #queryFor(track: Track, details: SongDetails | null, config: Readonly<LyricsConfig>): Promise<SearchQuery> {
    const custom = await this.#customQueries.get(track.videoId);
    const query: SearchQuery = {
      videoId: track.videoId,
      title: custom?.query ?? track.title,
      artist: custom ? (custom.artist ?? "") : track.artist,
      durationSeconds: track.durationSeconds,
      inexact: config.showLyricsEvenIfInexact,
    };
    if (track.album) query.album = track.album;
    if (details?.alternativeTitle && details.alternativeTitle !== track.title) query.alternativeTitle = details.alternativeTitle;
    if (details?.tags.length) query.tags = details.tags;
    if (custom) {
      query.title = custom.query;
      query.alternativeTitle = custom.query;
      query.artist = custom.artist ?? "";
    }
    return query;
  }

  #providerOptions(config: Readonly<LyricsConfig>, t: Translate): ProviderOptions {
    return {
      musixmatch: { userToken: config.musixmatchToken, t },
      ytmusic: { useProxyFallback: !config.useYTMLyricsWithoutProxy },
    };
  }

  async #searchAll(query: SearchQuery, config: Readonly<LyricsConfig>, t: Translate) {
    const options = this.#providerOptions(config, t);
    const results: Partial<Record<ProviderId, LyricResult | null>> = {};
    await Promise.all(
      resolvePriority(config.providerPriority).map(async (provider) => {
        try {
          results[provider] = await this.search(provider, query, options);
        } catch (error) {
          // One dead provider must not empty the API's answer.
          console.warn("[pear:synced-lyrics] provider failed", provider, error);
          results[provider] = null;
        }
      }),
    );
    return results;
  }
}

/** Keyed by the host context, which is also `this` in commands. */
export const hosts = new WeakMap<object, LyricsHost>();

export function hostOf(ctx: object) {
  const host = hosts.get(ctx);
  if (!host) throw new Error("synced-lyrics is not running");
  return host;
}
