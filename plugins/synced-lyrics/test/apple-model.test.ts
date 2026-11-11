import { describe, expect, test } from "vitest";
import { buildAppleLyrics, isPreActive, progressAt, timelineAt } from "../page/apple/model.ts";
import type { LyricLine } from "../types.ts";

const line = (startMs: number, endMs: number, text: string, extra: Partial<LyricLine> = {}): LyricLine => ({
  startMs,
  endMs,
  text,
  ...extra,
});

describe("the Apple Music timeline model", () => {
  test("drops blank interlude markers into one intro gap", () => {
    const lyrics = buildAppleLyrics([line(0, 8000, ""), line(8000, 12000, "First")]);
    expect(lyrics.rows.map((row) => row.kind)).toEqual(["gap", "line"]);
    expect(lyrics.rows[0]).toMatchObject({ startMs: 0, endMs: 8000 });
  });

  test("shows the dots for a long break between lines, and the intro", () => {
    const lyrics = buildAppleLyrics([line(0, 2000, "A"), line(2000, 4000, "B"), line(14000, 16000, "C")]);
    expect(lyrics.rows.map((row) => (row.kind === "gap" ? `gap ${row.startMs}-${row.endMs}` : row.text))).toEqual([
      "A",
      "B",
      "gap 4000-14000",
      "C",
    ]);
  });

  test("a break shorter than seven seconds stays in the normal flow", () => {
    const lyrics = buildAppleLyrics([line(0, 2000, "A"), line(6000, 8000, "B")]);
    expect(lyrics.rows.map((row) => row.kind)).toEqual(["line", "line"]);
  });

  test("a line without an end lasts until the next line; the last one gets a fallback", () => {
    const lyrics = buildAppleLyrics([line(0, 0, "A"), line(5000, 0, "B")]);
    expect(lyrics.rows.map((row) => row.endMs)).toEqual([5000, 10200]);
  });

  test("words inherit the next word or line end", () => {
    const lyrics = buildAppleLyrics([
      line(1000, 3000, "one two", {
        words: [
          { text: "one ", startMs: 1000, endMs: 0 },
          { text: "two", startMs: 2000, endMs: 0 },
        ],
      }),
    ]);
    const row = lyrics.rows[0];
    expect(row?.kind).toBe("line");
    if (row?.kind !== "line") return;
    expect(row.words.map((word) => word.endMs)).toEqual([2000, 3000]);
  });

  test("translations follow the source line index and skip identical text", () => {
    const lyrics = buildAppleLyrics([line(0, 1000, "Hello"), line(1000, 2000, "World")], ["Hallo", "World"]);
    expect(lyrics.rows.map((row) => (row.kind === "line" ? row.translation : null))).toEqual(["Hallo", null]);
  });

  test("finds the active line, the gap, and the row to scroll to", () => {
    const lyrics = buildAppleLyrics([line(0, 8000, ""), line(8000, 12000, "First"), line(20000, 24000, "Second")]);
    expect(timelineAt(lyrics, 3000)).toMatchObject({ inGap: true, activeLine: -1 });
    expect(timelineAt(lyrics, 9000)).toMatchObject({ activeLine: lyrics.rows.findIndex((row) => row.kind === "line"), inGap: false });
    // During the second gap, the next line is the scroll target.
    const during = timelineAt(lyrics, 16000);
    const gap = lyrics.rows.findIndex((row) => row.kind === "gap" && row.startMs < 16000 && row.endMs > 16000);
    const second = lyrics.rows.findIndex((row) => row.kind === "line" && row.text === "Second");
    expect(during.scrollRow).toBe(gap);
    expect(during.nextLine).toBe(second);
  });

  test("pre-activates only the upcoming line, shortly before it starts", () => {
    const lyrics = buildAppleLyrics([line(0, 5000, "A"), line(6000, 8000, "B")]);
    const state = timelineAt(lyrics, 5600);
    expect(isPreActive(lyrics, timelineAt(lyrics, 4000), 4000)).toBe(false);
    expect(isPreActive(lyrics, state, 5600)).toBe(true);
    expect(isPreActive(lyrics, timelineAt(lyrics, 6000), 6000)).toBe(false);
  });

  test("detects RTL text and real duet pairs", () => {
    const rtl = buildAppleLyrics([line(0, 1000, "\u05e9\u05dc\u05d5\u05dd")]);
    expect(rtl.rows[0]).toMatchObject({ kind: "line", rtl: true });
    expect(buildAppleLyrics([line(0, 1000, "Left")]).hasDuet).toBe(false);
    expect(buildAppleLyrics([line(0, 1000, "Right", { alignment: "end" })]).hasDuet).toBe(false);
    expect(buildAppleLyrics([line(0, 1000, "Left"), line(1000, 2000, "Right", { alignment: "end" })]).hasDuet).toBe(true);
  });

  test("uses the converted display text when given", () => {
    const lyrics = buildAppleLyrics([line(0, 1000, "国")], [], ["國"]);
    expect(lyrics.rows.find((row) => row.kind === "line")?.text).toBe("國");
  });

  test("the last line retires shortly after its end", () => {
    const lyrics = buildAppleLyrics([line(0, 1000, "Only")]);
    expect(timelineAt(lyrics, 1100).activeLine).toBe(0);
    expect(timelineAt(lyrics, 1300).activeLine).toBe(-1);
  });

  test("progress clamps before and after a range", () => {
    expect(progressAt(1500, 1000, 2000)).toBe(0.5);
    expect(progressAt(500, 1000, 2000)).toBe(0);
    expect(progressAt(2500, 1000, 2000)).toBe(1);
  });
});
