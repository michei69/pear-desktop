// Probes the tests install in the page or the main process, and their globals.

import type { ElectronApplication, Page } from "@playwright/test";

declare global {
  interface Window {
    /** Calls recorded by `recordCalls`, by key: `[method, ...args]`. */
    __pearCalls?: Record<string, unknown[][]>;
    /** Audio elements that started playing (crossfade's second stream). */
    __streams?: HTMLMediaElement[];
    /** Clicks on the album rows' like buttons, intercepted (album-actions). */
    __likes?: number;
  }
  // Main-process probe state.
  var __notifications: { title: string; body: string }[] | undefined;
  /** Uncaught errors in the main process, collected by tests that expect none. */
  var __mainErrors: string[] | undefined;
  var __trayProbe: { images: number[]; menu: string[] } | undefined;
}

/**
 * Records calls to `methods` of the element `selector` finds (they still run),
 * under `key`; returns a reader of what was recorded.
 */
export async function recordCalls(page: Page, selector: string, methods: readonly string[], key: string) {
  await page.evaluate(
    ([selector, methods, key]) => {
      const target = document.querySelector(selector)!;
      const recorded = window.__pearCalls ?? {};
      const calls = recorded[key] ?? [];
      recorded[key] = calls;
      window.__pearCalls = recorded;
      for (const name of methods) {
        const original = Reflect.get(target, name) as (...args: unknown[]) => unknown;
        Reflect.set(target, name, (...args: unknown[]) => {
          calls.push([name, ...args]);
          return original.apply(target, args);
        });
      }
    },
    [selector, methods, key] as const,
  );
  return () => page.evaluate((key) => window.__pearCalls?.[key] ?? [], key);
}

export function recordTray(app: ElectronApplication, { images = false } = {}) {
  return app.evaluate(
    ({ Tray }, { images }) => {
      const probe: NonNullable<typeof globalThis.__trayProbe> = { images: [], menu: [] };
      globalThis.__trayProbe = probe;
      if (images) {
        const setImage = Tray.prototype.setImage;
        Tray.prototype.setImage = function (this: Electron.Tray, image: Electron.NativeImage | string) {
          // The icons differ in their pixels; a checksum tells them apart.
          const bitmap = typeof image === "string" ? Buffer.alloc(0) : image.toBitmap();
          probe.images.push(bitmap.reduce((sum, byte) => (sum + byte) % 1_000_003, 0));
          return setImage.call(this, image);
        };
      }
      const setContextMenu = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (this: Electron.Tray, menu: Electron.Menu | null) {
        probe.menu = menu?.items.map((item) => item.label) ?? [];
        return setContextMenu.call(this, menu);
      };
    },
    { images },
  );
}
