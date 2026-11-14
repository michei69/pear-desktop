import { describe, expect, it, vi } from "vitest";
import { isShuffled, shuffleWhenReady } from "../restore.ts";
import { fakeQueue } from "./fake-queue.ts";

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
