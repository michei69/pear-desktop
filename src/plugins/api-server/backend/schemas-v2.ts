import { z } from '@hono/zod-openapi';

import { MediaType } from '@/providers/song-info-data';
import { LikeType } from '@/types/datahost-get-state';

/** Repeat modes the renderer understands, in the order it cycles them. */
const RepeatModes = ['NONE', 'ALL', 'ONE'] as const;

// Request bodies
export const SeekSchema = z.object({
  seconds: z.number().describe('Time in the song, in seconds'),
});

export const SetPlaybackSpeedSchema = z.object({
  speed: z.number().describe('Playback speed, where 1 is normal'),
});

export const SetShuffleSchema = z.object({
  enabled: z.boolean(),
});

export const SetRepeatSchema = z.object({
  mode: z.enum(RepeatModes),
});

export const SetVolumeSchema = z.object({
  volume: z.number().describe('Volume, 0-100'),
});

export const SetMuteSchema = z.object({
  muted: z.boolean(),
});

export const SetLikeStateSchema = z.object({
  state: z.enum(LikeType),
});

export const AddToQueueSchema = z.object({
  videoIds: z.array(z.string()).describe('Video IDs to add to the queue'),
  insertPosition: z
    .enum(['INSERT_AFTER_CURRENT_VIDEO', 'INSERT_AT_END'])
    .optional()
    .describe('Defaults to INSERT_AFTER_CURRENT_VIDEO'),
});

export const MoveInQueueSchema = z.object({
  toIndex: z.number().describe('Index to move the song to'),
});

export const SetQueueIndexSchema = z.object({
  index: z.number().int().nonnegative(),
});

export const SearchSchema = z.object({
  query: z.string(),
  params: z.string().optional(),
  continuation: z.string().optional(),
});

// Request params
export const QueueIndexParamSchema = z.object({
  index: z.coerce.number().int().nonnegative(),
});

// Query strings
export const SearchQuerySchema = z.object({
  query: z.string(),
  params: z.string().optional(),
  continuation: z.string().optional(),
});

export const PlaybackPositionQuerySchema = z.object({
  percentage: z
    .enum(['true', 'false'])
    .optional()
    .describe('Report a 0..1 fraction of the song instead of seconds'),
});

// Responses
/** The unified song info, as built by the renderer from the player response. */
export const SongInfoSchema = z.object({
  title: z.string(),
  alternativeTitle: z.string().optional(),
  artist: z.string(),
  artistUrl: z.string().optional(),
  views: z.number(),
  uploadDate: z.string().optional(),
  imageSrc: z.string().nullable().optional(),
  isPaused: z.boolean().optional(),
  songDuration: z.number(),
  elapsedSeconds: z.number().optional(),
  url: z.string().optional(),
  album: z.string().nullable().optional(),
  videoId: z.string(),
  playlistId: z.string().optional(),
  mediaType: z.enum([
    MediaType.Audio,
    MediaType.OriginalMusicVideo,
    MediaType.UserGeneratedContent,
    MediaType.PodcastEpisode,
    MediaType.OtherVideo,
  ]),
  tags: z.array(z.string()).optional(),
  scrobbleTitle: z.string(),
  scrobbleArtist: z.string(),
});
export type ResponseSongInfo = z.infer<typeof SongInfoSchema>;

export const PlayingStateSchema = z.object({
  state: z.boolean(),
});

export const PlaybackSpeedSchema = z.object({
  speed: z.number(),
});

export const PlaybackPositionSchema = z.object({
  position: z.number(),
});

export const ShuffleStateSchema = z.object({
  state: z.boolean(),
});

export const RepeatModeSchema = z.object({
  mode: z.enum(RepeatModes).nullable(),
});

export const VolumeSchema = z.object({
  volume: z.number(),
});

export const MuteStateSchema = z.object({
  muted: z.boolean(),
});

export const LikeStateSchema = z.object({
  state: z.enum(LikeType).nullable(),
});

/**
 * Queue as produced by the renderer. The individual entries are the raw
 * YouTube Music renderers, which are far too large to mirror here.
 */
export const QueueSchema = z.object({
  autoplay: z.boolean().optional(),
  isInfinite: z.boolean().optional(),
  items: z.array(z.unknown()).optional(),
  nextQueueItemId: z.string().optional(),
  playbackContentMode: z.string().optional(),
  repeatMode: z.enum(RepeatModes).optional(),
  currentPlayingItemId: z.number().optional(),
  shuffleEnabled: z.boolean().optional(),
  continuation: z.string().optional(),
});
export type ResponseQueue = z.infer<typeof QueueSchema>;

/** `GET|POST /video/search` proxies the renderer's raw search response. */
export const SearchResultSchema = z.record(z.string(), z.unknown());
