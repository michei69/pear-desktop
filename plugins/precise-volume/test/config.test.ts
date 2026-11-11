import { describe, expect, test } from "vitest";
import { isVolume } from "../config.ts";

describe("saved volume", () => {
  test("only percentages the player can take are restored", () => {
    expect(isVolume(0)).toBe(true);
    expect(isVolume(100)).toBe(true);
    // -1 is the "nothing saved yet" default.
    expect(isVolume(-1)).toBe(false);
    expect(isVolume(101)).toBe(false);
    expect(isVolume(Number.NaN)).toBe(false);
    expect(isVolume("42")).toBe(false);
  });
});
