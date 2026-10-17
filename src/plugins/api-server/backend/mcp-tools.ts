/**
 * The MCP tools: one per operation, implemented here rather than forwarded to
 * the HTTP routes, so the two surfaces can diverge (an endpoint MCP shouldn't
 * expose, a tool without a route). They drive the same renderer actions and
 * config helpers the routes do.
 *
 * It imports no HTTP app: `mcp.ts` owns the protocol and takes this list.
 */
import { z } from '@hono/zod-openapi';

import * as config from '@/config';
import { isEnabled } from '@/config/plugins';
import { cacheEntriesForVideo } from '@/plugins/synced-lyrics/translation/cache';
import { getAppMeta } from '@/providers/app-meta';
import { getSongControls } from '@/providers/song-controls';

import { callRenderer, callRendererWithTimeout, sendToRenderer } from './ipc';
import {
  AddToQueueSchema,
  BrowseRequestSchema,
  ConfigSchema,
  DownloadVideoSchema,
  FeatureFlagDeleteSchema,
  FeatureFlagOverridesSchema,
  LyricsTranslationRequestSchema,
  PlayVideoSchema,
  SearchSchema,
  SeekSchema,
  SetLikeStateSchema,
  SetMuteSchema,
  SetPlaybackSpeedSchema,
  SetQueueIndexSchema,
  SetRepeatSchema,
  SetShuffleSchema,
  SetVolumeSchema,
  type ResponseAutoplay,
  type ResponseBrowseRaw,
  type ResponseLyrics,
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

export type McpToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

export type McpTool = {
  name: string;
  description: string;
  input: z.ZodType;
  readOnly?: boolean;
  run: (args: Record<string, unknown>) => Promise<McpToolResult>;
};

const ok = (data?: unknown): McpToolResult => ({
  content: [
    {
      type: 'text',
      text:
        data === undefined
          ? 'Success'
          : typeof data === 'string'
            ? data
            : JSON.stringify(data),
    },
  ],
});

const fail = (message: string): McpToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});

/** No arguments; also the default input schema, so every tool has one. */
const NO_ARGS = z.object({});

const tool = <S extends z.ZodType = typeof NO_ARGS>(
  name: string,
  description: string,
  run: (args: z.infer<S>) => McpToolResult | Promise<McpToolResult>,
  { input, readOnly }: { input?: S; readOnly?: boolean } = {},
): McpTool => ({
  name,
  description,
  input: input ?? NO_ARGS,
  readOnly,
  run: async (args) => run(args as z.infer<S>),
});

const videoId = z.object({
  videoId: z
    .string()
    .optional()
    .describe('Another video instead of the current track'),
});

const raw = z
  .boolean()
  .optional()
  .describe('Include raw YouTube Music renderers');

const queueIndex = z.number().int().nonnegative().describe('Queue position');

