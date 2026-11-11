import type { AudioGraph, PageContextOf, PluginMenuItem, YTPlayerApi } from "@pear/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin, { dbToLinear, trackGainDb } from "../index.ts";

type Ctx = PageContextOf<NonNullable<typeof plugin.config>>;
type Config = Ctx["config"];
type HostStart = NonNullable<NonNullable<typeof plugin.host>["start"]>;
type HostCtx = Parameters<HostStart>[0];

const DEFAULT_CONFIG: Config = {
  threshold: -50,
  ratio: 12,
  knee: 40,
  attack: 0,
  release: 250,
  autoTrackGain: false,
  maxTrackGainDb: 12,
};

/** The AudioNode surface the plugin touches; edges are recorded so the order can be asserted. */
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

class FakeParam {
  value: number;

  constructor(value: number) {
    this.value = value;
  }

  cancelScheduledValues() {
    return this;
  }

  setValueAtTime(value: number) {
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-50);
  readonly ratio = new FakeParam(12);
  readonly knee = new FakeParam(40);
  readonly attack = new FakeParam(0);
  readonly release = new FakeParam(0.25);
}

interface Stage {
  input: FakeNode;
  output: FakeNode;
  order: number;
}

/**
 * The parts of a page context the compressor uses. The graph records the stage
 * it is given, the way the shared AudioGraph would wire it; `rebind` stands in
 * for the runtime re-cutting the graph after YTM swaps the <video>.
 */
