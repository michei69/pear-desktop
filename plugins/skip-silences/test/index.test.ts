import type { AudioGraph, PageContextOf } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import plugin from "../index.ts";
import { INTERVAL_MS } from "../latch.ts";

type Ctx = PageContextOf<NonNullable<typeof plugin.config>>;

class FakeNode {
  connect() {}
  disconnect() {}
}

class FakeAnalyser extends FakeNode {
  /** dB of every counted bin: -100 is silence, -20 is loud. */
  level = -100;
  fftSize = 512;
  smoothingTimeConstant = 0.1;
  readonly frequencyBinCount = 256;

  getFloatFrequencyData(bins: Float32Array) {
    bins.fill(this.level);
  }
}

class FakeVideo extends EventTarget {
  paused = true;
  seeking = false;
  ended = false;
  muted = false;
  volume = 1;
  currentTime = 0;
}

/** The parts of a page context the plugin uses, with the loop driven by hand. */
function harness({ onlySkipBeginning = false, playing = false } = {}) {
  const video = new FakeVideo();
  video.paused = !playing;
  const analyser = new FakeAnalyser();
  const graph = {
    context: {
      createGain: () => new FakeNode(),
      createAnalyser: () => analyser,
    },
    video,
    insert: () => () => {},
    tap: () => () => {},
  } as unknown as AudioGraph;

  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let intervalMs = 0;
  const playerListeners = new Map<string, () => void>();
  const state = { onlySkipBeginning, ad: false };

  const cleanups: (() => void)[] = [];
  const ctx = {
    get config() {
      return { onlySkipBeginning: state.onlySkipBeginning };
    },
    audio: async () => graph,
    player: {
      state: {
        get ad() {
          return state.ad;
        },
      },
      on(event: string, listener: () => void) {
        playerListeners.set(event, listener);
        return () => {};
      },
    },
    setInterval(fn: () => void, ms: number) {
      intervalMs = ms;
      const id = nextTimer++;
      timers.set(id, fn);
      return id as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval(timer: ReturnType<typeof setInterval> | undefined) {
      if (timer !== undefined) timers.delete(timer as unknown as number);
    },
    listen(target: EventTarget, type: string, listener: EventListener) {
      target.addEventListener(type, listener);
    },
    onCleanup(fn: () => void) {
      cleanups.push(fn);
    },
    log: { info() {}, warn() {}, error() {} },
    signal: { aborted: false },
  } as unknown as Ctx;

  return {
    video,
    analyser,
    timers,
    start: async () => {
      await (plugin.page as unknown as { start(ctx: Ctx): Promise<unknown> }).start(ctx);
    },
    play() {
      video.paused = false;
      video.dispatchEvent(new Event("play"));
    },
    pause() {
      video.paused = true;
      video.dispatchEvent(new Event("pause"));
    },
    seeked() {
      video.dispatchEvent(new Event("seeked"));
    },
    trackLoaded() {
      playerListeners.get("trackLoading")?.();
    },
    /** Runs the loop's callback `count` times, as the interval would. */
    tick(count = 1) {
      const callbacks = [...timers.values()];
      for (let index = 0; index < count; index++) for (const callback of callbacks) callback();
    },
    running: () => timers.size,
    intervalMs: () => intervalMs,
    setLevel(level: number) {
      analyser.level = level;
    },
    setAd(ad: boolean) {
      state.ad = ad;
    },
  };
}

describe("the silence loop", () => {
  it("samples every 25 ms only while playing", async () => {
    const app = harness();
    await app.start();
    // Enabled while paused: no timer at all.
    expect(app.running()).toBe(0);

    app.play();
    expect(app.intervalMs()).toBe(INTERVAL_MS);
    expect(app.running()).toBe(1);
    // A repeated `play` must not stack another loop.
    app.play();
    expect(app.running()).toBe(1);

    app.pause();
    expect(app.running()).toBe(0);
    // Scrubbing a paused player must not start the loop either.
    app.seeked();
    expect(app.running()).toBe(0);

    // Not even one tick while paused.
    app.setLevel(-100);
    app.tick(20);
    expect(app.video.currentTime).toBe(0);
  });

  it("needs about 250 ms of true silence before skipping", async () => {
    const app = harness({ playing: true });
    await app.start();
    expect(app.running()).toBe(1);

    app.setLevel(-20);
    app.tick(3); // real audio heard, so the latch is primed with loud samples
    app.setLevel(-100);
    app.tick(10); // 250 ms: master's history is not full of quiet yet
    expect(app.video.currentTime).toBe(0);
    app.tick(1);
    expect(app.video.currentTime).toBeCloseTo(0.2);
  });

  it("keeps onlySkipBeginning armed across the tracker's own seek", async () => {
    const app = harness({ playing: true, onlySkipBeginning: true });
    await app.start();

    // A silent lead-in may be skipped before any audio is heard.
    app.tick(1);
    expect(app.video.currentTime).toBeCloseTo(0.2);
    // YTM answers the jump with `seeked`; the latch itself survives.
    app.seeked();
    expect(app.video.currentTime).toBeCloseTo(0.4);

    // Real audio starts: the rest of this track is left alone.
    app.setLevel(-20);
    app.tick(3);
    app.setLevel(-100);
    app.tick(12);
    expect(app.video.currentTime).toBeCloseTo(0.4);

    // A mid-track seek drops the samples but not the "audio was heard" latch.
    app.seeked();
    expect(app.video.currentTime).toBeCloseTo(0.4);
  });

  it("re-arms beginning-only skipping for a new track", async () => {
    const app = harness({ playing: true, onlySkipBeginning: true });
    await app.start();
    app.setLevel(-20);
    app.tick(3);
    expect(app.video.currentTime).toBe(0);

    app.setLevel(-100);
    app.trackLoaded();
    app.tick(1);
    expect(app.video.currentTime).toBeCloseTo(0.2);
  });

  it("never skips during an ad", async () => {
    const app = harness({ playing: true });
    await app.start();
    app.setAd(true);
    app.tick(20);
    expect(app.video.currentTime).toBe(0);
  });
});
