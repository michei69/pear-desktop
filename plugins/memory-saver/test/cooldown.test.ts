import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import memorySaver from "../index.ts";

const MB = 1024 * 1024;
/** Above the 64 MB default, below a raised threshold. */
const USAGE = { images: { liveSize: 256 * MB } };

type Start = NonNullable<NonNullable<typeof memorySaver.host>["start"]>;
type StartContext = Parameters<Start>[0];

/** The bits of the host context the memory saver uses, over fake timers. */
function stubContext(thresholdMB = 64) {
  const cleanups: (() => void)[] = [];
  const clears: number[] = [];
  let onChange: ((config: Readonly<{ thresholdMB: number }>) => void) | undefined;
  const ctx = {
    config: { thresholdMB },
    onConfigChange(listener: typeof onChange) {
      onChange = listener;
    },
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (timer: ReturnType<typeof setInterval> | undefined) => clearInterval(timer),
    onCleanup: (fn: () => void) => cleanups.push(fn),
    window: {
      isDestroyed: () => false,
      isVisible: () => false,
      webContents: {
        executeJavaScript: async (code: string) => {
          if (code.includes("clearCache")) clears.push(Date.now());
          return code.includes("getResourceUsage") ? USAGE : undefined;
        },
      },
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    t: (_key: string, fallback?: string) => fallback ?? _key,
  };
  return {
    ctx: ctx as unknown as StartContext,
    start: () => memorySaver.host!.start!(ctx as unknown as StartContext),
    stop: () => cleanups.splice(0).forEach((cleanup) => cleanup()),
    clears: () => clears.length,
    setThreshold: (value: number) => onChange?.({ thresholdMB: value }),
  };
}

describe("memory saver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("clears once the hidden window passes the threshold, then honours the cooldown", async () => {
    const app = stubContext();
    app.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.clears()).toBe(1);
    // Still above the threshold one minute later: the ten-minute cooldown holds.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.clears()).toBe(1);
    app.stop();
  });

  test("the clear cooldown does not survive a stop/start cycle", async () => {
    // cba8097d: a clear from the previous enable must not suppress the first
    // tick of a fresh one.
    const first = stubContext();
    first.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(first.clears()).toBe(1);
    first.stop();

    const second = stubContext();
    second.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(second.clears()).toBe(1);
    second.stop();
  });

  test("a threshold change applies live", async () => {
    const app = stubContext();
    app.start();
    // 256 MB usage: a 512 MB threshold is not reached.
    app.setThreshold(512);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.clears()).toBe(0);
    app.setThreshold(128);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.clears()).toBe(1);
    app.stop();
  });
});
