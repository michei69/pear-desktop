import { z } from '@hono/zod-openapi';

import { MediaType } from '@/providers/song-info-data';
import { LikeType } from '@/types/datahost-get-state';

// Schemas both API versions declare identically, so the two can't drift apart.

/** Repeat modes the renderer understands, in the order it cycles them. */
export const RepeatModes = ['NONE', 'ALL', 'ONE'] as const;

export const RepeatModeEnum = z.enum(RepeatModes);

export const RepeatModeSchema = z.object({
  mode: RepeatModeEnum.nullable(),
});

export const SeekSchema = z.object({
  seconds: z.number().describe('Time in the song, in seconds'),
});

export const SetVolumeSchema = z.object({
  volume: z.number().describe('Volume, 0-100'),
});

/** A boolean a GET route takes in the query string, where it reads `true`/`false`. */
export const QueryFlagSchema = z.enum(['true', 'false']);

/** `?videoId=`: answer for another song instead of the current one. */
export const VideoIdQuerySchema = z.object({
  videoId: z
    .string()
    .optional()
    .describe('Answer for this video instead of the current song'),
});

/** Body of every non-2xx JSON response, so clients can parse failures too. */
export const ErrorSchema = z.object({
  error: z.string().describe('What went wrong'),
});

/** The unified song info, as the renderer builds it, before v2 adds to it. */
export const SongInfoBaseSchema = z.object({
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

export const SetQueueIndexSchema = z.object({
  index: z.number().int().nonnegative(),
});

export const QueueIndexParamSchema = z.object({
  index: z.coerce.number().int().nonnegative(),
});

export const LikeStateSchema = z.object({
  state: z.enum(LikeType).nullable(),
});

export const SetLikeStateSchema = z.object({
  state: z.enum(LikeType),
});

export const ShuffleStateSchema = z.object({
  state: z.boolean(),
});
