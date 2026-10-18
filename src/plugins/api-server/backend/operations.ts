/**
 * The API server's operations, in one place.
 *
 * The HTTP routes and the MCP tools both call these; each surface only maps an
 * operation's outcome to its own protocol (status codes vs tool text), so the
 * behavior — and the error messages — can't drift between them.
 *
 * Player getters read `PlayerState`, which the renderer keeps current; only the
 * reads state has no copy of (song, position, queue, search, browse, lyrics)
 * round-trip the renderer.
 */
import * as config from '@/config';
import { isEnabled } from '@/config/plugins';
import { cacheEntriesForVideo } from '@/plugins/synced-lyrics/translation/cache';
import { getAppMeta } from '@/providers/app-meta';
import {
  isPerformancePartEnabled,
  performanceModeOverrides,
} from '@/providers/performance-mode';
import { getSongControls } from '@/providers/song-controls';

import { callRenderer, callRendererWithTimeout, sendToRenderer } from './ipc';
import {
  type ResponseAutoplay,
  type ResponseBrowseRaw,
  type ResponseLyrics,
  type ResponseLyricsTranslation,
  type ResponseLyricsTranslations,
  type ResponseQueue,
  type ResponseSearch,
  type ResponseSongInfo,
} from './schemas-v2';

import { ApiActions, type ApiAction } from '../channels';

import type { PlayerState } from './state';
import type { LanguageTranslationResult } from '@/plugins/synced-lyrics/renderer/translation-store';
import type { LikeType, RepeatMode } from '@/types/datahost-get-state';
import type { BrowserWindow } from 'electron';

/** Translations may take minutes — far past the renderer's default timeout. */
const TRANSLATION_TIMEOUT_MS = 120_000;

const LYRICS_DISABLED = 'The synced-lyrics plugin is disabled.';
const DOWNLOADER_DISABLED = 'The downloader plugin is disabled.';

/** The statuses an operation failure reports. */
export type FailureStatus = 400 | 404 | 502;

/** An operation's answer: a value, or the failure a surface should report. */
export type Outcome<T = undefined, S extends FailureStatus = FailureStatus> =
  | { ok: true; value: T }
  | { ok: false; status: S; error: string };

export type SearchArgs = {
  query: string;
  params?: string;
  continuation?: string;
  raw?: boolean;
};

export type BrowseArgs = {
  browseId?: string;
  continuation?: string;
  raw?: boolean;
};

export type Operations = ReturnType<typeof createOperations>;

