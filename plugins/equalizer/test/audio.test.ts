import type { AudioGraph, Logger } from "@pear/sdk";
import { describe, expect, it, vi } from "vitest";
import { EqualizerChain } from "../audio.ts";
import { bandsFromGains, type EqualizerState } from "../config.ts";

type FakeParam = AudioParam & { value: number };

/** The AudioParam subset the chain ramps; values are set immediately. */
class FakeParamValue {
  value: number;

  constructor(value: number) {
    this.value = value;
  }

  cancelAndHoldAtTime() {
    return this;
  }

  setTargetAtTime(next: number) {
    this.value = next;
    return this;
  }
}

const fakeParam = (value: number): FakeParam => new FakeParamValue(value) as unknown as FakeParam;

interface FakeNode {
  edges: Set<FakeNode>;
  connect(to: FakeNode): FakeNode;
  disconnect(to?: FakeNode): void;
  type?: BiquadFilterType;
  frequency?: FakeParam;
  Q?: FakeParam;
  gain?: FakeParam;
}

const fakeNode = (): FakeNode => {
  const node: FakeNode = {
    edges: new Set<FakeNode>(),
    connect(to) {
      node.edges.add(to);
      return to;
    },
    disconnect(to) {
      if (to) node.edges.delete(to);
      else node.edges.clear();
    },
  };
  return node;
};

const created: FakeNode[] = [];
const context = {
  currentTime: 1,
  sampleRate: 48000,
  createGain() {
    const node = fakeNode();
    node.gain = fakeParam(1);
    created.push(node);
    return node as unknown as GainNode;
  },
  createBiquadFilter() {
    const node = fakeNode();
    node.type = "peaking";
    node.frequency = fakeParam(1000);
    node.Q = fakeParam(1);
    node.gain = fakeParam(0);
    created.push(node);
    return node as unknown as BiquadFilterNode;
  },
} as unknown as AudioContext;

let stage: { input: FakeNode; output: FakeNode; order: number } | undefined;
let removed = false;
const graph = {
  context,
  source: fakeNode() as unknown as MediaElementAudioSourceNode,
  video: {} as HTMLVideoElement,
  rebind: () => null,
  insert(input: AudioNode, output: AudioNode = input, order = 0) {
    stage = { input: input as unknown as FakeNode, output: output as unknown as FakeNode, order };
    return () => {
      removed = true;
    };
  },
  tap: () => () => {},
} as unknown as AudioGraph;

const log = { warn: vi.fn() } as unknown as Logger;

const state = (patch: Partial<EqualizerState> = {}): EqualizerState => ({
  bypass: false,
  outputGainDb: 0,
  bands: bandsFromGains([]),
  activePreset: "flat",
  recentPresets: [],
  userPresets: [],
  ...patch,
});

const build = () => {
  created.length = 0;
  stage = undefined;
  removed = false;
  const chain = new EqualizerChain(graph);
  const [input, dry, wet, output, ...bands] = created;
  return { chain, input: input!, dry: dry!, wet: wet!, output: output!, bands };
};

describe("the equalizer's serial insert", () => {
  it("inserts 11 bands with a dry/wet bypass mix and an output trim", () => {
    const { input, dry, wet, output, bands } = build();
    expect(stage?.order).toBe(10);
    expect(stage?.input).toBe(input);
    expect(stage?.output).toBe(output);
    expect(bands).toHaveLength(11);
    expect([...input.edges]).toEqual([bands[0], dry]);
    for (const [index, band] of bands.entries()) {
      expect([...band.edges]).toEqual([index === bands.length - 1 ? wet : bands[index + 1]]);
    }
    expect([...dry.edges]).toEqual([output]);
    expect([...wet.edges]).toEqual([output]);
  });

  it("updates filters and the trim in place", () => {
    const { chain, bands, output, dry, wet } = build();
    const gains = [12, 10, 7, 3, 0, 0, 0, 0, 0, 0, 0];
    chain.apply(state({ bands: bandsFromGains(gains), outputGainDb: -3 }), "", log);
    expect(bands.map((band) => band.gain?.value)).toEqual(gains);
    expect(output.gain?.value).toBeCloseTo(10 ** (-3 / 20), 5);
    expect(dry.gain?.value).toBe(0);
    expect(wet.gain?.value).toBe(1);
    // No rebuild: the same nodes are reused while dragging.
    expect(created).toHaveLength(15);
  });

  it("is unity on the output stage while bypassed: a trim must not quieten the mix", () => {
    const { chain, bands, output, dry, wet } = build();
    const bandsIn = bandsFromGains([6, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0]);
    chain.apply(state({ bands: bandsIn, outputGainDb: -3, bypass: true }), "", log);
    expect(output.gain?.value).toBe(1);
    expect(bands.every((band) => band.gain?.value === 0)).toBe(true);
    expect(dry.gain?.value).toBe(1);
    expect(wet.gain?.value).toBe(0);

    // Un-bypassing restores both the curve and the trim.
    chain.apply(state({ bands: bandsIn, outputGainDb: -3 }), "", log);
    expect(output.gain?.value).toBeCloseTo(10 ** (-3 / 20), 5);
    expect(bands[0]?.gain?.value).toBe(6);
    expect(bands[1]?.gain?.value).toBe(0);
    expect(dry.gain?.value).toBe(0);
    expect(wet.gain?.value).toBe(1);
  });

  it("mixes extra filters in parallel from the last band, rebuilding only on change", () => {
    const { chain, bands, wet } = build();
    const last = bands[bands.length - 1]!;
    chain.apply(state(), "", log);
    expect(created).toHaveLength(15);

    const extrasJson = '[{"type":"lowshelf","frequency":80,"Q":100,"gain":12}]';
    chain.apply(state(), extrasJson, log);
    expect(created).toHaveLength(16);
    const extra = created[15]!;
    expect(extra.type).toBe("lowshelf");
    expect(extra.frequency?.value).toBe(80);
    expect(extra.Q?.value).toBe(100);
    expect(extra.gain?.value).toBe(12);
    expect([...last.edges]).toEqual([wet, extra]);
    expect([...extra.edges]).toEqual([wet]);

    // Same list: no new nodes; a new list replaces them.
    chain.apply(state(), extrasJson, log);
    expect(created).toHaveLength(16);
    chain.apply(state(), "", log);
    expect(created).toHaveLength(16);
    expect(extra.edges.size).toBe(0);
    expect([...last.edges]).toEqual([wet]);
  });

  it("drops the insert and all nodes on dispose", () => {
    const { chain, input, dry, wet, output, bands } = build();
    chain.apply(state(), '[{"type":"lowshelf","frequency":80,"Q":1,"gain":3}]', log);
    chain.dispose();
    expect(removed).toBe(true);
    for (const node of [input, dry, wet, output, ...bands]) {
      expect(node.edges.size).toBe(0);
    }
    // Idempotent, like the shared graph's unsubscribe.
    chain.dispose();
  });

  it("ignores malformed extra filters instead of throwing", () => {
    const { chain } = build();
    chain.apply(state(), "{not json", log);
    expect(log.warn).toHaveBeenCalled();
    chain.apply(state(), '[{"type":"nope","frequency":80}]', log);
    expect(created).toHaveLength(15);
  });
});
