import { z } from '@hono/zod-openapi';

import { MediaType } from '@/providers/song-info';

export {
  LikeStateSchema,
  QueueIndexParamSchema,
  SetQueueIndexSchema,
  ShuffleStateSchema,
} from './schemas-common';

/** Payload of the tokens issued by `POST /auth/{id}`. */
export const JWTPayloadSchema = z.object({
  id: z.string(),
  iat: z.number(),
});
export type JWTPayload = z.infer<typeof JWTPayloadSchema>;

// Request bodies
export const SeekSchema = z.object({
  seconds: z.number(),
});

export const GoBackSchema = z.object({
  seconds: z.number(),
});

export const GoForwardSchema = z.object({
  seconds: z.number(),
});

export const SwitchRepeatSchema = z.object({
  iteration: z.number(),
});

export const SetVolumeSchema = z.object({
  volume: z.number(),
});

export const SetFullscreenSchema = z.object({
  state: z.boolean(),
});

export const SearchSchema = z.object({
  query: z.string(),
  params: z.string().optional(),
  continuation: z.string().optional(),
});

export const AddSongToQueueSchema = z.object({
  videoId: z.string(),
  insertPosition: z
    .enum(['INSERT_AT_END', 'INSERT_AFTER_CURRENT_VIDEO'])
    .optional()
    .default('INSERT_AT_END'),
});

export const MoveSongInQueueSchema = z.object({
  toIndex: z.number(),
});

export const LoadVideoSchema = z.object({
  videoId: z.string().optional().describe('Video ID'),
});

export const LoadPlaylistSchema = z.object({
  playlistId: z.string().describe('Playlist ID'),
});

// Responses
export const SongInfoSchema = z.object({
  title: z.string(),
  artist: z.string(),
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
  mediaType: z.enum(MediaType),
});
export type ResponseSongInfo = z.infer<typeof SongInfoSchema>;

export const RepeatModeSchema = z.object({
  mode: z.enum(['ONE', 'NONE', 'ALL']).nullable(),
});

export const VolumeStateSchema = z.object({
  state: z.number(),
  isMuted: z.boolean(),
});

export const FullscreenStateSchema = z.object({
  state: z.boolean(),
});

export const AccessTokenSchema = z.object({
  accessToken: z.string(),
});

/**
 * Queue as produced by the renderer. The individual entries are the raw
 * YouTube Music renderers, which are far too large to mirror here.
 */
export const QueueSchema = z.object({
  items: z.array(z.unknown()).optional(),
  autoPlaying: z.boolean().optional(),
  continuation: z.string().optional(),
});

/** Subset of a queue entry returned by `GET /queue/next`. */
export const NextSongSchema = z.object({
  title: z.string().optional(),
  videoId: z.string(),
  thumbnail: z.unknown(),
  lengthText: z.unknown(),
  shortBylineText: z.unknown(),
});

/** `POST /search` proxies the renderer's raw search response. */
export const SearchResultSchema = z.record(z.string(), z.unknown());
