import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import resumeShuffle from '../src/plugins/resume-shuffle';

import type { MusicPlayer } from '../src/types/music-player';

type Store = {
  getState: () => { queue: { items: unknown[]; shuffleEnabled: boolean } };
  subscribe: (listener: () => void) => () => void;
};

const withDom = (run: (window: Window) => Promise<void>) => async () => {
  const window = new Window();
  const previous = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
    location: (globalThis as Record<string, unknown>).location,
    setTimeout: (globalThis as Record<string, unknown>).setTimeout,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    location: { pathname: '/watch' },
  });
  (window as unknown as Record<string, unknown>).mainConfig = {
    get: () => true,
  };

  try {
    await run(window);
  } finally {
    Object.assign(globalThis, previous);
    window.happyDOM.close();
  }
};

test(
  'a boot without queue or store still starts persisting after the window',
  withDom(async (window) => {
    const app = window.document.createElement('ytmusic-app');
    window.document.body.append(app);

    const writes: unknown[] = [];
    const context = {
      ...resumeShuffle.renderer,
      stopped: false,
      unsubscribeShuffleState: null,
      cancelShuffle: null,
    };
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'function') {
        (context as unknown as Record<string, unknown>)[key] =
          value.bind(context);
      }
    }

    // Capture the restore-window timer instead of waiting ten seconds.
    const originalSetTimeout = globalThis.setTimeout;
    let restoreWindowElapsed: (() => void) | undefined;
    globalThis.setTimeout = ((fn: () => void) => {
      restoreWindowElapsed = fn;
      return 1;
    }) as unknown as typeof setTimeout;

    try {
      await context.onPlayerApiReady(
        {} as MusicPlayer,
        {
          getConfig: async () => ({ enabled: true, shuffled: true }),
          setConfig: (config: unknown) => {
            writes.push(config);
          },
          ipc: {},
        } as never,
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    // Neither the queue API nor the redux store resolved at boot: the restore
    // is pending, so nothing may be persisted yet.
    expect(restoreWindowElapsed).toBeDefined();
    expect(writes).toEqual([]);

    // The store appears while the window is open. Without the missing
    // transition `save` would stay false and the shuffle state would never be
    // written again for the whole session.
    let subscribed: (() => void) | undefined;
    const store: Store = {
      getState: () => ({ queue: { items: [], shuffleEnabled: true } }),
      subscribe: (listener) => {
        subscribed = listener;
        return () => {};
      },
    };
    (app as unknown as Record<string, unknown>).ytmusicReduxBehavior = {
      store: { store },
    };

    restoreWindowElapsed?.();

    expect(subscribed).toBeDefined();
    expect(writes).toEqual([{ shuffled: true }]);

    context.stop();
  }),
);