function harness(overrides: Partial<Config> = {}) {
  const state = { config: { ...DEFAULT_CONFIG, ...overrides } as Config };
  const gains: FakeGain[] = [];
  const compressors: FakeCompressor[] = [];
  const sources = vi.fn(() => {
    throw new Error("the plugin must not create a MediaElementAudioSourceNode");
  });
  const context = {
    currentTime: 1,
    createGain: () => {
      const node = new FakeGain();
      gains.push(node);
      return node as unknown as GainNode;
    },
    createDynamicsCompressor: () => {
      const node = new FakeCompressor();
      compressors.push(node);
      return node as unknown as DynamicsCompressorNode;
    },
    createMediaElementSource: sources,
  } as unknown as AudioContext;

  let stage: Stage | undefined;
  let removed = 0;
  let video = {} as HTMLVideoElement;
  /** The runtime unsubscribes a plugin's inserts when it stops. */
  const unsubscribes: (() => void)[] = [];
  const graph = {
    context,
    source: new FakeNode(),
    get video() {
      return video;
    },
    rebind: (next: HTMLVideoElement) => {
      video = next;
      return null;
    },
    insert(input: AudioNode, output: AudioNode = input, order = 0) {
      stage = { input: input as unknown as FakeNode, output: output as unknown as FakeNode, order };
      const unsubscribe = () => {
        removed += 1;
        stage = undefined;
      };
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    },
    tap: () => () => {},
  } as unknown as AudioGraph;

  /** What YTM's player response reports; the tests change it per track phase. */
  const player = { loudnessDb: null as number | null };
  const response = () => (player.loudnessDb === null ? undefined : { playerConfig: { audioConfig: { loudnessDb: player.loudnessDb } } });
  const api = { getPlayerResponse: response } as unknown as YTPlayerApi;

  const cleanups: (() => void)[] = [];
  let configListener: ((next: Config) => void) | undefined;

  const ctx = {
    get config() {
      return state.config;
    },
    audio: async () => graph,
    player: {
      api,
      ready: async () => api,
      on: () => () => {},
      video: () => video,
      state: { track: null },
    },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
    onConfigChange(listener: (next: Config) => void) {
      configListener = listener;
    },
    onCleanup: (fn: () => void) => cleanups.push(fn),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  return {
    ctx: ctx as unknown as Ctx,
    start: () => (plugin.page as unknown as (ctx: Ctx) => Promise<void>)(ctx as unknown as Ctx),
    config: state.config,
    /** What YT's player response says about the loaded track. */
    setLoudness(db: number | null) {
      player.loudnessDb = db;
    },
    change(patch: Partial<Config>) {
      state.config = { ...state.config, ...patch };
      configListener?.(state.config);
    },
    trackGain: () => gains[0]!,
    compressor: () => compressors[0]!,
    stage: () => stage,
    removed: () => removed,
    sources,
    rebind(next: HTMLVideoElement) {
      graph.rebind(next);
    },
    stop() {
      unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
      cleanups.splice(0).forEach((cleanup) => cleanup());
    },
    advance: (ms: number) => vi.advanceTimersByTimeAsync(ms),
  };
}

describe("the compressor's chain", () => {
  it("inserts one stage with the compressor before the track gain", async () => {
    const app = harness({ autoTrackGain: true });
    await app.start();
    const stage = app.stage();
    expect(stage?.order).toBe(20);
    expect(stage?.input).toBe(app.compressor());
    expect(stage?.output).toBe(app.trackGain());
    // The sub-chain's own edge: without it the graph has no path to the output.
    expect([...app.compressor().edges]).toEqual([app.trackGain()]);
  });

  it("does not bind the media element itself: the shared graph owns it", async () => {
    const app = harness();
    await app.start();
    const swapped = {} as HTMLVideoElement;
    // The runtime re-cuts the graph on a <video> swap; the stage is unchanged.
    app.rebind(swapped);
    expect(app.stage()?.input).toBe(app.compressor());
    expect(app.stage()?.output).toBe(app.trackGain());
    expect(app.sources).not.toHaveBeenCalled();
  });

  it("removes its stage and nodes on stop", async () => {
    const app = harness({ autoTrackGain: true });
    await app.start();
    app.stop();
    expect(app.removed()).toBe(1);
    expect(app.compressor().edges.size).toBe(0);
    expect(app.trackGain().edges.size).toBe(0);
  });
});

describe("the track gain", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is unity while even-out is off", async () => {
    const app = harness({ autoTrackGain: false });
    await app.start();
    expect(app.trackGain().gain.value).toBe(1);
  });

  it("boosts a quiet track up to the ceiling, after compression", async () => {
    const app = harness({ autoTrackGain: true, maxTrackGainDb: 9 });
    // 12 dB quieter than the reference, but the ceiling is 9 dB.
    app.setLoudness(-12);
    await app.start();
    expect(app.trackGain().gain.value).toBe(dbToLinear(9));
  });

  it("picks the loudness up after YT writes it a little into the track", async () => {
    const app = harness({ autoTrackGain: true, maxTrackGainDb: 12 });
    await app.start();
    expect(app.trackGain().gain.value).toBe(1);
    await app.advance(400);
    app.setLoudness(-12);
    await app.advance(400);
    expect(app.trackGain().gain.value).toBe(dbToLinear(12));
  });

  it("gives up at unity when YT never reports a loudness", async () => {
    const app = harness({ autoTrackGain: true, maxTrackGainDb: 12 });
    await app.start();
    await app.advance(400 * 5);
    expect(app.trackGain().gain.value).toBe(1);
  });

  it("applies a ceiling change live", async () => {
    const app = harness({ autoTrackGain: true, maxTrackGainDb: 12 });
    app.setLoudness(-12);
    await app.start();
    app.change({ maxTrackGainDb: 3 });
    expect(app.trackGain().gain.value).toBe(dbToLinear(3));
  });
});

describe("the Options menu item", () => {
  it("toggles auto track gain", () => {
    const items: PluginMenuItem[] = [];
    const setConfig = vi.fn();
    const ctx = {
      config: { autoTrackGain: false },
      setConfig,
      t: (_key: string, fallback?: string) => fallback ?? _key,
      addMenuItem: (item: PluginMenuItem) => items.push(item),
    } as unknown as HostCtx;

    plugin.host!.start!(ctx);
    expect(items).toHaveLength(1);
    items[0]!.click();
    expect(setConfig).toHaveBeenCalledWith({ autoTrackGain: true });
  });
});

describe("the loudness math", () => {
  it("boosts only tracks quieter than the reference", () => {
    expect(trackGainDb(-12, 24)).toBe(12);
    expect(trackGainDb(3, 24)).toBe(0);
    expect(trackGainDb(-30, 9)).toBe(9);
    expect(trackGainDb(-12, -6)).toBe(0);
  });

  it("converts dB to a linear gain", () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 3);
  });
});
