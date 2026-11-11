// Host-side state of a running instance: provider searches, romanization, the
// per-song custom queries, translations and the API's RPC methods.

import { join } from "node:path";
import type { Track } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import type { Translate } from "@pear/sdk/i18n";
import { net } from "electron";
import { apiCachedTranslation, apiProviderLyrics, type ApiLyrics } from "./api.ts";
import { CustomQueryStore } from "./custom-query.ts";
import { lineTextForTranslation } from "./line-text.ts";
import { pickProvider, resolvePriority, resolveTypePriority } from "./priority.ts";
import { type ProviderOptions, providers, SearchCache } from "./providers/index.ts";
import { nextForVideo, queueTrackFromNext, type VideoInfo } from "./providers/ytmusic.ts";
import { convertChinese, Romanizer } from "./romanize.ts";
import type { LyricsConfig } from "./schema.ts";
import { isChineseTarget, resolveTargetLanguage } from "./translation/language.ts";
import { TranslationService } from "./translation/service.ts";
import type { TranslationResult } from "./translation/types.ts";
import { lyricsType, type CustomQuery, type LyricResult, type ProviderId, type RomanizationScript, type SearchQuery } from "./types.ts";

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
  /** Watch-next metadata of videos the player is not on, for the API. */
  #videoInfo = new Map<string, Promise<VideoInfo>>();

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

  romanize(lines: string[], scripts: readonly RomanizationScript[]) {
    return this.#romanizer.romanize(lines, scripts);
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

  /** Empties the on-disk translation cache; returns how many files were removed. */
  clearTranslations() {
    return this.#translation.clear();
  }

  // ---- API RPC ----

  /**
   * Lyrics from every provider for the current track, or for any other video
   * (resolved through its watch-next queue entry), shaped like pear-desktop's
   * API. No lyrics is an empty provider list, not an error.
   */
  async lyrics(request: LyricsRequest): Promise<ApiLyrics> {
    const collected = await this.#collect(request);
    const { target, selected, results } = collected;
    if (!target || !selected) return { videoId: target, activeProvider: null, providers: [] };
    return {
      videoId: target,
      activeProvider: selected,
      providers: resolvePriority(request.config.providerPriority).flatMap((provider) => {
        const entry = apiProviderLyrics(provider, results[provider] ?? null);
        return entry ? [entry] : [];
      }),
    };
  }

  /** Translates the lyrics of the current track (or `videoId`) for the API. */
  async translateLyrics(request: TranslateLyricsRequest): Promise<TranslationResult> {
    const noLyrics = (): TranslationResult => ({
      provider: request.config.translationProvider,
      language: resolveTargetLanguage(request.lang || request.config.translationTargetLanguage, this.#translation.locale),
      lines: [],
      error: "no lyrics for this song",
      reason: "no-lyrics",
    });

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

    const { target, selected, results } = await this.#collect(request);
    if (!target || !selected) return noLyrics();
    const result =
      [results[selected], ...resolvePriority(request.config.providerPriority).map((provider) => results[provider])].find(
        (entry): entry is LyricResult => Boolean(entry && lyricsType(entry)),
      ) ?? null;
    if (!result) return noLyrics();

    const lines = result.lines?.length
      ? result.lines.map(lineTextForTranslation)
      : (result.plain ?? "").split("\n").map((line) => line.trim());

    return this.#translation.translate(
      {
        videoId: target,
        title: result.title,
        artists: result.artists,
        lines,
        ...(request.lang ? { language: request.lang } : {}),
        ...(request.force ? { force: true } : {}),
      },
      request.config,
    );
  }

  /** Provider results for the request's video: the playing track, or any other via its watch-next entry. */
  async #collect(request: LyricsRequest): Promise<{
    target: string | null;
    selected: ProviderId | null;
    results: Partial<Record<ProviderId, LyricResult | null>>;
  }> {
    const target = request.videoId ?? request.track?.videoId ?? null;
    if (!target) return { target, selected: null, results: {} };
    const query =
      request.track && target === request.track.videoId
        ? await this.#queryFor(request.track, request.details, request.config)
        : await this.#queryForVideo(target, request.config);
    if (!query) return { target, selected: null, results: {} };
    const results = await this.#searchAll(query, request.config, request.t);
    const selected = pickProvider({
      priority: resolvePriority(request.config.providerPriority),
      results,
      usePriorityList: request.config.usePriorityList,
      typePriority: resolveTypePriority(request.config.lyricsTypePriority),
      preferred: request.config.preferredProvider,
      wantsOfficialTranslation: wantsOfficialTranslation(request.config, this.#translation.locale),
    });
    return { target, selected, results };
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
      musixmatch: { tokenMode: config.musixmatchTokenMode, userToken: config.musixmatchToken, t },
      ytmusic: { useProxy: !config.useYTMLyricsWithoutProxy },
    };
  }

  /** The search query for a video the player is not on, from its watch-next queue entry. */
  async #queryForVideo(videoId: string, config: Readonly<LyricsConfig>): Promise<SearchQuery | null> {
    const info = await this.#infoForVideo(videoId).catch(() => null);
    if (!info) return null;
    const query: SearchQuery = {
      videoId,
      title: info.title,
      artist: info.artist,
      durationSeconds: info.durationSeconds,
      inexact: config.showLyricsEvenIfInexact,
    };
    if (info.album) query.album = info.album;
    const custom = await this.#customQueries.get(videoId);
    if (custom) {
      query.title = custom.query;
      query.alternativeTitle = custom.query;
      query.artist = custom.artist ?? "";
    }
    return query;
  }

  /** The video's watch-next metadata, cached (a failed lookup is not kept, so it can retry). */
  #infoForVideo(videoId: string): Promise<VideoInfo> {
    const cached = this.#videoInfo.get(videoId);
    if (cached) return cached;
    const pending = nextForVideo((url, init) => net.fetch(url, init), videoId).then((next) => {
      const info = queueTrackFromNext(next, videoId);
      if (!info) throw new Error(`no queue entry for ${videoId}`);
      return info;
    });
    this.#videoInfo.set(videoId, pending);
    pending.catch(() => this.#videoInfo.delete(videoId));
    while (this.#videoInfo.size > VIDEO_INFO_CACHE_SIZE) this.#videoInfo.delete(this.#videoInfo.keys().next().value!);
    return pending;
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

const VIDEO_INFO_CACHE_SIZE = 50;

/** pear-desktop prefers a provider that ships the official translation for Chinese targets. */
function wantsOfficialTranslation(config: Readonly<LyricsConfig>, locale: string) {
  return Boolean(config.translationEnabled && isChineseTarget(config.translationTargetLanguage, locale));
}

/** Keyed by the host context, which is also `this` in commands. */
export const hosts = new WeakMap<object, LyricsHost>();

export function hostOf(ctx: object) {
  const host = hosts.get(ctx);
  if (!host) throw new Error("synced-lyrics is not running");
  return host;
}
