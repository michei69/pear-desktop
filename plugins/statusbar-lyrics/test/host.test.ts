import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { trays } from "./fake-electron.ts";

vi.mock("electron", () => import("./fake-electron.ts"));

const { default: plugin } = await import("../index.ts");

type Click = () => void;
type MenuItem = { label: string; click: Click };

/** The app-emitter event synced-lyrics pushes its active line on. */
const LINE_EVENT = "pear:synced-lyrics-line";

let running: (() => void) | undefined;

function makeHost() {
  running?.();
  const menuItems: MenuItem[] = [];
  const cleanups: (() => void)[] = [];
  const configListeners: (() => void)[] = [];
  const config = { includePronunciation: false, maxLength: 55 };
  const app = new EventEmitter();
  const ctx = {
    config,
    setConfig: (patch: Partial<typeof config>) => {
      Object.assign(config, patch);
      for (const listener of [...configListeners]) listener();
    },
    addMenuItem: (item: MenuItem) => menuItems.push(item),
    onConfigChange: (listener: () => void) => configListeners.push(listener),
    onCleanup: (fn: () => void) => cleanups.push(fn),
    listen: (target: EventEmitter, event: string, listener: (...args: unknown[]) => void) => target.on(event, listener),
    app,
    t: (_key: string, fallback?: string) => fallback ?? _key,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const start = plugin.host!.start as (ctx: unknown) => void;
  start(ctx);
  const stop = () => {
    for (const cleanup of cleanups) cleanup();
  };
  running = stop;
  return {
    menuItems,
    config,
    /** One active-line event, as synced-lyrics' host relays it. */
    line: (text: string, romanized: string | null = null) => app.emit(LINE_EVENT, { text, romanized }),
    clear: () => app.emit(LINE_EVENT, null),
    /** Any payload, for the shape guard. */
    emit: (payload: unknown) => app.emit(LINE_EVENT, payload),
    titles: () => trays.at(-1)?.titles ?? [],
    stop,
  };
}

afterEach(() => {
  running?.();
  running = undefined;
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

test("draws the line synced-lyrics reports, creating the tray with the first one", () => {
  const host = makeHost();
  // Nothing playing: a cleared line must not reserve a menu-bar item.
  expect(trays).toHaveLength(0);
  host.clear();
  expect(trays).toHaveLength(0);

  host.line("  Hello   world  ");
  expect(trays).toHaveLength(1);
  expect(host.titles()).toEqual(["Hello world"]);

  // Clearing keeps the existing item, and a later line reuses it.
  host.clear();
  host.line("Again");
  expect(trays).toHaveLength(1);
  expect(host.titles()).toEqual(["Hello world", "", "Again"]);
  host.stop();
});

test("applies pronunciation and the maximum length on the host side", () => {
  const host = makeHost();
  host.line("こんにちは", "Konnichiwa");
  // Off by default: the original script.
  expect(host.titles()).toEqual(["こんにちは"]);

  // Switching the option on re-renders the line already shown.
  host.menuItems[1]!.click();
  expect(host.titles().at(-1)).toBe("Konnichiwa");
  // A line without romanization falls back to its text.
  host.line("Hello", null);
  expect(host.titles().at(-1)).toBe("Hello");

  host.menuItems[1]!.click();
  expect(host.titles().at(-1)).toBe("Hello");

  // The length applies to the current line too, and 0 hides the title.
  host.config.maxLength = 4;
  host.line("abcdefghij");
  expect(host.titles().at(-1)).toBe("abc…");
  host.config.maxLength = 0;
  // Any config change re-renders the line already shown.
  host.menuItems[1]!.click();
  expect(host.titles().at(-1)).toBe("");
  host.stop();
});

test("does not create a menu-bar item for a zero length", () => {
  const host = makeHost();
  host.config.maxLength = 0;
  host.line("Hello");
  expect(trays).toHaveLength(0);
  host.stop();
});

test("ignores payloads that are not a line", () => {
  const host = makeHost();
  host.emit(42);
  host.emit(null);
  host.emit({ text: 1, romanized: null });
  expect(trays).toHaveLength(0);
  host.stop();
});

test("clears and destroys the tray when the plugin stops", () => {
  const host = makeHost();
  host.line("Hello");
  expect(trays).toHaveLength(1);
  host.stop();
  expect(trays[0]!.titles.at(-1)).toBe("");
  expect(trays[0]!.destroyed).toBe(true);
});

test("has no page part: the menu bar is drawn from the host event", () => {
  expect(plugin.page).toBeUndefined();
  expect(plugin.host!.commands).toBeUndefined();
});
