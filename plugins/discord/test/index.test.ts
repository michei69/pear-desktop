import { IDLE, defaultsOf, type HostContextOf } from "@pear/sdk";
import { describe, expect, it, vi } from "vitest";
import { FakeClient } from "./harness.ts";

vi.mock("@xhayper/discord-rpc", async () => ({ Client: (await import("./harness.ts")).FakeClient }));

const { default: discord } = await import("../index.ts");
const { schema } = await import("../schema.ts");

type Ctx = HostContextOf<typeof schema>;

/** Starts the host part with fake Discord clients and no real timers. */
function start() {
  vi.useFakeTimers();
  FakeClient.instances.length = 0;
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
  return { ctx, items, clients: FakeClient.instances, stop: () => cleanups.forEach((fn) => fn()) };
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
