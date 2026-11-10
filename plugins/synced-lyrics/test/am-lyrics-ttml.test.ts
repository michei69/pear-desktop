import { describe, expect, test } from "vitest";
import { synthesizeTTML } from "../am-lyrics/ttml.ts";
import { parseTTML } from "../ttml.ts";
import type { LyricLine } from "../types.ts";

const line = (over: Partial<LyricLine>): LyricLine => ({ startMs: 0, endMs: 1000, text: "", ...over });

describe("synthesizeTTML", () => {
  test("word-synced lines keep their text, begin/end and word timings", () => {
    const ttml = synthesizeTTML([
      line({
        startMs: 1000,
        endMs: 3000,
        text: "Hello world",
        words: [
          { startMs: 1000, endMs: 1500, text: "Hello " },
          { startMs: 1500, endMs: 2200, text: "world" },
        ],
      }),
    ]);

    expect(ttml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(ttml).toContain('xmlns:ttm="http://www.w3.org/ns/ttml#metadata"');
    expect(ttml).toContain('xmlns:itunes="http://music.apple.com/lyrics"');

    const parsed = parseTTML(ttml)!;
    expect(parsed.lines).toHaveLength(1);

    const [synced] = parsed.lines;
    expect(synced).toMatchObject({ startMs: 1000, endMs: 3000, text: "Hello world" });
    expect(synced!.words.map(({ startMs, endMs }) => ({ startMs, endMs }))).toStrictEqual([
      { startMs: 1000, endMs: 1500 },
      { startMs: 1500, endMs: 2200 },
    ]);
  });

  test("lines without words stay line-synced", () => {
    const parsed = parseTTML(synthesizeTTML([line({ startMs: 4000, endMs: 6000, text: "Just a line" })]))!;

    expect(parsed.lines[0]).toMatchObject({ startMs: 4000, endMs: 6000, text: "Just a line", words: [] });
  });

  test('background vocals round-trip through ttm:role="x-bg"', () => {
    const ttml = synthesizeTTML([
      line({
        startMs: 1000,
        endMs: 3000,
        text: "Hello world",
        words: [
          { startMs: 1000, endMs: 1500, text: "Hello " },
          { startMs: 1500, endMs: 2200, text: "world" },
        ],
        background: [
          { startMs: 2300, endMs: 2600, text: "(ooh " },
          { startMs: 2600, endMs: 2900, text: "yeah)" },
        ],
      }),
    ]);

    expect(ttml).toContain('ttm:role="x-bg"');

    const [synced] = parseTTML(ttml)!.lines;
    expect(synced!.words.map((word) => word.text)).toStrictEqual(["Hello ", "world"]);
    expect(synced!.background.map((word) => word.text)).toStrictEqual(["(ooh ", "yeah)"]);
    expect(synced!.background.map((word) => word.startMs)).toStrictEqual([2300, 2600]);
  });

  test("duet alignment round-trips, including a song that opens on the right", () => {
    const parsed = parseTTML(
      synthesizeTTML([
        line({ startMs: 0, endMs: 1000, text: "Left", alignment: "start" }),
        line({ startMs: 1000, endMs: 2000, text: "Right", alignment: "end" }),
        line({ startMs: 2000, endMs: 3000, text: "Left again", alignment: "start" }),
        line({ startMs: 3000, endMs: 4000, text: "Untagged" }),
        line({ startMs: 4000, endMs: 5000, text: "Right again", alignment: "end" }),
      ]),
    )!;

    expect(parsed.lines.map((entry) => entry.alignment)).toStrictEqual(["start", "end", "start", undefined, "end"]);

    const rightOpening = parseTTML(
      synthesizeTTML([
        line({ startMs: 0, endMs: 1000, text: "Right", alignment: "end" }),
        line({ startMs: 1000, endMs: 2000, text: "Left", alignment: "start" }),
      ]),
    )!;
    expect(rightOpening.lines.map((entry) => entry.alignment)).toStrictEqual(["end", "start"]);
  });

  test('rtl lines carry dir="rtl"', () => {
    const ttml = synthesizeTTML([line({ startMs: 6000, endMs: 8000, text: "שלום עולם", rtl: true })]);
    expect(ttml).toContain('dir="rtl"');
    expect(parseTTML(ttml)!.lines[0]!.rtl).toBe(true);
  });

  test("non-finite durations still produce finite TTML times", () => {
    const ttml = synthesizeTTML([
      line({ startMs: 0, endMs: 0, text: "zero length" }),
      line({
        startMs: 5000,
        endMs: Number.POSITIVE_INFINITY,
        text: "last line",
        words: [{ startMs: 5000, endMs: 5500, text: "last " }],
      }),
    ]);

    expect(ttml).not.toContain("Infinity");
    expect(ttml).not.toContain("NaN");

    const parsed = parseTTML(ttml)!;
    expect(parsed.lines).toHaveLength(2);
    for (const parsedLine of parsed.lines) {
      expect(Number.isFinite(parsedLine.startMs)).toBe(true);
      expect(Number.isFinite(parsedLine.endMs)).toBe(true);
      expect(parsedLine.endMs).toBeGreaterThanOrEqual(parsedLine.startMs);
    }
  });

  test("translations ride along as <translation><text for> entries", () => {
    const ttml = synthesizeTTML(
      [
        line({ startMs: 0, endMs: 1000, text: "Hello" }),
        line({ startMs: 1000, endMs: 2000, text: "World" }),
        line({ startMs: 2000, endMs: 3000, text: "Untranslated" }),
      ],
      { translations: ["Bonjour", "  ", null], translationLanguage: "fr" },
    );

    expect(ttml).toContain('<translation xml:lang="fr">');
    expect(ttml).toContain('<text for="L1">Bonjour</text>');
    expect(ttml).not.toContain('for="L2"');
    expect(ttml).not.toContain('for="L3"');

    expect(parseTTML(ttml)!.translations).toStrictEqual({ L1: "Bonjour" });
  });

  test("text lines keep their text and escaping", () => {
    const parsed = parseTTML(
      synthesizeTTML([line({ startMs: 0, endMs: 500, text: "Rock & Roll <3" }), line({ startMs: 500, endMs: 1000, text: "Bye" })]),
    )!;

    expect(parsed.lines.map((entry) => entry.text)).toStrictEqual(["Rock & Roll <3", "Bye"]);
  });

  test("an interlude marker leaves a timed gap instead of an empty row", () => {
    const parsed = parseTTML(
      synthesizeTTML([
        line({ startMs: 10_000, endMs: 12_000, text: "Before the break" }),
        line({ startMs: 12_000, endMs: 20_000, text: "" }),
        line({ startMs: 20_000, endMs: 22_000, text: "After the break" }),
      ]),
    )!;

    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]!.endMs).toBe(12_000);
    expect(parsed.lines[1]!.startMs).toBe(20_000);
    expect(parsed.lines[1]!.startMs - parsed.lines[0]!.endMs).toBeGreaterThan(7000);
  });

  test("a long intro marker also becomes a gap, not a first blank row", () => {
    const parsed = parseTTML(
      synthesizeTTML([line({ startMs: 0, endMs: 9000, text: "" }), line({ startMs: 9000, endMs: 11_000, text: "First words" })]),
    )!;

    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]!.startMs).toBe(9000);
  });

  test("lines with only word timings still render", () => {
    const parsed = parseTTML(
      synthesizeTTML([line({ startMs: 1000, endMs: 2000, text: "", words: [{ startMs: 1000, endMs: 1400, text: "word " }] })]),
    )!;

    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]!.text.trim()).toBe("word");
  });

  test("a translation for a dropped interlude marker is not emitted", () => {
    const ttml = synthesizeTTML(
      [
        line({ startMs: 0, endMs: 1000, text: "Hello" }),
        line({ startMs: 1000, endMs: 2000, text: "" }),
        line({ startMs: 2000, endMs: 3000, text: "World" }),
      ],
      { translations: ["Bonjour", "Interlude", "Monde"] },
    );

    expect(ttml).toContain('<text for="L1">Bonjour</text>');
    expect(ttml).not.toContain("Interlude");
    expect(ttml).toContain('<text for="L3">Monde</text>');
  });
});
