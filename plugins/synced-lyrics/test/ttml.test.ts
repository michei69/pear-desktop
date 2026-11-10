import { describe, expect, test } from "vitest";
import { parseTTML, parseTTMLTime } from "../ttml.ts";

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:lrc="http://lrc.red/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="en">
  <head>
    <metadata>
      <ttm:agent type="person" xml:id="v1"/>
      <ttm:agent type="person" xml:id="v2"/>
      <ttm:translation xml:lang="ja"><ttm:text for="L1">こんにちは世界</ttm:text></ttm:translation>
      <ttm:translation xml:lang="en"><ttm:text for="L2">same language, dropped</ttm:text></ttm:translation>
    </metadata>
  </head>
  <body>
    <div lrc:songPart="Verse">
      <p begin="1.0" end="3.0" lrc:key="L1" ttm:agent="v1"><span begin="1.0" end="1.5">Hello</span> <span begin="1.5" end="2.2">world</span> <span ttm:role="x-bg"><span begin="2.3" end="2.6">(ooh</span> <span begin="2.6" end="2.9">yeah)</span></span></p>
      <p begin="4.0" end="6.0" lrc:key="L2" ttm:agent="v2"><span begin="4.0" end="5.0">Second</span> <span begin="5.0" end="6.0">singer</span></p>
      <p begin="7.0" end="9.0"></p>
    </div>
  </body>
</tt>`;

describe("parseTTML", () => {
  test("word and syllable timings, background vocals and line end", () => {
    const result = parseTTML(TTML);
    expect(result).not.toBeNull();

    const [first, second, gap] = result!.lines;

    expect(first).toMatchObject({ startMs: 1000, endMs: 3000, text: "Hello world" });
    expect(first!.words).toStrictEqual([
      { startMs: 1000, endMs: 1500, text: "Hello " },
      { startMs: 1500, endMs: 2200, text: "world " },
    ]);
    expect(first!.background).toStrictEqual([
      { startMs: 2300, endMs: 2600, text: "(ooh " },
      { startMs: 2600, endMs: 2900, text: "yeah)" },
    ]);

    expect(second).toMatchObject({ startMs: 4000, endMs: 6000, text: "Second singer" });
    expect(second!.words.map((word) => word.endMs - word.startMs)).toStrictEqual([1000, 1000]);

    // An empty <p> is an instrumental gap the renderer shows its dots for.
    expect(gap).toMatchObject({ startMs: 7000, endMs: 9000, text: "" });
  });

  test("translations keep the other-language lines only", () => {
    const result = parseTTML(TTML)!;
    expect(result.translations).toStrictEqual({ L1: "こんにちは世界" });
    expect(result.translationLanguage).toBe("ja");
  });

  test("duet lines alternate sides and untagged lines stay centered", () => {
    const result = parseTTML(TTML)!;
    expect(result.lines.map((line) => line.alignment)).toStrictEqual(["start", "end", undefined]);
  });

  test("right-to-left documents mark their lines", () => {
    const result = parseTTML(`<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="he">
  <body><div><p begin="1.0" end="2.0"><span begin="1.0" end="1.5">שלום</span></p></div></body>
</tt>`)!;

    expect(result.lines[0]!.rtl).toBe(true);
  });

  test("line-synced TTML has text but no word timings", () => {
    const result = parseTTML(`<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
  <p begin="0:01.000" end="0:03.000">Just a line</p>
</div></body></tt>`)!;

    expect(result.lines[0]).toMatchObject({ startMs: 1000, endMs: 3000, text: "Just a line", words: [] });
  });

  test("a line without an end runs until the next line", () => {
    const result = parseTTML(`<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
  <p begin="1.0">First</p>
  <p begin="4.0">Second</p>
</div></body></tt>`)!;

    expect(result.lines.map((line) => line.endMs)).toStrictEqual([4000, 4000]);
  });

  test("times accept clock, seconds and unit-suffixed forms", () => {
    expect(parseTTMLTime("1:02.500")).toBe(62500);
    expect(parseTTMLTime("01:02:03.004")).toBe(3723004);
    expect(parseTTMLTime("12.5")).toBe(12500);
    expect(parseTTMLTime("250ms")).toBe(250);
    expect(parseTTMLTime("1.5s")).toBe(1500);
    expect(parseTTMLTime(null, 42)).toBe(42);
    expect(parseTTMLTime("nonsense", 7)).toBe(7);
  });

  test("unusable payloads return null", () => {
    expect(parseTTML("")).toBeNull();
    expect(parseTTML("not xml at all")).toBeNull();
    expect(parseTTML('<?xml version="1.0"?><tt><body><div></div></body></tt>')).toBeNull();
  });
});
