import type { VideoData } from '../types';
import type {
  ItemPlaylistPanelVideoRenderer,
  PlaylistPanelVideoWrapperRenderer,
  QueueItem,
} from '@/types/datahost-get-state';

/**
 * Whether two owner lists describe the same tracks in the same order. Only the
 * video ids matter here: a repeated `SYNC_QUEUE` that just refreshes owner ids
 * must not trigger another `/music/get_queue` fetch.
 */
export const hasSameVideoIds = (a: VideoData[], b: VideoData[]) =>
  a.length === b.length &&
  a.every((item, index) => item.videoId === b[index]?.videoId);

export const mapQueueItem = <T>(
  map: (item?: ItemPlaylistPanelVideoRenderer) => T,
  array: QueueItem[],
): T[] =>
  array
    .map((item) => {
      // The redux queue is runtime data, so a slot can be empty even though
      // the type says otherwise.
      if (!item) return undefined;
      if ('playlistPanelVideoWrapperRenderer' in item) {
        const primary = item.playlistPanelVideoWrapperRenderer?.primaryRenderer;
        if (!primary) return undefined;
        const keys = Object.keys(
          primary,
        ) as (keyof PlaylistPanelVideoWrapperRenderer['primaryRenderer'])[];
        return primary[keys[0]];
      }
      if ('playlistPanelVideoRenderer' in item) {
        return item.playlistPanelVideoRenderer;
      }

      console.error('Music Together: Unknown item', item);
      return undefined;
    })
    .map(map);

export type QueueEntry = {
  videoId?: string;
  selected: boolean;
};

/** The rendered queue flattened to the fields the plugin mirrors. */
export const queueEntries = (items: QueueItem[]): (QueueEntry | undefined)[] =>
  mapQueueItem(
    (item) => item && { videoId: item.videoId, selected: !!item.selected },
    items,
  );

/** Video ids of the rendered queue, in order (empty for unknown rows). */
export const queueVideoIds = (items: QueueItem[]) =>
  queueEntries(items).map((entry) => entry?.videoId);

/** Index of the row YouTube Music marks as playing, or -1. */
export const selectedQueueIndex = (items: QueueItem[]) =>
  queueEntries(items).findIndex((entry) => entry?.selected);

/** Index of `videoId` in the rendered queue, or -1. */
export const indexOfQueueVideoId = (items: QueueItem[], videoId: string) =>
  queueEntries(items).findIndex((entry) => entry?.videoId === videoId);

/**
 * Inserts the added rows into the owner mirror. The position is clamped to the
 * list so a stale index from a peer (or an out-of-range play-next) cannot drop
 * tracks or grow the list past the queue.
 */
export const insertVideoData = (
  list: VideoData[],
  videos: VideoData[],
  index?: number,
): VideoData[] => {
  const at = Number.isFinite(index)
    ? Math.min(Math.max(Math.trunc(index as number), 0), list.length)
    : list.length;

  return [...list.slice(0, at), ...videos, ...list.slice(at)];
};

/** Removes one row from the owner mirror; an invalid index is a no-op. */
export const removeVideoData = (list: VideoData[], index: number) => {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    return list;
  }

  return [...list.slice(0, index), ...list.slice(index + 1)];
};

/**
 * Moves one row in the owner mirror, matching the queue store's `MOVE_ITEM`
 * semantics (remove first, then insert at the target position).
 */
export const moveVideoData = (
  list: VideoData[],
  fromIndex: number,
  toIndex: number,
) => {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex > list.length
  ) {
    return list;
  }

  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return list;

  next.splice(Math.min(toIndex, next.length), 0, moved);
  return next;
};

/**
 * Rebuilds the owner mirror after the queue was replaced wholesale (a full
 * `/music/get_queue` resync, or an autoplay append). Owners are carried over
 * from the previous list: same position first, then the same video id (the
 * queue can reorder), and only then the fallback owner.
 */
export const reconcileVideoData = (
  previous: VideoData[],
  items: QueueItem[],
  fallbackOwnerId: string,
): VideoData[] => {
  // Tracks which *previous* rows have been matched; new rows are visited once
  // each, so they need no bookkeeping of their own.
  const matched = new Set<number>();

  return queueEntries(items).map((entry, index) => {
    const videoId = entry?.videoId ?? '';
    const samePosition = previous[index];
    if (
      samePosition &&
      !matched.has(index) &&
      (samePosition.videoId === videoId || !videoId)
    ) {
      matched.add(index);
      return { videoId, ownerId: samePosition.ownerId };
    }

    const match = previous.findIndex(
      (candidate, candidateIndex) =>
        !matched.has(candidateIndex) && candidate.videoId === videoId,
    );
    if (match >= 0) {
      matched.add(match);
      return { videoId, ownerId: previous[match].ownerId };
    }

    return { videoId, ownerId: fallbackOwnerId };
  });
};
