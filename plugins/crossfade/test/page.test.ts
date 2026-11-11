import type { AudioGraph, PageContextOf } from "@pear/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startCrossfade } from "../page.ts";
import type { CrossfadeCommands, schema } from "../schema.ts";

type Ctx = PageContextOf<typeof schema, CrossfadeCommands>;
type Config = Ctx["config"];

/** The second stream's surface, so a swap, a handover or a failed fetch can be staged. */
const streamOf = vi.hoisted(() => {
  const calls: string[] = [];
  let ready = false;
  let handover = false;
  return {
    calls,
    setReady(value: boolean) {
      ready = value;
    },
    setHandover(value: boolean) {
      handover = value;
    },
    reset() {
      calls.length = 0;
      ready = false;
      handover = false;
    },
    stream: {
      prepare: (videoId: string) => calls.push(`prepare:${videoId}`),
      ready: () => ready,
      handover: (seconds: number) => {
        calls.push(`handover:${seconds}`);
        return handover;
      },
      rebind: () => calls.push("rebind"),
      cancelTransition: () => calls.push("cancelTransition"),
      pause: () => calls.push("pause"),
      follow: () => calls.push("follow"),
      resume: () => calls.push("resume"),
      release: () => calls.push("release"),
    },
  };
});

vi.mock("../stream.ts", () => ({
  HANDOVER_SECONDS: 0.02,
  secondStream: () => streamOf.stream,
}));

// The real minter runs BotGuard against the site; the page only has to answer.
vi.mock("@pear/sdk/potoken", () => ({
  poTokens: () => ({
    answer: async (request: { refresh?: boolean }) => ({ poToken: request.refresh ? "fresh" : "token", visitorData: "visitor" }),
    dispose: () => {},
  }),
}));

const DEFAULT_CONFIG: Config = {
  fadeInDuration: 5000,
  fadeOutDuration: 5000,
  secondsBeforeEnd: 10,
  fadeScaling: "equalPower",
  dynamicRange: 60,
};

class FakeParam {
  value = 1;
  curves: { curve: Float32Array; start: number; duration: number }[] = [];
  calls: string[] = [];

  cancelScheduledValues() {
    this.calls.push("cancelScheduledValues");
    return this;
  }

  cancelAndHoldAtTime() {
    this.calls.push("cancelAndHoldAtTime");
    return this;
  }

  setValueAtTime(value: number) {
    this.value = value;
    this.calls.push("setValueAtTime");
    return this;
  }

  setValueCurveAtTime(curve: Float32Array, start: number, duration: number) {
    this.curves.push({ curve, start, duration });
    this.value = curve.at(-1)!;
    return this;
  }

  linearRampToValueAtTime(value: number) {
    this.value = value;
    this.calls.push("linearRampToValueAtTime");
    return this;
  }
}

class FakeGain {
  readonly gain = new FakeParam();

  connect() {
    return this;
  }

  disconnect() {}
}

/**
 * The page context the crossfade uses: the shared graph, the player's events
 * and the video's events. The stream is mocked above, so a test can say whether
 * the second stream loaded and whether the handover succeeded.
 */
