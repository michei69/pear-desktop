import { expect, test } from '@playwright/test';

import { installFeatureFlags, liveFlags } from '../injectors/flags';

/** A stand-in for the page, whose `ytcfg` is built from an EXPERIMENT_FLAGS map. */
const pageConfig = (flags: Record<string, unknown>) => {
  const data: Record<string, unknown> = { EXPERIMENT_FLAGS: { ...flags } };
  return {
    data_: data,
    set: (key: string, value?: unknown) => {
      data[key] = value;
    },
  };
};

/** The page scope the installer patches; `window` is the test's global. */
const page = () => {
  const scope = globalThis as unknown as { window: unknown; ytcfg: unknown };
  scope.window = globalThis;
  return scope;
};

/**
 * The installer as the preload injects it: stringified into the page, so this
 * also covers it staying self-contained.
 */
const inject = (overrides: Record<string, unknown>) => {
  // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
  new Function(
    `(${installFeatureFlags.toString()})(${JSON.stringify(overrides)});`,
  )();
};

test('applies the saved overrides as soon as the page builds its config', () => {
  const scope = page();
  inject({ flag_a: true, flag_b: 7 });

  scope.ytcfg = pageConfig({ flag_a: false, flag_b: 1, flag_c: 'own' });

  expect(liveFlags()).toEqual({ flag_a: true, flag_b: 7, flag_c: 'own' });
});

test('keeps the overrides when the page sets EXPERIMENT_FLAGS again', () => {
  const scope = page();
  inject({ flag_a: true });

  scope.ytcfg = pageConfig({ flag_a: false });
  // What the page does when it refreshes its config from the server.
  (scope.ytcfg as { set: (k: string, v?: unknown) => void }).set(
    'EXPERIMENT_FLAGS',
    { flag_a: false, flag_b: 2 },
  );

  expect(liveFlags()).toEqual({ flag_a: true, flag_b: 2 });
});

test('adopts a config the page built before the patch', () => {
  const scope = page();
  scope.ytcfg = pageConfig({ flag_a: false });

  inject({ flag_a: true });

  expect(liveFlags().flag_a).toBe(true);
});

test('undo puts the page value back when the flags arrive after the patch', () => {
  const scope = page();
  inject({ flag_a: true });

  // YTM builds its config first and fills the flags in afterwards, so the override
  // lands on an empty map. The page's own value has to be picked up from the payload
  // that arrives later, or Undo has nothing to put back and drops the flag instead.
  const cfg = pageConfig({});
  scope.ytcfg = cfg;
  cfg.set('EXPERIMENT_FLAGS', { flag_a: false, flag_b: 2 });

  expect(liveFlags()).toEqual({ flag_a: true, flag_b: 2 });

  window.__peardFeatureFlags!.remove('flag_a');

  expect(liveFlags()).toEqual({ flag_a: false, flag_b: 2 });
});

test('undo keeps a flag whose page value matches the override', () => {
  const scope = page();
  inject({});
  scope.ytcfg = pageConfig({ flag_a: true });

  // Setting a flag to what it already was is still an override, and Undo must
  // restore the page's value rather than treat the match as "no default".
  window.__peardFeatureFlags!.set('flag_a', true);
  window.__peardFeatureFlags!.remove('flag_a');

  expect(liveFlags()).toEqual({ flag_a: true });
});

test('changes and removes a flag live', () => {
  const scope = page();
  inject({});
  scope.ytcfg = pageConfig({ flag_a: false, flag_b: 2 });

  window.__peardFeatureFlags!.set('flag_b', 9);
  expect(liveFlags()).toEqual({ flag_a: false, flag_b: 9 });

  // Removing puts the page's own value back, and drops a flag it never had.
  window.__peardFeatureFlags!.remove('flag_b');
  window.__peardFeatureFlags!.set('flag_c', 'x');
  window.__peardFeatureFlags!.remove('flag_c');

  expect(liveFlags()).toEqual({ flag_a: false, flag_b: 2 });
});

test('adds a flag the page never had, and takes it away again', () => {
  const scope = page();
  inject({});
  scope.ytcfg = pageConfig({ flag_a: false });

  // A flag the user typed in themselves: the page has no value to restore, so
  // removing the override removes the flag.
  window.__peardFeatureFlags!.set('custom_flag', true);
  expect(liveFlags()).toEqual({ flag_a: false, custom_flag: true });

  window.__peardFeatureFlags!.remove('custom_flag');
  expect(liveFlags()).toEqual({ flag_a: false });
});

test('reads no flags when the page has no config', () => {
  const scope = page();
  scope.ytcfg = undefined;

  expect(liveFlags()).toEqual({});
});