/** Builds the tool list; `window` and `playerState` do the work. */
export const createMcpTools = (
  window: BrowserWindow,
  playerState: PlayerState,
): McpTool[] => {
  const controller = getSongControls(window);

  const send = (action: ApiAction, ...args: unknown[]) => {
    sendToRenderer(window, action, ...args);
  };

  const call = <T>(action: ApiAction, ...args: unknown[]) =>
    callRenderer<T>(window, action, ...args);

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

  return [
    // Video
    tool(
      'video',
      'Get the current track info.',
      async () => {
        const info = await call<ResponseSongInfo | undefined>(
          ApiActions.getVideo,
        );
        return info ? ok(info) : ok('No track is playing');
      },
      { readOnly: true },
    ),
    tool('next_video', 'Play the next track.', () => {
      send(ApiActions.nextVideo);
      return ok();
    }),
    tool('previous_video', 'Play the previous track.', () => {
      send(ApiActions.previousVideo);
      return ok();
    }),
    tool(
      'play_video',
      'Play this video now, replacing the queue.',
      ({ videoId: id }) => {
        controller.loadVideo(id);
        return ok();
      },
      { input: PlayVideoSchema },
    ),
    tool(
      'download_video',
      'Download a video, or the current track, with the downloader plugin.',
      async ({ videoId: requested }) => {
        if (!(await isEnabled('downloader'))) {
          return fail('The downloader plugin is disabled.');
        }

        const id = requested || playerState.song?.videoId;
        if (!id) {
          return fail('No video is playing and no videoId was given.');
        }

        send(ApiActions.downloadVideo, id);
        return ok();
      },
      { input: DownloadVideoSchema },
    ),
    tool(
      'search',
      'Search YouTube Music.',
      async (args) => {
        const response = await call<ResponseSearch>(
          ApiActions.search,
          args.query,
          args.params,
          args.continuation,
          args.raw ?? false,
        );
        return ok(response);
      },
      { input: SearchSchema },
    ),
    tool(
      'browse',
      'Browse a YouTube Music page by browse id or continuation token.',
      async (args) => {
        const response = await call<ResponseBrowseRaw | null>(
          ApiActions.browse,
          args.browseId,
          args.continuation,
          args.raw ?? false,
        );
        return response ? ok(response) : fail('The browse request failed.');
      },
      { input: BrowseRequestSchema, readOnly: true },
    ),
    tool(
      'lyrics',
      "Get the current track's lyrics from every provider.",
      async ({ videoId: requested }) => {
        if (!(await isEnabled('synced-lyrics'))) {
          return fail('The synced-lyrics plugin is disabled.');
        }

        const lyrics = await call<ResponseLyrics | null>(
          ApiActions.getLyrics,
          requested,
        );
        return lyrics ? ok(lyrics) : ok('No lyrics available');
      },
      { input: videoId, readOnly: true },
    ),
    tool(
      'lyrics_translations',
      "Get the cached translations of the current track's lyrics.",
      async ({ videoId: requested }) => {
        if (!(await isEnabled('synced-lyrics'))) {
          return fail('The synced-lyrics plugin is disabled.');
        }

        const id = requested || playerState.song?.videoId || null;
        const entries = id
          ? await cacheEntriesForVideo(id).catch(() => [])
          : [];

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
      { input: videoId, readOnly: true },
    ),
    tool(
      'translate_lyrics',
      'Translate the lyrics into a language and cache the result.',
      async ({ lang, videoId: requested }) => {
        if (!(await isEnabled('synced-lyrics'))) {
          return fail('The synced-lyrics plugin is disabled.');
        }

        const result =
          await callRendererWithTimeout<LanguageTranslationResult | null>(
            window,
            ApiActions.translateLyrics,
            TRANSLATION_TIMEOUT_MS,
            lang,
            requested,
          );

        if (!result) {
          return fail('The synced-lyrics plugin is disabled.');
        }

        if (result.reason) {
          return fail(
            result.error ??
              `Cannot translate the current lyrics: ${result.reason}`,
          );
        }

        return ok({
          videoId: requested ?? playerState.song?.videoId ?? null,
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
      { input: LyricsTranslationRequestSchema },
    ),

    // Playback
    tool(
      'playing',
      'Check whether playback is running.',
      async () => ok({ state: !!(await call(ApiActions.getPlaying)) }),
      { readOnly: true },
    ),
    tool('play', 'Start playback.', () => {
      send(ApiActions.play);
      return ok();
    }),
    tool('pause', 'Pause playback.', () => {
      send(ApiActions.pause);
      return ok();
    }),
    tool('toggle_play', 'Toggle between play and pause.', () => {
      send(ApiActions.togglePlay);
      return ok();
    }),
    tool(
      'playback_speed',
      'Get the playback speed.',
      async () => ok({ speed: await call(ApiActions.getPlaybackSpeed) }),
      { readOnly: true },
    ),
    tool(
      'set_playback_speed',
      'Set the playback speed, where 1 is normal.',
      ({ speed }) => {
        send(ApiActions.setPlaybackSpeed, speed);
        return ok();
      },
      { input: SetPlaybackSpeedSchema },
    ),
    tool(
      'playback_position',
      'Get the playback position in seconds, or a 0..1 fraction.',
      async ({ percentage }) =>
        ok({
          position: await call(ApiActions.getPlaybackPosition, percentage),
        }),
      {
        input: z.object({
          percentage: z
            .boolean()
            .optional()
            .describe('Return a 0..1 fraction instead of seconds'),
        }),
        readOnly: true,
      },
    ),
    tool(
      'seek_to',
      'Seek to a time in seconds.',
      ({ seconds }) => {
        send(ApiActions.seekTo, seconds);
        return ok();
      },
      { input: SeekSchema },
    ),
    tool(
      'seek_by',
      'Seek forward or backward by a number of seconds.',
      ({ seconds }) => {
        send(ApiActions.seekBy, seconds);
        return ok();
      },
      { input: SeekSchema },
    ),
    tool(
      'shuffle_state',
      'Check whether shuffle is on.',
      async () => ok({ state: !!(await call(ApiActions.getShuffle)) }),
      { readOnly: true },
    ),
    tool('shuffle', 'Shuffle the queue.', () => {
      send(ApiActions.shuffle);
      return ok();
    }),
    tool(
      'set_shuffle',
      'Turn shuffle on or off.',
      ({ enabled }) => {
        send(ApiActions.setShuffle, enabled);
        return ok();
      },
      { input: SetShuffleSchema },
    ),
    tool(
      'repeat_mode',
      'Get the repeat mode.',
      async () =>
        ok({ mode: (await call<RepeatMode>(ApiActions.getRepeat)) ?? null }),
      { readOnly: true },
    ),
    tool(
      'set_repeat',
      'Set the repeat mode.',
      ({ mode }) => {
        send(ApiActions.setRepeat, mode);
        return ok();
      },
      { input: SetRepeatSchema },
    ),
    tool('switch_repeat', 'Cycle to the next repeat mode.', () => {
      send(ApiActions.switchRepeat);
      return ok();
    }),

    // Volume
    tool(
      'volume',
      'Get the volume.',
      async () => ok({ volume: await call(ApiActions.getVolume) }),
      { readOnly: true },
    ),
    tool(
      'set_volume',
      'Set the volume, 0-100.',
      ({ volume }) => {
        send(ApiActions.setVolume, volume);
        return ok();
      },
      { input: SetVolumeSchema },
    ),
    tool(
      'mute_state',
      'Check whether the player is muted.',
      async () => ok({ muted: !!(await call(ApiActions.getMute)) }),
      { readOnly: true },
    ),
    tool(
      'set_mute',
      'Mute or unmute the player.',
      ({ muted }) => {
        send(ApiActions.setMute, muted);
        return ok();
      },
      { input: SetMuteSchema },
    ),
    tool('unmute', 'Unmute the player.', () => {
      send(ApiActions.setMute, false);
      return ok();
    }),
    tool('toggle_mute', 'Toggle mute.', () => {
      send(ApiActions.toggleMute);
      return ok();
    }),

    // Rating
    tool(
      'like_state',
      'Get the like state of the current track.',
      async () =>
        ok({ state: (await call<LikeType>(ApiActions.getLikeState)) ?? null }),
      { readOnly: true },
    ),
    tool(
      'set_like_state',
      'Set the like state of the current track.',
      ({ state }) => {
        send(ApiActions.setLikeState, state);
        return ok();
      },
      { input: SetLikeStateSchema },
    ),
    tool('like', 'Like the current track.', () => {
      send(ApiActions.like);
      return ok();
    }),
    tool('dislike', 'Dislike the current track.', () => {
      send(ApiActions.dislike);
      return ok();
    }),
    tool('unlike', 'Clear the like state of the current track.', () => {
      send(ApiActions.unlike);
      return ok();
    }),

    // Queue
    tool(
      'queue',
      'Get the queue.',
      async ({ raw: includeRaw }) => {
        const info = await call<ResponseQueue | undefined>(
          ApiActions.getQueue,
          includeRaw ?? false,
        );
        return info ? ok(info) : ok('No queue info');
      },
      { input: z.object({ raw }), readOnly: true },
    ),
    tool(
      'add_to_queue',
      'Add videos or playlists to the queue.',
      ({ videoIds, playlistIds, insertPosition }) => {
        send(
          ApiActions.addToQueue,
          videoIds ?? [],
          insertPosition ?? 'INSERT_AFTER_CURRENT_VIDEO',
          playlistIds ?? [],
        );
        return ok();
      },
      { input: AddToQueueSchema },
    ),
    tool(
      'move_in_queue',
      'Move a queue item to another position.',
      ({ index, toIndex }) => {
        send(ApiActions.moveInQueue, index, toIndex);
        return ok();
      },
      {
        input: z.object({
          index: queueIndex,
          toIndex: z.number().describe('Position to move the item to'),
        }),
      },
    ),
    tool(
      'remove_from_queue',
      'Remove a queue item.',
      ({ index }) => {
        send(ApiActions.removeFromQueue, index);
        return ok();
      },
      { input: z.object({ index: queueIndex }) },
    ),
    tool(
      'set_queue_index',
      'Jump to a queue position.',
      ({ index }) => {
        send(ApiActions.setQueueIndex, index);
        return ok();
      },
      { input: SetQueueIndexSchema },
    ),
    tool(
      'autoplay',
      'Get the autoplay entries.',
      async ({ raw: includeRaw, continuation }) => {
        const response = await call<ResponseAutoplay | null>(
          ApiActions.getAutoplay,
          includeRaw ?? false,
          continuation,
        );
        return response
          ? ok(response)
          : fail('The next autoplay page could not be fetched.');
      },
      {
        input: z.object({
          raw,
          continuation: z
            .string()
            .optional()
            .describe('Fetch the next page from this token'),
        }),
        readOnly: true,
      },
    ),
    tool('clear_queue', 'Clear the queue.', () => {
      send(ApiActions.clearQueue);
      return ok();
    }),

    // Config
    tool('config', 'Get the app config.', () => ok(config.getAll()), {
      readOnly: true,
    }),
    tool(
      'patch_config',
      'Deep-merge a partial config into the app config.',
      (patch) => {
        config.patch(patch);
        return ok();
      },
      { input: ConfigSchema },
    ),
    tool(
      'app_meta',
      'Get app version, platform and hardware info.',
      async () => ok(await getAppMeta()),
      { readOnly: true },
    ),
    tool(
      'feature_flags',
      "Get the page's feature flags and the user's overrides.",
      async () => {
        const saved = flagsOverride();
        const live = (await window.webContents
          .executeJavaScript('window.ytcfg?.data_?.EXPERIMENT_FLAGS ?? {}')
          .catch(() => ({}))) as Record<string, unknown>;
        const names = [
          ...new Set([...Object.keys(live), ...Object.keys(saved)]),
        ].sort();

        return ok({
          flags: names.map((name) => ({
            name,
            value: Object.hasOwn(saved, name) ? saved[name] : live[name],
            overridden: Object.hasOwn(saved, name),
          })),
        });
      },
      { readOnly: true },
    ),
    tool(
      'patch_feature_flags',
      'Set feature flag overrides.',
      async (patch) => {
        config.set('options.featureFlags', { ...flagsOverride(), ...patch });
        await Promise.all(
          Object.entries(patch).map(([name, value]) => applyFlag(name, value)),
        );
        return ok();
      },
      { input: FeatureFlagOverridesSchema },
    ),
    tool(
      'delete_feature_flags',
      'Remove feature flag overrides.',
      async ({ flags }) => {
        const saved = { ...flagsOverride() };
        // Only an applied override needs the page to put its own value back;
        // removing one it never had would drop the flag from the page's map.
        const hadOverride = flags.filter((name) => Object.hasOwn(saved, name));
        for (const name of flags) delete saved[name];
        config.set('options.featureFlags', saved);
        await Promise.all(hadOverride.map((name) => removeFlag(name)));
        return ok();
      },
      { input: FeatureFlagDeleteSchema },
    ),
  ];
};
