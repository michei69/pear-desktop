import { describe, expect, test, vi } from "vitest";
import { type BatchSource, donePercent, isOutOfView, loadBatches } from "../bulk.ts";

/** The spinner element placeholder: the loader only compares identity. */
const spinner = {} as Element;

describe("loadBatches", () => {
  test("loads the remaining batches until the spinner is gone", async () => {
    let loaded = 10;
    let pending = [5, 5];
    let revealed = 0;
    const source: BatchSource = {
      loader: () => (pending.length > 0 ? spinner : null),
      rows: () => loaded,
      reveal: () => void revealed++,
      wait: async () => {
        loaded += pending.shift()!;
      },
      stopped: () => false,
    };
    const progress = vi.fn();

    await expect(loadBatches(source, { progress })).resolves.toBe("complete");
    expect(loaded).toBe(20);
    expect(revealed).toBe(2);
    expect(progress).toHaveBeenCalledTimes(2);
  });

  test("stalls when a batch does not arrive in time", async () => {
    let waited = 0;
    const source: BatchSource = {
      loader: () => spinner,
      rows: () => 10,
      reveal: () => {},
      wait: async () => void waited++,
      stopped: () => false,
    };
    const progress = vi.fn();

    await expect(loadBatches(source, { timeoutMs: 300, pollMs: 100, progress })).resolves.toBe("stalled");
    expect(waited).toBe(3);
    expect(progress).not.toHaveBeenCalled();
  });

  test("caps a very long list instead of loading forever", async () => {
    let loaded = 0;
    const source: BatchSource = {
      // The spinner never goes away, as on an endless list.
      loader: () => spinner,
      rows: () => loaded,
      reveal: () => {},
      wait: async () => void loaded++,
      stopped: () => false,
    };

    await expect(loadBatches(source, { maxBatches: 3 })).resolves.toBe("capped");
    expect(loaded).toBe(3);
  });

  test("stops as soon as the plugin is stopped, without touching a batch", async () => {
    let stopped = false;
    let loaded = 10;
    const source: BatchSource = {
      loader: () => spinner,
      rows: () => loaded,
      reveal: () => {},
      wait: async () => {
        stopped = true;
        loaded += 1;
      },
      stopped: () => stopped,
    };
    const progress = vi.fn();

    await expect(loadBatches(source, { progress })).resolves.toBe("stopped");
    expect(loaded).toBe(11);
    expect(progress).not.toHaveBeenCalled();
  });
});

describe("isOutOfView", () => {
  const rect = (top: number, bottom: number) => ({ top, bottom });

  test("is false while the spinner is on screen", () => {
    expect(isOutOfView(rect(-10, 20), 800)).toBe(false);
    expect(isOutOfView(rect(0, 800), 800)).toBe(false);
  });

  test("is true above or below the viewport", () => {
    expect(isOutOfView(rect(-100, -1), 800)).toBe(true);
    expect(isOutOfView(rect(801, 900), 800)).toBe(true);
  });
});

describe("donePercent", () => {
  test("is half full until the list has loaded completely", () => {
    expect(donePercent(false, 0, 10)).toBe(50);
    expect(donePercent(false, 10, 10)).toBe(50);
  });

  test("is the share of pressed rows once complete", () => {
    expect(donePercent(true, 0, 10)).toBe(0);
    expect(donePercent(true, 5, 10)).toBe(50);
    expect(donePercent(true, 2, 3)).toBe(67);
    expect(donePercent(true, 0, 0)).toBe(0);
  });
});