const ok = <T>(value: T): Outcome<T, never> => ({ ok: true, value });
const done = (): Outcome<undefined, never> => ({ ok: true, value: undefined });
const fail = <S extends FailureStatus>(
  status: S,
  error: string,
): Outcome<never, S> => ({
  ok: false,
  status,
  error,
});

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The operations both API surfaces offer, bound to one window's player. */
export const createOperations = (
  window: BrowserWindow,
  playerState: PlayerState,
) => {
  const controller = getSongControls(window);

  const send = (action: ApiAction, ...args: unknown[]) => {
    sendToRenderer(window, action, ...args);
  };

  /** A renderer getter as an outcome; a timeout is a failed gateway, not a 500. */
  const call = async <T>(
    action: ApiAction,
    ...args: unknown[]
  ): Promise<Outcome<T, 502>> => {
    try {
      return ok(await callRenderer<T>(window, action, ...args));
    } catch (error) {
      return fail(502, messageOf(error));
    }
  };

  const flagsOverride = () =>
    (config.get('options.featureFlags') ?? {}) as Record<string, unknown>;

  /** Applies an override to the page, so it needs no restart. */
  const applyFlag = (name: string, value: unknown) =>
    window.webContents
      .executeJavaScript(
        `window.__peardFeatureFlags?.set(${JSON.stringify(name)}, ${JSON.stringify(value)})`,
      )
      .catch(() => undefined);

  /** Puts the page's own value back for an override being dropped. */
  const removeFlag = (name: string) =>
    window.webContents
      .executeJavaScript(
        `window.__peardFeatureFlags?.remove(${JSON.stringify(name)})`,
      )
      .catch(() => undefined);

  return {
    // Player commands
    nextVideo: () => send(ApiActions.nextVideo),
    previousVideo: () => send(ApiActions.previousVideo),
    playVideo: (videoId: string) => controller.loadVideo(videoId),
    play: () => send(ApiActions.play),
    pause: () => send(ApiActions.pause),
    togglePlay: () => send(ApiActions.togglePlay),
    setPlaybackSpeed: (speed: number) =>
      send(ApiActions.setPlaybackSpeed, speed),
    seekTo: (seconds: number) => send(ApiActions.seekTo, seconds),
    seekBy: (seconds: number) => send(ApiActions.seekBy, seconds),
    shuffleQueue: () => send(ApiActions.shuffle),
    setShuffle: (enabled: boolean) => send(ApiActions.setShuffle, enabled),
    setRepeat: (mode: RepeatMode) => send(ApiActions.setRepeat, mode),
    switchRepeat: () => send(ApiActions.switchRepeat),
    setVolume: (volume: number) => send(ApiActions.setVolume, volume),
    setMute: (muted: boolean) => send(ApiActions.setMute, muted),
    toggleMute: () => send(ApiActions.toggleMute),
    setLikeState: (state: LikeType) => send(ApiActions.setLikeState, state),
    like: () => send(ApiActions.like),
    dislike: () => send(ApiActions.dislike),
    unlike: () => send(ApiActions.unlike),
    addToQueue: (
      videoIds: string[] = [],
      playlistIds: string[] = [],
      insertPosition = 'INSERT_AFTER_CURRENT_VIDEO',
    ) => send(ApiActions.addToQueue, videoIds, insertPosition, playlistIds),
    moveInQueue: (index: number, toIndex: number) =>
      send(ApiActions.moveInQueue, index, toIndex),
    removeFromQueue: (index: number) => send(ApiActions.removeFromQueue, index),
    setQueueIndex: (index: number) => send(ApiActions.setQueueIndex, index),
    clearQueue: () => send(ApiActions.clearQueue),
    downloadVideo: async (
      videoId?: string,
    ): Promise<Outcome<undefined, 400 | 404>> => {
      if (!(await isEnabled('downloader'))) {
        return fail(404, DOWNLOADER_DISABLED);
      }

      const id = videoId || playerState.song?.videoId;
      if (!id) {
        return fail(400, 'No video is playing and no videoId was given.');
      }

      send(ApiActions.downloadVideo, id);
      return done();
    },

    // Cached player state: the single source HTTP and the WebSocket both read
    playing: () => playerState.playing,
    playbackSpeed: () => playerState.speed ?? 1,
    shuffleState: () => playerState.shuffle,
    repeatMode: () => playerState.repeat ?? null,
    volume: () => playerState.volumeLevel,
    muteState: () => playerState.muted,
    likeState: () => playerState.rating,

    // Renderer reads with no cached copy
    video: () => call<ResponseSongInfo | undefined>(ApiActions.getVideo),
    playbackPosition: (percentage: boolean) =>
      call<number>(ApiActions.getPlaybackPosition, percentage),
    queue: (raw: boolean) =>
      call<ResponseQueue | undefined>(ApiActions.getQueue, raw),
    autoplay: async (
      raw: boolean,
      continuation?: string,
    ): Promise<Outcome<ResponseAutoplay, 502>> => {
      const result = await call<ResponseAutoplay | null>(
        ApiActions.getAutoplay,
        raw,
        continuation,
      );

      if (!result.ok || !result.value) {
        return result.ok
          ? fail(502, 'The next autoplay page could not be fetched.')
          : result;
      }

      return ok(result.value);
    },
    search: (args: SearchArgs) =>
      call<ResponseSearch>(
        ApiActions.search,
        args.query,
        args.params,
        args.continuation,
        args.raw ?? false,
      ),
    browse: async (
      args: BrowseArgs,
    ): Promise<Outcome<ResponseBrowseRaw, 502>> => {
      const result = await call<ResponseBrowseRaw | null>(
        ApiActions.browse,
        args.browseId,
        args.continuation,
        args.raw ?? false,
      );

      if (!result.ok || !result.value) {
        return result.ok ? fail(502, 'The browse request failed.') : result;
      }

      return ok(result.value);
    },

    // Plugins with their own gates
    lyrics: async (
      videoId?: string,
    ): Promise<Outcome<ResponseLyrics | undefined, 404 | 502>> => {
      if (!(await isEnabled('synced-lyrics'))) {
        return fail(404, LYRICS_DISABLED);
      }

      const result = await call<ResponseLyrics | null>(
        ApiActions.getLyrics,
        videoId,
      );
      if (!result.ok) {
        return result;
      }

      return ok(result.value ?? undefined);
    },
    lyricsTranslations: async (
      videoId?: string,
    ): Promise<Outcome<ResponseLyricsTranslations, 404>> => {
      if (!(await isEnabled('synced-lyrics'))) {
        return fail(404, LYRICS_DISABLED);
      }

      const id = videoId || playerState.song?.videoId || null;
      const entries = id ? await cacheEntriesForVideo(id).catch(() => []) : [];

      return ok({
        videoId: id,
        translations: entries.map((entry) => ({
          language: entry.targetLanguage,
          provider: entry.provider,
          model: entry.model,
          title: entry.title,
          artists: entry.artists,
          createdAt: entry.createdAt,
          lines: entry.lines,
        })),
      });
    },
    translateLyrics: async (
      lang: string,
      videoId?: string,
    ): Promise<Outcome<ResponseLyricsTranslation, 404 | 502>> => {
      if (!(await isEnabled('synced-lyrics'))) {
        return fail(404, LYRICS_DISABLED);
      }

      let result: LanguageTranslationResult | null;
      try {
        result =
          await callRendererWithTimeout<LanguageTranslationResult | null>(
            window,
            ApiActions.translateLyrics,
            TRANSLATION_TIMEOUT_MS,
            lang,
            videoId,
          );
      } catch (error) {
        return fail(502, messageOf(error));
      }

      // Null only when the renderer did not attempt it, i.e. the plugin is off.
      if (!result) {
        return fail(404, LYRICS_DISABLED);
      }

      if (result.reason) {
        return fail(
          result.reason === 'provider-error' ? 502 : 404,
          result.error ??
            `Cannot translate the current lyrics: ${result.reason}`,
        );
      }

      return ok({
        videoId: videoId ?? playerState.song?.videoId ?? null,
        language: result.language,
        provider: result.provider,
        lines: result.lines,
        ...(result.fromCache !== undefined && {
          fromCache: result.fromCache,
        }),
        ...(result.sameLanguage !== undefined && {
          sameLanguage: result.sameLanguage,
        }),
      });
    },

    // Config and app
    getConfig: () => config.getAll(),
    patchConfig: (patch: Record<string, unknown>) => config.patch(patch),
    appMeta: () => getAppMeta(),
    featureFlags: async () => {
      const saved = flagsOverride();
      // What the app actually sets: performance mode's flags, then the user's,
      // the same merge the preload applies to the page.
      const applied = isPerformancePartEnabled('flags')
        ? performanceModeOverrides(saved, config.get('options.performanceMode'))
        : saved;
      const names = Object.keys(applied).sort();
      // With nothing set, the page is running its own defaults and there is
      // nothing to report — or to ask it for.
      if (names.length === 0) return [];

      // The page already carries YouTube Music's own flags; only the ones this
      // app sets can differ, so only those cross CDP.
      const live = (await window.webContents
        .executeJavaScript(
          `(() => {
            const flags = window.ytcfg?.data_?.EXPERIMENT_FLAGS ?? {};
            return ${JSON.stringify(names)}
              .filter((name) => name in flags)
              .map((name) => [name, flags[name]]);
          })()`,
        )
        .catch(() => [])) as [string, unknown][];
      const liveByName = Object.fromEntries(live);

      return names.map((name) => ({
        name,
        value: Object.hasOwn(liveByName, name)
          ? liveByName[name]
          : applied[name],
        overridden: Object.hasOwn(saved, name),
      }));
    },
    patchFeatureFlags: async (patch: Record<string, unknown>) => {
      config.set('options.featureFlags', { ...flagsOverride(), ...patch });
      await Promise.all(
        Object.entries(patch).map(([name, value]) => applyFlag(name, value)),
      );
    },
    deleteFeatureFlags: async (flags: string[]) => {
      const saved = { ...flagsOverride() };
      // Only an applied override needs the page to put its own value back;
      // removing one it never had would drop the flag from the page's map.
      const hadOverride = flags.filter((name) => Object.hasOwn(saved, name));
      for (const name of flags) delete saved[name];
      config.set('options.featureFlags', saved);
      await Promise.all(hadOverride.map((name) => removeFlag(name)));
    },
  };
};
