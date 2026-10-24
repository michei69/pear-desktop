// The API server's operations, in one place. HTTP routes and MCP tools both
// call these, so behavior and error messages can't drift between surfaces.

import { type NowPlaying, type PlayerAction, livePosition } from "@pear/sdk";
import { isPlaying } from "@pear/sdk/util";
import { type Flags, flagOverrides, withFlagOverride } from "@pear/sdk/core-config";
import type { SongDetails } from "@pear/sdk/song-details";
import { getAppMeta } from "../app-meta.ts";
import type { Settings } from "../config.ts";
import type { PluginHost } from "../plugins.ts";
import { REPEAT_NAMES, songInfo } from "./song-info.ts";
import type { PlayerState } from "./player-state.ts";
import type { QueueResponse, SongInfoV2 } from "./types.ts";

export type FailureStatus = 400 | 404 | 502;
export type Outcome<T = undefined, S extends FailureStatus = FailureStatus> =
  | { ok: true; value: T }
  | { ok: false; status: S; error: string };

export interface SearchArgs {
  query: string;
  params?: string;
  continuation?: string;
  raw?: boolean;
}

export interface BrowseArgs {
  browseId?: string;
  continuation?: string;
  raw?: boolean;
}

export interface OperationEnvironment {
  state(): NowPlaying;
  details(): SongDetails | undefined;
  control(action: PlayerAction): void;
  page<T = unknown>(event: string, payload?: unknown): Promise<T>;
  playerState: PlayerState;
  plugins: PluginHost;
  settings: Settings;
  /** Pushes a page-surface event to the WebSockets (lyrics, translations). */
  emit(name: "lyrics" | "translation", payload: unknown): void;
}

const ok = <T>(value: T): Outcome<T, never> => ({ ok: true, value });
const done = (): Outcome<undefined, never> => ({ ok: true, value: undefined });
const fail = <S extends FailureStatus>(status: S, error: string): Outcome<never, S> => ({ ok: false, status, error });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const LYRICS_DISABLED = "The synced-lyrics plugin is disabled.";
const DOWNLOADER_DISABLED = "The downloader plugin is disabled.";

export type Operations = ReturnType<typeof createOperations>;

