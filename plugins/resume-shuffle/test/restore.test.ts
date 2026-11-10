import { describe, expect, it, vi } from "vitest";
import { isShuffled, shuffleWhenReady, type ShuffleAdapter } from "../restore.ts";

/** A queue whose item count and shuffle flag the test moves, and whose shuffle is a spy. */
function fakeQueue(options: { items?: number; shuffled?: boolean; button?: boolean } = {}) {
  let items = options.items ?? 0;
  let shuffled = options.shuffled ?? false;
  let notify: (() => void) | undefined;
  const shuffle = vi.fn(() => {
    // A page without YTM's shuffle button cannot shuffle.
    if (options.button === false) return false;
    shuffled = true;
    return true;
  });
  const adapter: ShuffleAdapter = {
    items: () => items,
    shuffled: () => shuffled,
    shuffle,
    subscribe: (listener) => {
      notify = listener;
      return () => {
        notify = undefined;
      };
    },
  };
  return {
    adapter,
    shuffle,
    fill(count: number) {
      items = count;
      notify?.();
    },
    get subscribed() {
      return notify !== undefined;
    },
  };
}

describe("shuffleWhenReady", () => {
  it("waits for the queue to fill, then shuffles once", () => {
    const fake = fakeQueue();
    const onDone = vi.fn();
    shuffleWhenReady(fake.adapter, onDone);

    expect(fake.shuffle).not.toHaveBeenCalled();
    fake.fill(1);
    expect(fake.shuffle).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
    // Unsubscribed once the restore landed; a later fill must not shuffle again.
    expect(fake.subscribed).toBe(false);
    fake.fill(2);
    expect(fake.shuffle).toHaveBeenCalledOnce();
  });

  it("shuffles at once when the queue is already full", () => {
    const fake = fakeQueue({ items: 1 });
    shuffleWhenReady(fake.adapter, vi.fn());
    expect(fake.shuffle).toHaveBeenCalledOnce();
  });

  it("leaves an already-shuffled queue alone", () => {
    const fake = fakeQueue({ items: 1, shuffled: true });
    const onDone = vi.fn();
    shuffleWhenReady(fake.adapter, onDone);
    expect(fake.shuffle).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("gives up after the timeout so a later queue is not shuffled by surprise", () => {
    vi.useFakeTimers();
    try {
      const fake = fakeQueue();
      const onDone = vi.fn();
      shuffleWhenReady(fake.adapter, onDone, 5000);
      vi.advanceTimersByTime(5000);
      expect(onDone).toHaveBeenCalledOnce();
      expect(fake.subscribed).toBe(false);
      fake.fill(1);
      expect(fake.shuffle).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels cleanly before the queue arrives", () => {
    const fake = fakeQueue();
    const onDone = vi.fn();
    const cancel = shuffleWhenReady(fake.adapter, onDone);
    cancel();
    fake.fill(1);
    expect(fake.shuffle).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(fake.subscribed).toBe(false);
  });

  it("finishes even when the page has no shuffle button", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fake = fakeQueue({ items: 1, button: false });
      const onDone = vi.fn();
      shuffleWhenReady(fake.adapter, onDone);
      expect(onDone).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("reads the shuffle flag through the adapter", () => {
    expect(isShuffled({ shuffled: () => true })).toBe(true);
    expect(isShuffled({ shuffled: () => false })).toBe(false);
  });
});
