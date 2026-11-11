import { describe, expect, test } from "vitest";
import { DEFAULT_THRESHOLD_MB, liveBytes, thresholdBytesFor } from "../usage.ts";

const MB = 1024 * 1024;

describe("liveBytes", () => {
  test("sums the live bytes of every Blink cache bucket", () => {
    expect(
      liveBytes({
        images: { liveSize: 1024, size: 4096 },
        scripts: { liveSize: 2048 },
        fonts: { liveSize: 0 },
      }),
    ).toBe(3072);
  });

  test("missing or unusable usage reports nothing rather than throwing", () => {
    expect(liveBytes(undefined)).toBe(0);
    expect(liveBytes(null)).toBe(0);
    expect(liveBytes("nope")).toBe(0);
    expect(liveBytes({ images: undefined, cssStyleSheets: {} })).toBe(0);
  });
});

describe("thresholdBytesFor", () => {
  test("converts the stored megabytes", () => {
    expect(thresholdBytesFor(128)).toBe(128 * MB);
    expect(thresholdBytesFor("32")).toBe(32 * MB);
  });

  test("a value that is not a positive number falls back to the default", () => {
    for (const value of [0, -1, Number.NaN, Infinity, undefined, "abc"]) {
      expect(thresholdBytesFor(value)).toBe(DEFAULT_THRESHOLD_MB * MB);
    }
  });
});
