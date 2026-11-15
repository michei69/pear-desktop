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
  queue: { items: QueueItem[]; queueContextParams: unknown; nextQueueItemId: unknown; shuffleEnabled?: boolean };
}

export type QueueAction = { type: string; payload?: unknown };

export interface QueueElement extends HTMLElement {
  dispatch(action: QueueAction): void;
  queue?: {
    getItems(): QueueItem[];
    autoPlaying?: boolean;
    continuation?: string;
    store: {
      store: {
        dispatch(action: QueueAction): void;
        getState(): QueueStoreState;
        subscribe?(listener: () => void): () => void;
      };
    };
    /** YTM's own shuffle action; the queue fills asynchronously, so it may reject while empty. */
    shuffle?(): Promise<unknown>;
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

export interface AppQueueState {
  items?: QueueItem[];
  automixItems?: QueueItem[];
  selectedItemIndex?: number;
  nextQueueItemId?: unknown;
  playbackContentMode?: string;
  repeatMode?: string;
  shuffleEnabled?: boolean;
  autoplay?: boolean;
  isInfinite?: boolean;
}

/** The app element, where YTM's own queue slice lives (the app reads it here too). */
interface AppQueueElement extends HTMLElement {
  getState?(): { queue?: AppQueueState } | undefined;
  ytmusicReduxBehavior?: {
    store: { store: { getState(): { queue?: AppQueueState }; subscribe?(listener: () => void): unknown } };
  };
}

const appQueue = () => document.querySelector<AppQueueElement>(selectors.app);

/** YTM's queue store on the app element, which outlives the queue element's re-renders. */
export function appQueueStore() {
  return appQueue()?.ytmusicReduxBehavior?.store?.store;
}

/**
 * Whether the queue is shuffled. Read where YTM keeps it: the app element's own
 * state, then its redux slice, then the player bar's `shuffle-on` attribute (the
 * fallback the app's player already uses when the field is missing).
 */
export function queueShuffleEnabled(): boolean {
  const queue = appQueue()?.getState?.()?.queue ?? appQueueStore()?.getState().queue;
  if (typeof queue?.shuffleEnabled === "boolean") return queue.shuffleEnabled;
  return document.querySelector(selectors.player_bar)?.hasAttribute("shuffle-on") ?? false;
}

/** Shuffles the queue through YTM's own button, which works without a queue element. */
export function queueShuffle(): boolean {
  const button = document.querySelector<HTMLElement>("#shuffle-button, [aria-label='Shuffle']");
  if (!button) return false;
  button.click();
  return true;
}

/**
 * Calls `listener` on every queue change; returns the unsubscribe. The app
 * element can take a moment to exist, so a listener registered early waits for
 * it (up to `timeoutMs`) instead of silently never firing.
 */
export function onQueueChange(listener: () => void, timeoutMs = 10_000): () => void {
  let unsubscribe: (() => void) | undefined;
  let cancelled = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + timeoutMs;

  const attach = () => {
    if (cancelled || unsubscribe) return;
    const store = appQueueStore();
    const result = store?.subscribe?.(listener);
    if (typeof result === "function") {
      unsubscribe = result as () => void;
      return;
    }
    if (Date.now() >= deadline) return;
    retry = setTimeout(attach, 250);
  };

  attach();
  return () => {
    cancelled = true;
    if (retry !== undefined) clearTimeout(retry);
    unsubscribe?.();
  };
}

export interface NextQueueData {
  queueContextParams?: unknown;
  playerOverlays?: unknown;
  contents?: {
    singleColumnMusicWatchNextResultsRenderer?: {
      tabbedRenderer?: { watchNextTabbedResultsRenderer?: { tabs?: unknown[] } };
    };
  };
}

export interface NextQueueItem {
  playlistPanelVideoRenderer?: unknown;
  [key: string]: unknown;
}

export function nextQueueItems(data: NextQueueData): NextQueueItem[] {
  const tabs = data.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
  const tab = (
    tabs as
      | { tabRenderer?: { content?: { musicQueueRenderer?: { content?: { playlistPanelRenderer?: { contents?: unknown } } } } } }[]
      | undefined
  )?.[0];
  const contents = tab?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents;
  return Array.isArray(contents) ? (contents as NextQueueItem[]) : [];
}

export function hydrateQueue(queue: QueueElement, data: NextQueueData, items: readonly unknown[]): void {
  queue.dispatch({ type: "CLEAR" });
  queue.dispatch({ type: "SET_QUEUE_CONTEXT_PARAMS", payload: data.queueContextParams });
  queue.dispatch({ type: "SET_PLAYER_PAGE_WATCH_NEXT_RESPONSE", payload: data });
  queue.dispatch({ type: "SET_PLAYER_OVERLAY", payload: data.playerOverlays });
  queue.dispatch({
    type: "SET_PLAYER_PAGE_TABS",
    payload: data.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs,
  });
  queue.dispatch({ type: "SET_PLAYER_PAGE_TABS_CONTENT", payload: {} });
  queue.dispatch({ type: "ADD_ITEMS", payload: { index: 0, items, nextQueueItemId: 0, shouldAssignIds: true } });
}
