// The performance switches' page-side invariants, ported from pear-desktop's
// tests/performance-mode.test.ts and tests/performance-mode-animations.test.ts.

import { expect, test } from "vitest";
import {
  installAnimationThrottle,
  isSkippedInPerformanceMode,
  performanceModeFeatureFlags,
  performanceModeOverrides,
} from "../src/performance.ts";

test("the performance flags layer under the user overrides", () => {
  const user = { web_animated_actions: true, kevlar_tuner_thumbnail_factor: 2 };
  const merged = performanceModeOverrides(user, true);

  // A deliberate choice wins over the flags' defaults in both directions, so
  // the win cannot hide behind a flag that happens to match the input.
  expect(merged.web_animated_actions).toBe(true);
  expect(performanceModeOverrides({ web_animated_actions: false }, true).web_animated_actions).toBe(false);
  expect(merged.kevlar_tuner_thumbnail_factor).toBe(2);
  // Everything else comes from the switches.
  expect(merged.web_watch_cinematics_disabled_by_default).toBe(true);
  expect(performanceModeFeatureFlags.web_animated_actions).toBe(false);
});

test("the performance flags leave the user overrides untouched when off", () => {
  const user = { web_animated_actions: true };

  expect(performanceModeOverrides(user, false)).toEqual(user);
});

test("the performance plugins switch skips only the expensive visual plugins", () => {
  expect(isSkippedInPerformanceMode("visualizer", true)).toBe(true);
  expect(isSkippedInPerformanceMode("ambient-mode", true)).toBe(true);
  expect(isSkippedInPerformanceMode("blur-nav-bar", true)).toBe(true);

  expect(isSkippedInPerformanceMode("visualizer", false)).toBe(false);
  expect(isSkippedInPerformanceMode("synced-lyrics", true)).toBe(false);
});

interface AnimateCall {
  keyframes: unknown;
  options?: unknown;
}

interface AnimatableElement {
  animate(keyframes: unknown, options?: unknown): unknown;
}

/** Runs `run` with a bare Element stand-in, whose prototype `installAnimationThrottle` patches. */
function withElement(run: (element: AnimatableElement, calls: AnimateCall[]) => void) {
  const calls: AnimateCall[] = [];
  class FakeElement {
    animate(keyframes: unknown, options?: unknown) {
      calls.push({ keyframes, options });
      return {};
    }
  }
  const globals = globalThis as unknown as { Element: typeof globalThis.Element | undefined };
  const previous = globals.Element;
  globals.Element = FakeElement as unknown as typeof globalThis.Element;
  try {
    run(new FakeElement(), calls);
  } finally {
    globals.Element = previous;
  }
}

test("collapses animations that touch non-composited properties", () => {
  withElement((element, calls) => {
    installAnimationThrottle();

    element.animate([{ visibility: "hidden" }], { duration: 200, iterations: 1 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toMatchObject({ duration: 0, fill: "forwards", iterations: 1 });
  });
});

test("leaves composited animations alone", () => {
  withElement((element, calls) => {
    installAnimationThrottle();

    element.animate([{ opacity: 0, transform: "scale(0.9)" }], 200);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toBe(200);
  });
});

test("installing twice does not wrap the native method again", () => {
  withElement((element, calls) => {
    installAnimationThrottle();
    installAnimationThrottle();

    element.animate([{ height: "10px" }], 300);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toMatchObject({ duration: 0 });
  });
});
