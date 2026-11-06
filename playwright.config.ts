import { defineConfig } from '@playwright/test';

const ELECTRON_TESTS = [
  'tests/index.test.js',
  'tests/do-not-track.test.js',
  'tests/ipc-subscription.test.js',
  'tests/settings-window.test.js',
];

export default defineConfig({
  testDir: '.',
  tsconfig: './tsconfig.test.json',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  projects: [
    {
      name: 'unit',
      testIgnore: ELECTRON_TESTS,
    },
    {
      name: 'electron',
      testMatch: ELECTRON_TESTS,
      timeout: 120_000,
    },
  ],
});
