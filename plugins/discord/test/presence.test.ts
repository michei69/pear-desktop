import { IDLE, type HostContextOf, type NowPlaying } from "@pear/sdk";
import type { Client } from "@xhayper/discord-rpc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Presence } from "../presence.ts";
import type { schema } from "../schema.ts";

type Ctx = HostContextOf<typeof schema>;
type ChangeListener = (state: NowPlaying, previous: NowPlaying) => void;

const config: Ctx["config"] = {
  activityType: "listening",
  statusDisplayType: "details",
  playButton: true,
  hideGitHubButton: false,
  hideDurationLeft: false,
  hideWhenPaused: false,
  activityTimeoutEnabled: true,
  activityTimeoutSeconds: 600,
  autoReconnect: true,
};

const track = {
  videoId: "abc",
  title: "Song",
  artist: "Artist",
  album: "Album",
  artworkUrl: "https://img.test/a.jpg",
  durationSeconds: 200,
  url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc",
  mediaType: "audio" as const,
};

const playing: NowPlaying = { ...IDLE, track, status: "playing", positionSeconds: 10, updatedAt: Date.now() };

/** What the plugin uses of @xhayper/discord-rpc's client, without the IPC. */
class FakeClient {
  readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly user = {
    setActivity: vi.fn((_activity: unknown) => Promise.resolve()),
    clearActivity: vi.fn(() => Promise.resolve()),
  };
  readonly login = vi.fn(() => Promise.resolve());
  destroyed = false;
  listenersRemoved = false;

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
    this.listenersRemoved = true;
    this.handlers.clear();
    return this;
  }

  destroy() {
    this.destroyed = true;
    return Promise.resolve();
  }
}

interface Harness {
  ctx: Ctx;
  presence: Presence;
  clients: FakeClient[];
  /** Plays a state, as the host player mirror would. */
  emit(state: NowPlaying): void;
}

function fakeContext(state: NowPlaying = IDLE) {
  const listeners: ChangeListener[] = [];
  let current = state;
  const ctx = {
    config,
    player: {
      get state() {
        return current;
      },
      on: (_event: string, listener: ChangeListener) => {
        listeners.push(listener);
        return () => {};
      },
      details: () => Promise.resolve(null),
      control: () => {},
    },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    t: (_key: string, fallback?: string) => fallback ?? _key,
    setStatus: vi.fn(),
  } as unknown as Ctx;
  const emit = (next: NowPlaying) => {
    const previous = current;
    current = next;
    for (const listener of listeners) listener(next, previous);
  };
  return { ctx, emit };
}

/** A Presence whose clients are fakes: nothing here connects to Discord. */
function makePresence(state: NowPlaying = IDLE): Harness {
  const { ctx, emit } = fakeContext(state);
  const clients: FakeClient[] = [];
  const presence = new Presence(ctx, () => {
    const client = new FakeClient();
    clients.push(client);
    return client as unknown as Client;
  });
  return { ctx, presence, clients, emit };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Presence connection lifecycle", () => {
  it("rebuilds a client that connects but never becomes ready, and keeps retrying", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const harness = makePresence();
    const { ctx, clients } = harness;
    expect(clients).toHaveLength(1);

    // The ready timeout drops the wedged client and enters the retry ladder.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(clients[0]!.destroyed).toBe(true);
    expect(ctx.setStatus).toHaveBeenLastCalledWith("Disconnected from Discord");

    // The first retry builds a fresh client and logs in again.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(clients).toHaveLength(2);
    expect(clients[1]!.login).toHaveBeenCalledOnce();

    harness.presence.stop();
  });

  it("clears the ready timeout once the client is ready", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const harness = makePresence();
    const { ctx, clients } = harness;

    clients[0]!.emit("ready");
    expect(ctx.setStatus).toHaveBeenLastCalledWith("Connected to Discord");

    await vi.advanceTimersByTimeAsync(15_000);
    expect(clients).toHaveLength(1);
    expect(clients[0]!.destroyed).toBe(false);

    harness.presence.stop();
  });

  it("Connect rebuilds a connected-but-not-ready client, and leaves a ready one alone", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const harness = makePresence();
    const { presence, clients } = harness;

    presence.connectNow();
    expect(clients).toHaveLength(2);
    expect(clients[0]!.destroyed).toBe(true);
    expect(clients[1]!.login).toHaveBeenCalledOnce();

    clients[1]!.emit("ready");
    presence.connectNow();
    expect(clients).toHaveLength(2);

    harness.presence.stop();
  });

  it("doubles the retry delay up to pear-desktop's five-minute cap", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const harness = makePresence();
    const { clients } = harness;
    clients[0]!.emit("disconnected");

    let delay = 5_000;
    for (let round = 0; round < 8; round += 1) {
      const before = clients.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(clients).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(clients).toHaveLength(before + 1);
      clients.at(-1)!.emit("disconnected");
      delay = Math.min(delay * 2, 5 * 60_000);
    }

    harness.presence.stop();
  });

  it("stops retrying and clears the activity on stop", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const harness = makePresence(playing);
    const { presence, clients } = harness;
    clients[0]!.emit("ready");

    presence.stop();
    expect(clients[0]!.user.clearActivity).toHaveBeenCalled();
    expect(clients[0]!.destroyed).toBe(true);
    expect(clients[0]!.listenersRemoved).toBe(true);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(clients).toHaveLength(1);
  });
});

describe("Presence activity updates", () => {
  it("retries a rejected activity update once the rate-limit window has passed", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const harness = makePresence(playing);
    const { ctx, clients } = harness;
    await Promise.resolve();
    const user = clients[0]!.user;
    user.setActivity.mockRejectedValueOnce(new Error("rate limited"));

    clients[0]!.emit("ready");
    expect(user.setActivity).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_999);
    expect(user.setActivity).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(user.setActivity).toHaveBeenCalledTimes(2);
    expect(ctx.log.warn).toHaveBeenCalled();

    harness.presence.stop();
  });

  it("sends the pause timeout's cleared activity", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const paused = { ...playing, status: "paused" as const };
    const harness = makePresence(paused);
    const { clients } = harness;
    clients[0]!.emit("ready");
    expect(clients[0]!.user.setActivity).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(config.activityTimeoutSeconds * 1000);
    expect(clients[0]!.user.clearActivity).toHaveBeenCalled();

    harness.presence.stop();
  });
});
