import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { initThemes } from '../src/themes/renderer';

import type { ThemeState } from '../src/themes/types';

/** Counters the evaluated theme scripts write into the Node global object. */
const globals = globalThis as unknown as Record<string, number | undefined>;

type IpcRendererStub = {
  invoke: (channel: string) => Promise<Partial<ThemeState>>;
  on: (channel: string, listener: () => void) => void;
};

let state: Partial<ThemeState> = {};

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

const installWindow = () => {
  const window = new Window();
  (window as unknown as { ipcRenderer: IpcRendererStub }).ipcRenderer = {
    invoke: () => Promise.resolve(state),
    on: () => {},
  };
  for (const name of ['window', 'document'] as const) {
    originalGlobals.set(
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    );
    Object.defineProperty(globalThis, name, {
      value: name === 'window' ? window : window.document,
      configurable: true,
    });
  }
};

const theme = (id: string, source: string, hash: string) => ({
  id,
  name: id,
  css: '',
  js: { source, hash },
});

const refresh = async (payload: Partial<ThemeState>) => {
  state = payload;
  await initThemes();
};

const reset = () => refresh({ themes: [], selected: '', overrides: {} });

/** A failing theme logs through console.error; keep the test output clean. */
const withoutErrors = async (fn: () => Promise<void>) => {
  const original = console.error;
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.error = original;
  }
};

/** Leave the Node globals as they were: later test files share this worker. */
const restoreGlobals = () => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  originalGlobals.clear();
};

test.beforeAll(() => {
  installWindow();
});

test.afterAll(() => {
  restoreGlobals();
});

test('a theme script that fails to evaluate is retried on the next refresh', async () => {
  await reset();
  globals.__themeEvalCount = 0;
  const payload: Partial<ThemeState> = {
    themes: [
      theme(
        'eval-fail',
        "globalThis.__themeEvalCount = (globalThis.__themeEvalCount ?? 0) + 1; throw new Error('boom');",
        'h1',
      ),
    ],
    selected: 'eval-fail',
    overrides: {},
  };

  await withoutErrors(async () => {
    await refresh(payload);
    await refresh(payload);
  });

  // A failed evaluation must not be remembered as a successful mount.
  expect(globals.__themeEvalCount).toBe(2);
});

test('a theme whose mount throws is retried instead of being latched as mounted', async () => {
  await reset();
  globals.__themeMountCount = 0;
  const source =
    "module.exports = { mount() { globalThis.__themeMountCount = (globalThis.__themeMountCount ?? 0) + 1; throw new Error('mount boom'); } };";
  const payload = (): Partial<ThemeState> => ({
    themes: [theme('mount-fail', source, 'h1')],
    selected: 'mount-fail',
    overrides: {},
  });

  await withoutErrors(async () => {
    await refresh(payload());
    await refresh(payload());
  });

  expect(globals.__themeMountCount).toBe(2);
});

test('a successful mount is latched and only re-runs when the script changes', async () => {
  await reset();
  globals.__themeMountCount = 0;
  globals.__themeCleanupCount = 0;
  const source =
    'module.exports = { mount() { globalThis.__themeMountCount = (globalThis.__themeMountCount ?? 0) + 1; return () => { globalThis.__themeCleanupCount = (globalThis.__themeCleanupCount ?? 0) + 1; }; } };';

  await refresh({
    themes: [theme('mounted', source, 'h1')],
    selected: 'mounted',
    overrides: {},
  });
  expect(globals.__themeMountCount).toBe(1);

  // Same theme and script hash: a palette-only refresh must not remount.
  await refresh({
    themes: [theme('mounted', source, 'h1')],
    selected: 'mounted',
    overrides: {},
  });
  expect(globals.__themeMountCount).toBe(1);

  // A different script hash tears the old mount down and mounts the new one.
  await refresh({
    themes: [theme('mounted', source, 'h2')],
    selected: 'mounted',
    overrides: {},
  });
  expect(globals.__themeMountCount).toBe(2);
  expect(globals.__themeCleanupCount).toBe(1);
});
