// A fake YTM queue store and element for the queue and session tests: the
// reducer follows \u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063's semantics for the actions the plugin sends.

import type { QueueElement, QueueItem, StoreEvent } from "../queue.ts";

export const video = (videoId: string, selected = false): QueueItem => ({ playlistPanelVideoRenderer: { videoId, selected } });

export const wrapper = (videoId: string, selected = false): QueueItem => ({
  playlistPanelVideoWrapperRenderer: { primaryRenderer: { playlistPanelVideoRenderer: { videoId, selected } } },
});

export const videoIdOf = (item: QueueItem | undefined) => {
  if (!item) return undefined;
  if ("playlistPanelVideoRenderer" in item) return item.playlistPanelVideoRenderer.videoId;
  return item.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer?.videoId;
};

type Payload = { items?: QueueItem[]; index?: number; fromIndex?: number; toIndex?: number } | undefined;

/** YTM's queue store, reduced to the rows the plugin mirrors. */
export function fakeQueue(initial: readonly (string | QueueItem)[] = [], selectedIndex = -1) {
  let items = initial.map((entry, index) => (typeof entry === "string" ? video(entry, index === selectedIndex) : entry));
  const applied: StoreEvent[] = [];
  let onReduce: ((event: StoreEvent) => void) | undefined;

  const reduce = (event: StoreEvent) => {
    const payload = event.payload as Payload | number;
    switch (event.type) {
      case "ADD_ITEMS": {
        if (typeof payload !== "object" || !payload?.items) return;
        // The queue store inserts before `index`, and at the end without one.
        const at = typeof payload.index === "number" ? Math.min(Math.max(payload.index, 0), items.length) : items.length;
        items = [...items.slice(0, at), ...payload.items, ...items.slice(at)];
        return;
      }
      case "UPDATE_ITEMS": {
        if (typeof payload !== "object" || !payload?.items) return;
        items = payload.items;
        return;
      }
      case "REMOVE_ITEM": {
        if (typeof payload !== "number") return;
        items = items.filter((_, index) => index !== payload);
        return;
      }
      case "MOVE_ITEM": {
        if (typeof payload !== "object" || typeof payload?.fromIndex !== "number" || typeof payload.toIndex !== "number") return;
        const next = [...items];
        const [moved] = next.splice(payload.fromIndex, 1);
        if (moved) next.splice(payload.toIndex, 0, moved);
        items = next;
        return;
      }
      case "SET_INDEX": {
        if (typeof payload !== "number") return;
        items = items.map((item, index) => video(videoIdOf(item) ?? "", index === payload));
        return;
      }
      case "CLEAR":
        items = [];
        return;
    }
  };

  const store = {
    getState: () => ({ queue: { items, queueContextParams: "", nextQueueItemId: items.length } }),
    dispatch(event: StoreEvent) {
      applied.push(event);
      reduce(event);
      // Runs inside the synchronous dispatch, like a store subscriber that dispatches again.
      onReduce?.(event);
    },
  };
  // YTM's #queue dispatches through its store (and so through the session's wrapper).
  const element = { queue: { store: { store } }, dispatch: (event: StoreEvent) => store.dispatch(event) } as unknown as QueueElement;

  /** What YTM dispatches when a user adds rows from a menu ("Add to queue", an album). */
  const userAdds = (videoIds: string | readonly string[], index?: number) =>
    store.dispatch({
      type: "ADD_ITEMS",
      payload: { items: (typeof videoIds === "string" ? [videoIds] : videoIds).map((videoId) => video(videoId)), index },
    });

  return {
    element,
    store,
    applied,
    userAdds,
    items: () => items,
    /** The rendered rows' video ids, in order. */
    ids: () => items.map(videoIdOf),
    /** The row \u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063 marks as playing, or -1. */
    selected: () => items.findIndex((item) => "playlistPanelVideoRenderer" in item && item.playlistPanelVideoRenderer.selected),
    setOnReduce: (fn: ((event: StoreEvent) => void) | undefined) => {
      onReduce = fn;
    },
  };
}
