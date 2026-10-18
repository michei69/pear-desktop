/**
 * The MCP tools: one per operation, with their own names, descriptions and
 * schemas. They call the same operations the HTTP routes call, so the two
 * surfaces can differ in shape (an endpoint MCP doesn't expose, a tool without
 * a route) without copying the work; each tool only maps the outcome to text.
 *
 * Type-only operations import: the module is testable with a fake `Operations`.
 */
import { z } from '@hono/zod-openapi';

import {
  AddToQueueSchema,
  BrowseRequestSchema,
  ConfigSchema,
  DownloadVideoSchema,
  FeatureFlagDeleteSchema,
  FeatureFlagOverridesSchema,
  LyricsQuerySchema,
  LyricsTranslationRequestSchema,
  MoveInQueueSchema,
  PlayVideoSchema,
  QueueIndexParamSchema,
  SearchSchema,
  SeekSchema,
  SetLikeStateSchema,
  SetMuteSchema,
  SetPlaybackSpeedSchema,
  SetQueueIndexSchema,
  SetRepeatSchema,
  SetShuffleSchema,
  SetVolumeSchema,
} from './schemas-v2';

import type { Operations, Outcome } from './operations';

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

/** A tool's answer from an operation: its value, or its error text. */
const fromOutcome = <T>(result: Outcome<T>, empty: string): McpToolResult => {
  if (!result.ok) {
    return fail(result.error);
  }

  return ok(result.value === undefined ? empty : result.value);
};

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

const raw = z
  .boolean()
  .optional()
  .describe("Include each item's raw YouTube Music renderer");

const percentage = z
  .boolean()
  .optional()
  .describe('Report a 0..1 fraction of the song instead of seconds');

const continuation = z
  .string()
  .optional()
  .describe('Fetch the next page from this token');

const queueIndex = z.object({ index: QueueIndexParamSchema.shape.index });
const moveInQueue = z.object({
  index: QueueIndexParamSchema.shape.index,
  toIndex: MoveInQueueSchema.shape.toIndex,
});

