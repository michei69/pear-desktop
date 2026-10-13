import { expect, test } from '@playwright/test';

import { buildDebugInfo } from '../debug-info';

import type { AppMeta } from '../state';

const meta: AppMeta = {
  name: 'YouTube Music',
  version: '3.12.4',
  build: 'stable 1a2b3c4',
  copyright: '',
  platform: 'linux',
  arch: 'x64',
  osVersion: '6.8.0',
  versions: { electron: '31.0.0', chrome: '126.0.0', node: '20.0.0' },
  cpu: { model: 'CPU', threads: 8 },
  gpu: { features: {}, renderer: 'GPU' },
  memory: { main: 1024, renderers: 2048, gpu: 512 },
};

/** The page scope the debug info reads; `window` is the test's global. */
const page = (data: Record<string, unknown>) => {
  const scope = globalThis as unknown as { window: unknown; ytcfg: unknown };
  scope.window = globalThis;
  scope.ytcfg = { data_: data };
};

test('lists every flag, marking the overridden ones', () => {
  // What the page carries once the installer has applied the override.
  page({
    EXPERIMENT_FLAGS: { flag_b: false, flag_a: 7 },
    INNERTUBE_CLIENT_VERSION: '1.20240701.01.00',
  });

  const lines = buildDebugInfo(meta, [], { flag_a: 7 }).split('\n');

  expect(lines).toContain('Innertube client version: 1.20240701.01.00');
  expect(lines).toContain('Feature flags (2, 1 overridden):');
  expect(lines).toContain('flag_a: 7 (overridden)');
  expect(lines).toContain('flag_b: false');
});

test('carries an override the page never had, and no client version', () => {
  page({ EXPERIMENT_FLAGS: {} });

  const lines = buildDebugInfo(meta, [], { custom_flag: true }).split('\n');

  expect(lines).toContain('Innertube client version: unknown');
  expect(lines).toContain('Feature flags (1, 1 overridden):');
  expect(lines).toContain('custom_flag: true (overridden)');
});

test('leaves the flag block out when there is no page to read', () => {
  page({});

  const lines = buildDebugInfo(meta, [], {}).split('\n');

  expect(lines).toContain('Innertube client version: unknown');
  expect(lines.some((line) => line.startsWith('Feature flags'))).toBe(false);
});
