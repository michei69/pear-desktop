// pear-desktop's shared queue: YTM's own queue store is the session's queue.
// Its dispatch is wrapped, so changes made in YTM (play next, add to queue,
// remove, reorder, play) go to the session instead, and the session's changes
// are dispatched into it; each item shows who added it.

import type { Translate } from "@pear/sdk/i18n";
import { decorateOwner } from "./owners.tsx";
import type { ConnectionEventUnion, Profile, VideoData } from "./types.ts";

interface VideoRenderer {
  videoId: string;
  selected?: boolean;
}

/** An item of YTM's queue state: a video, or a wrapper with the video as its primary renderer. */
export type QueueItem =
  | { playlistPanelVideoRenderer: VideoRenderer }
  | { playlistPanelVideoWrapperRenderer: { primaryRenderer: Record<string, VideoRenderer | undefined> } };

export interface StoreEvent {
  type: string;
  payload?: unknown;
}

type QueuePayload = { items?: QueueItem[]; index?: number; fromIndex?: number; toIndex?: number } | undefined;

interface QueueState {
  queue: { items: QueueItem[]; queueContextParams: string; nextQueueItemId: number };
}

interface Store {
  getState(): QueueState;
  dispatch(event: StoreEvent): void;
}

/** YTM's #queue element. */
export interface QueueElement extends HTMLElement {
  queue: { store: { store: Store } };
  dispatch(event: StoreEvent): void;
}

interface AppElement extends HTMLElement {
  networkManager: { fetch<T>(path: string, body: unknown): Promise<T> };
}

// Queue rows, plain or inside a video wrapper.
const QUEUE_ITEMS =
  "#contents > ytmusic-player-queue-item, #contents > ytmusic-playlist-panel-video-wrapper-renderer > #primary-renderer > ytmusic-player-queue-item";

/** How long a burst of `SYNC_QUEUE`s waits before one fetch covers it. */
const SYNC_DEBOUNCE_MS = 100;

export type QueueEventListener = (event: ConnectionEventUnion) => void;

export const mapQueueItem = <T>(map: (item?: VideoRenderer) => T, items: readonly QueueItem[]): T[] =>
  items
    .map((item) => {
      // The redux queue is runtime data: a slot can be empty even though the type
      // says otherwise, and a wrapper loses its primary renderer when YTM swaps
      // player pages.
      if (!item) return undefined;
      if ("playlistPanelVideoWrapperRenderer" in item) {
        const primary = item.playlistPanelVideoWrapperRenderer?.primaryRenderer;
        if (!primary) return undefined;
        return primary[Object.keys(primary)[0]!];
      }
      if ("playlistPanelVideoRenderer" in item) return item.playlistPanelVideoRenderer;
      return undefined;
    })
    .map(map);

export interface QueueEntry {
  videoId?: string;
  selected: boolean;
}

/** The rendered queue flattened to the fields the plugin mirrors. */
export const queueEntries = (items: readonly QueueItem[]): (QueueEntry | undefined)[] =>
  mapQueueItem((item) => item && { videoId: item.videoId, selected: !!item.selected }, items);

/** Video ids of the rendered queue, in order (undefined for an unknown row). */
export const queueVideoIds = (items: readonly QueueItem[]) => queueEntries(items).map((entry) => entry?.videoId);

/** Index of the row YTM marks as playing, or -1. */
export const selectedQueueIndex = (items: readonly QueueItem[]) => queueEntries(items).findIndex((entry) => entry?.selected);

/** Index of `videoId` in the rendered queue, or -1. */
export const indexOfQueueVideoId = (items: readonly QueueItem[], videoId: string) =>
  queueEntries(items).findIndex((entry) => entry?.videoId === videoId);

/**
 * Whether two owner lists describe the same tracks in the same order. Only the
 * video ids matter: a repeated `SYNC_QUEUE` that merely refreshes owner ids
 * must not trigger another `/music/get_queue` fetch.
 */
export const hasSameVideoIds = (a: readonly VideoData[], b: readonly VideoData[]) =>
  a.length === b.length && a.every((item, index) => item.videoId === b[index]?.videoId);

