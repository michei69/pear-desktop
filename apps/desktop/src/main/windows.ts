import { join } from "node:path";
import { type BrowserWindow, nativeImage, type WebPreferences } from "electron";
import { pearIconBitmap, ytmIconBitmap } from "@pear/sdk/icon";

const ICON_SIZE = 256;

/** The window, unless it is gone (closed windows throw on most calls). */
export function alive(window: BrowserWindow | null | undefined) {
  return window && !window.isDestroyed() ? window : undefined;
}

/** Shows the window and brings it to the front, restoring it if minimized. */
export function focusWindow(window: BrowserWindow) {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** The icon of the app's windows: pear's, or Music's with `appearance.useYtmIcons`. */
export function appIcon(useYtmIcons: boolean) {
  const pixels = useYtmIcons ? ytmIconBitmap(ICON_SIZE) : pearIconBitmap(ICON_SIZE);
  return nativeImage.createFromBitmap(pixels, { width: ICON_SIZE, height: ICON_SIZE });
}

/** What every app window runs with: the preload bridge in an isolated, sandboxed renderer. */
export function secureWebPreferences(): WebPreferences {
  return {
    preload: join(import.meta.dirname, "../preload/index.cjs"),
    contextIsolation: true,
    sandbox: true,
    // The session-wide spellchecker is off; the window-level flag matches pear-desktop.
    spellcheck: false,
  };
}
