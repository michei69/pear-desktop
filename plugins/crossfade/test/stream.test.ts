import type { AudioGraph, Logger, YTPlayerApi } from "@pear/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOriginalAudioTrack, secondStream } from "../stream.ts";
import type { Ctx } from "../schema.ts";

/** The browser's media element surface the second stream drives. */
class FakeMedia extends EventTarget {
  static HAVE_FUTURE_DATA = 3;

  preload = "";
  muted = false;
  playbackRate = 1;
  src = "";
  crossOrigin: string | null = null;
  paused = true;
  readyState = 4;
  seeking = false;
  currentTime = 0;
  duration = 120;
  /** Seconds of audio buffered ahead of `currentTime`. */
  bufferedAhead = Infinity;
  onplaying: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #volume = 1;

  get volume() {
    return this.#volume;
  }

  set volume(value: number) {
    this.#volume = value;
  }

  get buffered() {
    const end = this.currentTime + this.bufferedAhead;
    return { length: 1, start: () => 0, end: () => end } as unknown as TimeRanges;
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

  /** Three failed byte fetches, then the tail is left for the URL. */
  async function flushFetches() {
    for (let attempt = 0; attempt < 4; attempt += 1) await vi.advanceTimersByTimeAsync(500);
  }

  /** Settles the URL fetch's promise chain. */
  async function flushPromises() {
    for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
  }

  /** The settings a URL source reads: when its tail is due and how long it fades. */
  const URL_CONFIG = { secondsBeforeEnd: 10, fadeOutDuration: 5000 };

  const commandsOf = (app: { ctx: { host: { invoke: unknown } } }) =>
    (app.ctx.host.invoke as unknown as { mock: { calls: string[][] } }).mock.calls.map(([command]) => command);

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

  it("keeps a URL source's tail out of the track until its end", async () => {
    const app = harness(
      async (command) => {
        if (command === "audioBytes") throw new Error("the CDN refused");
        if (command === "audioUrl") return "https://stream.example/a";
        throw new Error(`unexpected ${command}`);
      },
      undefined,
      URL_CONFIG,
    );
    app.stream.prepare("a");
    await flushFetches();
    // The bytes were tried; the URL waits for the track's end.
    expect(commandsOf(app).filter((command) => command === "audioBytes")).toHaveLength(3);
    expect(commandsOf(app)).not.toContain("audioUrl");
    expect(app.audio()).toBeUndefined();

    // Near the end, the tail is fetched and starts running with the video.
    app.video.currentTime = 100;
    app.stream.preload();
    await flushPromises();
    expect(commandsOf(app)).toEqual(["audioBytes", "audioBytes", "audioBytes", "audioUrl"]);
    expect(app.audio()?.src).toBe("https://stream.example/a");
    expect(app.audio()?.crossOrigin).toBe("anonymous");
    expect(app.stream.ready()).toBe(true);
  });

  it("goes straight to the URL when the host declines to buffer a long track", async () => {
    const app = harness(
      async (command) => {
        if (command === "audioBytes") return undefined;
        if (command === "audioUrl") return "https://stream.example/long";
        throw new Error(`unexpected ${command}`);
      },
      undefined,
      URL_CONFIG,
    );
    app.stream.prepare("a");
    await flushFetches();
    // One refusal, no retries, and still no URL until the end.
    expect(commandsOf(app)).toEqual(["audioBytes"]);
    app.video.currentTime = 100;
    app.stream.preload();
    await flushPromises();
    expect(commandsOf(app)).toEqual(["audioBytes", "audioUrl"]);
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
      { ...URL_CONFIG, streamUrlOnly: true },
    );
    app.stream.prepare("a");
    await flushFetches();
    // Nothing is fetched while the track plays; the tail arrives near the end.
    expect(commandsOf(app)).toEqual([]);
    app.video.currentTime = 100;
    app.stream.preload();
    await flushPromises();
    expect(commandsOf(app)).toEqual(["audioUrl"]);
    expect(app.audio()?.src).toBe("https://stream.example/only");
    expect(app.stream.ready()).toBe(true);
  });

  it("takes a URL tail over only once its fade is buffered", async () => {
    const app = harness(
      async (command) => {
        if (command === "audioUrl") return "https://stream.example/tail";
        throw new Error(`unexpected ${command}`);
      },
      undefined,
      { ...URL_CONFIG, streamUrlOnly: true },
    );
    app.video.currentTime = 100;
    app.stream.prepare("a");
    await flushFetches();
    const audio = app.audio()!;
    // One second ahead is one stall away from a hole under the fade curve.
    audio.bufferedAhead = 1;
    expect(app.stream.ready()).toBe(false);
    expect(app.stream.handover(5)).toBe(false);

    audio.bufferedAhead = Infinity;
    expect(app.stream.ready()).toBe(true);
    expect(app.stream.handover(5)).toBe(true);
  });

  it("lets the outgoing tail outlive the site's pause between tracks", async () => {
    const app = harness(async () => ({ bytes: new Uint8Array([1]), mimeType: "audio/webm" }));
    app.stream.prepare("a");
    await flushFetches();
    const outgoing = app.audio()!;
    expect(app.stream.handover(5)).toBe(true);

    // The site pauses the video for a moment while it loads the next track: the
    // tail keeps playing through a short pause...
    app.video.dispatchEvent(new Event("pause"));
    await vi.advanceTimersByTimeAsync(200);
    expect(outgoing.paused).toBe(false);
    app.video.dispatchEvent(new Event("playing"));
    await vi.advanceTimersByTimeAsync(300);
    expect(outgoing.paused).toBe(false);

    // ...and stops after one long enough to be the user's.
    app.video.dispatchEvent(new Event("pause"));
    await vi.advanceTimersByTimeAsync(400);
    expect(outgoing.paused).toBe(true);
  });

  it("warns and leaves no stream when neither source arrives", async () => {
    const app = harness(
      async (command) => {
        throw new Error(command === "audioBytes" ? "the CDN refused" : "no stream URL");
      },
      undefined,
      URL_CONFIG,
    );
    app.video.currentTime = 100;
    app.stream.prepare("a");
    await flushFetches();
    app.stream.preload();
    await flushPromises();
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
