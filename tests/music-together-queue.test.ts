import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { Queue } from '../src/plugins/music-together/queue/queue';

import type { Profile, VideoData } from '../src/plugins/music-together/types';
import type { QueueItem } from '../src/types/datahost-get-state';

type Action = { type: string; payload?: any };

type Entry = { videoId: string; selected: boolean };

const video = (videoId: string, selected = false): QueueItem =>
  ({
    playlistPanelVideoRenderer: {
      videoId,
      selected,
    },
  }) as unknown as QueueItem;

const videoIdOf = (item: QueueItem | undefined) =>
  item?.playlistPanelVideoRenderer?.videoId ??
  item?.playlistPanelVideoWrapperRenderer?.primaryRenderer
    ?.playlistPanelVideoRenderer?.videoId;

/** The queue store reducer, mirroring YouTube Music's queue semantics. */
const makeStore = (initial: string[]) => {
  let entries: Entry[] = initial.map((videoId) => ({
    videoId,
    selected: false,
  }));
  let nextQueueItemId = entries.length;

  const items = () =>
    entries.map((entry) => video(entry.videoId, entry.selected));

  const getState = () => ({
    queue: {
      items: items(),
      nextQueueItemId,
      queueContextParams: '',
      shuffleEnabled: false,
    },
  });

  const addEntries = (action: Action) => {
    const added = (action.payload.items as QueueItem[]).map((item) => ({
      videoId: videoIdOf(item) ?? '',
      selected: false,
    }));
    const index = Math.min(
      Math.max(action.payload.index ?? entries.length, 0),
      entries.length,
    );
    entries = [...entries.slice(0, index), ...added, ...entries.slice(index)];
    nextQueueItemId += added.length;
  };

  const reduce = (action: Action) => {
    switch (action.type) {
      case 'ADD_ITEMS': {
        addEntries(action);
        break;
      }
      case 'UPDATE_ITEMS': {
        const start = (action.payload.currentIndex ?? -1) + 1;
        const added = (action.payload.items as QueueItem[]).map((item) => ({
          videoId: videoIdOf(item) ?? '',
          selected: false,
        }));
        entries = [...entries.slice(0, start), ...added];
        nextQueueItemId += added.length;
        break;
      }
      case 'SET_INDEX': {
        entries = entries.map((entry, index) => ({
          ...entry,
          selected: index === action.payload,
        }));
        break;
      }
      case 'REMOVE_ITEM': {
        entries = [
          ...entries.slice(0, action.payload),
          ...entries.slice(action.payload + 1),
        ];
        break;
      }
      case 'MOVE_ITEM': {
        const next = [...entries];
        const [moved] = next.splice(action.payload.fromIndex, 1);
        next.splice(action.payload.toIndex, 0, moved);
        entries = next;
        break;
      }
      case 'CLEAR': {
        entries = [];
        break;
      }
      default:
        break;
    }
  };

  return {
    getState,
    dispatch: (action: Action) => reduce(action),
    items,
  };
};

const createPage = () => {
  const window = new Window();
  const document = window.document;
  Object.assign(globalThis, {
    document,
    window,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  });

  const requested: string[][] = [];
  let fetchDelay = 0;
  const app = document.createElement('ytmusic-app');
  Object.assign(app, {
    networkManager: {
      fetch: async (_url: string, body: { videoIds: string[] }) => {
        requested.push(body.videoIds);
        if (fetchDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, fetchDelay));
        }
        return {
          queueDatas: body.videoIds.map((videoId) => ({
            content: video(videoId),
          })),
        };
      },
    },
  });
  document.body.append(app);

  const createPeer = (
    initial: string[],
    ownerId: string,
    withPageQueue = false,
    initialOwnerId = ownerId,
  ) => {
    const store = makeStore(initial);
    const element = document.createElement('ytmusic-player-queue');
    if (withPageQueue) element.id = 'queue';
    // The page's element dispatch goes through the redux store the plugin wraps.
    Object.assign(element, {
      queue: { store: { store } },
      dispatch: (action: Action) => store.dispatch(action),
    });
    document.body.append(element);

    const owner: Profile = {
      id: ownerId,
      name: ownerId,
      thumbnail: '',
      handleId: '',
    };

    const queue = new Queue({
      owner,
      queue: element as never,
      getProfile: () => undefined,
    });

    // Stand-in for the plugin's listener: applying a synced insert locally.
    queue.setVideoList(
      initial.map((videoId) => ({ videoId, ownerId: initialOwnerId })),
      false,
    );

    queue.on(async (event) => {
      if (event.type === 'ADD_SONGS') {
        await queue.addVideos(event.payload.videoList, event.payload.index);
      }
    });

    return { queue, store, owner, element };
  };

  return {
    document,
    requested,
    createPeer,
    setFetchDelay: (ms: number) => {
      fetchDelay = ms;
    },
    close: () => window.happyDOM.close(),
  };
};

