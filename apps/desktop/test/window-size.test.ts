import { describe, expect, test } from "vitest";
import { DEFAULT_WINDOW_SIZE, MIN_HEIGHT, MIN_WIDTH } from "../src/main/window-size.ts";

describe("main window geometry", () => {
  test("matches pear-desktop's default and minimum sizes", () => {
    // A regression guard: these were once silently reverted to 360/300 and 1280×800.
    expect([MIN_WIDTH, MIN_HEIGHT]).toEqual([325, 425]);
    expect(DEFAULT_WINDOW_SIZE).toEqual({ width: 1100, height: 550 });
  });
});
