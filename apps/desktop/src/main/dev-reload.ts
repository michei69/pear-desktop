// In dev, electron-vite rebuilds the preload bundle in watch mode, and that
// bundle carries the page runtime (the settings UI and every plugin's page
// part). Without a renderer dev server there is nothing for electron-vite to
// reload, so watch the rebuilt file and reload the windows ourselves.

import { watch } from "node:fs";
import { join } from "node:path";

/** How long to wait for the rebuild's writes to settle before reloading. */
const RELOAD_DELAY_MS = 150;

/** Reloads the app's windows whenever electron-vite rewrites the preload bundle. */
export function watchPreloadBundle(reload: () => void) {
  // Only electron-vite's dev server sets this; a packaged app has no watcher.
  if (process.env.NODE_ENV !== "development") return;
  const dir = join(import.meta.dirname, "../preload");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const watcher = watch(dir, (_event, name) => {
      if (String(name) !== "index.cjs") return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.info("[pear] preload rebuilt; reloading the windows");
        reload();
      }, RELOAD_DELAY_MS);
    });
    // A dev watcher must not keep the app alive after a quit.
    watcher.unref();
  } catch (error) {
    console.warn("[pear] can't watch the preload bundle for dev reloads", error);
  }
}
