import { beforeEach, describe, expect, test, vi } from "vitest";
import plugin from "../index.ts";

interface ProxyOptions {
  mode: string;
  proxyRules?: string;
  proxyBypassRules?: string;
}

const mocks = vi.hoisted(() => {
  const proxySession = (name: string) => ({
    name,
    setProxy: vi.fn(async (_options: ProxyOptions) => {}),
    closeAllConnections: vi.fn(async () => {}),
  });
  const defaultSession = proxySession("default");
  const lastfmSession = proxySession("lastfm");
  return {
    defaultSession,
    lastfmSession,
    fromPartition: vi.fn((_partition: string): typeof lastfmSession => lastfmSession),
  };
});

vi.mock("electron", () => ({ session: { fromPartition: mocks.fromPartition } }));

const { defaultSession, lastfmSession } = mocks;

beforeEach(() => vi.clearAllMocks());

function makeContext(config: Record<string, unknown> = {}) {
  const cleanups: (() => void)[] = [];
  const menuItems: { label: string; click(): void }[] = [];
  const handlers: unknown[] = [];
  const openSettings = vi.fn();
  const ctx = {
    config: {
      url: "socks5://alice:secret@127.0.0.1:9",
      username: "",
      password: "",
      bypass: "<local>",
      hostname: "127.0.0.1",
      port: 0,
      ...config,
    },
    session: defaultSession,
    webRequest: { onBeforeRequest: (handler: unknown) => void handlers.push(handler) },
    onCleanup: (fn: () => void) => void cleanups.push(fn),
    addMenuItem: (item: { label: string; click(): void }) => void menuItems.push(item),
    openSettings,
    t: (_key: string, fallback?: string) => fallback ?? _key,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    listen: vi.fn(),
    app: { on: vi.fn(), removeListener: vi.fn() },
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  return { ctx, cleanups, menuItems, openSettings, handlers };
}

describe("Proxy plugin", () => {
  test("proxies the default session and the Last.fm sign-in partition", async () => {
    const { ctx, cleanups } = makeContext();
    await plugin.host!.start!(ctx as never);

    expect(mocks.fromPartition).toHaveBeenCalledWith("persist:pear-lastfm");
    const [defaultCall] = defaultSession.setProxy.mock.calls;
    const [lastfmCall] = lastfmSession.setProxy.mock.calls;
    expect(defaultCall![0]).toMatchObject({ mode: "fixed_servers", proxyBypassRules: "<local>" });
    expect(defaultCall![0].proxyRules).toMatch(/^socks5:\/\/127\.0\.0\.1:\d+$/);
    // The adapter's real port, also when the config asks for a free one.
    expect(lastfmCall![0]).toEqual(defaultCall![0]);
    expect(defaultSession.closeAllConnections).toHaveBeenCalledOnce();
    expect(lastfmSession.closeAllConnections).toHaveBeenCalledOnce();

    for (const cleanup of cleanups) cleanup();
    await vi.waitFor(() => {
      expect(defaultSession.setProxy).toHaveBeenLastCalledWith({ mode: "system" });
      expect(lastfmSession.setProxy).toHaveBeenLastCalledWith({ mode: "system" });
    });
  });

  test("holds requests only until the proxy applies", async () => {
    const { ctx, handlers } = makeContext();
    await plugin.host!.start!(ctx as never);
    // Registered while starting, removed in its finally.
    expect(handlers).toHaveLength(2);
    expect(handlers[1]).toBeNull();
    const handler = handlers[0] as (details: unknown, callback: (response: unknown) => void) => void;
    const response = await new Promise((resolve) => handler({}, resolve));
    expect(response).toEqual({});
  });

  test("offers the adapter address and port in the app menu", async () => {
    const { ctx, menuItems, openSettings } = makeContext();
    await plugin.host!.start!(ctx as never);
    expect(menuItems.map((item) => item.label)).toEqual(["Adapter address", "Adapter port"]);
    for (const item of menuItems) item.click();
    expect(openSettings).toHaveBeenCalledTimes(2);
  });

  test("reports an unparsable address instead of starting", async () => {
    const { ctx } = makeContext({ url: "ftp://proxy:21" });
    await expect(plugin.host!.start!(ctx as never)).rejects.toThrow(/Unsupported proxy type/);
  });
});
