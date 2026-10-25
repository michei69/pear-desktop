import path from 'node:path';
import process from 'node:process';

import { expect, test, _electron as electron } from '@playwright/test';

process.env.NODE_ENV = 'test';

test('the standalone settings window mounts its UI', async ({}, testInfo) => {
  const appPath = path.resolve(import.meta.dirname, '..');
  // A container or CI runner has no display server; Chromium's headless mode
  // still builds the window and runs the preload.
  const headless =
    process.platform === 'linux' && !process.env.DISPLAY
      ? ['--headless', '--ozone-platform=headless']
      : [];

  const app = await electron.launch({
    cwd: appPath,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      XDG_CONFIG_HOME: testInfo.outputPath('config'),
      XDG_CACHE_HOME: testInfo.outputPath('cache'),
      XDG_DATA_HOME: testInfo.outputPath('data'),
    },
    args: [
      appPath,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      ...headless,
      `--user-data-dir=${testInfo.outputPath('electron-profile')}`,
    ],
  });

  try {
    const main = await app.firstWindow();

    // The channel exists once the settings-ui backend has started, which can
    // trail the first window by a moment.
    await expect
      .poll(
        () =>
          main.evaluate(() =>
            window.ipcRenderer.invoke('ytmd-sui:open-window').then(
              () => 'opened',
              () => 'pending',
            ),
          ),
        { timeout: 30_000 },
      )
      .toBe('opened');

    await expect
      .poll(() =>
        app.windows().some((page) => page.url().includes('settings.html')),
      )
      .toBe(true);

    const settings = app
      .windows()
      .find((page) => page.url().includes('settings.html'));

    // Regression: the window used to load the built renderer page, which ran
    // the bundle twice and left the body empty.
    await expect
      .poll(
        () =>
          settings.evaluate(
            () =>
              document.body?.innerText.includes('Settings') &&
              Boolean(document.getElementById('ytmd-sui-standalone-root')),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
  } finally {
    await app.close();
  }
});
