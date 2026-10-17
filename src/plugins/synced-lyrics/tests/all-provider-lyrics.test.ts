import { registerHooks } from 'node:module';

import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { ProviderNames, providerNames, type ProviderName } from '../providers';

import type { LyricProvider, LyricResult } from '../types';
import type { SongInfo } from '@/providers/song-info';

/**
 * `allProviderLyrics` is the API server's window into the lyrics store, so these
 * tests drive the real store with stubbed providers: what matters is that it
 * waits for every provider to settle, never refetches, and answers for the song
 * the UI is on.
 *
 * The store's UI half cannot load outside the bundler — `renderer.tsx` and the
 * plugin entry pull in `virtual:` modules and DOM-only deps — and the store only
 * reads `config()` from it. So both are stubbed for the duration of the import,
 * which is all the setup below is for.
 */
const UI_STUBS: [suffix: string, source: string][] = [
  [
    '/synced-lyrics/renderer/renderer.tsx',
    'export const config = () => null; export const setConfig = () => {};',
  ],
  [
    '/synced-lyrics/renderer/index.ts',
    'export const translateInvoke = async () => ({ lines: [], fromCache: false });',
  ],
];

const VIRTUAL_STUB =
  'data:text/javascript,export const languageResources = {};';

/** Off once the store is imported, so other test files load normally. */
let stubbing = true;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbing && specifier.startsWith('virtual:')) {
      return { url: VIRTUAL_STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (stubbing) {
      const stub = UI_STUBS.find(([suffix]) => url.endsWith(suffix));
      if (stub) {
        return { format: 'module', source: stub[1], shortCircuit: true };
      }
    }
    return nextLoad(url, context);
  },
});

/** The DOM the store expects, without an Electron renderer around it. */
const installDom = () => {
  const window = new Window();
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const key of [
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'MutationObserver',
    'customElements',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'DOMParser',
    'XMLHttpRequest',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'location',
    'history',
    'screen',
    'CSS',
  ]) {
    const value = (window as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    try {
      globals[key] = value;
    } catch {
      Object.defineProperty(globals, key, { value, configurable: true });
    }
  }

  (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
    on() {},
    send() {},
    invoke: () => Promise.resolve(undefined),
  };
};

type Store = typeof import('../renderer/store');

let store: Store;
let providers: Record<ProviderName, LyricProvider>;
const searches: Partial<Record<ProviderName, number>> = {};

/** Answer every provider with `answer`, counting the calls it receives. */
const stubProviders = (
  answer: (
    name: ProviderName,
    info: Parameters<LyricProvider['search']>[0],
  ) => Promise<LyricResult | null>,
) => {
  for (const name of providerNames) {
    searches[name] = 0;
    providers[name].search = (info) => {
      searches[name] = (searches[name] ?? 0) + 1;
      return answer(name, info);
    };
  }
};

const song = (videoId: string): SongInfo =>
  ({
    videoId,
    title: `Song ${videoId}`,
    artist: 'Artist',
    songDuration: 100,
  }) as unknown as SongInfo;

const lyric = (name: string): LyricResult => ({
  title: `Song ${name}`,
  artists: ['Artist'],
  lyrics: `words from ${name}`,
});

const deferred = <T>() => {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
};

test.beforeAll(async () => {
  installDom();
  store = await import('../renderer/store');
  const registry = await import('../providers/renderer');
  providers = registry.providers as Record<ProviderName, LyricProvider>;
  stubProviders(() => Promise.resolve(null));
  stubbing = false;
});

test('answers nothing while no song is playing, without searching', async () => {
  expect(store.currentLyricsVideoId()).toBeNull();

  const states = await store.allProviderLyrics();

  expect(providerNames.every((name) => states[name].data === null)).toBe(true);
  expect(providerNames.every((name) => searches[name] === 0)).toBe(true);
});

