import { createSignal } from 'solid-js';
import * as z from 'zod';

export const CustomQuerySchema = z.object({
  query: z.string().trim().min(1),
  artist: z.string().trim().optional(),
});

export type CustomQuery = z.infer<typeof CustomQuerySchema>;

const STORAGE_PREFIX = 'ytmd-sl-custom-';

const storageKey = (videoId: string) => `${STORAGE_PREFIX}${videoId}`;

export const getCustomQuery = (videoId: string): CustomQuery | null => {
  try {
    const raw = localStorage.getItem(storageKey(videoId));
    if (!raw) return null;
    const parsed = CustomQuerySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const saveCustomQuery = (videoId: string, query: CustomQuery): void => {
  localStorage.setItem(storageKey(videoId), JSON.stringify(query));
};

export const removeCustomQuery = (videoId: string): void => {
  localStorage.removeItem(storageKey(videoId));
};

/** Reactive signal tracking the current video's custom query. */
export const [customQuery, setCustomQuerySignal] =
  createSignal<CustomQuery | null>(null);

/** Load the custom query for a videoId into the reactive signal. */
export const loadCustomQueryForVideo = (videoId: string | null) => {
  if (!videoId) {
    setCustomQuerySignal(null);
  } else {
    setCustomQuerySignal(getCustomQuery(videoId));
  }
};
