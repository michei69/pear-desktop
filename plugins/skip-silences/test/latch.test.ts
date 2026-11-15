import { describe, expect, it } from "vitest";
import { afterSeek, createLatch, FIRST_BIN, HISTORY, INTERVAL_MS, resetLatch, sample, shouldSkip, THRESHOLD_DB } from "../latch.ts";

const quiet = { loud: false, muted: false };
const loud = { loud: true, muted: false };

/** Feeds the latch `count` samples of the same kind. */
function feed(count: number, value: { loud: boolean; muted: boolean }) {
  const latch = createLatch();
  const latched: number[] = [];
  for (let index = 0; index < count; index++) {
    if (sample(latch, value)) latched.push(index);
  }
  return { latch, latched };
}

describe("the 250 ms silence window", () => {
  it("samples at master's 25 ms, so the history covers a quarter second", () => {
    expect(INTERVAL_MS).toBe(25);
    expect(INTERVAL_MS * HISTORY).toBe(250);
    expect(FIRST_BIN).toBe(4);
    expect(THRESHOLD_DB).toBe(-100);
  });

  it("latches only after the whole history is quiet", () => {
    // From the start (all zeros) the first quiet sample is already a full quiet history.
    expect(feed(1, quiet).latched).toEqual([0]);
  });

  it("does not latch a short gap after audio", () => {
    const latch = createLatch();
    for (let index = 0; index < 3; index++) sample(latch, loud);
    // 4 samples = 100 ms of a breath; master's 10-sample history ignores it.
    for (let index = 0; index < 4; index++) expect(sample(latch, quiet)).toBe(false);
    expect(latch.silent).toBe(false);
  });

  it("latches after ten samples of true silence", () => {
    const latch = createLatch();
    for (let index = 0; index < 3; index++) sample(latch, loud);
    for (let index = 0; index < 10; index++) expect(sample(latch, quiet)).toBe(false);
    expect(latch.silent).toBe(false);
    // The tenth quiet slot is checked before the sample is shifted in, so the
    // latch waits for 11 quiet samples (~275 ms): master behaves identically.
    expect(sample(latch, quiet)).toBe(true);
    expect(latch.silent).toBe(true);
  });

  it("never latches while seeking, ended, muted or at volume 0", () => {
    const latch = createLatch();
    for (let index = 0; index < 12; index++) expect(sample(latch, { loud: false, muted: true })).toBe(false);
    expect(latch.silent).toBe(false);
  });

  it("un-latches once two of the last three recorded samples are loud", () => {
    const latch = createLatch();
    expect(sample(latch, quiet)).toBe(true);
    // The current sample is checked against the history, then recorded, so two
    // preceding loud samples are needed to resume.
    expect(sample(latch, loud)).toBe(false);
    expect(latch.silent).toBe(true);
    expect(sample(latch, loud)).toBe(false);
    expect(latch.silent).toBe(true);
    expect(sample(latch, loud)).toBe(false);
    expect(latch.silent).toBe(false);
    expect(latch.audioStarted).toBe(true);
  });
});

describe("the skip decision", () => {
  const conditions = { onlySkipBeginning: false, paused: false, ad: false };

  it("only seeks a latched silence while playing, never during an ad", () => {
    const latch = createLatch();
    expect(shouldSkip(latch, conditions)).toBe(false);
    sample(latch, quiet);
    expect(shouldSkip(latch, conditions)).toBe(true);
    expect(shouldSkip(latch, { ...conditions, paused: true })).toBe(false);
    expect(shouldSkip(latch, { ...conditions, ad: true })).toBe(false);
  });

  it("skips the beginning until real audio is heard", () => {
    const latch = createLatch();
    const beginningOnly = { ...conditions, onlySkipBeginning: true };
    sample(latch, quiet);
    expect(shouldSkip(latch, beginningOnly)).toBe(true);
    // Audio was heard: the rest of the track is left alone.
    for (let index = 0; index < 3; index++) sample(latch, loud);
    sample(latch, quiet);
    expect(latch.silent).toBe(false);
  });

  it("keeps the beginning-only latch across the tracker's own seek", () => {
    const latch = createLatch();
    const beginningOnly = { ...conditions, onlySkipBeginning: true };
    for (let index = 0; index < 3; index++) sample(latch, loud);
    expect(latch.audioStarted).toBe(true);
    for (let index = 0; index < 12; index++) sample(latch, quiet);
    expect(latch.silent).toBe(true);

    // skip() moves currentTime, YTM answers with `seeked`; afterSeek drops the
    // stale samples only, so a self-induced seek cannot re-arm the setting.
    afterSeek(latch);
    expect(latch.audioStarted).toBe(true);
    expect(shouldSkip(latch, beginningOnly)).toBe(false);
  });

  it("re-arms beginning-only skipping for a new track", () => {
    const latch = createLatch();
    for (let index = 0; index < 3; index++) sample(latch, loud);
    resetLatch(latch);
    expect(latch.audioStarted).toBe(false);
    expect(latch.silent).toBe(false);
    expect(latch.history).toEqual(Array.from({ length: HISTORY }, () => 0));
    sample(latch, quiet);
    expect(shouldSkip(latch, { ...conditions, onlySkipBeginning: true })).toBe(true);
  });
});