const flush = async (times = 4) => {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const waitForSync = async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  await flush(8);
};

const idsOf = (items: QueueItem[]) => items.map(videoIdOf);
const mirrorIds = (queue: Queue) =>
  queue.videoList.map((it: VideoData) => it.videoId);

test('a play-next insert keeps the owner mirror on the rendered queue', async () => {
  const page = createPage();
  const host = page.createPeer(['a', 'b', 'c'], 'host', true);

  try {
    host.queue.injection();
    host.queue.setIndex(0);
    await flush();

    // YouTube Music dispatches ADD_ITEMS at the current item + 1 for a
    // "play next"; the plugin broadcasts it and applies it to both peers.
    host.store.dispatch({
      type: 'ADD_ITEMS',
      payload: {
        items: [video('x')],
        index: 1,
        nextQueueItemId: 3,
        shouldAssignIds: true,
        shuffleEnabled: false,
      },
    });
    await flush(8);

    expect(idsOf(host.store.items())).toEqual(['a', 'x', 'b', 'c']);
    // The owner mirror must match the store row for row, or the next queue
    // sync (and the selection restore that follows it) would be skipped.
    expect(mirrorIds(host.queue)).toEqual(['a', 'x', 'b', 'c']);
    expect(page.requested).toHaveLength(1);
  } finally {
    await page.close();
  }
});

test('an insert received from the host keeps the mirror in step', async () => {
  const page = createPage();
  const guest = page.createPeer(['a', 'b', 'c'], 'guest', true, 'host');

  try {
    guest.queue.injection();

    // A remote "play next": the row after `a` is owned by the host too, which
    // used to make the old owner-id check skip the mirror update.
    await guest.queue.addVideos([{ videoId: 'x', ownerId: 'host' }], 1);
    await flush(8);

    expect(idsOf(guest.store.items())).toEqual(['a', 'x', 'b', 'c']);
    expect(mirrorIds(guest.queue)).toEqual(['a', 'x', 'b', 'c']);
  } finally {
    await page.close();
  }
});

test('an album added to the queue is mirrored, not swallowed', async () => {
  const page = createPage();
  const host = page.createPeer(['a', 'b'], 'host', true);

  try {
    host.queue.injection();

    host.store.dispatch({
      type: 'ADD_ITEMS',
      payload: {
        items: [video('x'), video('y')],
        index: 2,
        nextQueueItemId: 2,
        shouldAssignIds: true,
        shuffleEnabled: false,
      },
    });
    await flush(8);

    expect(idsOf(host.store.items())).toEqual(['a', 'b', 'x', 'y']);
    expect(mirrorIds(host.queue)).toEqual(['a', 'b', 'x', 'y']);
    expect(page.requested).toHaveLength(1);
  } finally {
    await page.close();
  }
});

test('a full sync restores the row YouTube Music was playing', async () => {
  const page = createPage();
  const guest = page.createPeer(['a', 'b', 'c'], 'guest', true);

  try {
    guest.queue.injection();
    guest.queue.setIndex(1);
    await flush();

    // The guest is behind by one row; the host's rendered list forces a sync.
    guest.queue.setVideoList(
      ['a', 'b', 'c', 'd'].map((videoId) => ({
        videoId,
        ownerId: 'host',
      })),
    );
    await waitForSync();

    expect(idsOf(guest.store.items())).toEqual(['a', 'b', 'c', 'd']);
    expect(guest.queue.selectedIndex).toBe(1);
    expect(guest.store.items()[1]?.playlistPanelVideoRenderer?.selected).toBe(
      true,
    );
  } finally {
    await page.close();
  }
});

