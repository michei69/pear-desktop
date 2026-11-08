import { expect, test } from '@playwright/test';

import {
  listenStorePush,
  refreshStore,
  setIpc,
  setPluginSliderValue,
  setPluginValue,
  store,
  unlistenStorePush,
  type StoreShape,
} from '../src/plugins/settings-ui/state';
import type { ConfigDelta } from '../src/plugins/settings-ui/paths';

type Ipc = Parameters<typeof setIpc>[0];

/** The parts of the config these tests read, behind the real store type. */
const snapshot = (theme: string): StoreShape =>
  ({
    options: { theme },
    plugins: { fixture: { enabled: true, size: 1 } },
  }) as unknown as StoreShape;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

type Invocation = { channel: string; args: unknown[] };

const fakeIpc = (
  loadStore: () => Promise<StoreShape>,
  listeners = new Map<string, (delta: ConfigDelta) => void>(),
) => {
  const calls: Invocation[] = [];
  const ipc = {
    invoke: async (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args });
      return channel === 'ytmd-sui:load-store' ? loadStore() : true;
    },
    on: (channel: string, handler: (delta: ConfigDelta) => void) => {
      listeners.set(channel, handler);
    },
    off: (channel: string) => {
      listeners.delete(channel);
    },
  };

  setIpc(ipc as unknown as Ipc);
  return { calls, listeners };
};

// Must run first: the store signal is module state, and this path needs it to
// still be null (no snapshot loaded yet).
test('a delta queued during a load is applied by the newest snapshot', async () => {
  const older = deferred<StoreShape>();
  const newer = deferred<StoreShape>();
  let loads = 0;
  const { listeners } = fakeIpc(() =>
    loads++ === 0 ? older.promise : newer.promise,
  );
  listenStorePush();

  const olderLoad = refreshStore();
  // Queued: the first snapshot has not arrived yet.
  listeners.get('ytmd-sui:store-changed')?.([
    { path: 'plugins.fixture.size', value: 7 },
  ]);
  const newerLoad = refreshStore();

  newer.resolve(snapshot('new'));
  await newerLoad;
  older.resolve(snapshot('old'));
  await olderLoad;
  unlistenStorePush();

  expect(store()?.options.theme).toBe('new');
  expect(store()?.plugins.fixture.size).toBe(7);
});

test('an older store load cannot overwrite a newer snapshot', async () => {
  const older = deferred<StoreShape>();
  const newer = deferred<StoreShape>();
  let loads = 0;
  fakeIpc(() => (loads++ === 0 ? older.promise : newer.promise));

  const olderLoad = refreshStore();
  const newerLoad = refreshStore();

  // The newer load resolves first, then the stale one that was read earlier.
  newer.resolve(snapshot('new'));
  await newerLoad;
  older.resolve(snapshot('old'));
  await olderLoad;

  expect(store()?.options.theme).toBe('new');
});

test('a discrete plugin write cancels a pending slider write for the same key', async () => {
  const { calls } = fakeIpc(async () => snapshot('theme'));
  await refreshStore();

  setPluginSliderValue('fixture', 'size', 2);
  setPluginValue('fixture', 'size', 3);

  // Past the slider debounce: the cancelled write must never land.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const writes = calls.filter(({ channel }) => channel === 'peard:set-config');
  expect(writes).toEqual([
    { channel: 'peard:set-config', args: ['fixture', { size: 3 }] },
  ]);
  expect(store()?.plugins.fixture.size).toBe(3);
});
