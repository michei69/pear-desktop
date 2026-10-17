import { expect, test } from '@playwright/test';

import {
  installDom,
  setUpModuleStubs,
  song,
  startStubbing,
  stopStubbing,
  watchNextPage,
  withWatchNext,
} from './harness';

import { ProviderNames, providerNames, type ProviderName } from '../providers';

import type { LyricProvider, LyricResult } from '../types';

/**
 * `allProviderLyrics` is the API server's window into the lyrics store, so these
 * tests drive the real store with stubbed providers: what matters is that it
 * waits for every provider to settle, never refetches, and answers for the song
 * the UI is on.
 *
 * The store's UI half cannot load outside the bundler, so its modules are
 * stubbed for the duration of the import — see `./harness` for the plumbing.
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

setUpModuleStubs({
  load(url, context, nextLoad) {
    const stub = UI_STUBS.find(([suffix]) => url.endsWith(suffix));
    return stub
      ? { format: 'module', source: stub[1], shortCircuit: true }
      : nextLoad(url, context);
  },
});

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
  startStubbing();
  store = await import('../renderer/store');
  const registry = await import('../providers/renderer');
  providers = registry.providers as Record<ProviderName, LyricProvider>;
  stubProviders(() => Promise.resolve(null));
  stopStubbing();
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

test('does not write the store when it already shows the cached song', async () => {
  stubProviders((name) => Promise.resolve(lyric(name)));

  store.refreshCurrentLyrics('test', song('read-only-1'));
  await store.allProviderLyrics();

  const lyricsBefore = store.lyricsStore.lyrics;

  await store.allProviderLyrics();
  await store.allProviderLyrics();

  // Reading must leave the store alone. Every write re-wakes the lyrics UI and
  // the API server's own lyrics watch, which calls this accessor again, so a
  // write here turns a read into an endless re-render of the lyrics list.
  expect(store.lyricsStore.lyrics).toBe(lyricsBefore);
});

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
