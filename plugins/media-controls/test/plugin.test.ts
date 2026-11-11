import { beforeEach, describe, expect, test, vi } from "vitest";
import type { NowPlaying, Track } from "@pear/sdk";
import mediaControls from "../index.ts";

const mocks = vi.hoisted(() => {
  class FakeMpris {
    static LOOP_STATUS_NONE = "None";
    static LOOP_STATUS_PLAYLIST = "Playlist";
    static LOOP_STATUS_TRACK = "Track";
    static PLAYBACK_STATUS_PLAYING = "Playing";
    static PLAYBACK_STATUS_PAUSED = "Paused";
    static PLAYBACK_STATUS_STOPPED = "Stopped";
    static instances: FakeMpris[] = [];

    readonly handlers = new Map<string, (...args: any[]) => void>();
    readonly metadataWrites: unknown[] = [];
    readonly seeked = vi.fn();
    readonly busDisconnect = vi.fn();
    readonly _bus = { disconnect: this.busDisconnect };
    canGoPrevious = false;
    canGoNext = true;
    fullscreen = false;
    playbackStatus: string = FakeMpris.PLAYBACK_STATUS_STOPPED;
    volume = 1;
    loopStatus: string = FakeMpris.LOOP_STATUS_NONE;
    shuffle = false;
    #metadata: unknown = {};

    constructor(readonly options: unknown) {
      FakeMpris.instances.push(this);
    }

    get metadata() {
      return this.#metadata;
    }

    set metadata(value: unknown) {
      this.#metadata = value;
      this.metadataWrites.push(value);
    }

    on(event: string, handler: (...args: any[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    emit(event: string, ...args: any[]) {
      this.handlers.get(event)?.(...args);
    }

    removeAllListeners(event: string) {
      this.handlers.delete(event);
    }

    objectPath(path: string) {
      return `/org/mpris/MediaPlayer2/${path}`;
    }
  }
  return { FakeMpris };
});

vi.mock("@jellybrick/mpris-service", () => ({ default: mocks.FakeMpris }));

function track(overrides: Partial<Track> = {}): Track {
  return {
    videoId: "vid1",
    title: "Song",
    artist: "Artist",
    durationSeconds: 200,
    url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=vid1",
    mediaType: "audio",
    ...overrides,
  };
}

function nowPlaying(overrides: Partial<NowPlaying> = {}): NowPlaying {
  return {
    track: track(),
    status: "paused",
    positionSeconds: 0,
    volume: 100,
    muted: false,
    repeat: "none",
    shuffle: false,
    like: "none",
    ad: false,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function fakeContext(initial: NowPlaying) {
  const changeListeners: ((next: NowPlaying, previous: NowPlaying) => void)[] = [];
  const player = {
    state: initial,
    control: vi.fn(),
    details: vi.fn(),
    on: (event: string, listener: (next: NowPlaying, previous: NowPlaying) => void) => {
      if (event === "change") changeListeners.push(listener);
      return () => {
        const index = changeListeners.indexOf(listener);
        if (index >= 0) changeListeners.splice(index, 1);
      };
    },
  };
  const ctx = {
    id: "media-controls",
    config: {},
    player,
    app: {},
    window: { loadURL: vi.fn() },
    core: () => ({}),
    request: vi.fn(async () => undefined),
    focusWindow: vi.fn(),
    openSettings: vi.fn(),
    onCleanup: vi.fn(),
    onConfigChange: vi.fn(),
    listen: vi.fn(),
    setStatus: vi.fn(),
    emit: vi.fn(),
    api: { broadcast: vi.fn() },
    t: (_key: string, fallback?: string) => fallback ?? _key,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    setConfig: vi.fn(),
  };
  let current = initial;
  const apply = (next: NowPlaying) => {
    const previous = current;
    current = next;
    for (const listener of changeListeners) listener(next, previous);
  };
  return { ctx, apply, player };
}

function start(initial: NowPlaying = nowPlaying()) {
  mocks.FakeMpris.instances.length = 0;
  const harness = fakeContext(initial);
  const returned = mediaControls.host!.start!(harness.ctx as never);
  const cleanup = returned as unknown as () => void;
  const mpris = mocks.FakeMpris.instances.at(-1)!;
  return { ...harness, mpris, cleanup };
}

const position = (mpris: object) => (mpris as { getPosition(): number }).getPosition();
type FakeMprisInstance = InstanceType<typeof mocks.FakeMpris>;

const metadata = (mpris: FakeMprisInstance, index = -1) => mpris.metadataWrites.at(index) as Record<string, unknown>;

beforeEach(() => {
  mocks.FakeMpris.instances.length = 0;
});

describe("the MPRIS mirror", () => {
  test("is seeded from the current player state", () => {
    const { mpris, cleanup } = start();
    expect(mpris.metadataWrites).toHaveLength(1);
    const data = metadata(mpris);
    expect(data["xesam:title"]).toBe("Song");
    expect(data["xesam:artist"]).toEqual(["Artist"]);
    expect(data["xesam:url"]).toBe("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=vid1");
    expect(data["mpris:trackid"]).toBe("/org/mpris/MediaPlayer2/track/vid1");
    expect(data["mpris:length"]).toBe(200e6);
    cleanup();
  });

  test("republishes metadata for same-video artist, album and duration corrections", () => {
    const { apply, mpris, cleanup } = start();
    apply(nowPlaying({ track: track({ artist: "Other" }) }));
    expect(mpris.metadataWrites).toHaveLength(2);
    expect(metadata(mpris)["xesam:artist"]).toEqual(["Other"]);

    apply(nowPlaying({ track: track({ album: "LP", durationSeconds: 300 }) }));
    expect(mpris.metadataWrites).toHaveLength(3);
    expect(metadata(mpris)["xesam:album"]).toBe("LP");
    expect(metadata(mpris)["mpris:length"]).toBe(300e6);
    cleanup();
  });

  test("leaves the metadata alone when an update repeats it", () => {
    const { apply, mpris, cleanup } = start();
    apply(nowPlaying());
    expect(mpris.metadataWrites).toHaveLength(1);
    cleanup();
  });

  test("play and pause do not toggle", () => {
    const { mpris, player, cleanup } = start();
    mpris.emit("play");
    expect(player.control).toHaveBeenLastCalledWith({ type: "play" });
    mpris.emit("pause");
    expect(player.control).toHaveBeenLastCalledWith({ type: "pause" });
    mpris.emit("playpause");
    expect(player.control).toHaveBeenLastCalledWith({ type: "toggle" });
    cleanup();
  });

  test("keeps the position of live streams (the duration is 0 there)", () => {
    const { mpris, cleanup } = start(
      nowPlaying({ status: "playing", positionSeconds: 10, updatedAt: Date.now() - 5000, track: track({ durationSeconds: 0 }) }),
    );
    expect(position(mpris)).toBeGreaterThanOrEqual(15e6);
    cleanup();
  });

  test("clamps the position to a known track length", () => {
    const { mpris, cleanup } = start(
      nowPlaying({ status: "playing", positionSeconds: 10, updatedAt: Date.now() - 5000, track: track({ durationSeconds: 12 }) }),
    );
    expect(position(mpris)).toBe(12e6);
    cleanup();
  });

  test("tears the bus and its handlers down", () => {
    const { apply, cleanup, mpris, player } = start();
    const writes = mpris.metadataWrites.length;
    cleanup();
    expect(mpris.handlers.has("play")).toBe(false);
    expect(mpris._bus.disconnect).toHaveBeenCalledOnce();
    apply(nowPlaying({ track: track({ videoId: "other", title: "Other" }) }));
    expect(mpris.metadataWrites).toHaveLength(writes);
    expect(player.control).not.toHaveBeenCalled();
  });
});
