import { z } from '@hono/zod-openapi';

import { SongInfoBaseSchema } from './schemas-common';

export {
  LikeStateSchema,
  QueueIndexParamSchema,
  RepeatModeSchema,
  SeekSchema,
  SetQueueIndexSchema,
  SetVolumeSchema,
  ShuffleStateSchema,
  SongInfoBaseSchema,
} from './schemas-common';

export const SongInfoSchema = SongInfoBaseSchema;

/** Payload of the tokens issued by `POST /auth/{id}`. */
export const JWTPayloadSchema = z.object({
  id: z.string(),
  iat: z.number(),
});
export type JWTPayload = z.infer<typeof JWTPayloadSchema>;

// Request bodies
export const SwitchRepeatSchema = z.object({
  iteration: z.number(),
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
export type ResponseSongInfo = z.infer<typeof SongInfoSchema>;

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