/** Builds the tool list from the operations both surfaces share. */
export const createMcpTools = (operations: Operations): McpTool[] => [
  // Video
  tool(
    'video',
    'Get the current track info.',
    async () => fromOutcome(await operations.video(), 'No track is playing'),
    { readOnly: true },
  ),
  tool('next_video', 'Play the next track.', () => {
    operations.nextVideo();
    return ok();
  }),
  tool('previous_video', 'Play the previous track.', () => {
    operations.previousVideo();
    return ok();
  }),
  tool(
    'play_video',
    'Play this video now, replacing the queue.',
    ({ videoId }) => {
      operations.playVideo(videoId);
      return ok();
    },
    { input: PlayVideoSchema },
  ),
  tool(
    'download_video',
    'Download a video, or the current track, with the downloader plugin.',
    async ({ videoId }) =>
      fromOutcome(await operations.downloadVideo(videoId), 'Success'),
    { input: DownloadVideoSchema },
  ),
  tool(
    'search',
    'Search YouTube Music.',
    async (args) => fromOutcome(await operations.search(args), 'No results'),
    { input: SearchSchema },
  ),
  tool(
    'browse',
    'Browse a YouTube Music page by browse id or continuation token.',
    async (args) => fromOutcome(await operations.browse(args), 'No results'),
    { input: BrowseRequestSchema, readOnly: true },
  ),
  tool(
    'lyrics',
    "Get the current track's lyrics from every provider.",
    async ({ videoId }) =>
      fromOutcome(await operations.lyrics(videoId), 'No lyrics available'),
    { input: LyricsQuerySchema, readOnly: true },
  ),
  tool(
    'lyrics_translations',
    "Get the cached translations of the current track's lyrics.",
    async ({ videoId }) =>
      fromOutcome(await operations.lyricsTranslations(videoId), 'No entries'),
    { input: LyricsQuerySchema, readOnly: true },
  ),
  tool(
    'translate_lyrics',
    'Translate the lyrics into a language and cache the result.',
    async ({ lang, videoId }) =>
      fromOutcome(await operations.translateLyrics(lang, videoId), 'No lines'),
    { input: LyricsTranslationRequestSchema },
  ),

  // Playback
  tool(
    'playing',
    'Check whether playback is running.',
    () => ok({ state: operations.playing() }),
    { readOnly: true },
  ),
  tool('play', 'Start playback.', () => {
    operations.play();
    return ok();
  }),
  tool('pause', 'Pause playback.', () => {
    operations.pause();
    return ok();
  }),
  tool('toggle_play', 'Toggle between play and pause.', () => {
    operations.togglePlay();
    return ok();
  }),
  tool(
    'playback_speed',
    'Get the playback speed.',
    () => ok({ speed: operations.playbackSpeed() }),
    { readOnly: true },
  ),
  tool(
    'set_playback_speed',
    'Set the playback speed, where 1 is normal.',
    ({ speed }) => {
      operations.setPlaybackSpeed(speed);
      return ok();
    },
    { input: SetPlaybackSpeedSchema },
  ),
  tool(
    'playback_position',
    'Get the playback position in seconds, or a 0..1 fraction.',
    async ({ percentage: fraction }) =>
      fromOutcome(
        await operations.playbackPosition(fraction ?? false),
        'No position',
      ),
    { input: z.object({ percentage }), readOnly: true },
  ),
  tool(
    'seek_to',
    'Seek to a time in seconds.',
    ({ seconds }) => {
      operations.seekTo(seconds);
      return ok();
    },
    { input: SeekSchema },
  ),
  tool(
    'seek_by',
    'Seek forward or backward by a number of seconds.',
    ({ seconds }) => {
      operations.seekBy(seconds);
      return ok();
    },
    { input: SeekSchema },
  ),
  tool(
    'shuffle_state',
    'Check whether shuffle is on.',
    () => ok({ state: operations.shuffleState() }),
    { readOnly: true },
  ),
  tool('shuffle', 'Shuffle the queue.', () => {
    operations.shuffleQueue();
    return ok();
  }),
  tool(
    'set_shuffle',
    'Turn shuffle on or off.',
    ({ enabled }) => {
      operations.setShuffle(enabled);
      return ok();
    },
    { input: SetShuffleSchema },
  ),
  tool(
    'repeat_mode',
    'Get the repeat mode.',
    () => ok({ mode: operations.repeatMode() }),
    { readOnly: true },
  ),
  tool(
    'set_repeat',
    'Set the repeat mode.',
    ({ mode }) => {
      operations.setRepeat(mode);
      return ok();
    },
    { input: SetRepeatSchema },
  ),
  tool('switch_repeat', 'Cycle to the next repeat mode.', () => {
    operations.switchRepeat();
    return ok();
  }),

  // Volume
  tool('volume', 'Get the volume.', () => ok({ volume: operations.volume() }), {
    readOnly: true,
  }),
  tool(
    'set_volume',
    'Set the volume, 0-100.',
    ({ volume }) => {
      operations.setVolume(volume);
      return ok();
    },
    { input: SetVolumeSchema },
  ),
  tool(
    'mute_state',
    'Check whether the player is muted.',
    () => ok({ muted: operations.muteState() }),
    { readOnly: true },
  ),
  tool(
    'set_mute',
    'Mute or unmute the player.',
    ({ muted }) => {
      operations.setMute(muted);
      return ok();
    },
    { input: SetMuteSchema },
  ),
  tool('unmute', 'Unmute the player.', () => {
    operations.setMute(false);
    return ok();
  }),
  tool('toggle_mute', 'Toggle mute.', () => {
    operations.toggleMute();
    return ok();
  }),

  // Rating
  tool(
    'like_state',
    'Get the like state of the current track.',
    () => ok({ state: operations.likeState() }),
    { readOnly: true },
  ),
  tool(
    'set_like_state',
    'Set the like state of the current track.',
    ({ state }) => {
      operations.setLikeState(state);
      return ok();
    },
    { input: SetLikeStateSchema },
  ),
  tool('like', 'Like the current track.', () => {
    operations.like();
    return ok();
  }),
  tool('dislike', 'Dislike the current track.', () => {
    operations.dislike();
    return ok();
  }),
  tool('unlike', 'Clear the like state of the current track.', () => {
    operations.unlike();
    return ok();
  }),

  // Queue
  tool(
    'queue',
    'Get the queue.',
    async ({ raw: includeRaw }) =>
      fromOutcome(await operations.queue(includeRaw ?? false), 'No queue info'),
    { input: z.object({ raw }), readOnly: true },
  ),
  tool(
    'add_to_queue',
    'Add videos or playlists to the queue.',
    ({ videoIds, playlistIds, insertPosition }) => {
      operations.addToQueue(
        videoIds ?? [],
        playlistIds ?? [],
        insertPosition ?? 'INSERT_AFTER_CURRENT_VIDEO',
      );
      return ok();
    },
    { input: AddToQueueSchema },
  ),
  tool(
    'move_in_queue',
    'Move a queue item to another position.',
    ({ index, toIndex }) => {
      operations.moveInQueue(index, toIndex);
      return ok();
    },
    { input: moveInQueue },
  ),
  tool(
    'remove_from_queue',
    'Remove a queue item.',
    ({ index }) => {
      operations.removeFromQueue(index);
      return ok();
    },
    { input: queueIndex },
  ),
  tool(
    'set_queue_index',
    'Jump to a queue position.',
    ({ index }) => {
      operations.setQueueIndex(index);
      return ok();
    },
    { input: SetQueueIndexSchema },
  ),
  tool(
    'autoplay',
    'Get the autoplay entries.',
    async ({ raw: includeRaw, continuation: token }) =>
      fromOutcome(
        await operations.autoplay(includeRaw ?? false, token),
        'No autoplay entries',
      ),
    { input: z.object({ raw, continuation }), readOnly: true },
  ),
  tool('clear_queue', 'Clear the queue.', () => {
    operations.clearQueue();
    return ok();
  }),

  // Config
  tool('config', 'Get the app config.', () => ok(operations.getConfig()), {
    readOnly: true,
  }),
  tool(
    'patch_config',
    'Deep-merge a partial config into the app config.',
    (patch) => {
      operations.patchConfig(patch);
      return ok();
    },
    { input: ConfigSchema },
  ),
  tool(
    'app_meta',
    'Get app version, platform and hardware info.',
    async () => ok(await operations.appMeta()),
    { readOnly: true },
  ),
  tool(
    'feature_flags',
    'Get the feature flags this app sets.',
    async () => ok({ flags: await operations.featureFlags() }),
    { readOnly: true },
  ),
  tool(
    'patch_feature_flags',
    'Set feature flag overrides.',
    async (patch) => {
      await operations.patchFeatureFlags(patch);
      return ok();
    },
    { input: FeatureFlagOverridesSchema },
  ),
  tool(
    'delete_feature_flags',
    'Remove feature flag overrides.',
    async ({ flags }) => {
      await operations.deleteFeatureFlags(flags);
      return ok();
    },
    { input: FeatureFlagDeleteSchema },
  ),
];
