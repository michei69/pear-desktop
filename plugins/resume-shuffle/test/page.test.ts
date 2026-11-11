import { afterEach, describe, expect, it, vi } from "vitest";
import { selectors } from "@pear/sdk/selectors";
import { shuffleQueue, startResumeShuffle } from "../page.ts";
import { RESTORE_TIMEOUT_MS, type ShuffleAdapter } from "../restore.ts";

interface FakeConfig {
  shuffled: boolean;
}

type StartResumeShuffle = typeof startResumeShuffle;
type Ctx = Parameters<StartResumeShuffle>[0];

/** The parts of the page context and the config the restore reads. */
function fakeContext(options: { shuffled?: boolean; resumeOnStart?: boolean; pathname?: string } = {}) {
  vi.stubGlobal("location", { pathname: options.pathname ?? "/watch" });
  let config: FakeConfig = { shuffled: options.shuffled ?? false };
  const writes: Partial<FakeConfig>[] = [];
  const setConfig = vi.fn((patch: Partial<FakeConfig>) => {
    writes.push(patch);
    config = { ...config, ...patch };
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = {
    get config() {
      return config;
    },
    setConfig,
    core: () => ({ resumeOnStart: options.resumeOnStart ?? true }),
    log,
  };
  return { ctx: ctx as unknown as Ctx, writes, setConfig, log };
}

/** A queue whose item count and shuffle flag the test moves, with every subscriber recorded. */
function fakeAdapter(options: { items?: number; shuffled?: boolean } = {}) {
  let items = options.items ?? 0;
  let shuffled = options.shuffled ?? false;
  const listeners = new Set<() => void>();
  const shuffle = vi.fn(() => {
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
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("startResumeShuffle", () => {
  it("does not save while a restore is pending, then saves once the restore lands", async () => {
    const app = fakeContext({ shuffled: true });
    const queue = fakeAdapter();

    await startResumeShuffle(app.ctx, queue.adapter);
    expect(app.writes).toEqual([]);

    queue.fill(1);
    expect(queue.shuffle).toHaveBeenCalledOnce();
    // The restore applied: the next state change is persisted.
    expect(app.writes).toEqual([]);
    queue.notify();
    expect(app.writes).toEqual([{ shuffled: true }]);
  });

  it("starts saving after the timeout even when the queue never fills", async () => {
    vi.useFakeTimers();
    const app = fakeContext({ shuffled: true });
    const queue = fakeAdapter();

    await startResumeShuffle(app.ctx, queue.adapter);
    vi.advanceTimersByTime(RESTORE_TIMEOUT_MS);

    expect(queue.shuffle).not.toHaveBeenCalled();
    expect(app.writes).toEqual([]);
    queue.setShuffled(true);
    queue.notify();
    expect(app.writes).toEqual([{ shuffled: true }]);
  });

  it("leaves no write and no shuffle behind when cancelled", async () => {
    const app = fakeContext({ shuffled: true });
    const queue = fakeAdapter();

    const stop = await startResumeShuffle(app.ctx, queue.adapter);
    stop();
    queue.fill(1);

    expect(queue.shuffle).not.toHaveBeenCalled();
    expect(app.writes).toEqual([]);
    expect(queue.subscriberCount).toBe(0);
  });

  it("saves immediately when no restore is wanted", async () => {
    const app = fakeContext({ shuffled: false });
    const queue = fakeAdapter();

    await startResumeShuffle(app.ctx, queue.adapter);
    expect(app.writes).toEqual([{ shuffled: false }]);
    expect(queue.subscriberCount).toBe(1);

    queue.setShuffled(true);
    queue.notify();
    expect(app.writes).toEqual([{ shuffled: false }, { shuffled: true }]);
  });

  it("does not restore outside /watch or with resumeOnStart off", async () => {
    for (const options of [{ pathname: "/" }, { resumeOnStart: false }]) {
      const app = fakeContext({ shuffled: true, ...options });
      const queue = fakeAdapter();
      await startResumeShuffle(app.ctx, queue.adapter);

      // Saves from the first moment; the restore itself never starts.
      expect(app.writes).toEqual([{ shuffled: false }]);
      queue.fill(1);
      expect(queue.shuffle).not.toHaveBeenCalled();
      expect(app.writes.at(-1)).toEqual({ shuffled: false });
      expect(queue.subscriberCount).toBe(1);
      vi.unstubAllGlobals();
    }
  });
});

describe("shuffleQueue", () => {
  const stubPage = (elements: Record<string, unknown>) => {
    vi.stubGlobal("document", { querySelector: (selector: string) => elements[selector] ?? null });
  };

  it("uses YTM's own queue action", () => {
    const shuffle = vi.fn(() => Promise.resolve());
    stubPage({ [selectors.queue]: { queue: { shuffle } } });

    expect(shuffleQueue()).toBe(true);
    expect(shuffle).toHaveBeenCalledOnce();
  });

  it("logs a rejected action instead of throwing", async () => {
    const error = new Error("empty queue");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    stubPage({ [selectors.queue]: { queue: { shuffle: () => Promise.reject(error) } } });

    expect(shuffleQueue()).toBe(true);
    for (let index = 0; index < 5; index++) await Promise.resolve();
    expect(consoleError).toHaveBeenCalledWith("[resume-shuffle] shuffle failed", error);
  });

  it("clicks the player bar's shuffle control when the action is missing", () => {
    const click = vi.fn();
    stubPage({ [selectors.queue]: {}, [selectors["player_bar.shuffle"]]: { click } });

    expect(shuffleQueue()).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it("reports when neither exists", () => {
    stubPage({});
    expect(shuffleQueue()).toBe(false);
  });
});
