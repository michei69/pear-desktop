import type { AudioGraph } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import { createFader, fadeCurve } from "../fade.ts";
import type { Ctx } from "../schema.ts";

type FadeScaling = Ctx["config"]["fadeScaling"];

/** The crossfade's config as the fade math reads it. */
const ctxOf = (fadeScaling: FadeScaling = "equalPower", dynamicRange = 60) => ({ config: { fadeScaling, dynamicRange } }) as unknown as Ctx;

const peakOf = (curve: Float32Array) => Math.max(...curve);

/** An AudioParam that keeps the curve it was handed. */
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

function faderOf(fadeScaling: FadeScaling = "equalPower", dynamicRange = 60) {
  const context = { currentTime: 2, createGain: () => new FakeGain() } as unknown as AudioContext;
  let stage: { input: unknown; order: number } | undefined;
  const graph = {
    context,
    insert(input: AudioNode, _output: AudioNode = input, order = 0) {
      stage = { input, order };
      return () => {};
    },
    tap: () => () => {},
  } as unknown as AudioGraph;
  const fader = createFader(ctxOf(fadeScaling, dynamicRange), graph);
  const gain = (stage!.input as FakeGain).gain;
  return { fader, gain: () => gain, stage: () => stage };
}

describe("the fade curve", () => {
  it("holds a constant combined power for an equal-power crossfade", () => {
    const fadeIn = fadeCurve(ctxOf("equalPower"), "in");
    const fadeOut = fadeCurve(ctxOf("equalPower"), "out");
    for (let point = 0; point < fadeIn.length; point += 1) {
      expect(fadeIn[point]! ** 2 + fadeOut[point]! ** 2).toBeCloseTo(1, 6);
    }
  });

  it("reaches both endpoints in every scaling", () => {
    for (const scaling of ["linear", "equalPower", "logarithmic"] as const) {
      const fadeIn = fadeCurve(ctxOf(scaling), "in");
      expect(fadeIn[0]).toBe(0);
      expect(peakOf(fadeIn)).toBeCloseTo(1, 6);
      expect(fadeIn.at(-1)).toBeCloseTo(1, 6);
    }
  });

  it("interpolates linearly for linear scaling", () => {
    const quarter = fadeCurve(ctxOf("linear"), "in", 0.25, 0.25);
    expect(quarter[0]).toBeCloseTo(0.25, 6);
    expect(fadeCurve(ctxOf("equalPower"), "in", 0.5, 0.5)[0]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("expands the configured dynamic range in dB", () => {
    // Halfway through a 20 dB range is 10 dB down; the default 60 dB sits 30 dB down.
    expect(fadeCurve(ctxOf("logarithmic", 20), "in", 0.5, 0.5)[0]).toBeCloseTo(10 ** -0.5, 6);
    expect(fadeCurve(ctxOf("logarithmic"), "in", 0.5, 0.5)[0]).toBeCloseTo(10 ** -1.5, 6);
    // Zero progress is silence, not the bottom of the range.
    expect(fadeCurve(ctxOf("logarithmic"), "in")[0]).toBe(0);
  });

  it("samples a sub-range from where a resumed fade stands", () => {
    // A fade-in resumed at 50% starts at the level it was frozen on.
    const resumed = fadeCurve(ctxOf("equalPower"), "in", 0.5, 1);
    expect(resumed[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(resumed.at(-1)).toBeCloseTo(1, 6);
    // A fade-out samples the same scaler backwards: its first point is the level
    // of the progress it starts at, its last the level of where it ends.
    const tail = fadeCurve(ctxOf("linear"), "out", 0.2, 0.8);
    expect(tail[0]).toBeCloseTo(0.8, 6);
    expect(tail.at(-1)).toBeCloseTo(0.2, 6);
  });
});

describe("the fader", () => {
  it("inserts its gain late in the shared graph and schedules a curve", () => {
    const { fader, gain, stage } = faderOf();
    expect(stage()?.order).toBe(50);
    fader.ramp(0, 1, 2);
    const { curve, start, duration } = gain().curves[0]!;
    expect(curve[0]).toBe(0);
    expect(curve.at(-1)).toBeCloseTo(1, 6);
    expect(curve).toHaveLength(256);
    expect(start).toBe(2);
    expect(duration).toBe(2);
  });

  it("runs a fade out backwards", () => {
    const { fader, gain } = faderOf();
    fader.ramp(1, 0, 2);
    const curve = gain().curves[0]!.curve;
    expect(curve[0]).toBeCloseTo(1, 6);
    expect(curve.at(-1)).toBe(0);
  });

  it("jumps to the end for a ramp too short to schedule", () => {
    const { fader, gain } = faderOf();
    fader.ramp(0.2, 1, 0.001);
    expect(gain().calls).toContain("setValueAtTime");
    expect(gain().value).toBe(1);
    expect(gain().curves).toHaveLength(0);
  });

  it("holds and freezes at a fixed level", () => {
    const { fader, gain } = faderOf();
    fader.hold(0.25);
    expect(gain().calls).toContain("setValueAtTime");
    expect(gain().value).toBe(0.25);
    fader.freeze();
    expect(gain().calls).toContain("cancelAndHoldAtTime");
  });

  it("splices to a level over a linear ramp", () => {
    const { fader, gain } = faderOf();
    fader.splice(1, 0.05);
    expect(gain().calls).toContain("cancelAndHoldAtTime");
    expect(gain().calls).toContain("linearRampToValueAtTime");
    expect(gain().value).toBe(1);
  });
});
