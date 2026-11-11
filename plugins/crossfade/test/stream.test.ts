import type { AudioGraph, Logger } from "@pear/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { secondStream } from "../stream.ts";
import type { Ctx } from "../schema.ts";

/** The browser's media element surface the second stream drives. */
class FakeMedia extends EventTarget {
  static HAVE_FUTURE_DATA = 4;

  preload = "";
  muted = false;
  playbackRate = 1;
  src = "";
  crossOrigin: string | null = null;
  paused = true;
  readyState = FakeMedia.HAVE_FUTURE_DATA;
  seeking = false;
  currentTime = 0;
  onplaying: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #volume = 1;

  get volume() {
    return this.#volume;
  }

  set volume(value: number) {
    this.#volume = value;
  }

  play() {
    this.paused = false;
    this.onplaying?.();
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  removeAttribute() {
    this.src = "";
  }

  load() {}
}

class FakeNode {
  readonly edges = new Set<FakeNode>();

  connect(target: FakeNode) {
    this.edges.add(target);
    return target;
  }

  disconnect(target?: FakeNode) {
    if (target) this.edges.delete(target);
    else this.edges.clear();
  }
}

class FakeGain extends FakeNode {
  readonly gain = {
    value: 1,
    cancelScheduledValues() {},
    cancelAndHoldAtTime() {},
    setValueAtTime() {},
    setValueCurveAtTime() {},
    linearRampToValueAtTime() {},
  };
}

describe("the second stream", () => {
  const audios: FakeMedia[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "Audio",
      class extends FakeMedia {
        constructor() {
          super();
          audios.push(this);
        }
      },
    );
    vi.stubGlobal("HTMLMediaElement", FakeMedia);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    audios.length = 0;
  });

  function harness(invoke: (command: string, videoId: string) => Promise<unknown>) {
    const video = new FakeMedia();
    video.paused = false;
    const context = {
      createMediaElementSource: () => new FakeNode(),
      createGain: () => new FakeGain(),
      destination: {},
    } as unknown as AudioContext;
    const graph = {
      context,
      video,
      source: new FakeNode(),
      rebind: () => null,
      insert: () => () => {},
      tap: () => () => {},
    } as unknown as AudioGraph;
    const state = { track: { videoId: "a" }, ad: false, muted: false, repeat: "none" };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const ctx = {
      config: {},
      player: { state, on: () => () => {} },
      host: { invoke: vi.fn(invoke) },
      listen: () => {},
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (timer: ReturnType<typeof setInterval> | undefined) => clearInterval(timer),
      onCleanup: () => {},
      log,
      signal: new AbortController().signal,
    } as unknown as Ctx;
    const stream = secondStream(ctx, graph);
    return { stream, ctx, log, audio: () => audios.at(-1) };
  }

  /** Three failed byte fetches, then the URL fallback. */
  async function flushFetches() {
    for (let attempt = 0; attempt < 4; attempt += 1) await vi.advanceTimersByTimeAsync(500);
  }

  it("starts the silent copy once the track's bytes arrive", async () => {
    const app = harness(async (command) => {
      if (command !== "audioBytes") throw new Error(`unexpected ${command}`);
      return { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" };
    });
    app.stream.prepare("a");
    await flushFetches();
    expect(app.ctx.host.invoke).toHaveBeenCalledTimes(1);
    expect(app.ctx.host.invoke).toHaveBeenCalledWith("audioBytes", "a");
    expect(app.audio()?.src).toMatch(/^blob:/);
    expect(app.stream.ready()).toBe(true);
  });

  it("falls back to the track's stream URL when the bytes do not arrive", async () => {
    const app = harness(async (command) => {
      if (command === "audioBytes") throw new Error("the CDN refused");
      if (command === "audioUrl") return "https://stream.example/a";
      throw new Error(`unexpected ${command}`);
    });
    app.stream.prepare("a");
    await flushFetches();
    const commands = (app.ctx.host.invoke as unknown as { mock: { calls: string[][] } }).mock.calls.map(([command]) => command);
    expect(commands.filter((command) => command === "audioBytes")).toHaveLength(3);
    expect(commands.at(-1)).toBe("audioUrl");
    expect(app.audio()?.src).toBe("https://stream.example/a");
    expect(app.audio()?.crossOrigin).toBe("anonymous");
    expect(app.stream.ready()).toBe(true);
  });

  it("warns and leaves no stream when neither source arrives", async () => {
    const app = harness(async (command) => {
      throw new Error(command === "audioBytes" ? "the CDN refused" : "no stream URL");
    });
    app.stream.prepare("a");
    await flushFetches();
    expect(app.stream.ready()).toBe(false);
    expect(app.log.warn).toHaveBeenCalled();
    expect(app.audio()).toBeUndefined();
  });

  it("releases its nodes and object URL on stop", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const app = harness(async () => ({ bytes: new Uint8Array([1]), mimeType: "audio/webm" }));
    app.stream.prepare("a");
    await flushFetches();
    const audio = app.audio()!;
    app.stream.release();
    expect(revoke).toHaveBeenCalled();
    expect(audio.src).toBe("");
    expect(audio.paused).toBe(true);
    revoke.mockRestore();
  });
});