/**
 * Inserts the added rows into the owner mirror. The position is clamped to the
 * list, so a stale index from a peer cannot drop tracks or grow the list past
 * the queue.
 */
export const insertVideoData = (list: readonly VideoData[], videos: readonly VideoData[], index?: number): VideoData[] => {
  const at = Number.isFinite(index) ? Math.min(Math.max(Math.trunc(index as number), 0), list.length) : list.length;
  return [...list.slice(0, at), ...videos, ...list.slice(at)];
};

/** Removes one row from the owner mirror; an invalid index is a no-op. */
export const removeVideoData = (list: VideoData[], index: number) => {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
  return [...list.slice(0, index), ...list.slice(index + 1)];
};

/**
 * Moves one row in the owner mirror, matching the queue store's `MOVE_ITEM`
 * semantics (remove first, then insert at the target position).
 */
export const moveVideoData = (list: VideoData[], fromIndex: number, toIndex: number) => {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return list;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex > list.length) return list;

  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return list;

  next.splice(Math.min(toIndex, next.length), 0, moved);
  return next;
};

/**
 * Rebuilds the owner mirror after the queue was replaced wholesale (a full
 * `/music/get_queue` resync). Owners carry over from the previous list: same
 * position first, then the same video id (the queue can reorder), and only
 * then the fallback owner.
 */
export const reconcileVideoData = (previous: readonly VideoData[], items: QueueItem[], fallbackOwnerId: string): VideoData[] => {
  // Tracks which *previous* rows have been matched; new rows are visited once
  // each, so they need no bookkeeping of their own.
  const matched = new Set<number>();

  return queueEntries(items).map((entry, index) => {
    const videoId = entry?.videoId ?? "";
    const samePosition = previous[index];
    if (samePosition && !matched.has(index) && (samePosition.videoId === videoId || !videoId)) {
      matched.add(index);
      return { videoId, ownerId: samePosition.ownerId };
    }

    const match = previous.findIndex((candidate, candidateIndex) => !matched.has(candidateIndex) && candidate.videoId === videoId);
    if (match >= 0) {
      matched.add(match);
      return { videoId, ownerId: previous[match]!.ownerId };
    }

    return { videoId, ownerId: fallbackOwnerId };
  });
};

/** YTM's queue entries for these videos, from its own API. */
async function queueRenderers(queue: QueueElement, videoIds: string[]): Promise<QueueItem[] | null> {
  const app = document.querySelector<AppElement>("ytmusic-app");
  if (!app?.networkManager) return null;
  const response = await app.networkManager.fetch<{ queueDatas: { content: QueueItem }[] }>("/music/get_queue", {
    queueContextParams: queue.queue.store.store.getState().queue.queueContextParams,
    videoIds,
  });
  const items = response?.queueDatas.map((data) => data?.content).filter((content): content is QueueItem => !!content);
  // Nothing resolved: the caller must not apply a queue the peer cannot see.
  return items?.length ? items : null;
}

export interface QueueOptions {
  queue: QueueElement;
  getProfile(id: string): Profile | undefined;
  t: Translate;
}

export class Queue {
  private readonly queue: QueueElement;
  private originalDispatch: Store["dispatch"] | undefined;
  /** Depth of this class's own dispatches, which mustn't loop back to the session. */
  private internalDispatch = 0;
  /** YTM cleared the queue: the next ADD_ITEMS is a whole new queue (something new is playing). */
  private replacingQueue = false;
  private listeners: QueueEventListener[] = [];
  private owner: Profile | null = null;
  private readonly getProfile: (id: string) => Profile | undefined;
  private readonly t: Translate;
  private _videoList: VideoData[] = [];
  /** A queued full sync; a newer one supersedes it. */
  private syncTimeout: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every full sync: a fetch for an older list is dropped. */
  private syncToken = 0;
  /** Bumped by a local queue edit, so an in-flight fetch cannot undo it. */
  private revision = 0;
  /** Bumped by clear, so a stale fetch cannot repopulate the queue. */
  private generation = 0;
  /** Runs the queue fetches one at a time, in the order the events arrived. */
  private mutations: Promise<unknown> = Promise.resolve();
  /** Last index either peer asked for; restored after a full queue replacement. */
  private requestedIndex: number | undefined;
  /** Index a peer sent while a full sync was pending, applied after it. */
  private pendingSyncIndex: number | undefined;
  /** Set while `replaceQueue` holds the queue being replaced. */
  private syncing = false;
  /** Set while an owner-marker patch is waiting for the next frame. */
  private ownerFrame: number | undefined;
  /** Last owner data written per rendered row, to skip unchanged rows. */
  private ownerSignatures = new WeakMap<HTMLElement, string>();

