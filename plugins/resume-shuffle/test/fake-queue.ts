import { vi } from "vitest";
import type { ShuffleAdapter } from "../restore.ts";

export function fakeQueue(options: { items?: number; shuffled?: boolean; button?: boolean } = {}) {
  let items = options.items ?? 0;
  let shuffled = options.shuffled ?? false;
  const listeners = new Set<() => void>();
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
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    adapter,
    shuffle,
    notify,
    fill(count: number) {
      items = count;
      notify();
    },
    setShuffled(value: boolean) {
      shuffled = value;
    },
    get subscriberCount() {
      return listeners.size;
    },
    get subscribed() {
      return listeners.size > 0;
    },
  };
}
