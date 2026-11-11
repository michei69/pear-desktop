import { expect, test } from "vitest";
import { format, MAX_SPEED, MIN_SPEED, normalize } from "../speed.ts";

test("an unusable speed falls back to normal playback", () => {
  // The panel's range input and a future config source can both echo NaN back.
  for (const value of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    expect(normalize(value)).toBe(1);
  }
});

test("a speed outside the player range is clamped to it", () => {
  expect(normalize(0.001)).toBe(MIN_SPEED);
  expect(normalize(100)).toBe(MAX_SPEED);
});

test("the speed is kept to the two decimals the player accepts", () => {
  expect(normalize(1.239)).toBe(1.24);
  expect(format(1.5)).toBe("1.5×");
  expect(format(1)).toBe("1×");
});