export function createOperations(env: OperationEnvironment) {
  const { playerState, settings, plugins } = env;

  const isPluginEnabled = (id: string) => settings.plugin(id)?.enabled === true;

  /** A page getter as an outcome; a timeout is a bad gateway, not a 500. */
  const call = async <T>(event: string, payload?: unknown): Promise<Outcome<T, 502>> => {
    try {
      return ok(await env.page<T>(event, payload));
    } catch (error) {
      return fail(502, messageOf(error));
    }
  };

  const controlling = (action: PlayerAction) => () => {
    env.control(action);
  };

  /** Applies a flag to the running page, so it needs no restart. */
  const applyFlag = (name: string, value: unknown) => env.page("flags:set", { name, value }).catch(() => undefined);

  /** Puts the page's own value back for an override being dropped. */
  const removeFlag = (name: string) => env.page("flags:remove", name).catch(() => undefined);

  const savedFlags = (): Flags => flagOverrides(settings.core("site").siteFlags);

  /**
   * Calls a synced-lyrics RPC method, trying the input shapes the plugin may
   * declare (object or bare id) until one validates. The plugin owns the
   * provider implementations and the translation cache.
   */
  const lyricsRpc = async <T>(method: string, variants: unknown[]): Promise<Outcome<T, 502>> => {
    let lastError = `synced-lyrics: ${method} is unavailable`;
    for (const input of variants) {
      const result = await plugins.callRpc("synced-lyrics", method, input);
      if (result.ok) return ok(result.value as T);
      lastError = result.error;
      if (result.status !== 400) break;
    }
    return fail(502, lastError);
  };

  return {
    // Player commands
    nextVideo: controlling({ type: "next" }),
    previousVideo: controlling({ type: "previous" }),
    playVideo: (videoId: string) => void env.page("video:play", videoId).catch(() => undefined),
    play: controlling({ type: "play" }),
    pause: controlling({ type: "pause" }),
    togglePlay: controlling({ type: "toggle" }),
    setPlaybackSpeed(speed: number) {
      playerState.setSpeed(speed);
      void env.page("speed:set", speed).catch(() => undefined);
    },
    seekTo: (seconds: number) => env.control({ type: "seek", seconds }),
    seekBy: (seconds: number) => env.control({ type: "seekBy", seconds }),
    shuffleQueue: controlling({ type: "shuffle" }),
    setShuffle: (enabled: boolean) => void env.page("shuffle:set", enabled).catch(() => undefined),
    setRepeat: (mode: "NONE" | "ALL" | "ONE") => void env.page("repeat:set", mode).catch(() => undefined),
    switchRepeat: () => env.control({ type: "repeat" }),
    setVolume: (volume: number) => env.control({ type: "volume", value: volume }),
    setMute: (muted: boolean) => env.control({ type: "mute", muted }),
    toggleMute: () => env.control({ type: "mute" }),
    setLikeState: (state: "LIKE" | "DISLIKE" | "INDIFFERENT") => void env.page("like", state).catch(() => undefined),
    like: () => void env.page("like", "LIKE").catch(() => undefined),
    dislike: () => void env.page("like", "DISLIKE").catch(() => undefined),
    unlike: () => void env.page("like", "INDIFFERENT").catch(() => undefined),
    addToQueue: (videoIds: string[] = [], playlistIds: string[] = [], insertPosition = "INSERT_AFTER_CURRENT_VIDEO") =>
      void env.page("queue:add-items", { videoIds, playlistIds, insertPosition }).catch(() => undefined),
    moveInQueue: (index: number, toIndex: number) => void env.page("queue:move", { fromIndex: index, toIndex }).catch(() => undefined),
    removeFromQueue: (index: number) => void env.page("queue:remove", index).catch(() => undefined),
    setQueueIndex: (index: number) => void env.page("queue:set-index", index).catch(() => undefined),
    clearQueue: () => void env.page("queue:clear").catch(() => undefined),

    async downloadVideo(videoId?: string): Promise<Outcome<undefined, 400 | 404 | 502>> {
      if (!isPluginEnabled("downloader")) return fail(404, DOWNLOADER_DISABLED);
      const id = videoId || playerState.song?.videoId || env.state().track?.videoId;
      if (!id) return fail(400, "No video is playing and no videoId was given.");
      const result = await plugins.callRpc("downloader", "download", { videoId: id });
      if (!result.ok) return fail(result.status === 400 ? 400 : 502, result.error);
      return done();
    },

    // Cached player state
    playing: () => isPlaying(env.state()),
    /** The page owns the rate; read it live, keeping the cached copy fresh for PLAYER_INFO. */
    playbackSpeed: async () => {
      const live = await env.page<number>("speed").catch(() => undefined);
      if (typeof live === "number" && Number.isFinite(live)) playerState.setSpeed(live);
      return playerState.speed ?? 1;
    },
    shuffleState: () => playerState.shuffle,
    repeatMode: () => REPEAT_NAMES[env.state().repeat] as "NONE" | "ALL" | "ONE",
    volume: () => playerState.volumeLevel,
    muteState: () => playerState.muted,
    likeState: () => (env.state().track ? playerState.rating : null),

    // Renderer reads
    async video(): Promise<Outcome<SongInfoV2 | undefined>> {
      const info = songInfo(env.state(), env.details());
      if (!info) return ok(undefined);
      // The fork's `/video` also carries the scrobbler's config-derived names;
      // this app has no separate scrobbler names, so the track's own are used.
      return ok({ ...info, scrobbleTitle: info.title, scrobbleArtist: info.artist });
    },
    async playbackPosition(percentage: boolean): Promise<Outcome<number>> {
      const state = env.state();
      const seconds = livePosition(state);
      if (!percentage) return ok(seconds);
      const duration = state.track?.durationSeconds ?? 0;
      return ok(duration ? seconds / duration : 0);
    },
    queue: (raw: boolean) => call<QueueResponse | null>("queue:parsed", { raw }),
    autoplay: async (raw: boolean, continuation?: string): Promise<Outcome<{ items: unknown[]; continuation?: string }, 502>> => {
      const result = await call<{ items: unknown[]; continuation?: string } | null>("queue:autoplay", { raw, continuation });
      if (!result.ok) return result;
      return result.value ? ok(result.value) : fail(502, "The next autoplay page could not be fetched.");
    },
    search: (args: SearchArgs) =>
      call<unknown>("search:parsed", { query: args.query, params: args.params, continuation: args.continuation, raw: args.raw ?? false }),
    browse: async (args: BrowseArgs): Promise<Outcome<unknown, 502>> => {
      const result = await call<unknown | null>("browse", {
        browseId: args.browseId,
        continuation: args.continuation,
        raw: args.raw ?? false,
      });
      if (!result.ok) return result;
      return result.value ? ok(result.value) : fail(502, "The browse request failed.");
    },

    // Plugins with their own gates. The synced-lyrics plugin owns lyric
    // fetching, the translation providers and their cache; the API only calls
    // its RPC methods by name.
    async lyrics(videoId?: string): Promise<Outcome<unknown, 404 | 502>> {
      if (!isPluginEnabled("synced-lyrics")) return fail(404, LYRICS_DISABLED);
      const result = await lyricsRpc<unknown | null>("lyrics", videoId ? [{ videoId }, videoId, {}] : [{}, undefined]);
      if (!result.ok) return result;
      if (result.value && typeof result.value === "object") env.emit("lyrics", result.value);
      return ok(result.value ?? undefined);
    },
    async lyricsTranslations(videoId?: string): Promise<Outcome<{ videoId: string | null; translations: unknown[] }, 404 | 502>> {
      if (!isPluginEnabled("synced-lyrics")) return fail(404, LYRICS_DISABLED);
      const result = await lyricsRpc<{ videoId?: string | null; translations?: unknown[] }>(
        "translations",
        videoId ? [{ videoId }, videoId, {}] : [{}, undefined],
      );
      if (!result.ok) return result;
      const value = result.value;
      return ok({
        videoId: value?.videoId ?? videoId ?? playerState.song?.videoId ?? null,
        translations: Array.isArray(value?.translations) ? value.translations : [],
      });
    },
    async translateLyrics(lang: string, videoId?: string): Promise<Outcome<Record<string, unknown>, 404 | 502>> {
      if (!isPluginEnabled("synced-lyrics")) return fail(404, LYRICS_DISABLED);
      // The plugin's declared shapes vary by build: `{ lang, videoId? }`,
      // `{ language, videoId? }`, or `{ videoId?, force? }` (its configured
      // target language). First one that validates wins.
      const variants = [
        { lang, ...(videoId ? { videoId } : {}) },
        { language: lang, ...(videoId ? { videoId } : {}) },
        { lang },
        { language: lang },
        { ...(videoId ? { videoId } : {}) },
      ];
      const result = await lyricsRpc<unknown>("translateLyrics", variants);
      if (!result.ok) return result;

      const value = result.value;
      if (!value || typeof value !== "object") return fail(502, "The translation provider returned no result.");
      const translation = value as Record<string, unknown>;
      if (typeof translation.reason === "string") {
        return fail(
          translation.reason === "provider-error" ? 502 : 404,
          typeof translation.error === "string" ? translation.error : `Cannot translate the current lyrics: ${translation.reason}`,
        );
      }
      env.emit("translation", { language: lang, ...(videoId ? { videoId } : {}), ...translation });
      return ok(translation);
    },

    // Config and app
    getConfig: () => settings.all(),
    patchConfig: (patch: Record<string, unknown>) => settings.patch(patch),
    appMeta: () => getAppMeta(),
    featureFlags: async () => {
      const saved = savedFlags();
      const names = Object.keys(saved).sort();
      if (names.length === 0) return [];
      // The page already carries YTM's own flags; only the ones this app sets
      // can differ, so only those cross the bridge.
      const live = await env.page<Record<string, unknown>>("flags:list", names).catch((): Record<string, unknown> => ({}));
      return names.map((name) => ({
        name,
        value: Object.hasOwn(live, name) ? live[name] : saved[name],
        overridden: true,
      }));
    },
    patchFeatureFlags: async (patch: Record<string, unknown>) => {
      let flags = settings.core("site").siteFlags;
      for (const [name, value] of Object.entries(patch)) {
        if (typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") continue;
        flags = withFlagOverride(flags, name, value);
        await applyFlag(name, value);
      }
      settings.setCore("site", { siteFlags: flags });
    },
    deleteFeatureFlags: async (names: string[]) => {
      let flags = settings.core("site").siteFlags;
      for (const name of names) {
        flags = withFlagOverride(flags, name, undefined);
        await removeFlag(name);
      }
      settings.setCore("site", { siteFlags: flags });
    },
  };
}
