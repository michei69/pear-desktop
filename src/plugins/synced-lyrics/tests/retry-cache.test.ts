import { expect, test } from '@playwright/test';

import {
  installDom,
  setUpModuleStubs,
  song,
  startStubbing,
  stopStubbing,
  uninstallDom,
} from './harness';

import { type ProviderName, ProviderNames, providerNames } from '../providers';

import type { LyricProvider, LyricResult } from '../types';

/**
 * `retrySearch` writes the store, but the per-video cache is what a later
 * re-activation republishes. If the retry result is not written there too,
 * switching away and back resurrects the pre-retry state.
 *
 * The store's UI half cannot load outside the bundler, so its renderer modules
 * are stubbed for the duration of the import. The store is imported through a
 * query-suffixed URL so this file gets its own module graph in a worker that
 * reuses its registry across test files.
 */
const FRESH = '?retry-cache';
const RENDERER_DIR = '/synced-lyrics/renderer/';
const CONFIG_STUB =
  'data:text/javascript,export const config = () => null; export const setConfig = () => {};';
const INVOKE_STUB =
  'data:text/javascript,export const translateInvoke = async () => ({ lines: [], fromCache: false });';

const FILE_STUBS: [suffix: string, source: string][] = [
  ['/renderer/renderer.tsx', CONFIG_STUB],
  ['/renderer/index.ts', INVOKE_STUB],
];

let importing = false;

const inPrivateGraph = (parentURL: string | undefined) =>
  parentURL?.includes(FRESH) ||
  (importing && Boolean(parentURL?.includes('/synced-lyrics/')));

setUpModuleStubs({
  resolve(specifier, context, nextResolve) {
    if (!inPrivateGraph(context.parentURL)) {
      return nextResolve(specifier, context);
    }

    const resolved = nextResolve(specifier, context);
    const stub = FILE_STUBS.find(([suffix]) => resolved.url.endsWith(suffix));
    if (stub) return { url: stub[1], shortCircuit: true };
    if (resolved.url.includes(RENDERER_DIR)) {
      return { url: `${resolved.url}${FRESH}`, shortCircuit: true };
    }
    return resolved;
  },
  load(url, context, nextLoad) {
    if (url.includes(FRESH)) {
      return { ...nextLoad(url.split('?')[0], context), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

type Store = typeof import('../renderer/store');

let store: Store;
let providers: Record<ProviderName, LyricProvider>;
/** The shared provider registry is mutated by several test files; restore it. */
const originalSearches = new Map<ProviderName, LyricProvider['search']>();

const lyric = (name: string): LyricResult => ({
  title: `Song ${name}`,
  artists: ['Artist'],
  lyrics: `words from ${name}`,
});

const stubProviders = (
  answer: (name: ProviderName) => Promise<LyricResult | null>,
) => {
  for (const name of providerNames) {
    providers[name].search = () => answer(name);
  }
};

const waitFor = async (check: () => boolean, timeoutMs = 2000) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for the store');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test.beforeAll(async () => {
  installDom();
  startStubbing();
  importing = true;
  try {
    store = await import('../renderer/store');
  } finally {
    importing = false;
  }
  const registry = await import('../providers/renderer');
  providers = registry.providers as Record<ProviderName, LyricProvider>;
  for (const name of providerNames) {
    originalSearches.set(name, providers[name].search.bind(providers[name]));
  }
});

test.afterAll(() => {
  for (const [name, search] of originalSearches) {
    providers[name].search = search;
  }
  stopStubbing();
  uninstallDom();
});

test('a retried provider result survives switching away and back', async () => {
  // The song fails everywhere first, so its cache holds an error state.
  stubProviders(() => Promise.reject(new Error('provider down')));
  store.refreshCurrentLyrics('test', song('retry-a'));
  await store.allProviderLyrics();
  expect(store.lyricsStore.lyrics[ProviderNames.YTMusic].state).toBe('error');

  // Refetch succeeds for the active provider.
  stubProviders((name) => Promise.resolve(lyric(name)));
  store.retrySearch(ProviderNames.YTMusic, song('retry-a'));
  await waitFor(
    () => store.lyricsStore.lyrics[ProviderNames.YTMusic].state === 'done',
  );

  // Switch to another song and back: the cache decides what is republished.
  store.refreshCurrentLyrics('test', song('retry-b'));
  await store.allProviderLyrics();
  store.refreshCurrentLyrics('test', song('retry-a'));

  expect(store.lyricsStore.videoId).toBe('retry-a');
  expect(store.lyricsStore.lyrics[ProviderNames.YTMusic].state).toBe('done');
  expect(store.lyricsStore.lyrics[ProviderNames.YTMusic].data?.lyrics).toBe(
    'words from YTMusic',
  );
});
