import { describe, expect, test } from "vitest";
import { capabilities, pageNav } from "../nav.ts";

const queue = { fullscreen: false, itemCount: 3, selectedIndex: 1, autoplay: false, continuation: false };

describe("pageNav", () => {
  test("counts the tracks before and after the selected one", () => {
    expect(pageNav({ ...queue, selectedIndex: 0 })).toEqual({ fullscreen: false, before: 0, after: 2, more: false });
    expect(pageNav({ ...queue, selectedIndex: 2 })).toEqual({ fullscreen: false, before: 2, after: 0, more: false });
    expect(pageNav({ ...queue, selectedIndex: -1 })).toEqual({ fullscreen: false, before: 0, after: 3, more: false });
  });

  test("reports autoplay and a queue continuation as more tracks", () => {
    expect(pageNav({ ...queue, autoplay: true }).more).toBe(true);
    expect(pageNav({ ...queue, continuation: true }).more).toBe(true);
    expect(pageNav(queue).more).toBe(false);
  });

  test("carries YTM's full-screen player state", () => {
    expect(pageNav({ ...queue, fullscreen: true }).fullscreen).toBe(true);
  });
});

describe("MPRIS capabilities", () => {
  test("previous only after the first track, next while tracks follow", () => {
    expect(capabilities({ fullscreen: false, before: 0, after: 2, more: false }, "none")).toEqual({
      canGoPrevious: false,
      canGoNext: true,
    });
    expect(capabilities({ fullscreen: false, before: 2, after: 0, more: false }, "none")).toEqual({
      canGoPrevious: true,
      canGoNext: false,
    });
  });

  test("autoplay, a queue continuation or repeat-all keep next available at the end", () => {
    const atEnd = { fullscreen: false, before: 2, after: 0, more: false };
    expect(capabilities({ ...atEnd, more: true }, "none").canGoNext).toBe(true);
    expect(capabilities(atEnd, "all").canGoNext).toBe(true);
    expect(capabilities(atEnd, "one").canGoNext).toBe(false);
  });
});
