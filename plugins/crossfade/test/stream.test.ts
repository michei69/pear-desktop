import type { AudioGraph, Logger, YTPlayerApi } from "@pear/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOriginalAudioTrack, secondStream } from "../stream.ts";
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
    // exponential-volume's accessor-change announcement lands on the document.
    vi.stubGlobal("document", new EventTarget());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    audios.length = 0;
  });

  function harness(invoke: (command: string, videoId: string) => Promise<unknown>, api?: unknown, config: Record<string, unknown> = {}) {
    const video = new FakeMedia();
    video.paused = false;
    const context = {
      createMediaElementSource: () => new FakeNode(),
      createGain: () => new FakeGain(),
      destination: {},
    } as unknown as AudioContext;
    const externals = new Map<FakeNode, number | undefined>();
    const graph = {
      context,
      video,
      source: new FakeNode(),
      rebind: () => null,
      insert: () => () => {},
      tap: () => () => {},
      connectExternal(node: FakeNode, order?: number) {
        externals.set(node, order);
        return () => externals.delete(node);
      },
    } as unknown as AudioGraph;
    const state = { track: { videoId: "a" }, ad: false, muted: false, repeat: "none" };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const ctx = {
      config,
      player: { state, api: api ?? null, on: () => () => {} },
      host: { invoke: vi.fn(invoke) },
      listen(target: EventTarget, type: string, listener: (event: Event) => void) {
        target.addEventListener(type, listener);
        return () => target.removeEventListener(type, listener);
      },
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (timer: ReturnType<typeof setInterval> | undefined) => clearInterval(timer),
      onCleanup: () => {},
      log,
      signal: new AbortController().signal,
    } as unknown as Ctx;
    const stream = secondStream(ctx, graph);
    return { stream, ctx, log, video, audio: () => audios.at(-1), externals: () => externals };
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
    // The stream's gain is in the shared graph, injected after the pre-chain stages.
    expect([...app.externals().values()]).toEqual([0]);
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

  it("goes straight to the URL when the host declines to buffer a long track", async () => {
    const app = harness(async (command) => {
      if (command === "audioBytes") return undefined;
      if (command === "audioUrl") return "https://stream.example/long";
      throw new Error(`unexpected ${command}`);
    });
    app.stream.prepare("a");
    await flushFetches();
    const commands = (app.ctx.host.invoke as unknown as { mock: { calls: string[][] } }).mock.calls.map(([command]) => command);
    // One refusal, no retries: the browser streams the tail instead of buffering hours.
    expect(commands).toEqual(["audioBytes", "audioUrl"]);
    expect(app.audio()?.src).toBe("https://stream.example/long");
    expect(app.audio()?.crossOrigin).toBe("anonymous");
    expect(app.stream.ready()).toBe(true);
  });

  it("uses only the stream URL when RAM buffering is turned off", async () => {
    const app = harness(
      async (command) => {
        if (command === "audioUrl") return "https://stream.example/only";
        throw new Error(`unexpected ${command}`);
      },
      undefined,
      { streamUrlOnly: true },
    );
    app.stream.prepare("a");
    await flushFetches();
    const commands = (app.ctx.host.invoke as unknown as { mock: { calls: string[][] } }).mock.calls.map(([command]) => command);
    expect(commands).toEqual(["audioUrl"]);
    expect(app.audio()?.src).toBe("https://stream.example/only");
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
    // The tail's gain left the shared graph with it.
    expect(app.externals().size).toBe(0);
    revoke.mockRestore();
  });

  it("re-reads the video's level when exponential-volume reassigns the accessor", async () => {
    const app = harness(async () => ({ bytes: new Uint8Array([1]), mimeType: "audio/webm" }));
    app.stream.prepare("a");
    await flushFetches();
    const audio = app.audio()!;
    expect(audio.volume).toBe(1);

    // The video's element level changed with the plugin's re-map; the detached
    // stream is not in the document, so the announced event is what reaches it.
    app.video.volume = 0.2;
    document.dispatchEvent(new Event("pear:volume-map"));
    expect(audio.volume).toBe(0.2);
  });

  it("leaves a non-original audio track to the fallback fade", async () => {
    const dub = {
      getLanguageInfo: () => ({ getId: () => "es", getIsDefault: () => false, getIsAutoDubbed: () => true }),
    };
    const original = {
      getLanguageInfo: () => ({ getId: () => "en", getIsDefault: () => true, getIsAutoDubbed: () => false }),
    };
    const api = {
      getAvailableAudioTracks: () => [original, dub],
      getAudioTrack: () => dub,
    };
    const app = harness(async () => ({ bytes: new Uint8Array([1]), mimeType: "audio/webm" }), api);
    app.stream.prepare("a");
    await flushFetches();
    // The host would serve the original track, so no stream is fetched at all.
    expect(app.ctx.host.invoke).not.toHaveBeenCalled();
    expect(app.stream.ready()).toBe(false);
    expect(app.stream.handover(5)).toBe(false);
    expect(app.log.info).toHaveBeenCalled();
  });
});

describe("the original audio track", () => {
  const track = (options: { id?: string; isDefault?: boolean; autoDubbed?: boolean } = {}) => ({
    getLanguageInfo: () => ({
      getId: () => options.id ?? "en",
      getIsDefault: () => options.isDefault ?? false,
      getIsAutoDubbed: () => options.autoDubbed ?? false,
    }),
  });
  const api = (tracks: unknown[], current: unknown) =>
    ({ getAvailableAudioTracks: () => tracks, getAudioTrack: () => current }) as unknown as YTPlayerApi;

  it("treats a player without a track choice as the original", () => {
    expect(isOriginalAudioTrack(null)).toBe(true);
    expect(isOriginalAudioTrack(api([track({ isDefault: true })], track({ isDefault: true })))).toBe(true);
  });

  it("accepts the default non-dubbed track and rejects a dub", () => {
    const original = track({ id: "en", isDefault: true });
    const dub = track({ id: "es", autoDubbed: true });
    expect(isOriginalAudioTrack(api([original, dub], original))).toBe(true);
    expect(isOriginalAudioTrack(api([original, dub], dub))).toBe(false);
    // The protobuf shape carries the same flags.
    const pbDub = { Pb: { id: "es", isDefault: false, isAutoDubbed: true } };
    expect(isOriginalAudioTrack(api([original, pbDub], pbDub))).toBe(false);
  });
});