  constructor(options: QueueOptions) {
    this.queue = options.queue;
    this.getProfile = options.getProfile;
    this.t = options.t;
  }

  get videoList() {
    return this._videoList;
  }

  private get store() {
    return this.queue.queue.store.store;
  }

  private get rawItems() {
    return this.store.getState().queue.items ?? [];
  }

  get selectedIndex() {
    return selectedQueueIndex(this.rawItems);
  }

  setOwner(owner: Profile) {
    this.owner = owner;
  }

  /** The rendered queue as owner data, for broadcasting a full queue sync. */
  videoDataFromQueue() {
    return this.currentVideoData();
  }

  /** The owner mirror the rendered queue store implies, in store order. */
  private currentVideoData(): VideoData[] {
    return queueVideoIds(this.rawItems).map((videoId, index) => ({
      videoId: videoId ?? "",
      ownerId: this._videoList[index]?.ownerId ?? this.owner?.id ?? "",
    }));
  }

  /**
   * Rebuilds the owner mirror from the store. Every queue edit ends here, so a
   * stale index from a peer can never leave the mirror one row behind the list
   * YTM actually renders.
   */
  private reconcileVideoList() {
    this._videoList = reconcileVideoData(this._videoList, this.rawItems, this.owner?.id ?? "");
  }

  setVideoList(videoList: VideoData[], sync = true) {
    // The list comes from the peer: drop anything that is not a real row, so a
    // malformed message cannot poison the owner mirror.
    const videos = videoList.filter((it): it is VideoData => !!it && typeof it.videoId === "string");

    // Compare against the rows YTM actually has, not against the cached
    // mirror: an optimistic local edit must never hide a missing row.
    const sameVideos = hasSameVideoIds(videos, this.currentVideoData());
    this._videoList = videos;

    if (!sync) return;

    // An empty host queue means the rendered queue is gone; the store has to
    // follow instead of keeping rows nobody can play.
    if (!videos.length) {
      if (this.rawItems.length) this.clear();
      return;
    }

    // A repeated full sync (the host re-sends on joins and refusals) does not
    // need another fetch or re-render. It also supersedes any sync still queued
    // or running for an older list.
    if (sameVideos) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = undefined;
      this.syncToken += 1;
      // The cancelled sync never rebuilds, so drop its index: it must not re-select an old row later.
      this.pendingSyncIndex = undefined;
      this.syncQueueOwner();
      return;
    }

