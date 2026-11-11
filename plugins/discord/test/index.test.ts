import { IDLE, defaultsOf, type HostContextOf } from "@pear/sdk";
import { describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const clients: FakeClient[] = [];
  class FakeClient {
    readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    readonly user = {
      setActivity: vi.fn(() => Promise.resolve()),
      clearActivity: vi.fn(() => Promise.resolve()),
    };
    readonly login = vi.fn(() => Promise.resolve());
    destroyed = false;

    constructor() {
      clients.push(this);
    }

    on(event: string, listener: (...args: unknown[]) => void) {
      const listeners = this.handlers.get(event) ?? new Set();
      listeners.add(listener);
      this.handlers.set(event, listeners);
      return this;
    }

    emit(event: string) {
      for (const listener of this.handlers.get(event) ?? []) listener();
    }

    removeAllListeners() {
      this.handlers.clear();
      return this;
    }

    destroy() {
      this.destroyed = true;
      return Promise.resolve();
    }
  }
  return { FakeClient, clients };
});

vi.mock("@xhayper/discord-rpc", () => ({ Client: mock.FakeClient }));

const { default: discord } = await import("../index.ts");
const { schema } = await import("../schema.ts");

type Ctx = HostContextOf<typeof schema>;

/** Starts the host part with fake Discord clients and no real timers. */
function start() {
  vi.useFakeTimers();
  const items: { label: string; click(): void }[] = [];
  const cleanups: (() => void)[] = [];
  const ctx = {
    config: defaultsOf(schema),
    player: { state: IDLE, on: () => () => {}, details: () => Promise.resolve(null) },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    t: (_key: string, fallback?: string) => fallback ?? _key,
    setStatus: vi.fn(),
    addMenuItem: (item: (typeof items)[number]) => items.push(item),
    onConfigChange: () => {},
    onCleanup: (fn: () => void) => cleanups.push(fn),
  } as unknown as Ctx;
  discord.host!.start!(ctx);
  return { ctx, items, clients: mock.clients, stop: () => cleanups.forEach((fn) => fn()) };
}

describe("the Discord menu items", () => {
  it("Connect rebuilds the connection, Clear activity clears it", () => {
    const run = start();
    expect(run.items.map((item) => item.label)).toEqual(["Connect", "Clear activity"]);
    expect(run.clients).toHaveLength(1);

    // Connect: the first client is still not ready, so it is rebuilt and logs in again.
    run.items[0]!.click();
    expect(run.clients).toHaveLength(2);
    expect(run.clients[0]!.destroyed).toBe(true);

    run.clients[1]!.emit("ready");
    run.items[1]!.click();
    expect(run.clients[1]!.user.clearActivity).toHaveBeenCalled();

    run.stop();
    vi.useRealTimers();
  });
});
