import { IDLE, type NowPlaying, type Track } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import { beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../index.ts";

const fetchMock = vi.hoisted(() => vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 })));

vi.mock("electron", () => ({ net: { fetch: fetchMock } }));

type HostStart = NonNullable<NonNullable<typeof plugin.host>["start"]>;
type HostCtx = Parameters<HostStart>[0];
type ChangeListener = (state: NowPlaying, previous: NowPlaying) => void;

const song = (videoId: string, patch: Partial<Track> = {}): Track => ({
  videoId,
  title: "Song",
  artist: "Artist",
  durationSeconds: 200,
  url: `https://music.example.test/watch?v=${videoId}`,
  mediaType: "audio",
  ...patch,
});

const playing = (current: Track | null, patch: Partial<NowPlaying> = {}): NowPlaying => ({
  ...IDLE,
  track: current,
  status: current ? "playing" : "idle",
  positionSeconds: 10,
  updatedAt: Date.now(),
  ...patch,
});

/** A host context with just what the plugin touches: player state, changes and details. */
function host() {
  const listeners = new Set<ChangeListener>();
  const cleanups: (() => void)[] = [];
  const details = vi.fn(async (): Promise<SongDetails | null> =>
    state.track ? { videoId: state.track.videoId, views: 99, tags: [] } : null,
  );
  const setInterval = vi.fn();
  let state = playing(null);
  const ctx = {
    player: {
      get state() {
        return state;
      },
      on(_event: "change", listener: ChangeListener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      details,
    },
    setInterval,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    onCleanup(fn: () => void) {
      cleanups.push(fn);
    },
  } as unknown as HostCtx;
  return {
    ctx,
    details,
    setInterval,
    start() {
      plugin.host!.start!(ctx);
    },
    /** A state update as the host mirrors it. */
    change(next: NowPlaying) {
      const previous = state;
      state = next;
      for (const listener of listeners) listener(state, previous);
    },
    stop() {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

const posts = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body)).data) as {
    eventType: string;
    videoId: string;
    views?: number;
    isPaused: boolean;
  }[];
const events = () => posts().map((post) => post.eventType);
const flush = async (times = 4) => {
  for (let index = 0; index < times; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => fetchMock.mockClear());

describe("Lumia Stream event mapping", () => {
  it("reports a track change after a pause as a switch again", async () => {
    const app = host();
    app.start();

    app.change(playing(song("a")));
    app.change(playing(song("a"), { status: "paused" }));
    app.change(playing(song("a")));
    app.change(playing(song("b")));
    await flush();

    expect(events()).toEqual(["switchSong", "playPause", "playPause", "switchSong"]);
    expect(posts().map((post) => post.videoId)).toEqual(["a", "a", "a", "b"]);
  });

  it("posts one switchSong per track change, not one with and one without views", async () => {
    const app = host();
    app.start();
    app.change(playing(song("a")));
    await flush();
    const before = fetchMock.mock.calls.length;

    app.change(playing(song("b")));
    await flush();

    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(posts().at(-1)).toMatchObject({ eventType: "switchSong", videoId: "b" });
    expect(posts().at(-1)?.views).toBeUndefined();
    expect(app.details).toHaveBeenCalledTimes(2);

    // The views are known now: the next event for the same track carries them.
    app.change(playing(song("b"), { status: "paused" }));
    await flush();
    expect(posts().at(-1)).toMatchObject({ eventType: "playPause", videoId: "b", views: 99 });
  });

  it("uses the view count the page mirrors on the track, without a details request", async () => {
    const app = host();
    app.start();
    app.change(playing(song("a")));
    await flush();
    app.details.mockClear();

    app.change(playing({ ...song("b"), views: 120 } as Track));
    await flush();

    expect(app.details).not.toHaveBeenCalled();
    expect(posts().at(-1)).toMatchObject({ eventType: "switchSong", videoId: "b", views: 120 });
  });

  it("does not post every second while playing", async () => {
    const app = host();
    app.start();
    app.change(playing(song("a")));
    await flush();

    expect(app.setInterval).not.toHaveBeenCalled();
  });

  it("does not post when a seek keeps the track and the pause state", async () => {
    const app = host();
    app.start();
    app.change(playing(song("a")));
    await flush();
    const count = fetchMock.mock.calls.length;

    app.change(playing(song("a"), { positionSeconds: 120 }));
    await flush();

    expect(fetchMock.mock.calls.length).toBe(count);
  });

  it("reports an ad as a pause toggle", async () => {
    const app = host();
    app.start();
    app.change(playing(song("a")));
    app.change(playing(song("a"), { ad: true }));
    app.change(playing(song("a"), { ad: false }));
    await flush();

    expect(events()).toEqual(["switchSong", "playPause", "playPause"]);
    expect(posts().map((post) => post.isPaused)).toEqual([false, true, false]);
  });

  it("posts the restored track once on start", async () => {
    const app = host();
    app.change(playing(song("a")));
    app.start();
    await flush();

    expect(events()).toEqual(["switchSong"]);
  });

  it("stops posting when the plugin is disabled", async () => {
    const app = host();
    app.start();
    app.change(playing(song("a")));
    await flush();
    const count = fetchMock.mock.calls.length;

    app.stop();
    app.change(playing(song("b")));
    await flush();

    expect(fetchMock.mock.calls.length).toBe(count);
  });
});
