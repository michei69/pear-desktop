// YTM's playback queue, as its own element exposes it. Plugins that skip,
// filter or inspect queue entries share these instead of each reaching into
// the private store shape.

import { selectors } from "./selectors.ts";

export interface QueueItem {
  playlistPanelVideoRenderer?: { selected?: boolean; videoId?: string; [key: string]: unknown };
  playlistPanelVideoWrapperRenderer?: {
    primaryRenderer?: { playlistPanelVideoRenderer?: { selected?: boolean; videoId?: string } };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface QueueStoreState {
  queue: { items: QueueItem[]; queueContextParams: unknown; nextQueueItemId: unknown };
}

export type QueueAction = { type: string; payload?: unknown };

export interface QueueElement extends HTMLElement {
  dispatch(action: QueueAction): void;
  queue?: {
    getItems(): QueueItem[];
    autoPlaying?: boolean;
    continuation?: string;
    store: { store: { dispatch(action: QueueAction): void; getState(): QueueStoreState } };
  };
}

/** The queue element, when YTM has rendered one. */
export function playerQueue(): QueueElement | null {
  return document.querySelector<QueueElement>(selectors.queue);
}

/** The queue's redux store, when it exists. */
export function queueStore(): QueueElement["queue"] | undefined {
  return playerQueue()?.queue;
}

export function queueItems(): QueueItem[] {
  return queueStore()?.getItems() ?? [];
}

/** The renderer of a queue item (wrappers only wrap it). */
export function queueRenderer(item: QueueItem | undefined) {
  return item?.playlistPanelVideoRenderer ?? item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
}

/** Index of the playing item; -1 when nothing is selected yet. */
export function queueSelectedIndex(items: QueueItem[] = queueItems()): number {
  return items.findIndex((item) => queueRenderer(item)?.selected);
}

export function queueDispatch(action: QueueAction) {
  playerQueue()?.dispatch(action);
}
