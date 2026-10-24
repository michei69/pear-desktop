// The fade engine: the video's gain in the shared graph, and the equal-power
// curves it and the second stream are ramped along.

import type { AudioGraph } from "@pear/sdk";
import type { Ctx } from "./schema.ts";

// Late in the shared graph: fades apply after effects, before visualizer taps.
const ORDER = 50;
const CURVE_POINTS = 256;
/** Ramps shorter than this jump straight to their end. */
const MIN_RAMP_S = 0.01;

/**
 * Gain for a normalized fade position (0 silent → 1 full). Equal power is the
 * default: two copies of a track cross over it without a dip in the middle.
 */
const fadeLevel = (ctx: Ctx, position: number) => {
  const progress = Math.min(1, Math.max(0, position));
  const scaling = ctx.config.fadeScaling;
  if (scaling === "linear") return progress;
  if (scaling === "equalPower") return Math.sin((progress * Math.PI) / 2);
  // Logarithmic over the configured dynamic range; zero is silence, not a
  // fraction of the range.
  return progress === 0 ? 0 : 10 ** (((progress - 1) * ctx.config.dynamicRange) / 20);
};

/**
 * A curve for the audio thread to follow, from fade progress `from` to `to`. A
 * fade in samples the level forwards, a fade out backwards, so the two keep a
 * constant combined power where they overlap.
 */
export const fadeCurve = (ctx: Ctx, direction: "in" | "out", from = 0, to = 1) => {
  const curve = new Float32Array(CURVE_POINTS);
  for (let point = 0; point < CURVE_POINTS; point += 1) {
    const progress = from + ((to - from) * point) / (CURVE_POINTS - 1);
    curve[point] = fadeLevel(ctx, direction === "in" ? progress : 1 - progress);
  }
  return curve;
};

export function createFader(ctx: Ctx, graph: AudioGraph) {
  const { context } = graph;
  const gain = context.createGain();
  graph.insert(gain, gain, ORDER);

  return {
    /** Fades from one position to another over `seconds`, optionally starting at a later context time. */
    ramp(from: number, to: number, seconds: number, start = context.currentTime) {
      gain.gain.cancelScheduledValues(start);
      if (seconds <= MIN_RAMP_S) return gain.gain.setValueAtTime(fadeLevel(ctx, to), start);
      const curve = to >= from ? fadeCurve(ctx, "in", from, to) : fadeCurve(ctx, "out", 1 - from, 1 - to);
      gain.gain.setValueCurveAtTime(curve, start, seconds);
    },
    /**
     * Moves the current level to `value` linearly, over the handover splice: the
     * two copies are the same signal, so a constant sum is what keeps it clickless.
     */
    splice(to: number, seconds: number) {
      const now = context.currentTime;
      gain.gain.cancelAndHoldAtTime(now);
      if (seconds <= 0) return gain.gain.setValueAtTime(to, now);
      gain.gain.linearRampToValueAtTime(to, now + seconds);
    },
    /** Stops any fade at a fixed gain. */
    hold(value: number) {
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setValueAtTime(value, context.currentTime);
    },
    /** Stops any fade where it is. */
    freeze() {
      gain.gain.cancelAndHoldAtTime(context.currentTime);
    },
  };
}
