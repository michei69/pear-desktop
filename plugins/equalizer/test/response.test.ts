import { describe, expect, it } from "vitest";
import { bandsFromGains, MAX_FREQUENCY, MIN_FREQUENCY } from "../config.ts";
import { interpolatedResponse } from "../response.ts";

describe("the editor curve", () => {
  it("passes through every band control dot", () => {
    const gains = [-6, 9, -18, 3, 24, -12, 7, -3, 14, -9, 5];
    const bands = bandsFromGains(gains);
    const curve = interpolatedResponse(bands);
    for (const band of bands) {
      const point = curve.find((candidate) => Math.abs(candidate.frequency - band.frequency) < 1e-6);
      expect(point).toBeDefined();
      expect(point!.db).toBeCloseTo(band.gain, 6);
    }
  });

  it("stays monotone between two control dots", () => {
    // A non-monotone request must not overshoot into the neighbouring band's range.
    const curve = interpolatedResponse(bandsFromGains([0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0]));
    for (let index = 1; index < curve.length; index += 1) {
      const previous = curve[index - 1]!;
      const current = curve[index]!;
      if (previous.frequency >= 320 && current.frequency <= 640) {
        expect(current.db).toBeLessThanOrEqual(previous.db + 1e-9);
      }
    }
  });

  it("samples the whole audible range, sorted, through the flat layout", () => {
    const curve = interpolatedResponse(bandsFromGains([]));
    expect(curve.length).toBeGreaterThanOrEqual(400);
    expect(curve[0]?.frequency).toBeCloseTo(MIN_FREQUENCY, 6);
    expect(curve.at(-1)?.frequency).toBeCloseTo(MAX_FREQUENCY, 6);
    expect(curve.every((point, index) => index === 0 || point.frequency > curve[index - 1]!.frequency)).toBe(true);
    expect(curve.every((point) => Math.abs(point.db) < 1e-9)).toBe(true);
  });
});
