// The shared graph's wiring: stages in order, and external streams joining at
// their requested boundary (after lower-order stages, before higher ones).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioGraph } from "../src/audio.ts";

class FakeNode {
  readonly edges = new Set<FakeNode>();

  connect(target: FakeNode) {
    this.edges.add(target);
    return target;
  }

  disconnect() {
    this.edges.clear();
  }
}

class FakeGain extends FakeNode {
  readonly gain = { value: 1 };
}

class FakeContext {
  readonly destination = new FakeNode();

  createGain() {
    return new FakeGain();
  }

  createMediaElementSource() {
    return new FakeNode();
  }
}

const fakeVideo = () => ({ crossOrigin: null, src: "", paused: true, addEventListener: () => {} }) as unknown as HTMLVideoElement;

/** The one node `node` feeds, for a chain that is linear at that point. */
const next = (node: FakeNode) => {
  const [target] = node.edges;
  if (!target) throw new Error("no outgoing edge");
  return target;
};

const stageOf = (graph: AudioGraph, order: number) => {
  const input = new FakeGain();
  const output = new FakeGain();
  const remove = graph.insert(input as unknown as AudioNode, output as unknown as AudioNode, order);
  return { input, output, remove };
};

describe("the shared graph's external streams", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joins after the stages at or below its order, before the higher ones", () => {
    const graph = new AudioGraph(fakeVideo());
    const fader = stageOf(graph, -50);
    const skip = stageOf(graph, -100);
    const eq = stageOf(graph, 10);
    const source = graph.source as unknown as FakeNode;

    const external = new FakeGain();
    graph.connectExternal(external as unknown as AudioNode, 0);

    // Video: source -> skip (-100) -> fader (-50) -> boundary mix -> equalizer.
    expect(next(source)).toBe(skip.input);
    expect(next(skip.output)).toBe(fader.input);
    const mix = next(fader.output);
    expect(mix).not.toBe(eq.input);
    expect(mix.edges.has(eq.input)).toBe(true);
    // The external joins that boundary mix: the fader never processes it, the
    // equalizer (ordered above 0) does.
    expect(next(external)).toBe(mix);
    expect(fader.input.edges.has(external)).toBe(false);
    expect(fader.output.edges.has(external)).toBe(false);
  });

  it("drops the boundary mix and the source on unsubscribe", () => {
    const graph = new AudioGraph(fakeVideo());
    const fader = stageOf(graph, -50);
    const eq = stageOf(graph, 10);
    const external = new FakeGain();
    const disconnect = graph.connectExternal(external as unknown as AudioNode, 0);
    const mix = next(fader.output);
    expect(mix.edges.has(eq.input)).toBe(true);

    disconnect();
    expect(mix.edges.size).toBe(0);
    expect(external.edges.size).toBe(0);
    // No external left: the video runs straight into the equalizer again.
    expect(next(fader.output)).toBe(eq.input);
  });

  it("joins at the bus when no stage is ordered above it", () => {
    const graph = new AudioGraph(fakeVideo());
    const fader = stageOf(graph, -50);
    const external = new FakeGain();
    graph.connectExternal(external as unknown as AudioNode, 0);
    const mix = next(fader.output);
    // The last stage feeds the boundary mix, which feeds the bus (the only
    // node reaching the destination).
    expect(mix.edges.size).toBe(1);
    expect([...mix.edges][0]!.edges.has((graph.context as unknown as FakeContext).destination)).toBe(true);
  });
});
