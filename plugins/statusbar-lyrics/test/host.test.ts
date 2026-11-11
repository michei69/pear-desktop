import { afterEach, expect, test, vi } from "vitest";

const { trays } = vi.hoisted(() => ({ trays: [] as { titles: string[]; destroyed: boolean }[] }));

vi.mock("electron", () => ({
  nativeImage: { createEmpty: () => ({}) },
  Tray: class {
    titles: string[] = [];
    destroyed = false;
    constructor() {
      trays.push(this);
    }
    setTitle(title: string) {
      this.titles.push(title);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

const { default: plugin } = await import("../index.ts");

type Click = () => void;
type MenuItem = { label: string; click: Click };

function makeHost() {
  const menuItems: MenuItem[] = [];
  const cleanups: (() => void)[] = [];
  const config = { includePronunciation: false, maxLength: 55 };
  const ctx = {
    config,
    setConfig: (patch: Partial<typeof config>) => Object.assign(config, patch),
    addMenuItem: (item: MenuItem) => menuItems.push(item),
    onConfigChange: vi.fn(),
    onCleanup: (fn: () => void) => cleanups.push(fn),
    t: (_key: string, fallback?: string) => fallback ?? _key,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const start = plugin.host!.start as (ctx: unknown) => void;
  start(ctx);
  return {
    menuItems,
    config,
    setTitle: (text: string) => (plugin.host!.commands!.setTitle as (this: unknown, text: string) => void).call(ctx, text),
    stop: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

afterEach(() => {
  trays.length = 0;
});

test("offers the title-length presets and the pronunciation switch in the menu", () => {
  const host = makeHost();
  expect(host.menuItems.map((item) => item.label)).toEqual(["Maximum length", "Include pronunciation"]);

  // The presets cycle through master's choices, wrapping after the last one.
  host.menuItems[0]!.click();
  expect(host.config.maxLength).toBe(70);
  host.config.maxLength = 120;
  host.menuItems[0]!.click();
  expect(host.config.maxLength).toBe(30);

  host.menuItems[1]!.click();
  expect(host.config.includePronunciation).toBe(true);
  host.menuItems[1]!.click();
  expect(host.config.includePronunciation).toBe(false);
  host.stop();
});

test("creates the tray with the first line, not before it", () => {
  const host = makeHost();
  // Nothing playing: an empty title must not reserve a menu-bar item.
  expect(trays).toHaveLength(0);
  host.setTitle("");
  expect(trays).toHaveLength(0);

  host.setTitle("  Hello   world  ");
  expect(trays).toHaveLength(1);
  expect(trays[0]!.titles).toEqual(["Hello world"]);

  // Clearing keeps the existing item, and a later line reuses it.
  host.setTitle("");
  host.setTitle("Again");
  expect(trays).toHaveLength(1);
  expect(trays[0]!.titles).toEqual(["Hello world", "", "Again"]);
  host.stop();
  expect(trays[0]!.titles.at(-1)).toBe("");
  expect(trays[0]!.destroyed).toBe(true);
});
