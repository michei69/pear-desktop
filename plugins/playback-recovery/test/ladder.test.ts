import type { NowPlaying, PlayerAction } from "@pear/sdk";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import plugin from "../index.ts";

type Config = { stallTimeoutMs: number; maxRetries: number; logToConsole: boolean };

/** Just the <video> members the plugin touches. */
interface FakeVideo {
  currentTime: number;
  duration: number;
  paused: boolean;
  readyState: number;
  buffered: { length: number };
  error?: { code: number; message: string };
  addEventListener(type: string, listener: () => void, options?: unknown): void;
  removeEventListener(type: string, listener: () => void): void;
  dispatch(type: string): void;
}

type VideoSetting = "currentTime" | "duration" | "paused" | "readyState" | "buffered" | "error";

function fakeVideo(overrides: Partial<Pick<FakeVideo, VideoSetting>> = {}): FakeVideo {
  const listeners = new Map<string, Set<() => void>>();
  return {
    currentTime: 10,
    duration: 200,
    paused: false,
    readyState: 4,
    buffered: { length: 0 },
    addEventListener(type, listener) {
      const forType = listeners.get(type) ?? new Set();
      forType.add(listener);
      listeners.set(type, forType);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    ...overrides,
  };
}

interface FakeApp {
  video: FakeVideo;
  state: NowPlaying;
  controls: PlayerAction[];
  /** Every ctx.setTimeout delay, so a test can tell a kept timer from a restarted one. */
  timeouts: number[];
  start(): void;
  /** Fires a page-player event, e.g. "timeUpdate", "trackChange" or "trackLoading". */
  emit(event: string): void;
  /** Runs the watchdog interval once. */
  tick(): void;
}

/** The page part as the runner calls it (the plugin's `page` is a plain function). */
const startPage = plugin.page as unknown as (ctx: unknown) => void;

function makeApp(options: { config?: Partial<Config>; video?: FakeVideo; state?: Partial<NowPlaying> } = {}): FakeApp {
  const config: Config = { stallTimeoutMs: 50, maxRetries: 5, logToConsole: false, ...options.config };
  const video = options.video ?? fakeVideo();
  const state = { status: "playing", ad: false, track: null, positionSeconds: 0, ...options.state } as NowPlaying;
  const controls: PlayerAction[] = [];
  const timeouts: number[] = [];
  const listeners = new Map<string, Set<() => void>>();
  let watchdog: (() => void) | undefined;

  const ctx = {
    config,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    player: {
      state,
      video: () => video as unknown as HTMLVideoElement,
      on(event: string, listener: () => void) {
        const forEvent = listeners.get(event) ?? new Set();
        forEvent.add(listener);
        listeners.set(event, forEvent);
        return () => forEvent.delete(listener);
      },
      control(action: PlayerAction) {
        controls.push(action);
      },
    },
    observe: vi.fn(),
    setTimeout(fn: () => void, ms: number) {
      timeouts.push(ms);
      return setTimeout(fn, ms) as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(timer: ReturnType<typeof setTimeout> | undefined) {
      clearTimeout(timer as unknown as Parameters<typeof clearTimeout>[0]);
    },
    setInterval(fn: () => void) {
      watchdog = fn;
      return 0 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: vi.fn(),
    onCleanup: vi.fn(),
  };

  return {
    video,
    state,
    controls,
    timeouts,
    start: () => startPage(ctx),
    emit: (event) => {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    tick: () => watchdog?.(),
  };
}

/** The player actions of a recovery attempt, as "seek:11" / "play" / "next". */
const actions = (controls: PlayerAction[]) => controls.map((action) => (action.type === "seek" ? `seek:${action.seconds}` : action.type));

/** Two failures put the ladder in the seek-forward band (attempts 1-2 seek to the current position). */
const twoFailures = (app: FakeApp) => {
  app.video.dispatch("error");
  vi.advanceTimersByTime(4_000);
  app.video.dispatch("error");
  vi.advanceTimersByTime(4_000);
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the retry ladder", () => {
  test("every attempt under the retry cap runs a recovery strategy", () => {
    const app = makeApp();
    app.start();

    const strategies: string[][] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      app.controls.length = 0;
      app.video.dispatch("error");
      strategies.push(actions(app.controls));
      vi.advanceTimersByTime(4_000);
    }

    // Attempts 1-2 seek to the current position, 3 and up seek forward. The dead
    // band (attempt 5 with the default maxRetries) used to run nothing.
    expect(strategies[0]).toEqual(["seek:10", "play"]);
    expect(strategies[1]).toEqual(["seek:10", "play"]);
    expect(strategies[2]).toEqual(["seek:11", "play"]);
    expect(strategies[3]).toEqual(["seek:11", "play"]);
    expect(strategies[4]).toEqual(["seek:11", "play"]);
  });

  test("an attempt past the retry cap skips the track and resets the ladder", () => {
    const app = makeApp();
    app.start();
    for (let attempt = 0; attempt < 5; attempt++) {
      app.video.dispatch("error");
      vi.advanceTimersByTime(4_000);
    }

    app.controls.length = 0;
    app.video.dispatch("error");
    expect(actions(app.controls)).toEqual(["next"]);

    // The next track's first failure starts the ladder over.
    vi.advanceTimersByTime(5_000);
    app.controls.length = 0;
    app.video.dispatch("error");
    expect(actions(app.controls)).toEqual(["seek:10", "play"]);
  });

  test("a brief resume does not reset the retry ladder", () => {
    const app = makeApp();
    app.start();
    twoFailures(app);

    // One second of progress is less than the 10 s healthy window.
    vi.advanceTimersByTime(1_000);
    app.emit("timeUpdate");
    app.controls.length = 0;
    app.video.dispatch("error");
    expect(actions(app.controls)).toEqual(["seek:11", "play"]);

    // Once playback has stayed healthy long enough, it does reset.
    vi.advanceTimersByTime(4_000);
    vi.advanceTimersByTime(11_000);
    app.emit("timeUpdate");
    app.controls.length = 0;
    app.video.dispatch("error");
    expect(actions(app.controls)).toEqual(["seek:10", "play"]);
  });

  test("seek-forward recovery clamps the target to the track duration", () => {
    const app = makeApp({ video: fakeVideo({ currentTime: 199.8 }) });
    app.start();
    twoFailures(app);

    app.controls.length = 0;
    app.video.dispatch("error");
    // currentTime + 1 is past the end; the seek stops half a second before it.
    expect(actions(app.controls)).toEqual(["seek:199.5", "play"]);
  });

  test("seek-forward recovery ignores an unknown duration", () => {
    const app = makeApp({ video: fakeVideo({ duration: Number.NaN }) });
    app.start();
    twoFailures(app);

    app.controls.length = 0;
    app.video.dispatch("error");
    expect(actions(app.controls)).toEqual(["seek:11", "play"]);
  });
});

describe("stall timers and the watchdog", () => {
  test("repeated stall events keep the timer instead of extending it", () => {
    const app = makeApp();
    app.start();

    app.video.dispatch("waiting");
    expect(app.timeouts).toEqual([50]);
    app.video.dispatch("waiting");
    // A stalled event must not restart the buffer timeout either.
    app.video.dispatch("stalled");
    expect(app.timeouts).toEqual([50]);
  });

  test("progress clears a pending stall timer", () => {
    const app = makeApp();
    app.start();
    app.video.dispatch("waiting");
    expect(app.timeouts).toEqual([50]);

    app.emit("timeUpdate");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(app.controls).toEqual([]);
  });

  test("the watchdog starts with a grace period and does not fire immediately", () => {
    const app = makeApp({ video: fakeVideo({ readyState: 0 }) });
    app.start();

    // A dead element right after the watchdog starts is inside the grace period.
    app.tick();
    expect(app.controls).toEqual([]);

    vi.advanceTimersByTime(100);
    app.tick();
    expect(actions(app.controls)).toEqual(["seek:10", "play"]);
  });

  test("a waiting-armed timer still recovers when a stalled event lands at readyState 2", () => {
    const app = makeApp();
    app.start();
    app.video.dispatch("waiting");
    app.video.dispatch("stalled");
    // HAVE_CURRENT_DATA is still a recoverable stall.
    app.video.readyState = 2;

    vi.advanceTimersByTime(50);
    expect(actions(app.controls)).toEqual(["seek:10", "play"]);
  });

  test("the watchdog leaves ads to YTM", () => {
    const app = makeApp({ video: fakeVideo({ readyState: 0 }), state: { ad: true } });
    app.start();
    vi.advanceTimersByTime(1_000);

    app.tick();
    expect(app.controls).toEqual([]);
  });
});

describe("track changes", () => {
  test("a new track starts the retry ladder from the first attempt", () => {
    const app = makeApp();
    app.start();
    twoFailures(app);

    app.emit("trackChange");
    app.controls.length = 0;
    app.video.dispatch("error");
    // Attempt 1 (seek-to-current), not the seek-forward band the previous track
    // left the ladder in.
    expect(actions(app.controls)).toEqual(["seek:10", "play"]);
  });

  test("the media load resets the ladder before trackChange arrives", () => {
    const app = makeApp();
    app.start();
    twoFailures(app);

    app.emit("trackLoading");
    app.controls.length = 0;
    app.video.dispatch("error");
    expect(actions(app.controls)).toEqual(["seek:10", "play"]);
  });
});
