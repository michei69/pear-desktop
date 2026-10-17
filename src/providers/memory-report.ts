import { app, session, type BrowserWindow } from 'electron';

import { LoggerPrefix } from '@/utils';

const INTERVAL_MS = 30_000;
const MB = (kilobytes: number) => Math.round(kilobytes / 1024);

/** Opt-in: `--memory-report` or `PEAR_MEMORY_REPORT=1`. */
const enabled = () =>
  process.argv.includes('--memory-report') ||
  process.env.PEAR_MEMORY_REPORT === '1';

/**
 * Logs a memory snapshot for every process, the HTTP cache and Blink's resource
 * caches. Diagnostic only; nothing in the app reads it.
 */
export const setupMemoryReport = (win: BrowserWindow) => {
  if (!enabled()) return;

  const report = async () => {
    if (win.isDestroyed()) return;

    const processes = app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      workingSetMB: MB(metric.memory.workingSetSize),
    }));

    let blinkCache: unknown;
    try {
      blinkCache = await win.webContents.executeJavaScript(
        'window.peardPerf?.getResourceUsage()',
      );
    } catch {
      // The renderer may be gone; the rest of the snapshot is still useful.
    }

    const [main, httpCacheBytes] = await Promise.all([
      process.getProcessMemoryInfo(),
      session.defaultSession.getCacheSize(),
    ]);

    console.log(
      `${LoggerPrefix} [memory-report]`,
      JSON.stringify({
        processes,
        mainPrivateMB: MB(main.private),
        httpCacheMB: (httpCacheBytes / 1024 / 1024).toFixed(1),
        blinkCache,
      }),
    );
  };

  const run = () => {
    report().catch((error) =>
      console.error(LoggerPrefix, 'Memory report failed:', error),
    );
  };

  win.webContents.once('did-finish-load', () => setTimeout(run, 5_000));
  const timer = setInterval(run, INTERVAL_MS);
  win.on('closed', () => clearInterval(timer));
};
