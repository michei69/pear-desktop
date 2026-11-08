import { expect, test } from '@playwright/test';

import memorySaver from '../src/plugins/memory-saver/index';

const windowStub = () => ({
  isDestroyed: () => false,
  isVisible: () => false,
  webContents: {
    executeJavaScript: () => Promise.resolve({}),
    send: () => {},
  },
});

test('the clear cooldown does not survive a stop/start cycle', async () => {
  const backend = memorySaver.backend;
  if (!backend || typeof backend === 'function') throw new Error('no backend');

  type StartContext = Parameters<NonNullable<typeof backend.start>>[0];
  type StopContext = Parameters<NonNullable<typeof backend.stop>>[0];

  const window = windowStub();
  const getConfig = () => Promise.resolve({ enabled: true, thresholdMB: 128 });

  await backend.start?.({ window, getConfig } as unknown as StartContext);
  backend.lastClearAt = Date.now();
  await backend.stop?.({ window } as unknown as StopContext);
  expect(backend.lastClearAt).toBe(0);

  backend.lastClearAt = Date.now();
  await backend.start?.({ window, getConfig } as unknown as StartContext);
  expect(backend.lastClearAt).toBe(0);
  await backend.stop?.({ window } as unknown as StopContext);
});
