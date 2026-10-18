import { test, expect } from '@playwright/test';
import { Window } from 'happy-dom';

import { startSfwMusic } from '../renderer';

import type { MusicPlayer } from '@/types/music-player';

const explicitIcon = { icon: { iconType: 'MUSIC_EXPLICIT_BADGE' } };
const explicitBadges = [{ musicInlineBadgeRenderer: explicitIcon }];

/** Builds a fake player, player bar, and queue in a happy-dom document. */
function setup() {
  const window = new Window();
  const document = window.document;
  const previousDocument = globalThis.document;
  Object.assign(globalThis, { document });
  document.body.innerHTML =
    '<ytmusic-player-bar></ytmusic-player-bar><ytmusic-player-queue id="queue"></ytmusic-player-queue>';
  let videoId = 'explicit';
  let items: unknown[] = [];
  let selectedItemIndex = 0;
  let repeatMode = 'NONE';
  let pauses = 0;
  let skips = 0;
  let state = 1;
  const queueSelections: number[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const queueListeners = new Set<() => void>();
  const getState = () => ({
    queue: { items, selectedItemIndex, repeatMode },
  });
  const bar = document.querySelector('ytmusic-player-bar')!;
  Object.assign(bar, { getState });
  Object.assign(document.querySelector('#queue')!, {
    queue: {
      store: {
        store: {
          getState,
          subscribe: (listener: () => void) => {
            queueListeners.add(listener);
            return () => queueListeners.delete(listener);
          },
        },
      },
    },
    dispatch: ({ payload }: { payload: number }) => {
      queueSelections.push(payload);
      skips++;
      selectedItemIndex = payload;
      videoId =
        (
          items[payload] as {
            playlistPanelVideoRenderer?: { videoId?: string };
          }
        )?.playlistPanelVideoRenderer?.videoId ?? videoId;
      listeners.get('videodatachange')?.forEach((listener) => listener());
    },
  });
  const api = {
    getVideoData: () => ({ video_id: videoId }),
    getPlayerState: () => state,
    pauseVideo: () => {
      pauses++;
      state = 2;
    },
    nextVideo: () => {
      skips++;
    },
    addEventListener: (name: string, listener: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener: (name: string, listener: () => void) =>
      listeners.get(name)?.delete(listener),
  } as unknown as MusicPlayer;
  const song = (id: string, explicit = true) => ({
    playlistPanelVideoRenderer: {
      videoId: id,
      badges: explicit ? explicitBadges : [],
    },
  });
  items = [song('explicit')];
  return {
    api,
    bar,
    document,
    song,
    queueSelections,
    repeatAll: () => {
      repeatMode = 'ALL';
    },
    setItems: (value: unknown[]) => {
      items = value;
      queueListeners.forEach((listener) => listener());
    },
    select: (index: number) => {
      selectedItemIndex = index;
    },
    play: async (id: string, index = 0) => {
      videoId = id;
      selectedItemIndex = index;
      listeners.get('videodatachange')?.forEach((listener) => listener());
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
    resume: async () => {
      state = 1;
      listeners.get('onStateChange')?.forEach((listener) => listener());
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
    get state() {
      return state;
    },
    get pauses() {
      return pauses;
    },
    get skips() {
      return skips;
    },
    get listeners() {
      return [...listeners.values()].reduce(
        (count, set) => count + set.size,
        0,
      );
    },
    close: async () => {
      await window.happyDOM.close();
      if (previousDocument) {
        Object.assign(globalThis, { document: previousDocument });
      } else {
        delete (globalThis as { document?: Document }).document;
      }
    },
  };
}

let fixture: ReturnType<typeof setup>;
let stop: (() => void) | undefined;

test.beforeEach(() => {
  fixture = setup();
});
test.afterEach(async () => {
  stop?.();
  stop = undefined;
  await fixture.close();
});

test('skips the current explicit song immediately and only once', async () => {
  stop = startSfwMusic(fixture.api);
  await fixture.play('explicit');
  expect(fixture.skips).toBe(1);
  expect(fixture.pauses).toBe(1);
});

test('leaves clean songs alone even when an explicit song is in the queue', async () => {
  fixture.setItems([fixture.song('explicit'), fixture.song('clean', false)]);
  await fixture.play('clean', 1);
  stop = startSfwMusic(fixture.api);
  expect(fixture.skips).toBe(0);
  expect(fixture.pauses).toBe(0);
});

test('ignores stale metadata belonging to another video', async () => {
  await fixture.play('clean');
  stop = startSfwMusic(fixture.api);
  expect(fixture.skips).toBe(0);
});

test('skips a directly selected explicit song when the queue index points elsewhere', async () => {
  fixture.setItems([fixture.song('explicit'), fixture.song('clean', false)]);
  await fixture.play('explicit', 1);
  stop = startSfwMusic(fixture.api);
  expect(fixture.pauses).toBe(1);
  expect(fixture.skips).toBe(1);
  expect(fixture.queueSelections).toEqual([1]);
});

test('advances with the player API after a direct one-song selection', async () => {
  await fixture.play('explicit', 1);
  stop = startSfwMusic(fixture.api);
  expect(fixture.skips).toBe(1);
  expect(fixture.queueSelections).toEqual([]);
});

test('recognizes an explicit video counterpart outside the selected queue row', async () => {
  fixture.setItems([
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: fixture.song('audio', false),
        counterpart: [{ counterpartRenderer: fixture.song('explicit') }],
      },
    },
    fixture.song('clean', false),
  ]);
  await fixture.play('explicit', 1);
  stop = startSfwMusic(fixture.api);
  expect(fixture.pauses).toBe(1);
  expect(fixture.queueSelections).toEqual([1]);
});

test('wraps to the first song when directly selecting the last explicit song with repeat all', async () => {
  fixture.setItems([fixture.song('clean', false), fixture.song('explicit')]);
  fixture.repeatAll();
  await fixture.play('explicit', 0);
  stop = startSfwMusic(fixture.api);
  expect(fixture.queueSelections).toEqual([0]);
});

test('detects explicit metadata arriving after the song event', async () => {
  fixture.setItems([]);
  stop = startSfwMusic(fixture.api);
  fixture.setItems([fixture.song('explicit')]);
  await expect.poll(() => fixture.skips).toBe(1);
});

test('stops at a repeated explicit song in an all-explicit queue', async () => {
  fixture.setItems([fixture.song('explicit'), fixture.song('second')]);
  stop = startSfwMusic(fixture.api);
  await fixture.play('second', 1);
  await fixture.play('explicit');
  expect(fixture.skips).toBe(2);
  expect(fixture.pauses).toBe(3);
});

test('stops when repeat all wraps back to an already skipped song', async () => {
  fixture.setItems([fixture.song('first'), fixture.song('second')]);
  fixture.repeatAll();
  stop = startSfwMusic(fixture.api);
  await fixture.play('first', 0);
  // Direct selection leaves the index on "first", so the skip wraps there.
  await fixture.play('second', 0);
  await fixture.resume();
  expect(fixture.queueSelections).toEqual([0]);
  expect(fixture.skips).toBe(2);
  expect(fixture.state).toBe(2);
});

test('skips again when a new queue starts with an already skipped song', async () => {
  fixture.setItems([fixture.song('explicit'), fixture.song('clean', false)]);
  stop = startSfwMusic(fixture.api);
  expect(fixture.skips).toBe(1);
  fixture.setItems([fixture.song('explicit')]);
  await fixture.play('explicit');
  expect(fixture.skips).toBe(2);
});

test('keeps the loop guard when the radio appends songs', async () => {
  fixture.setItems([fixture.song('first'), fixture.song('second')]);
  stop = startSfwMusic(fixture.api);
  await fixture.play('first');
  expect(fixture.skips).toBe(1);
  fixture.setItems([
    fixture.song('first'),
    fixture.song('second'),
    fixture.song('third'),
  ]);
  await fixture.play('first');
  expect(fixture.skips).toBe(1);
});

test('skips without the legacy player bar on the newer UI', () => {
  fixture.bar.remove();
  stop = startSfwMusic(fixture.api);
  expect(fixture.skips).toBe(1);
});

test('falls back to the player bar when the queue store is missing', () => {
  Object.assign(fixture.document.querySelector('#queue')!, {
    queue: undefined,
  });
  stop = startSfwMusic(fixture.api);
  expect(fixture.skips).toBe(1);
});

test('can skip the same song again after a clean song plays', async () => {
  fixture.setItems([fixture.song('explicit'), fixture.song('clean', false)]);
  stop = startSfwMusic(fixture.api);
  await fixture.play('clean', 1);
  await fixture.play('explicit');
  expect(fixture.skips).toBe(2);
});

test('skips separate copies of a song before reaching a clean song', async () => {
  fixture.setItems([
    fixture.song('explicit'),
    fixture.song('second'),
    fixture.song('explicit'),
    fixture.song('clean', false),
  ]);
  stop = startSfwMusic(fixture.api);
  await fixture.play('second', 1);
  await fixture.play('explicit', 2);
  await fixture.play('clean', 3);
  expect(fixture.skips).toBe(3);
  expect(fixture.pauses).toBe(3);
});

test('skips consecutive copies of an explicit song', async () => {
  fixture.setItems([fixture.song('explicit'), fixture.song('explicit')]);
  stop = startSfwMusic(fixture.api);
  await fixture.play('explicit', 1);
  expect(fixture.skips).toBe(2);
});

test('blocks playback restarting while an explicit skip is still pending', async () => {
  stop = startSfwMusic(fixture.api);
  await fixture.resume();
  expect(fixture.state).toBe(2);
  expect(fixture.skips).toBe(1);
});

test('keeps the explicit player paused when the queue has already advanced', async () => {
  fixture.setItems([fixture.song('explicit'), fixture.song('clean', false)]);
  stop = startSfwMusic(fixture.api);
  fixture.select(1);
  await fixture.resume();
  expect(fixture.state).toBe(2);
  expect(fixture.skips).toBe(1);
});

test('disabling removes listeners and stops delayed checks', async () => {
  fixture.setItems([]);
  stop = startSfwMusic(fixture.api);
  stop();
  fixture.setItems([fixture.song('explicit')]);
  await fixture.play('explicit');
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(fixture.skips).toBe(0);
  expect(fixture.listeners).toBe(0);
});

for (const eventType of ['click', 'tap']) {
  test(`blocks direct explicit selections before YouTube handles ${eventType}`, () => {
    fixture.setItems([]);
    const row = fixture.document.createElement(
      'ytmusic-responsive-list-item-renderer',
    );
    row.innerHTML =
      '<a href="watch?v=explicit">Explicit song</a><ytmusic-inline-badge-renderer></ytmusic-inline-badge-renderer>';
    Object.assign(row.querySelector('ytmusic-inline-badge-renderer')!, {
      data: explicitIcon,
    });
    fixture.document.body.append(row);
    let played = false;
    row.addEventListener(eventType, () => {
      played = true;
    });
    stop = startSfwMusic(fixture.api);
    const event = new fixture.document.defaultView!.Event(eventType, {
      bubbles: true,
      cancelable: true,
    });
    row.querySelector('a')!.dispatchEvent(event);
    expect(played).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    stop();
    row.querySelector('a')!.dispatchEvent(
      new fixture.document.defaultView!.Event(eventType, {
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(played).toBe(true);
  });
}

test('allows selecting a clean row beside an explicit row', () => {
  fixture.setItems([]);
  fixture.document.body.innerHTML +=
    '<ytmusic-responsive-list-item-renderer><ytmusic-inline-badge-renderer></ytmusic-inline-badge-renderer></ytmusic-responsive-list-item-renderer><ytmusic-responsive-list-item-renderer><a href="watch?v=clean">Clean song</a></ytmusic-responsive-list-item-renderer>';
  Object.assign(
    fixture.document.querySelector('ytmusic-inline-badge-renderer')!,
    {
      data: explicitIcon,
    },
  );
  let played = false;
  const link = fixture.document.querySelector('a')!;
  link.addEventListener('click', () => {
    played = true;
  });
  stop = startSfwMusic(fixture.api);
  link.click();
  expect(played).toBe(true);
});

for (const control of [
  '<ytmusic-menu-renderer><button>Menu</button></ytmusic-menu-renderer>',
  '<a href="browse/artist">Artist</a>',
]) {
  test(`allows non-playback queue controls: ${control}`, () => {
    fixture.setItems([]);
    const row = fixture.document.createElement('ytmusic-player-queue-item');
    row.innerHTML = `${control}<ytmusic-inline-badge-renderer></ytmusic-inline-badge-renderer>`;
    Object.assign(row.querySelector('ytmusic-inline-badge-renderer')!, {
      data: explicitIcon,
    });
    fixture.document.body.append(row);
    let clicked = false;
    const target = row.querySelector('button, a')!;
    target.addEventListener('click', () => {
      clicked = true;
    });
    stop = startSfwMusic(fixture.api);
    target.dispatchEvent(
      new fixture.document.defaultView!.Event('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(clicked).toBe(true);
  });
}