test('an index sent during a resync is applied once the queue is rebuilt', async () => {
  const page = createPage();
  const guest = page.createPeer(['a', 'b', 'c'], 'guest', true);

  try {
    guest.queue.injection();
    guest.queue.setIndex(0);
    await flush();

    // The host sends the list and the current index back to back; the guest
    // rebuilds the queue asynchronously, after the index has already arrived.
    guest.queue.setVideoList(
      ['a', 'b', 'c', 'd'].map((videoId) => ({ videoId, ownerId: 'host' })),
    );
    guest.queue.setIndex(2);
    await waitForSync();

    expect(idsOf(guest.store.items())).toEqual(['a', 'b', 'c', 'd']);
    expect(guest.queue.selectedIndex).toBe(2);
    expect(guest.store.items()[2]?.playlistPanelVideoRenderer?.selected).toBe(
      true,
    );
  } finally {
    await page.close();
  }
});

test('an index that arrives while the sync is fetching still wins', async () => {
  const page = createPage();
  const guest = page.createPeer(['a', 'b', 'c'], 'guest', true);

  try {
    guest.queue.injection();
    guest.queue.setIndex(0);
    await flush();

    page.setFetchDelay(200);
    guest.queue.setVideoList(
      ['a', 'b', 'c', 'd'].map((videoId) => ({ videoId, ownerId: 'host' })),
    );
    // Let the debounce fire so the fetch is in flight, then send the index.
    await new Promise((resolve) => setTimeout(resolve, 130));
    guest.queue.setIndex(2);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flush(8);

    expect(idsOf(guest.store.items())).toEqual(['a', 'b', 'c', 'd']);
    expect(guest.queue.selectedIndex).toBe(2);
  } finally {
    await page.close();
  }
});

test('a same-list sync supersedes an older queued fetch', async () => {
  const page = createPage();
  const guest = page.createPeer(['a', 'b', 'c'], 'guest', true);

  try {
    guest.queue.injection();

    // A sync for a queue the guest never had is queued, then the host sends
    // the list the guest already renders: the stale fetch must be dropped.
    guest.queue.setVideoList(
      ['a', 'b', 'c', 'd'].map((videoId) => ({ videoId, ownerId: 'host' })),
    );
    guest.queue.setVideoList(
      ['a', 'b', 'c'].map((videoId) => ({ videoId, ownerId: 'host' })),
    );
    await waitForSync();

    expect(idsOf(guest.store.items())).toEqual(['a', 'b', 'c']);
    expect(page.requested).toHaveLength(0);
  } finally {
    await page.close();
  }
});

test('an out-of-range index cannot clear the current row', async () => {
  const page = createPage();
  const host = page.createPeer(['a', 'b'], 'host', true);

  try {
    host.queue.injection();
    host.queue.setIndex(0);
    await flush();

    host.queue.setIndex(42);
    await flush();

    expect(host.queue.selectedIndex).toBe(1);
    expect(
      host.store
        .items()
        .filter((item) => item.playlistPanelVideoRenderer?.selected),
    ).toHaveLength(1);
  } finally {
    await page.close();
  }
});

test('host and guest stay in step when a play-next track starts', async () => {
  const page = createPage();
  const host = page.createPeer(['a', 'b', 'c'], 'host', true);
  // The host added the playlist, so the guest mirrors its rows as host-owned.
  const guest = page.createPeer(['a', 'b', 'c'], 'guest', false, 'host');

  try {
    host.queue.injection();
    guest.queue.injection();
    host.queue.setIndex(1);
    guest.queue.setIndex(1);
    await flush();

    // 1. The host adds `x` as "play next" and the guest receives the insert.
    host.store.dispatch({
      type: 'ADD_ITEMS',
      payload: {
        items: [video('x')],
        index: 2,
        nextQueueItemId: 3,
        shouldAssignIds: true,
        shuffleEnabled: false,
      },
    });
    await flush(8);
    await guest.queue.addVideos([{ videoId: 'x', ownerId: 'host' }], 2);
    await flush(8);

    // 2. The host starts the new track: list snapshot plus index.
    host.queue.setIndex(2);
    guest.queue.setVideoList(host.queue.videoDataFromQueue());
    guest.queue.setIndex(2);
    await waitForSync();

    expect(idsOf(guest.store.items())).toEqual(idsOf(host.store.items()));
    expect(mirrorIds(guest.queue)).toEqual(mirrorIds(host.queue));
    expect(guest.queue.selectedIndex).toBe(2);
    expect(host.queue.selectedIndex).toBe(2);
    // The lists matched, so the guest never re-fetched the queue and never
    // lost the playing row to an `UPDATE_ITEMS` replacement.
    expect(page.requested).toHaveLength(2);
  } finally {
    await page.close();
  }
});
