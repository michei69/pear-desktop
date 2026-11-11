import { afterEach, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  nativeImage: { createEmpty: () => ({}) },
  Tray: class {
    setTitle() {}
    isDestroyed() {
      return false;
    }
    destroy() {}
  },
}));

const { default: plugin } = await import("../index.ts");

interface PageOptions {
  invoke(command: string, text: string): Promise<void>;
}

/**
 * A page context whose lyric view shows one active line, plus the pieces the
 * test drives: change the line, fire a player tick, or stop the plugin.
 */
function makePage({ invoke }: PageOptions) {
  let text = "Hello";
  const listeners = new Map<string, () => void>();
  const cleanups: (() => void)[] = [];

  const textElement = () => ({ querySelectorAll: () => [], textContent: text });
  const activeLine = () => ({ querySelector: (selector: string) => (selector === ".text" ? textElement() : null) });
  const panel = () => ({
    querySelector: (selector: string) => (selector === "pear-synced-lyrics" ? { shadowRoot: { querySelector: () => activeLine() } } : null),
  });

  const ctx = {
    config: { includePronunciation: false, maxLength: 55 },
    $: () => panel(),
    observe: vi.fn(),
    player: {
      on: (event: string, listener: () => void) => {
        listeners.set(event, listener);
        return () => {};
      },
    },
    host: { invoke: vi.fn(invoke), on: vi.fn(), handle: vi.fn() },
    onConfigChange: vi.fn(),
    onCleanup: (fn: () => void) => cleanups.push(fn),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
    t: (_key: string, fallback?: string) => fallback ?? _key,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  (plugin.page as (ctx: unknown) => void)(ctx);

  return {
    invoke: ctx.host.invoke,
    setText: (next: string) => {
      text = next;
    },
    tick: () => listeners.get("timeUpdate")?.(),
    stop: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

/** Lets the pending invoke callbacks and the retry timer settle. */
const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.restoreAllMocks();
});

test("retries a rejected send instead of recording it as delivered", async () => {
  const sent: string[] = [];
  let failures = 1;
  const page = makePage({
    invoke: (_command, text) => {
      sent.push(text);
      if (failures-- > 0) return Promise.reject(new Error("backend down"));
      return Promise.resolve();
    },
  });

  // The first send failed; no player event fires, only the 250 ms retry.
  await expect.poll(() => sent.length, { timeout: 1000 }).toBeGreaterThan(1);
  expect(sent).toEqual(["Hello", "Hello"]);

  // The delivered line is not sent again by later ticks.
  page.tick();
  page.tick();
  await settle();
  expect(sent).toEqual(["Hello", "Hello"]);
  page.stop();
});

test("sends an unchanged line once", async () => {
  const sent: string[] = [];
  const page = makePage({
    invoke: (_command, text) => {
      sent.push(text);
      return Promise.resolve();
    },
  });

  page.tick();
  page.tick();
  await settle();
  expect(sent).toEqual(["Hello"]);

  // A new line is sent once, however many events report it.
  page.setText("World");
  page.tick();
  page.tick();
  page.tick();
  await settle();
  expect(sent).toEqual(["Hello", "World"]);
  page.stop();
});

test("a newer line wins over the failed one", async () => {
  const sent: string[] = [];
  let failures = 1;
  const page = makePage({
    invoke: (_command, text) => {
      sent.push(text);
      if (failures-- > 0) return Promise.reject(new Error("backend down"));
      return Promise.resolve();
    },
  });

  // Replace the line before the retry: the retry must carry the newer text.
  page.setText("World");
  page.tick();
  await expect.poll(() => sent.length, { timeout: 1000 }).toBeGreaterThan(1);
  expect(sent.at(-1)).toBe("World");
  page.stop();
});