    clearTimeout(this.syncTimeout);
    const token = ++this.syncToken;
    this.syncTimeout = setTimeout(() => {
      this.syncTimeout = undefined;
      if (token !== this.syncToken) return;
      void this.syncVideo();
    }, SYNC_DEBOUNCE_MS);
  }

  async addVideos(videoData: VideoData[], index?: number) {
    try {
      return await this.serialize(() => this.insertVideos(videoData, index));
    } catch (error) {
      console.warn("[music-together] queue insert failed", error);
      return false;
    }
  }

  private async insertVideos(videoData: VideoData[], index?: number) {
    // Same guard as `setVideoList`: these rows arrive over the wire.
    const videos = videoData.filter((it): it is VideoData => !!it && typeof it.videoId === "string" && it.videoId.length > 0);
    if (!videos.length) return false;

    const generation = this.generation;
    const items = await queueRenderers(
      this.queue,
      videos.map((it) => it.videoId),
    );
    if (!items || generation !== this.generation) return false;

    // The payload index addresses the rendered queue, so clamp it there; the
    // mirror is rebuilt from the store right after the dispatch anyway.
    const length = this.rawItems.length;
    const at = Number.isInteger(index) ? Math.min(Math.max(index!, 0), length) : length;

    this.revision += 1;
    this.dispatchSession({
      type: "ADD_ITEMS",
      payload: {
        nextQueueItemId: this.store.getState().queue.nextQueueItemId,
        index: at,
        items,
        shuffleEnabled: false,
        shouldAssignIds: true,
      },
    });

    this._videoList = insertVideoData(
      this._videoList,
      videos.map((it) => ({ videoId: it.videoId, ownerId: it.ownerId ?? this.owner?.id ?? "" }) satisfies VideoData),
      at,
    );
    this.reconcileVideoList();
    this.refresh();
    return true;
  }

  removeVideo(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.rawItems.length) return;

    this.revision += 1;
    this.dispatchSession({ type: "REMOVE_ITEM", payload: index });
    this._videoList = removeVideoData(this._videoList, index);
    this.reconcileVideoList();
    this.refresh();
  }

  setIndex(index: number) {
    if (!Number.isInteger(index) || index < 0) return;

    // An out-of-range SET_INDEX clears every `selected` flag in the queue store,
    // which leaves YTM with no current item: clamp it.
    const length = this.rawItems.length;
    const target = length > 0 ? Math.min(index, length - 1) : index;
    this.requestedIndex = length > 0 ? target : undefined;

    // A track change can arrive while a full sync is in flight; the replacement
    // drops the selection flags, so remember this index to apply afterwards.
    if (this.syncing || this.syncTimeout !== undefined) this.pendingSyncIndex = target;

    this.dispatchSession({ type: "SET_INDEX", payload: target });
  }

  moveItem(fromIndex: number, toIndex: number) {
    const length = this.rawItems.length;
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= length || toIndex > length) return;

    this.revision += 1;
    this.dispatchSession({ type: "MOVE_ITEM", payload: { fromIndex, toIndex } });
    this._videoList = moveVideoData(this._videoList, fromIndex, toIndex);
    this.reconcileVideoList();
    this.refresh();
  }

  clear() {
    // A queued or in-flight sync belongs to the queue being cleared: never let it
    // repopulate the new one.
    this.generation += 1;
    this.syncToken += 1;
    clearTimeout(this.syncTimeout);
    this.syncTimeout = undefined;

    this.requestedIndex = undefined;
    this.pendingSyncIndex = undefined;
    this._videoList = [];

    this.dispatchSession({ type: "CLEAR" });
  }

  on(listener: QueueEventListener) {
    if (!this.listeners.includes(listener)) this.listeners.push(listener);
  }

  off(listener: QueueEventListener) {
    this.listeners = this.listeners.filter((it) => it !== listener);
  }

  rollbackInjection() {
    clearTimeout(this.syncTimeout);
    this.syncTimeout = undefined;
    this.syncToken += 1;
    // Don't let a swallowed CLEAR's latch survive a restart on this same instance.
    this.replacingQueue = false;

    if (this.originalDispatch) this.store.dispatch = this.originalDispatch;
    this.originalDispatch = undefined;
  }

  /** Routes YTM's own queue changes to the session (see the file comment). */
  injection() {
    // Re-wrapping the already-wrapped dispatch would broadcast every edit twice.
    if (this.originalDispatch) return;
    const store = this.store;
    const original = store.dispatch;
    this.originalDispatch = original;
    store.dispatch = (event) => {
      const passOn = !this.owner || this.internalDispatch > 0 || this.onYtmChange(event);
      if (passOn) original.call(store, event);
    };
  }

  /** A change YTM made itself; whether it should still reach YTM's store (possibly rewritten). */
  private onYtmChange(event: StoreEvent): boolean {
    const payload = event.payload as QueuePayload;
    switch (event.type) {
      case "CLEAR":
        this.replacingQueue = true;
        this.broadcast({ type: "CLEAR_QUEUE", payload: null });
        return false;
      case "UPDATE_ITEMS":
        // A full replacement ends the swallowed-clear window: a later ADD_ITEMS
        // is an ordinary edit, not a fresh playlist.
        this.replacingQueue = false;
        return true;
      case "ADD_ITEMS":
        this.onYtmAdd(payload);
        return false;
      case "MOVE_ITEM":
        this.broadcast({ type: "MOVE_SONG", payload: { fromIndex: payload!.fromIndex!, toIndex: payload!.toIndex! } });
        return false;
      case "REMOVE_ITEM":
        this.broadcast({ type: "REMOVE_SONG", payload: { index: event.payload as number } });
        return false;
      case "SET_INDEX":
        this.broadcast({ type: "SYNC_PROGRESS", payload: { index: event.payload as number } });
        return false;
      case "SET_HEADER":
        event.payload = this.headerPayload();
        return true;
      case "ADD_STEERING_CHIPS":
        event.type = "CLEAR_STEERING_CHIPS";
        event.payload = undefined;
        return true;
      case "SET_PLAYER_UI_STATE":
        return !(event.payload === "INACTIVE" && this._videoList.length > 0);
      // No autoplay or automix in a session: the queue is what people put in it.
      case "HAS_SHOWN_AUTOPLAY":
      case "ADD_AUTOMIX_ITEMS":
        return false;
    }
    return true;
  }

  private onYtmAdd(payload: QueuePayload) {
    const videoList = this.ownedBySelf(payload?.items ?? []);
    if (!videoList.length) return;
    if (this.replacingQueue) {
      // Playing something new: YTM cleared the queue just before, so the rows
      // start at the top and playback starts there.
      this.replacingQueue = false;
      this.broadcast({ type: "ADD_SONGS", payload: { videoList }, after: [{ type: "SET_INDEX", payload: { index: 0 } }] });
      return;
    }
    // One row is "play next"/"add to queue", several rows are an album or a
    // playlist added from a menu; both insert at the payload's index.
    const hasIndex = !!payload && Object.hasOwn(payload, "index") && typeof payload.index === "number";
    this.broadcast({ type: "ADD_SONGS", payload: { ...(hasIndex ? { index: payload!.index! } : {}), videoList } });
  }

  private ownedBySelf(items: readonly QueueItem[]) {
    return queueEntries(items)
      .filter((entry) => !!entry?.videoId)
      .map((entry) => ({ videoId: entry!.videoId!, ownerId: this.owner!.id }) satisfies VideoData);
  }

  /** The queue's header says it's the session's, and autoplay is off. */
  initQueue() {
    this.dispatchSession({ type: "HAS_SHOWN_AUTOPLAY", payload: false });
    this.dispatchSession({ type: "SET_HEADER", payload: this.headerPayload() });
    this.dispatchSession({ type: "CLEAR_STEERING_CHIPS" });
  }

  async syncVideo() {
    return this.serialize(() => this.replaceQueue()).catch((error: unknown) => {
      console.warn("[music-together] queue sync failed", error);
      return false;
    });
  }

  /**
   * Replaces the whole queue with the one the host rendered. `UPDATE_ITEMS`
   * drops the `selected` flags, so the current row has to be restored
   * afterwards or YTM loses its "current item" and stalls on the next
   * transition.
   */
  private async replaceQueue() {
    const token = this.syncToken;
    const generation = this.generation;
    const revision = this.revision;
    const videoIds = this._videoList.map((it) => it.videoId).filter(Boolean);
    if (!videoIds.length) {
      this.pendingSyncIndex = undefined;
      return false;
    }

    // A sync that never rebuilt the queue must not leave an index behind for a
    // later, unrelated replacement; a newer sync may still consume it.
    const abort = () => {
      if (token === this.syncToken) this.pendingSyncIndex = undefined;
      return false;
    };

    this.syncing = true;
    let selectedVideoId: string | undefined;
    try {
      const items = await queueRenderers(this.queue, videoIds);
      // A local edit while the fetch ran means these rows are already stale.
      if (!items || generation !== this.generation || revision !== this.revision) return abort();
      if (token !== this.syncToken) return false;

      selectedVideoId = queueEntries(this.rawItems).find((entry) => entry?.selected)?.videoId;

      this.dispatchSession({
        type: "UPDATE_ITEMS",
        payload: { items, nextQueueItemId: this.store.getState().queue.nextQueueItemId, shouldAssignIds: true, currentIndex: -1 },
      });
      this.reconcileVideoList();
    } finally {
      this.syncing = false;
    }

    this.restoreSelection(selectedVideoId);
    this.refresh();
    return true;
  }

  /** Re-selects the current row after an `UPDATE_ITEMS` replacement. */
  private restoreSelection(videoId?: string) {
    const items = this.rawItems;
    const pending = this.pendingSyncIndex;
    this.pendingSyncIndex = undefined;
    if (!items.length) return;

    // A peer's index for the rebuilt queue wins over the row this side had
    // selected while its old (possibly incomplete) queue was still rendered.
    if (typeof pending === "number") {
      this.setIndex(pending);
      return;
    }

    if (selectedQueueIndex(items) >= 0) return;

    const byVideoId = videoId ? indexOfQueueVideoId(items, videoId) : -1;
    if (byVideoId >= 0) {
      this.setIndex(byVideoId);
      return;
    }

    if (typeof this.requestedIndex === "number") this.setIndex(this.requestedIndex);
  }

  /** Shows who added each item: their avatar, and their name on hover. Batched to one frame. */
  syncQueueOwner() {
    if (this.ownerFrame !== undefined) return;
    this.ownerFrame = requestAnimationFrame(() => {
      this.ownerFrame = undefined;
      this.patchQueueOwner();
    });
  }

  private patchQueueOwner() {
    const unknown = this.t("plugins.music-together.internal.unknown-user", "Unknown User");
    for (const queue of document.querySelectorAll("#queue")) {
      queue.querySelectorAll<HTMLElement>(QUEUE_ITEMS).forEach((item, index) => {
        const id = this._videoList[index]?.ownerId ?? "";
        const profile = this.getProfile(id);
        // Rows keep their identity across renders; only rewrite one whose owner
        // data (or position) actually changed, or every avatar re-decodes.
        const signature = [index, id, profile?.name, profile?.handleId, profile?.thumbnail].join("\u0000");
        if (this.ownerSignatures.get(item) === signature) return;
        this.ownerSignatures.set(item, signature);
        decorateOwner(item, index, id, profile, unknown);
      });
    }
  }

  removeQueueOwner() {
    if (this.ownerFrame !== undefined) {
      cancelAnimationFrame(this.ownerFrame);
      this.ownerFrame = undefined;
    }
    // The markers are gone, so a later sync must write every row again.
    this.ownerSignatures = new WeakMap();
    for (const element of document.querySelectorAll("#queue .music-together-owner, #queue .music-together-name")) element.remove();
  }

  private refresh() {
    setTimeout(() => {
      // Stopped while the queue work was pending: it no longer belongs to a session.
      if (!this.originalDispatch) return;
      this.initQueue();
      this.syncQueueOwner();
    }, 0);
  }

  private headerPayload() {
    const save = this.t("plugins.music-together.internal.save", "Save");
    return {
      title: { runs: [{ text: this.t("plugins.music-together.internal.track-source", "Track Source") }] },
      subtitle: { runs: [{ text: this.t("plugins.music-together.name", "Music Together") }] },
      buttons: [
        {
          chipCloudChipRenderer: {
            style: { styleType: "STYLE_TRANSPARENT" },
            text: { runs: [{ text: save }] },
            navigationEndpoint: { saveQueueToPlaylistCommand: {} },
            icon: { iconType: "ADD_TO_PLAYLIST" },
            accessibilityData: { accessibilityData: { label: save } },
            isSelected: false,
            uniqueId: save,
          },
        },
      ],
    };
  }

  /** Runs the queue fetches in order, so rapid edits cannot be reordered. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(task, task);
    this.mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Dispatches the session's change into YTM's queue without sending it back to the session. */
  private dispatchSession(event: StoreEvent) {
    this.internalDispatch += 1;
    try {
      this.queue.dispatch(event);
    } finally {
      this.internalDispatch -= 1;
    }
  }

  private broadcast(event: ConnectionEventUnion) {
    for (const listener of this.listeners) listener(event);
  }
}