function harness(options: { config?: Partial<Config>; duration?: number; repeat?: "none" | "one" | "all" } = {}) {
  const config: Config = { ...DEFAULT_CONFIG, ...options.config };
  const state = { config };
  const video = {
    duration: options.duration ?? 120,
    currentTime: 0,
    paused: false,
    playbackRate: 1,
    listeners: new Map<string, Set<() => void>>(),
    addEventListener(type: string, listener: () => void) {
      let set = this.listeners.get(type);
      if (!set) this.listeners.set(type, (set = new Set()));
      set.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      this.listeners.get(type)?.delete(listener);
    },
    emit(type: string) {
      for (const listener of this.listeners.get(type) ?? []) listener();
    },
  };
  const player = {
    track: { videoId: "a" } as { videoId: string } | null,
    ad: false,
    repeat: options.repeat ?? "none",
    muted: false,
    listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
    controls: [] as unknown[],
    on(event: string, listener: (...args: unknown[]) => void) {
      let set = this.listeners.get(event);
      if (!set) this.listeners.set(event, (set = new Set()));
      set.add(listener);
      return () => set.delete(listener);
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    },
    control(action: unknown) {
      this.controls.push(action);
    },
    video: () => video,
    ready: async () => ({}),
    state: {
      get track() {
        return player.track;
      },
      ad: false,
      repeat: options.repeat ?? "none",
    },
  };

  const gains: FakeGain[] = [];
  const handlers = new Map<string, (payload: unknown) => unknown>();
  const contextTime = { value: 10 };
  const listeners = new Map<string, Set<() => void>>();
  const cleanups: (() => void)[] = [];
  let stage: { input: FakeGain; order: number } | undefined;

  const context = {
    get currentTime() {
      return contextTime.value;
    },
    destination: {},
    createGain: () => {
      const gain = new FakeGain();
      gains.push(gain);
      return gain as unknown as GainNode;
    },
  } as unknown as AudioContext;

  const graph = {
    context,
    source: {},
    video,
    rebind: () => null,
    insert(input: AudioNode, _output: AudioNode = input, order = 0) {
      stage = { input: input as unknown as FakeGain, order };
      return () => {};
    },
    tap: () => () => {},
  } as unknown as AudioGraph;

  const ctx = {
    get config() {
      return state.config;
    },
    audio: async () => graph,
    player,
    listen(_target: EventTarget, type: string, listener: () => void) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(listener);
    },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
    onConfigChange: () => {},
    onCleanup: (fn: () => void) => cleanups.push(fn),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    signal: new AbortController().signal,
    host: {
      handle(event: string, handler: (payload: unknown) => unknown) {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      },
    },
  };

  return {
    ctx: ctx as unknown as Ctx,
    start: () => startCrossfade(ctx as unknown as Ctx),
    video: () => video,
    player,
    gain: () => gains[0]!.gain,
    stage: () => stage,
    handlers: () => handlers,
    /** The shared context clock, in seconds. */
    time: () => contextTime.value,
    advance(ms: number) {
      contextTime.value += ms / 1000;
      return vi.advanceTimersByTimeAsync(ms);
    },
    emitVideo(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
      // The page now moves its media listeners to the live <video> directly.
      for (const listener of video.listeners.get(type) ?? []) listener();
    },
    emitPlayer(event: string, ...args: unknown[]) {
      player.emit(event, ...args);
    },
    stop() {
      cleanups.splice(0).forEach((cleanup) => cleanup());
    },
  };
}

describe("the page's PO tokens", () => {
  it("answers the host's request for a track's token", async () => {
    const app = harness();
    await app.start();
    const answer = await app.handlers().get("poToken")!({ signedIn: true, refresh: true, videoId: "a" });
    expect(answer).toEqual({ poToken: "fresh", visitorData: "visitor" });
  });
});

