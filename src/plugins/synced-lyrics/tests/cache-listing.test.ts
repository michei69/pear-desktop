import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import type { CacheEntry } from '../translation/types';

/**
 * `listCache` feeds the API's GET of cached translations, so it has to answer
 * with whatever is on disk — including when a file there is junk — and the
 * per-video filter has to match by key prefix, since a `CacheEntry` has no video
 * id of its own.
 *
 * `cache.ts` is main-process code that asks Electron for the user-data path, so
 * `app.getPath` is stubbed to a temp directory for the duration of the import.
 * The module is imported dynamically and with a query suffix: static imports
 * would resolve before the hook below is registered, and a Playwright worker
 * reuses its module registry across test files.
 */
const CACHE_DIR = path.join(tmpdir(), 'tfl-cache-listing');
/**
 * Where entries actually live: `cache.ts` appends its own directory name to the
 * Electron user-data path, so a raw file dropped in `CACHE_DIR` is never read
 * and a "junk file" test would pass without testing anything.
 */
const CACHE_SUBDIR = path.join(CACHE_DIR, 'synced-lyrics-translations');
const ELECTRON_STUB =
  'data:text/javascript,export const app = { getPath: () => globalThis.__cacheDir };';

let stubbing = true;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbing && specifier === 'electron') {
      return { url: ELECTRON_STUB, shortCircuit: true };
    }
    if (stubbing && specifier.includes('?cache-listing')) {
      const resolved = nextResolve(specifier.split('?')[0], context);
      return { url: `${resolved.url}?cache-listing`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (stubbing && url.includes('?cache-listing')) {
      return { ...nextLoad(url.split('?')[0], context), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

type Cache = typeof import('../translation/cache');

/**
 * Not a literal, so TypeScript does not try (and fail) to resolve the query
 * suffix; the cast is what the loader will actually hand back.
 */
const CACHE_SPECIFIER = '../translation/cache?cache-listing';

let cache: Cache;

const entry = (
  videoId: string,
  language: string,
  lines: string[],
): CacheEntry => {
  const sourceLines = ['na na', 'la la'];
  const sourceHash = cache.buildSourceHash(sourceLines);
  return {
    key: cache.buildCacheKey({
      videoId,
      targetLanguage: language,
      provider: 'gemini',
      model: 'gemini-test',
      sourceHash,
    }),
    strategyVersion: '1',
    title: `Song ${videoId}`,
    artists: ['Artist'],
    targetLanguage: language,
    provider: 'gemini',
    model: 'gemini-test',
    sourceHash,
    sourceLines,
    createdAt: 1,
    lines,
  };
};

const setCacheDir = (dir: string) => {
  (globalThis as unknown as Record<string, unknown>).__cacheDir = dir;
};

test.beforeAll(async () => {
  setCacheDir(CACHE_DIR);
  await rm(CACHE_DIR, { recursive: true, force: true });
  await mkdtemp(path.join(tmpdir(), 'tfl-cache-listing-'));
  cache = (await import(CACHE_SPECIFIER)) as Cache;
  stubbing = false;
});

test.afterAll(async () => {
  await rm(CACHE_DIR, { recursive: true, force: true });
});

test('lists every cached entry, skipping the corrupt file', async () => {
  await cache.writeCache(entry('list-1', 'fr', ['un', 'deux']));
  await cache.writeCache(entry('list-1', 'de', ['eins', 'zwei']));
  await cache.writeCache(entry('list-2', 'fr', ['un', 'deux']));
  await writeFile(
    path.join(CACHE_SUBDIR, 'corrupt.json'),
    '{ not json',
    'utf-8',
  );
  await writeFile(
    path.join(CACHE_SUBDIR, 'wrong-shape.json'),
    JSON.stringify({ nope: true }),
    'utf-8',
  );

  const listed = await cache.listCache();

  expect(listed.map((item) => item.key).sort()).toEqual(
    [
      entry('list-1', 'fr', ['un', 'deux']).key,
      entry('list-1', 'de', ['eins', 'zwei']).key,
      entry('list-2', 'fr', ['un', 'deux']).key,
    ].sort(),
  );
  expect(
    listed.find((item) => item.key === entry('list-1', 'fr', []).key),
  ).toMatchObject({ targetLanguage: 'fr', lines: ['un', 'deux'] });
});

test('lists nothing when the cache directory does not exist', async () => {
  const missing = path.join(tmpdir(), 'tfl-cache-missing');
  setCacheDir(missing);
  await rm(missing, { recursive: true, force: true });

  expect(await cache.listCache()).toEqual([]);

  setCacheDir(CACHE_DIR);
});

test('skips an entry whose key is fine but whose body is not', async () => {
  // A truncated or hand-edited file can carry a valid key and still not match
  // what the listing promises, which would make the API serve a body its own
  // response schema does not describe.
  const good = entry('shape-1', 'fr', ['un']);
  const malformed = {
    'lines-not-an-array': { ...good, lines: 'un' },
    'lines-not-strings': { ...good, lines: [1, 2] },
    'lines-missing': { ...good, lines: undefined },
    'artists-not-an-array': { ...good, artists: 'Artist' },
    'language-missing': { ...good, targetLanguage: undefined },
  };
  await cache.writeCache(good);
  for (const [name, body] of Object.entries(malformed)) {
    await writeFile(
      path.join(CACHE_SUBDIR, `${name}.json`),
      JSON.stringify(body),
      'utf-8',
    );
  }

  // Scoped to this song, so the assertion does not depend on what earlier tests
  // left in the shared cache directory.
  const listed = await cache.cacheEntriesForVideo('shape-1');

  expect(listed).toHaveLength(1);
  expect(listed[0]?.lines).toEqual(['un']);
});

test('filters entries by video, and only that video', async () => {
  // `list-1` must not swallow `list-10`: the filter is a key prefix, not a
  // substring search.
  await cache.writeCache(entry('list-10', 'fr', ['dix']));

  const forOne = await cache.cacheEntriesForVideo('list-1');

  expect(forOne).toHaveLength(2);
  expect(forOne.map((item) => item.targetLanguage).sort()).toEqual([
    'de',
    'fr',
  ]);
  expect(forOne.every((item) => item.key.includes('::list-1::'))).toBe(true);

  const forTen = await cache.cacheEntriesForVideo('list-10');
  expect(forTen).toHaveLength(1);
  expect(forTen[0].lines).toEqual(['dix']);

  expect(await cache.cacheEntriesForVideo('nobody')).toEqual([]);
});

test('reads back a cache key built the same way the main process builds it', async () => {
  const written = entry('round-trip', 'ja', ['いち', 'に']);
  await cache.writeCache(written);

  expect(await cache.readCache(written.key)).toEqual(written);
});