test('resolves only once every provider has settled', async () => {
  const slow = deferred<LyricResult | null>();
  stubProviders((name) =>
    name === ProviderNames.NetEase
      ? slow.promise
      : name === ProviderNames.LRCLib
        ? Promise.reject(new Error('provider down'))
        : Promise.resolve(lyric(name)),
  );

  store.refreshCurrentLyrics('test', song('wait-1'));

  let settled = false;
  const pending = store.allProviderLyrics().then((states) => {
    settled = true;
    return states;
  });

  // The fast providers are done; the slow one still has the answer in hand.
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);

  slow.settle(lyric('NetEase'));
  const states = await pending;

  expect(states.YTMusic).toMatchObject({ state: 'done' });
  expect(states.NetEase).toMatchObject({ state: 'done' });
  expect(states.LRCLib.state).toBe('error');
  expect(states.LRCLib.data).toBeNull();
  expect(states.YTMusic.data?.lyrics).toBe('words from YTMusic');
});

test('joins a fetch already in flight instead of searching twice', async () => {
  const slow = deferred<LyricResult | null>();
  stubProviders((name) =>
    name === ProviderNames.MusixMatch
      ? slow.promise
      : Promise.resolve(lyric(name)),
  );

  store.refreshCurrentLyrics('test', song('inflight-1'));

  const first = store.allProviderLyrics();
  const second = store.allProviderLyrics();

  expect(searches.MusixMatch).toBe(1);

  slow.settle(lyric('MusixMatch'));
  const [a, b] = await Promise.all([first, second]);

  expect(providerNames.every((name) => searches[name] === 1)).toBe(true);
  expect(a.MusixMatch.state).toBe('done');
  expect(b.MusixMatch.data?.lyrics).toBe('words from MusixMatch');
});

test('serves a cached song without searching again', async () => {
  stubProviders((name) => Promise.resolve(lyric(name)));

  store.refreshCurrentLyrics('test', song('cached-1'));
  await store.allProviderLyrics();

  expect(store.currentLyricsVideoId()).toBe('cached-1');

  const providerBefore = store.lyricsStore.provider;
  const again = await store.allProviderLyrics();

  expect(providerNames.every((name) => searches[name] === 1)).toBe(true);
  expect(again.YTMusic.data?.lyrics).toBe('words from YTMusic');
  // The accessor is read-only for the UI: the chosen provider is untouched.
  expect(store.lyricsStore.provider).toBe(providerBefore);
});

/** A watch-next page whose first queue item is the requested song. */
const watchNextPage = (
  videoId: string,
  title: string,
  byline: string,
  length: string,
) => ({
  contents: {
    singleColumnMusicWatchNextResultsRenderer: {
      tabbedRenderer: {
        watchNextTabbedResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  musicQueueRenderer: {
                    content: {
                      playlistPanelRenderer: {
                        contents: [
                          {
                            playlistPanelVideoRenderer: {
                              videoId,
                              title: { runs: [{ text: title }] },
                              longBylineText: { runs: [{ text: byline }] },
                              lengthText: { runs: [{ text: length }] },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
});

/** Answers `/next` with `page` for the duration of `run`. */
const withWatchNext = async (
  page: unknown,
  run: () => Promise<void>,
): Promise<void> => {
  const app = document.createElement('ytmusic-app');
  (app as unknown as { networkManager: unknown }).networkManager = {
    fetch: () => Promise.resolve(page),
  };
  document.body.append(app);

  try {
    await run();
  } finally {
    app.remove();
  }
};

test('fetches another video from its watch-next page, without touching the store', async () => {
  const requested: Parameters<LyricProvider['search']>[0][] = [];
  stubProviders((name, info) => {
    requested.push(info);
    return Promise.resolve(lyric(name));
  });
  const playing = store.lyricsStore.videoId;

  await withWatchNext(
    watchNextPage(
      'elsewhere-1',
      'Elsewhere',
      'Other Artist • Other Album • 2011',
      '3:21',
    ),
    async () => {
      const states = await store.lyricsForVideo('elsewhere-1');

      expect(states.YTMusic.data?.lyrics).toBe('words from YTMusic');
      expect(requested[0]).toMatchObject({
        videoId: 'elsewhere-1',
        title: 'Elsewhere',
        artist: 'Other Artist',
        album: 'Other Album',
        songDuration: 201,
      });

      // Second ask is answered from the per-video cache.
      await store.lyricsForVideo('elsewhere-1');
      expect(searches.YTMusic).toBe(1);
    },
  );

  // Asking about another song must not move the UI's lyrics.
  expect(store.lyricsStore.videoId).toBe(playing);
});