describe("the crossfade's transition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    streamOf.reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives a last track its tail back when the next click does not navigate", async () => {
    const app = harness({ duration: 100 });
    await app.start();
    // Inside the fallback fade window: the video fades on its own toward silence.
    app.video().currentTime = 89;
    app.emitVideo("timeupdate");
    expect(app.gain().curves).toHaveLength(1);
    // The end of the fade window: the next track is asked for, and the video is
    // muted for the handover that will not come.
    app.video().currentTime = 90.2;
    app.emitVideo("timeupdate");
    expect(streamOf.calls).toContain("handover:5");
    expect(app.player.controls).toEqual([{ type: "next" }]);
    expect(app.gain().value).toBe(0);

    // No navigation within the latch's timeout: the track is still playing, so
    // its audio comes back, and the failed attempt is not repeated.
    await app.advance(5000);
    expect(streamOf.calls).toContain("cancelTransition");
    expect(app.gain().value).toBe(1);
    const ramps = app.gain().calls.filter((call) => call === "linearRampToValueAtTime").length;

    app.video().currentTime = 95;
    app.emitVideo("timeupdate");
    app.emitVideo("playing");
    expect(app.player.controls).toHaveLength(1);
    expect(app.gain().value).toBe(1);
    expect(app.gain().calls.filter((call) => call === "linearRampToValueAtTime")).toHaveLength(ramps);
  });

  it("ends a stale handover's outgoing stream when its navigation never comes", async () => {
    const app = harness({ duration: 100 });
    streamOf.setReady(true);
    streamOf.setHandover(true);
    await app.start();
    app.video().currentTime = 90.2;
    app.emitVideo("timeupdate");
    expect(app.gain().value).toBe(0);
    // The outgoing stream is carrying the tail; without a navigation it would
    // fade it to silence, so the track's own audio has to take it back.
    await app.advance(5000);
    expect(streamOf.calls.filter((call) => call === "cancelTransition")).toHaveLength(1);
    expect(app.gain().value).toBe(1);
  });

  it("crossfades an automatic transition and keeps the handover after trackLoading", async () => {
    const app = harness({ duration: 100 });
    streamOf.setReady(true);
    streamOf.setHandover(true);
    await app.start();

    app.video().currentTime = 90.2;
    app.emitVideo("timeupdate");
    expect(streamOf.calls).toContain("handover:5");
    expect(app.gain().value).toBe(0);
    expect(app.player.controls).toEqual([{ type: "next" }]);

    // The automatic navigation arrives: the outgoing splice must not be cut short.
    app.emitPlayer("trackLoading", "b");
    expect(streamOf.calls).toContain("prepare:b");
    const holds = app.gain().calls.filter((call) => call === "setValueAtTime").length;

    // The next track plays: the video fades in, from where the splice left it.
    app.video().currentTime = 0;
    app.emitVideo("playing");
    const fadeIn = app.gain().curves.at(-1)!;
    expect(fadeIn.curve[0]).toBe(0);
    expect(fadeIn.curve.at(-1)).toBeCloseTo(1, 6);
    expect(fadeIn.duration).toBe(5);
    expect(app.gain().calls.filter((call) => call === "setValueAtTime")).toHaveLength(holds);

    // The armed transition was consumed, so its timeout does not restore anything.
    const cancels = streamOf.calls.filter((call) => call === "cancelTransition").length;
    await app.advance(5000);
    expect(streamOf.calls.filter((call) => call === "cancelTransition")).toHaveLength(cancels);
  });

  it("releases the armed transition when the navigation only reports trackChange", async () => {
    const app = harness({ duration: 100 });
    await app.start();
    app.video().currentTime = 90.2;
    app.emitVideo("timeupdate");
    expect(app.player.controls).toEqual([{ type: "next" }]);

    // The new track's metadata arrives without `trackLoading`: the latch must
    // not later restore over the incoming track.
    app.emitPlayer("trackChange", { videoId: "b" });
    app.video().currentTime = 1;
    app.emitVideo("playing");
    app.video().currentTime = 2;
    app.emitVideo("timeupdate");
    const cancels = streamOf.calls.filter((call) => call === "cancelTransition").length;
    await app.advance(5000);
    expect(streamOf.calls.filter((call) => call === "cancelTransition")).toHaveLength(cancels);
    expect(app.gain().value).toBe(1);
  });

  it("cuts the outgoing fade on a manual skip and fades the incoming track in", async () => {
    const app = harness({ duration: 120 });
    await app.start();
    app.video().currentTime = 106;
    app.emitVideo("timeupdate");
    expect(app.gain().curves).toHaveLength(1);

    app.emitPlayer("trackLoading", "b");
    expect(streamOf.calls).toContain("cancelTransition");
    expect(app.gain().value).toBe(0);
    expect(streamOf.calls).toContain("prepare:b");

    app.video().currentTime = 1;
    app.emitVideo("playing");
    const fadeIn = app.gain().curves.at(-1)!;
    expect(fadeIn.curve[0]).toBe(0);
    expect(fadeIn.curve.at(-1)).toBeCloseTo(1, 6);
  });

  it("resumes a frozen fade-in where the pause caught it", async () => {
    const app = harness({ duration: 120 });
    await app.start();
    // A manual skip arms the incoming track's fade-in; it starts on `playing`.
    app.emitPlayer("trackLoading", "b");
    app.video().currentTime = 1;
    app.emitVideo("playing");
    expect(app.gain().curves.at(-1)!.curve[0]).toBe(0);

    // Two seconds into the five-second fade, the user pauses and resumes later.
    await app.advance(2000);
    app.emitVideo("pause");
    app.video().paused = false;
    await app.advance(3000);
    app.emitVideo("playing");
    const resumed = app.gain().curves.at(-1)!;
    expect(resumed.curve[0]).toBeCloseTo(Math.sin((0.4 * Math.PI) / 2), 6);
    expect(resumed.curve.at(-1)).toBeCloseTo(1, 6);
    expect(resumed.duration).toBeCloseTo(3, 6);
  });

  it("leaves a track shorter than the minimum alone", async () => {
    const app = harness({ duration: 20 });
    await app.start();
    app.video().currentTime = 19;
    app.emitVideo("timeupdate");
    expect(app.player.controls).toEqual([]);
    expect(streamOf.calls).not.toContain("handover:5");
    expect(app.gain().curves).toHaveLength(0);
  });

  it("fades with no second stream at all (failed fetch)", async () => {
    const app = harness({ duration: 100 });
    await app.start();
    app.video().currentTime = 89;
    app.emitVideo("timeupdate");
    // The fallback fade owns the window; the handover then has nothing to hand to.
    expect(app.gain().curves).toHaveLength(1);
    app.video().currentTime = 90.2;
    app.emitVideo("timeupdate");
    expect(streamOf.calls).toContain("handover:5");
    expect(app.player.controls).toEqual([{ type: "next" }]);
  });

  it("seeks to the start instead of asking for the next track while repeating one", async () => {
    const app = harness({ duration: 100, repeat: "one" });
    await app.start();
    app.video().currentTime = 90.2;
    app.emitVideo("timeupdate");
    expect(app.player.controls).toEqual([{ type: "seek", seconds: 0 }]);
    expect(streamOf.calls).not.toContain("handover:5");
    expect(app.gain().curves.at(-1)!.curve.at(-1)).toBeCloseTo(1, 6);
  });
});
