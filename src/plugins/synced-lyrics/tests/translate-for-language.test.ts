import { registerHooks } from 'node:module';

import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { providerNames } from '../providers';

import type { TranslateInvokeArgs } from '../renderer/ipc-bridge';
import type {
  LyricProvider,
  LyricResult,
  SyncedLyricsPluginConfig,
} from '../types';
import type { SongInfo } from '@/providers/song-info';

/**
 * `translateForLanguage` is the API's way to translate a song into a language of
 * its choosing. These tests drive the real translation store with a stubbed
 * config and IPC, and check the thing that matters: the app's own translation
 * comes out the other side untouched, and a failure is data rather than a throw.
 *
 * The store's UI half cannot load outside the bundler — `renderer.tsx` and the
 * plugin entry pull in `virtual:` modules and DOM-only deps — so both are stubbed
 * for the duration of the import. A Playwright worker also reuses its module
 * registry across test files, so the two modules under test are imported through
 * a query-suffixed URL: that gives this file its own copy of the graph wired to
 * these stubs, whichever test file ran first.
 */
const FRESH = '?translate-for-language';
const RENDERER_DIR = '/synced-lyrics/renderer/';
const VIRTUAL_STUB =
  'data:text/javascript,export const languageResources = {};';
const CONFIG_STUB =
  'data:text/javascript,export const config = () => globalThis.__tflConfig ?? null; export const setConfig = () => {};';
const INVOKE_STUB =
  'data:text/javascript,export const translateInvoke = (args) => { globalThis.__tflCalls.push(args); return globalThis.__tflInvoke(args); };';

/** Renderer modules that must never load: the UI half of the plugin. */
const FILE_STUBS: [suffix: string, source: string][] = [
  ['/renderer/renderer.tsx', CONFIG_STUB],
  ['/renderer/index.ts', INVOKE_STUB],
];

/** Off once this file is done, so other test files load normally. */
let stubbing = true;

/** True only while the two entry imports below are resolving their graph. */
let importing = false;

/**
 * The translation store imports the lyrics store lazily (they import each
 * other), so its graph keeps growing after the entry import — a module already
 * in the private graph stays in it.
 */
