import { beforeEach, describe, expect, it } from "vitest";
import { claimSkip, releaseSkip, resetSkipClaims } from "../src/skip.ts";

beforeEach(() => resetSkipClaims());

describe("claimSkip", () => {
  it("lets one plugin claim a track and leaves it to that plugin", () => {
    expect(claimSkip("aaaaaaaaaaa", "sfw-music")).toBe(true);
    expect(claimSkip("aaaaaaaaaaa", "skip-ai-slop")).toBe(false);
    // The same plugin may skip the track again later (repeat-all, a replaced queue).
    expect(claimSkip("aaaaaaaaaaa", "sfw-music")).toBe(true);
  });

  it("does not block a different track", () => {
    expect(claimSkip("aaaaaaaaaaa", "sfw-music")).toBe(true);
    expect(claimSkip("bbbbbbbbbbb", "skip-ai-slop")).toBe(true);
  });

  it("releases a claim when the skip could not happen", () => {
    expect(claimSkip("aaaaaaaaaaa", "skip-ai-slop")).toBe(true);
    releaseSkip("aaaaaaaaaaa", "skip-ai-slop");
    expect(claimSkip("aaaaaaaaaaa", "sfw-music")).toBe(true);
  });
});
