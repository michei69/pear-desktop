import { expect, test } from '@playwright/test';

import {
  installDom,
  setUpModuleStubs,
  startStubbing,
  stopStubbing,
  uninstallDom,
} from '../src/plugins/synced-lyrics/tests/harness';

/**
 * The statusbar renderer coalesces its 250 ms sends. `lastPayload` used to be
 * committed before the IPC call, so a rejected send was recorded as delivered
 * and the same line was never retried.
 *
 * The module imports the plugin runtime through `@/utils` -> `@/i18n`, whose
 * `virtual:i18n` resource module only resolves under the test stubs, so the
 * renderer's own type cannot be imported here — a structural one is enough.
 */
interface Renderer {
  start(ctx: never): void;
  stop(ctx: never): void;
}

let renderer: Renderer;

const config = {
  enabled: true,
  includePronunciation: false,
  maxLength: 30,
};

const addLyricLine = (text: string) => {
  document.body.innerHTML = `<div class="synced-line current"><div class="text-lyrics">${text}</div></div>`;
};

const makeContext = (
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
) =>
  ({
    getConfig: () => Promise.resolve(config),
    ipc: { invoke },
  }) as never;

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeAll(async () => {
  installDom();
  startStubbing();
  setUpModuleStubs({});
  ({ renderer } =
    (await import('../src/plugins/statusbar-lyrics/renderer')) as unknown as {
      renderer: Renderer;
    });
  stopStubbing();
});

test.afterEach(() => {
  renderer.stop({} as never);
  document.body.innerHTML = '';
});

test.afterAll(() => {
  uninstallDom();
});

test('retries a rejected send instead of recording it as delivered', async () => {
  addLyricLine('Hello');

  const calls: string[] = [];
  let failures = 1;
  renderer.start(
    makeContext((channel) => {
      calls.push(channel);
      if (failures-- > 0) return Promise.reject(new Error('backend down'));
      return Promise.resolve();
    }),
  );

  await tick(300);
  const afterFailure = calls.length;
  expect(afterFailure).toBeGreaterThan(0);

  // The rejected payload was not committed, so the next timer tick retries it.
  await tick(300);
  expect(calls.length).toBeGreaterThan(afterFailure);
});

test('sends an unchanged line once', async () => {
  addLyricLine('Hello');

  const calls: string[] = [];
  renderer.start(
    makeContext((channel) => {
      calls.push(channel);
      return Promise.resolve();
    }),
  );

  // Two timer ticks, one changed payload.
  await tick(600);

  expect(calls).toEqual(['statusbar-lyrics:set-text']);
});
