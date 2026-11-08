import { expect, test } from '@playwright/test';

import { createMigrations } from '../src/config/migrations';

type Plain = Record<string, unknown>;

/** The subset of `conf` the migrations use: dotted get/set/delete. */
class FakeStore {
  store: Plain;

  constructor(initial: Plain) {
    this.store = structuredClone(initial);
  }

  get(key: string): unknown {
    let current: unknown = this.store;
    for (const segment of key.split('.')) {
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Plain)[segment];
    }
    return current;
  }

  set(key: string, value: unknown) {
    const segments = key.split('.');
    let current: Plain = this.store;
    for (const segment of segments.slice(0, -1)) {
      if (
        current[segment] === null ||
        typeof current[segment] !== 'object' ||
        Array.isArray(current[segment])
      ) {
        current[segment] = {};
      }
      current = current[segment] as Plain;
    }
    current[segments.at(-1)!] = structuredClone(value);
  }

  delete(key: string) {
    const segments = key.split('.');
    let current: unknown = this.store;
    for (const segment of segments.slice(0, -1)) {
      if (current === null || typeof current !== 'object') return;
      current = (current as Plain)[segment];
    }
    if (current === null || typeof current !== 'object') return;
    delete (current as Plain)[segments.at(-1)!];
  }
}

const runAll = (
  store: FakeStore,
  migrations: ReturnType<typeof createMigrations>,
) => {
  for (const migration of Object.values(migrations)) {
    (migration as unknown as (target: FakeStore) => void)(store);
  }
};

const migrations = createMigrations({
  buildChannel: 'stable',
  channelBeforeDefaults: undefined,
});

test('a 1.x config is converted to the current plugin-config shape', () => {
  const store = new FakeStore({
    options: { ForceShowLikeButtons: true },
    plugins: ['shortcuts', 'discord'],
  });

  runAll(store, migrations);

  // 1.7.0 turns the id list into per-plugin configs...
  expect(Array.isArray(store.get('plugins'))).toBe(false);
  expect(store.get('plugins.downloader.enabled')).toBe(false);
  expect(store.get('plugins.shortcuts.enabled')).toBe(true);

  // ...which is what the later migrations operate on: adblocker -> do-not-track
  // only works if the array -> object conversion ran first.
  expect(store.get('plugins.adblocker')).toBeUndefined();
  expect(store.get('plugins.do-not-track')).toEqual({
    enabled: true,
    cache: true,
    additionalBlockLists: [],
    customEnabled: false,
    blocker: 'Lite',
  });

  expect(store.get('plugins.discord.listenAlong')).toBeUndefined();
  expect(
    store.get(
      'plugins.discord.playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063',
    ),
  ).toBe(true);
  expect(store.get('plugins.video-toggle.mode')).toBe('custom');
  expect(store.get('plugins.precise-volume.globalShortcuts')).toEqual({});
  expect(store.get('plugins.visualizer')).toBeUndefined();

  expect(store.get('options.resumeOnStart')).toBe(true);
  expect(store.get('options.likeButtons')).toBe('force');
  expect(store.get('options.updateChannel')).toBe('stable');
});

test('the array guard is silent for an already-converted config', () => {
  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);

  try {
    const store = new FakeStore({ plugins: { downloader: { enabled: true } } });
    runAll(store, migrations);
    expect(store.get('plugins.downloader.enabled')).toBe(true);
  } finally {
    console.warn = originalWarn;
  }

  expect(warnings).toEqual([]);
});

test('the 3.12.3 rename moves the provider pick to the priority list', () => {
  const store = new FakeStore({
    plugins: {
      'synced-lyrics': { enabled: true, preferredProvider: 'LRCLib' },
    },
  });

  runAll(store, migrations);

  expect(store.get('plugins.synced-lyrics')).toEqual({
    enabled: true,
    providerPriority: ['LRCLib'],
    usePriorityList: true,
  });
});

test('the 3.12.4 cleanup drops only the keys this build no longer has', () => {
  const store = new FakeStore({
    options: { inProcessGpu: true, updateChannel: 'beta', tray: true },
    plugins: {
      'skip-disliked-songs': { enabled: true },
      'compact-sidebar': { enabled: false },
      'custom-theme': { enabled: true },
      'clock': { enabled: true },
    },
  });

  runAll(
    store,
    createMigrations({
      buildChannel: 'stable',
      channelBeforeDefaults: 'beta',
    }),
  );

  expect(store.get('options.inProcessGpu')).toBeUndefined();
  expect(store.get('plugins.skip-disliked-songs')).toBeUndefined();
  expect(store.get('plugins.compact-sidebar')).toBeUndefined();
  expect(store.get('plugins.custom-theme')).toBeUndefined();
  expect(store.get('plugins.clock')).toEqual({ enabled: true });
  expect(store.get('options.tray')).toBe(true);
  // A channel the user picked survives the seed.
  expect(store.get('options.updateChannel')).toBe('beta');
});

test('the single performance mode toggle is split into its parts', () => {
  const store = new FakeStore({ options: { performanceMode: true } });

  runAll(store, migrations);

  expect(store.get('options.performanceMode')).toEqual({
    flags: true,
    css: true,
    animations: true,
    plugins: true,
  });

  // Off for every part when the old toggle was off.
  const off = new FakeStore({ options: { performanceMode: false } });
  runAll(off, migrations);
  expect(off.get('options.performanceMode')).toEqual({
    flags: false,
    css: false,
    animations: false,
    plugins: false,
  });

  // A config that already holds the object (or a fresh one) is left alone.
  const split = new FakeStore({
    options: {
      performanceMode: {
        flags: true,
        css: false,
        animations: true,
        plugins: false,
      },
    },
  });
  runAll(split, migrations);
  expect(split.get('options.performanceMode')).toEqual({
    flags: true,
    css: false,
    animations: true,
    plugins: false,
  });
});

test('re-running the migrations is idempotent', () => {
  const store = new FakeStore({
    plugins: {
      lastfm: {
        enabled: true,
        token: 't',
        session_key: 's',
        api_root: 'root',
        api_key: 'k',
        secret: 'x',
      },
    },
    options: { language: 'de' },
  });

  runAll(store, migrations);
  const first = structuredClone(store.store);
  runAll(store, migrations);

  expect(store.store).toEqual(first);
  expect(store.get('plugins.lastfm')).toBeUndefined();
  expect(store.get('plugins.scrobbler.scrobblers.lastfm')).toMatchObject({
    enabled: true,
    token: 't',
    sessionKey: 's',
  });
  expect(store.get('options.language')).toBe('de');
});
