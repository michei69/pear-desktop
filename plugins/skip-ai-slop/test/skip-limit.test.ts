import { describe, expect, it } from "vitest";
import { createSkipLimiter } from "../skip-limit.ts";

const MAX_SKIPS = 5;
const SKIP_WINDOW_MS = 10_000;

describe("createSkipLimiter", () => {
  it("skips each id once", () => {
    const limiter = createSkipLimiter(MAX_SKIPS, SKIP_WINDOW_MS);

    expect(limiter.trySkip("video-1")).toBe(true);
    expect(limiter.has("video-1")).toBe(true);
    expect(limiter.trySkip("video-1")).toBe(false);
  });

  it("does not remember a rate-limited attempt, so it is retried when the window frees", () => {
    let now = 0;
    const limiter = createSkipLimiter(MAX_SKIPS, SKIP_WINDOW_MS, () => now);
    for (let index = 0; index < MAX_SKIPS; index++) expect(limiter.trySkip(`video-${index}`)).toBe(true);

    expect(limiter.trySkip("throttled")).toBe(false);
    expect(limiter.has("throttled")).toBe(false);

    now += SKIP_WINDOW_MS;
    expect(limiter.trySkip("throttled")).toBe(true);
    expect(limiter.has("throttled")).toBe(true);
  });

  it("evaluates a fresh arrival of the same track again after reset", () => {
    const limiter = createSkipLimiter(MAX_SKIPS, SKIP_WINDOW_MS);

    expect(limiter.trySkip("video-1")).toBe(true);
    limiter.reset("video-1");
    expect(limiter.has("video-1")).toBe(false);
    expect(limiter.trySkip("video-1")).toBe(true);
  });

  it("clear forgets the skipped ids and the budget", () => {
    const limiter = createSkipLimiter(2, SKIP_WINDOW_MS);

    expect(limiter.trySkip("video-1")).toBe(true);
    expect(limiter.trySkip("video-2")).toBe(true);
    expect(limiter.trySkip("video-3")).toBe(false);
    limiter.clear();
    expect(limiter.has("video-1")).toBe(false);
    expect(limiter.trySkip("video-3")).toBe(true);
  });
});
