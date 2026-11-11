import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  hasSameVideoIds,
  indexOfQueueVideoId,
  insertVideoData,
  mapQueueItem,
  moveVideoData,
  Queue,
  type QueueItem,
  queueEntries,
  queueVideoIds,
  reconcileVideoData,
  removeVideoData,
  selectedQueueIndex,
} from "../queue.ts";
import type { VideoData } from "../types.ts";
import { fakeQueue, video, videoIdOf, wrapper } from "./queue-fake.ts";

const owner = (videoId: string, ownerId = "host"): VideoData => ({ videoId, ownerId });

/** A page whose `/music/get_queue` answer can be delayed, to race a sync. */
let requested: string[][] = [];
let fetchDelay = 0;

beforeEach(() => {
  requested = [];
  fetchDelay = 0;
  const app = {
    networkManager: {
      fetch: async (_path: string, body: { videoIds: string[] }) => {
        requested.push(body.videoIds);
        if (fetchDelay > 0) await new Promise((resolve) => setTimeout(resolve, fetchDelay));
        return { queueDatas: body.videoIds.map((videoId) => ({ content: video(videoId) })) };
      },
    },
  };
  vi.stubGlobal("document", { querySelector: () => app, querySelectorAll: () => [] });
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
});
afterEach(async () => {
  // Let the queue syncs the test started finish while the page stubs still exist.
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

const flush = async (times = 4) => {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const waitForSync = async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  await flush(8);
};

/** One side of a session: YTM's queue store plus a stand-in for the session's loopback. */
const createPeer = (initial: string[], ownerId: string, initialOwnerId = ownerId) => {
  const queue = fakeQueue(initial);
  const shared = new Queue({ queue: queue.element, getProfile: () => undefined, t: (_key, fallback = "") => fallback });
  shared.setOwner({ id: ownerId, handleId: "", name: ownerId, thumbnail: "" });
  shared.setVideoList(
    initial.map((videoId) => ({ videoId, ownerId: initialOwnerId })),
    false,
  );
  // What the session does with a synced insert: applies it to the local queue.
  shared.on(async (event) => {
    if (event.type === "ADD_SONGS") await shared.addVideos(event.payload.videoList, event.payload.index);
  });
  return { queue, shared };
};

const mirrorIds = (shared: Queue) => shared.videoList.map((it) => it.videoId);

const collectBroadcasts = (shared: Queue) => {
  const events: { type: string; payload?: { index?: number }; after?: unknown[] }[] = [];
  shared.on((event) => events.push(event as never));
  return events;
};

test("a play-next insert keeps the owner mirror on the rendered queue", async () => {
  const host = createPeer(["a", "b", "c"], "host");
  host.shared.injection();
  host.shared.setIndex(0);
  await flush();

  // \u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063 dispatches ADD_ITEMS at the current item + 1 for a "play next";
  // the plugin broadcasts it and applies it back through the session.
  host.queue.store.dispatch({ type: "ADD_ITEMS", payload: { items: [video("x")], index: 1 } });
  await flush(8);

  expect(host.queue.ids()).toEqual(["a", "x", "b", "c"]);
  // The owner mirror must match the store row for row, or the next queue sync
  // and the selection restore that follows it would be skipped.
  expect(mirrorIds(host.shared)).toEqual(["a", "x", "b", "c"]);
  expect(requested).toHaveLength(1);
});

test("an insert received from the host keeps the mirror in step", async () => {
  // The host added the playlist, so a remote "play next" row is host-owned too:
  // an owner-id check would mistake it for the plugin's own insert.
  const guest = createPeer(["a", "b", "c"], "guest", "host");

  await guest.shared.addVideos([{ videoId: "x", ownerId: "host" }], 1);
  await flush(8);

  expect(guest.queue.ids()).toEqual(["a", "x", "b", "c"]);
  expect(mirrorIds(guest.shared)).toEqual(["a", "x", "b", "c"]);
});

test("an album added to the queue is mirrored, not swallowed", async () => {
  const host = createPeer(["a", "b"], "host");
  host.shared.injection();

  // Several rows in one dispatch: YTM's album/playlist "Add to queue".
  host.queue.store.dispatch({ type: "ADD_ITEMS", payload: { items: [video("x"), video("y")], index: 2 } });
  await flush(8);

  expect(host.queue.ids()).toEqual(["a", "b", "x", "y"]);
  expect(mirrorIds(host.shared)).toEqual(["a", "b", "x", "y"]);
  expect(requested).toHaveLength(1);
});

test("a full sync restores the row \u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063 was playing", async () => {
  const guest = createPeer(["a", "b", "c"], "guest", "host");
  guest.shared.injection();
  guest.shared.setIndex(1);
  await flush();

  guest.shared.setVideoList(["a", "b", "c", "d"].map((videoId) => ({ videoId, ownerId: "host" })));
  await waitForSync();

  expect(guest.queue.ids()).toEqual(["a", "b", "c", "d"]);
  expect(guest.shared.selectedIndex).toBe(1);
  expect(guest.queue.selected()).toBe(1);
});

test("an index sent during a resync is applied once the queue is rebuilt", async () => {
  const guest = createPeer(["a", "b", "c"], "guest", "host");
  guest.shared.injection();
  guest.shared.setIndex(0);
  await flush();

  // The host sends the list and the current index back to back; the guest
  // rebuilds the queue asynchronously, after the index has already arrived.
  guest.shared.setVideoList(["a", "b", "c", "d"].map((videoId) => ({ videoId, ownerId: "host" })));
  guest.shared.setIndex(2);
  await waitForSync();

  expect(guest.queue.ids()).toEqual(["a", "b", "c", "d"]);
  expect(guest.shared.selectedIndex).toBe(2);
  expect(guest.queue.selected()).toBe(2);
});

test("an index that arrives while the sync is fetching still wins", async () => {
  const guest = createPeer(["a", "b", "c"], "guest", "host");
  guest.shared.injection();
  guest.shared.setIndex(0);
  await flush();

  fetchDelay = 200;
  guest.shared.setVideoList(["a", "b", "c", "d"].map((videoId) => ({ videoId, ownerId: "host" })));
  // Let the debounce fire so the fetch is in flight, then send the index.
  await new Promise((resolve) => setTimeout(resolve, 130));
  guest.shared.setIndex(2);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await flush(8);

  expect(guest.queue.ids()).toEqual(["a", "b", "c", "d"]);
  expect(guest.shared.selectedIndex).toBe(2);
});

test("a same-list sync supersedes an older queued fetch", async () => {
  const guest = createPeer(["a", "b", "c"], "guest", "host");
  guest.shared.injection();

  // A sync for a queue the guest never had is queued, then the host sends the
  // list the guest already renders: the stale fetch must be dropped.
  guest.shared.setVideoList(["a", "b", "c", "d"].map((videoId) => ({ videoId, ownerId: "host" })));
  guest.shared.setVideoList(["a", "b", "c"].map((videoId) => ({ videoId, ownerId: "host" })));
  await waitForSync();

  expect(guest.queue.ids()).toEqual(["a", "b", "c"]);
  expect(requested).toHaveLength(0);
});

test("an out-of-range index cannot clear the current row", async () => {
  const host = createPeer(["a", "b"], "host");
  host.shared.injection();
  host.shared.setIndex(0);
  await flush();

  host.shared.setIndex(42);
  await flush();

  expect(host.shared.selectedIndex).toBe(1);
  expect(
    host.queue.items().filter((item) => "playlistPanelVideoRenderer" in item && item.playlistPanelVideoRenderer.selected),
  ).toHaveLength(1);
});

test("an out-of-range remove or move is a no-op", () => {
  const guest = createPeer(["a", "b", "c"], "guest");

  guest.shared.removeVideo(-1);
  guest.shared.removeVideo(9);
  guest.shared.moveItem(-1, 0);
  guest.shared.moveItem(0, 9);

  expect(guest.queue.ids()).toEqual(["a", "b", "c"]);
});

test("an index from a cancelled sync cannot re-select an old row", async () => {
  const guest = createPeer(["a", "b", "c"], "guest", "host");
  const hostList = (ids: string[]) => ids.map((videoId) => ({ videoId, ownerId: "host" }));
  guest.shared.injection();
  guest.shared.setIndex(1);
  await flush();

  // A different list queues a sync; the index for that future replacement
  // arrives while it is still pending.
  guest.shared.setVideoList(hostList(["a", "b", "c", "x"]));
  guest.shared.setIndex(2);
  await flush();

  // The host re-sends the list the guest already renders: the queued sync is
  // cancelled, so its pending index must be dropped with it.
  guest.shared.setVideoList(hostList(["a", "b", "c"]));
  // The user moves to another row after the cancellation.
  guest.shared.setIndex(1);
  await flush();

  // A later, unrelated replacement must not jump back to the stale index 2.
  guest.shared.setVideoList(hostList(["a", "b", "c", "d"]));
  await waitForSync();

  expect(guest.queue.ids()).toEqual(["a", "b", "c", "d"]);
  expect(guest.shared.selectedIndex).toBe(1);
});

test("a replacement after a local clear does not turn the next add into a fresh playlist", async () => {
  const host = createPeer(["a", "b"], "host");
  const events = collectBroadcasts(host.shared);
  host.shared.injection();

  // A local clear is swallowed and announced as CLEAR_QUEUE; the fresh-playlist
  // latch is armed for the ADD_ITEMS that usually follows.
  host.queue.store.dispatch({ type: "CLEAR" });
  // The store follows with a full replacement instead of ADD_ITEMS.
  host.queue.store.dispatch({ type: "UPDATE_ITEMS", payload: { items: [video("a")], currentIndex: -1 } });
  events.length = 0;

  // The next ordinary "add to queue" must keep its insert position instead of
  // being broadcast as a fresh playlist that rewinds every guest.
  host.queue.store.dispatch({ type: "ADD_ITEMS", payload: { items: [video("x")], index: 1 } });

  const add = events.find((event) => event.type === "ADD_SONGS");
  expect(add?.after).toBeUndefined();
  expect(add?.payload?.index).toBe(1);
});

test("rollbackInjection drops a latch left by a swallowed clear", async () => {
  const host = createPeer(["a", "b"], "host");
  const events = collectBroadcasts(host.shared);
  host.shared.injection();

  host.queue.store.dispatch({ type: "CLEAR" });
  // A session stop rolls the injection back; the same Queue instance is
  // injected again when the session restarts.
  host.shared.rollbackInjection();
  host.shared.injection();
  events.length = 0;

  host.queue.store.dispatch({ type: "ADD_ITEMS", payload: { items: [video("x")], index: 1 } });

  const add = events.find((event) => event.type === "ADD_SONGS");
  expect(add?.after).toBeUndefined();
  expect(add?.payload?.index).toBe(1);
});

test("a nested dispatch during an internal edit is not broadcast", async () => {
  const host = createPeer(["a", "b"], "host");
  const events = collectBroadcasts(host.shared);
  let nested = false;
  host.shared.injection();
  host.queue.setOnReduce((event) => {
    if (nested || event.type !== "ADD_ITEMS") return;
    nested = true;
    // A nested internal dispatch must not clear the outer guard: the edit that
    // follows it is still the plugin's, not a user edit.
    host.shared.setIndex(0);
    host.queue.store.dispatch({ type: "MOVE_ITEM", payload: { fromIndex: 0, toIndex: 1 } });
  });

  await host.shared.addVideos([{ videoId: "x", ownerId: "host" }], 0);
  await flush(8);

  expect(events.map((event) => event.type)).not.toContain("MOVE_SONG");
});

test("a repeated queue sync with the same tracks is detected", () => {
  const host = [owner("a"), owner("b", "guest")];
  // The host re-sends the list on a join or a rejected action, with owner ids
  // filled in: same tracks, so the guest must not re-fetch the queue.
  expect(hasSameVideoIds([owner("a"), owner("b", "host")], host)).toBe(true);
  expect(hasSameVideoIds([], [])).toBe(true);
});

test("an added, removed, reordered or replaced track is a real change", () => {
  const base = [owner("a"), owner("b")];

  expect(hasSameVideoIds([...base, owner("c")], base)).toBe(false);
  expect(hasSameVideoIds(base.slice(0, 1), base)).toBe(false);
  expect(hasSameVideoIds([base[1]!, base[0]!], base)).toBe(false);
  expect(hasSameVideoIds([base[0]!, owner("z")], base)).toBe(false);
});

test("inserting rows keeps the surrounding owners and clamps the position", () => {
  const base = [owner("a"), owner("b", "guest")];

  expect(insertVideoData(base, [owner("x")], 1)).toEqual([owner("a"), owner("x"), owner("b", "guest")]);
  // A play-next at the end, or a stale index from a peer, must not drop rows.
  expect(insertVideoData(base, [owner("x")], 99)).toEqual([owner("a"), owner("b", "guest"), owner("x")]);
  expect(insertVideoData(base, [owner("x")], -3)).toEqual([owner("x"), owner("a"), owner("b", "guest")]);
  expect(insertVideoData(base, [owner("x")])).toEqual([owner("a"), owner("b", "guest"), owner("x")]);
  expect(base).toHaveLength(2);
});

test("removing and moving rows follow the queue store semantics", () => {
  const base = [owner("a"), owner("b", "guest"), owner("c")];

  expect(removeVideoData(base, 1)).toEqual([owner("a"), owner("c")]);
  expect(removeVideoData(base, -1)).toBe(base);
  expect(removeVideoData(base, 9)).toBe(base);

  expect(moveVideoData(base, 0, 2)).toEqual([owner("b", "guest"), owner("c"), owner("a")]);
  expect(moveVideoData(base, 2, 0)).toEqual([owner("c"), owner("a"), owner("b", "guest")]);
  // Moving to the end passes the list length, as the queue store allows.
  expect(moveVideoData(base, 0, base.length)).toEqual([owner("b", "guest"), owner("c"), owner("a")]);
  expect(moveVideoData(base, 0, 9)).toBe(base);
  expect(moveVideoData(base, 9, 0)).toBe(base);
});

test("reconciling a replaced queue keeps owners and defaults the new rows", () => {
  const previous = [owner("a"), owner("b", "guest")];

  expect(reconcileVideoData(previous, [video("a"), video("b")], "host")).toEqual([owner("a"), owner("b", "guest")]);
  // The queue reordered: match by video id instead of position.
  expect(reconcileVideoData(previous, [video("b"), video("a")], "host")).toEqual([owner("b", "guest"), owner("a")]);
  // A row the previous list did not have falls back to its added owner.
  expect(reconcileVideoData(previous, [video("a"), video("x")], "host")).toEqual([owner("a"), owner("x", "host")]);
  // Removed rows do not leave a stale tail behind.
  expect(reconcileVideoData(previous, [video("a")], "host")).toEqual([owner("a")]);
});

test("queue rows are flattened for owner matching and selection", () => {
  const items = [video("a"), wrapper("b", true), null as unknown as QueueItem];

  expect(queueEntries(items)).toEqual([{ videoId: "a", selected: false }, { videoId: "b", selected: true }, undefined]);
  expect(queueVideoIds(items)).toEqual(["a", "b", undefined]);
  expect(selectedQueueIndex(items)).toBe(1);
  expect(indexOfQueueVideoId(items, "b")).toBe(1);
  expect(indexOfQueueVideoId(items, "missing")).toBe(-1);
});

test("malformed rows never throw while the queue is read", () => {
  // The redux queue is runtime data: slots can be null and a wrapper can have no
  // primary renderer after \u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063 switches player pages.
  const items = [
    null as unknown as QueueItem,
    {} as QueueItem,
    { playlistPanelVideoWrapperRenderer: {} } as unknown as QueueItem,
    video("a"),
  ];

  expect(() => mapQueueItem((item) => item?.videoId, items)).not.toThrow();
  expect(queueVideoIds(items)).toEqual([undefined, undefined, undefined, "a"]);
  expect(selectedQueueIndex(items)).toBe(-1);
  expect(videoIdOf(items[3])).toBe("a");
});