const inPrivateGraph = (parentURL: string | undefined) => {
  if (parentURL?.includes(FRESH)) return true;
  return importing && Boolean(parentURL?.includes('/synced-lyrics/'));
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!stubbing) return nextResolve(specifier, context);

    if (specifier.startsWith('virtual:')) {
      return { url: VIRTUAL_STUB, shortCircuit: true };
    }

    if (inPrivateGraph(context.parentURL)) {
      const resolved = nextResolve(specifier, context);
      const stub = FILE_STUBS.find(([suffix]) => resolved.url.endsWith(suffix));
      if (stub) return { url: stub[1], shortCircuit: true };
      if (resolved.url.includes(RENDERER_DIR)) {
        return { url: `${resolved.url}${FRESH}`, shortCircuit: true };
      }
      return resolved;
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (stubbing && url.includes(FRESH)) {
      return { ...nextLoad(url.split('?')[0], context), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

type InvokeResult = { lines: string[]; fromCache: boolean; error?: string };

interface Harness {
  __tflConfig?: SyncedLyricsPluginConfig;
  __tflInvoke: (args: TranslateInvokeArgs) => Promise<InvokeResult>;
  __tflCalls: TranslateInvokeArgs[];
}

const harness = globalThis as unknown as Harness;

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
type Translation = typeof import('../renderer/translation-store');

let store: Store;
let translation: Translation;
let providers: Record<string, LyricProvider>;

/** Short enough that language detection gives up, so nothing skips the call. */
const SOURCE_LINES = ['na na', 'la la', 'oh oh'];
const TRANSLATED_LINES = ['blah blah', 'bleh bleh', 'bloh bloh'];
const ENGLISH_LINES = [
  'I keep on dreaming of the days when we were young and free',
  'We ran through fields of gold and never once looked back at time',
];

const song = (videoId: string): SongInfo =>
  ({
    videoId,
    title: `Song ${videoId}`,
    artist: 'Artist',
    songDuration: 100,
  }) as unknown as SongInfo;

const lyric = (texts: string[]): LyricResult => ({
  title: 'Song',
  artists: ['Artist'],
  lines: texts.map((text, index) => ({
    time: `0:0${index}`,
    timeInMs: index * 1000,
    duration: 1000,
    status: 'current' as const,
    text,
  })),
});

const config = (enabled: boolean): SyncedLyricsPluginConfig =>
  ({
    translation: {
      enabled,
      provider: 'gemini',
      targetLanguage: 'en',
      providers: {
        'openai-compatible': { baseUrl: '', apiKey: '', model: '' },
        'anthropic': { apiKey: '', model: '' },
        'gemini': { apiKey: 'test-key', model: 'gemini-test' },
        'local-cli': { engine: 'claude', timeoutSeconds: 120 },
        'google-translate': { host: 'translate.google.com' },
      },
    },
  }) as unknown as SyncedLyricsPluginConfig;

/** The app's translation state, as the UI would see it. */
const uiTranslation = () => ({
  current: translation.translationStore.current,
  videoId: translation.translationStore.videoId,
  key: translation.translationStore.key,
});

const stubProviders = (answer: () => Promise<LyricResult | null>) => {
  for (const name of providerNames) {
    providers[name].search = () => answer();
  }
};

/** Put the store on `videoId` with `lines`, or with no lyrics at all. */
const setSong = async (videoId: string, lines: string[] | null) => {
  stubProviders(() => Promise.resolve(lines ? lyric(lines) : null));
  store.refreshCurrentLyrics('test', song(videoId));
  await store.allProviderLyrics();
  // Let the translation effect that follows the lyrics settle before arming.
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test.beforeAll(async () => {
  installDom();
  importing = true;
  try {
    store = await import('../renderer/store');
    translation = await import('../renderer/translation-store');
  } finally {
    importing = false;
  }
  const registry = await import('../providers/renderer');
  providers = registry.providers as Record<string, LyricProvider>;
});

test.afterAll(() => {
  stubbing = false;
});

test.beforeEach(() => {
  harness.__tflCalls = [];
  harness.__tflConfig = config(false);
  harness.__tflInvoke = () =>
    Promise.resolve({ lines: TRANSLATED_LINES, fromCache: false });
});

test('translates into the requested language', async () => {
  await setSong('tfl-happy', SOURCE_LINES);
  harness.__tflConfig = config(true);

  const result = await translation.translateForLanguage('fr');

  expect(result).toEqual({
    provider: 'gemini',
    language: 'fr',
    lines: TRANSLATED_LINES,
    fromCache: false,
  });
  // A success carries no reason at all — the discriminant is for failures only.
  expect(result.reason).toBeUndefined();
  expect(Object.keys(result)).not.toContain('reason');
  expect(harness.__tflCalls).toHaveLength(1);
  expect(harness.__tflCalls[0].videoId).toBe('tfl-happy');
  expect(harness.__tflCalls[0].provider).toBe('gemini');
  expect(harness.__tflCalls[0].request).toEqual({
    title: 'Song',
    artists: ['Artist'],
    targetLanguage: 'fr',
    resolvedTargetLanguage: 'fr',
    lines: SOURCE_LINES,
  });
  expect(harness.__tflCalls[0].settings).toEqual({
    apiKey: 'test-key',
    model: 'gemini-test',
  });
});

test("leaves the app's own translation exactly as it was", async () => {
  await setSong('tfl-untouched', SOURCE_LINES);
  harness.__tflConfig = config(true);

  // What the app is showing right now, through its own path.
  await translation.fetchTranslation(
    'tfl-untouched',
    'Song',
    ['Artist'],
    SOURCE_LINES,
  );
  const before = uiTranslation();
  const providerBefore = store.lyricsStore.provider;
  expect(before.current?.state).toBe('done');

  harness.__tflCalls = [];
  harness.__tflInvoke = () =>
    Promise.resolve({ lines: ['eins', 'zwei', 'drei'], fromCache: true });
  const result = await translation.translateForLanguage('de');

  expect(result.lines).toEqual(['eins', 'zwei', 'drei']);
  expect(result.fromCache).toBe(true);
  expect(harness.__tflCalls).toHaveLength(1);
  expect(harness.__tflCalls[0].request.resolvedTargetLanguage).toBe('de');
  // Same object, same video, same key: nothing moved underneath the UI.
  expect(translation.translationStore.current).toBe(before.current);
  expect(uiTranslation()).toEqual(before);
  expect(store.lyricsStore.provider).toBe(providerBefore);
  expect(store.currentLyricsVideoId()).toBe('tfl-untouched');
});

test('returns a provider failure as data', async () => {
  await setSong('tfl-error', SOURCE_LINES);
  harness.__tflConfig = config(true);
  harness.__tflInvoke = () =>
    Promise.resolve({
      lines: [],
      fromCache: false,
      error: 'provider exploded',
    });

  const result = await translation.translateForLanguage('ja');

  expect(result).toEqual({
    provider: 'gemini',
    language: 'ja',
    lines: [],
    error: 'provider exploded',
    reason: 'provider-error',
  });
});

test('returns an empty provider result as a provider error', async () => {
  await setSong('tfl-empty-result', SOURCE_LINES);
  harness.__tflConfig = config(true);
  harness.__tflInvoke = () => Promise.resolve({ lines: [], fromCache: false });

  const result = await translation.translateForLanguage('ja');

  expect(result).toEqual({
    provider: 'gemini',
    language: 'ja',
    lines: [],
    error: 'Translation provider returned no lines',
    reason: 'provider-error',
  });
});

test('returns a thrown provider failure as data', async () => {
  await setSong('tfl-throw', SOURCE_LINES);
  harness.__tflConfig = config(true);
  harness.__tflInvoke = () => Promise.reject(new Error('socket closed'));

  const result = await translation.translateForLanguage('ko');

  expect(result.lines).toEqual([]);
  expect(result.error).toBe('socket closed');
  expect(result.reason).toBe('provider-error');
});

test('refuses when translation is disabled', async () => {
  await setSong('tfl-disabled', SOURCE_LINES);

  const result = await translation.translateForLanguage('fr');

  expect(result.lines).toEqual([]);
  expect(result.error).toMatch(/disabled/);
  expect(result.reason).toBe('disabled');
  expect(harness.__tflCalls).toHaveLength(0);
});

test('refuses when the song has no lyrics', async () => {
  await setSong('tfl-empty', null);
  harness.__tflConfig = config(true);

  const result = await translation.translateForLanguage('fr');

  expect(result.lines).toEqual([]);
  expect(result.error).toMatch(/no lyrics/);
  expect(result.reason).toBe('no-lyrics');
  expect(harness.__tflCalls).toHaveLength(0);
});

test('refuses when the lyrics are already in the requested language', async () => {
  await setSong('tfl-same', ENGLISH_LINES);
  harness.__tflConfig = config(true);

  const result = await translation.translateForLanguage('en');

  expect(result.lines).toEqual([]);
  expect(result.error).toMatch(/already in en/);
  expect(result.reason).toBe('same-language');
  expect(harness.__tflCalls).toHaveLength(0);
});
