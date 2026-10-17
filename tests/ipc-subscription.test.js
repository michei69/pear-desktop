import path from 'node:path';
import process from 'node:process';

import { expect, test, _electron as electron } from '@playwright/test';

process.env.NODE_ENV = 'test';

test('ipcRenderer.subscribe removes only its own listener', async ({}, testInfo) => {
  const app = await electron.launch({
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      XDG_CONFIG_HOME: testInfo.outputPath('config'),
      XDG_CACHE_HOME: testInfo.outputPath('cache'),
      XDG_DATA_HOME: testInfo.outputPath('data'),
    },
    args: [
      path.resolve(import.meta.dirname, '..'),
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${testInfo.outputPath('electron-profile')}`,
    ],
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(
      () => typeof window.ipcRenderer?.subscribe === 'function',
    );
    await page.evaluate(() => {
      window.subscriptionCounts = [0, 0];
      window.disposeFirst = window.ipcRenderer.subscribe(
        'subscription:test',
        () => {
          window.subscriptionCounts[0]++;
        },
      );
      window.disposeSecond = window.ipcRenderer.subscribe(
        'subscription:test',
        () => {
          window.subscriptionCounts[1]++;
        },
      );
    });
    const emit = () =>
      app.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send('subscription:test');
      });
    await emit();
    await expect
      .poll(() => page.evaluate(() => window.subscriptionCounts))
      .toEqual([1, 1]);
    // Disposing twice must stay a no-op, not remove the other listener.
    await page.evaluate(() => {
      window.disposeFirst();
      window.disposeFirst();
    });
    await emit();
    await expect
      .poll(() => page.evaluate(() => window.subscriptionCounts))
      .toEqual([1, 2]);
    await page.evaluate(() => window.disposeSecond());
  } finally {
    await app.close();
  }
});
