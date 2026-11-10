import { describe, expect, it, vi } from "vitest";
import { isShuffled, shuffleWhenReady, type ShuffleQueue } from "../restore.ts";

/** A queue store whose items the test fills, and whose shuffle is a spy. */
function fakeQueue(options: { items?: unknown[]; shuffled?: boolean } = {}) {
  let state = { queue: { items: options.items ?? [], shuffleEnabled: options.shuffled ?? false } };
  let notify: (() => void) | undefined;
  const queue: ShuffleQueue = {
    store: {
      store: {
        getState: () => state,
        subscribe: (listener) => {
          notify = listener;
          return () => {
            notify = undefined;
          };
        },
      },
    },
    shuffle: vi.fn(async () => {
      state = { queue: { ...state.queue, shuffleEnabled: true } };
      return undefined;
    }),
  };
  return {
    queue,
    shuffle: queue.shuffle as ReturnType<typeof vi.fn>,
    fill(items: unknown[]) {
      state = { queue: { ...state.queue, items } };
      notify?.();
    },
    setShuffled(shuffleEnabled: boolean) {
      state = { queue: { ...state.queue, shuffleEnabled } };
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
    shuffleWhenReady(fake.queue, onDone);

    expect(fake.shuffle).not.toHaveBeenCalled();
    fake.fill([{ id: 1 }]);
    expect(fake.shuffle).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
    // Unsubscribed once the restore landed; a later fill must not shuffle again.
    expect(fake.subscribed).toBe(false);
    fake.fill([{ id: 1 }, { id: 2 }]);
    expect(fake.shuffle).toHaveBeenCalledOnce();
  });

  it("shuffles at once when the queue is already full", () => {
    const fake = fakeQueue({ items: [{ id: 1 }] });
    shuffleWhenReady(fake.queue, vi.fn());
    expect(fake.shuffle).toHaveBeenCalledOnce();
  });

  it("leaves an already-shuffled queue alone", () => {
    const fake = fakeQueue({ items: [{ id: 1 }], shuffled: true });
    const onDone = vi.fn();
    shuffleWhenReady(fake.queue, onDone);
    expect(fake.shuffle).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("gives up after the timeout so a later queue is not shuffled by surprise", () => {
    vi.useFakeTimers();
    try {
      const fake = fakeQueue();
      const onDone = vi.fn();
      shuffleWhenReady(fake.queue, onDone, 5000);
      vi.advanceTimersByTime(5000);
      expect(onDone).toHaveBeenCalledOnce();
      expect(fake.subscribed).toBe(false);
      fake.fill([{ id: 1 }]);
      expect(fake.shuffle).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels cleanly before the queue arrives", () => {
    const fake = fakeQueue();
    const onDone = vi.fn();
    const cancel = shuffleWhenReady(fake.queue, onDone);
    cancel();
    fake.fill([{ id: 1 }]);
    expect(fake.shuffle).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(fake.subscribed).toBe(false);
  });

  it("survives a queue without a shuffle action", () => {
    const fake = fakeQueue({ items: [{ id: 1 }] });
    const queue = { store: fake.queue.store } as ShuffleQueue;
    const onDone = vi.fn();
    expect(() => shuffleWhenReady(queue, onDone)).not.toThrow();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("reads the shuffle flag defensively", () => {
    expect(isShuffled(undefined)).toBe(false);
    expect(isShuffled(fakeQueue({ shuffled: true }).queue)).toBe(true);
  });
});
