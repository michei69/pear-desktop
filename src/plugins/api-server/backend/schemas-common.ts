import { z } from '@hono/zod-openapi';

import { LikeType } from '@/types/datahost-get-state';

// Schemas both API versions declare identically, so the two can't drift apart.

export const SetQueueIndexSchema = z.object({
  index: z.number().int().nonnegative(),
});

export const QueueIndexParamSchema = z.object({
  index: z.coerce.number().int().nonnegative(),
});

export const LikeStateSchema = z.object({
  state: z.enum(LikeType).nullable(),
});

export const ShuffleStateSchema = z.object({
  state: z.boolean(),
});
