import { describe, expect, test } from "vitest";
import { activeLineAt } from "../page/active-line.ts";
import type { Shown } from "../page/store.ts";
import type { LyricLine } from "../types.ts";

const lines: LyricLine[] = [
  { startMs: 0, endMs: 1000, text: "国" },
  { startMs: 1000, endMs: 2000, text: "" },
  { startMs: 2000, endMs: 3000, text: "Hello" },
];

const shown: Pick<Shown, "lines" | "texts" | "romanized"> = {
  lines,
  texts: ["國", "", "Hello"],
  romanized: ["guó", "♪", null],
};

describe("activeLineAt", () => {
  test("returns the displayed line with its romanization", () => {
    expect(activeLineAt(shown, 0)).toEqual({ text: "國", romanized: "guó" });
    expect(activeLineAt(shown, 2)).toEqual({ text: "Hello", romanized: null });
  });

  test("has nothing to show before the lyrics, on a gap or past the end", () => {
    expect(activeLineAt(shown, -1)).toBeNull();
    // An instrumental gap has no lyric text for the menu bar.
    expect(activeLineAt(shown, 1)).toBeNull();
    expect(activeLineAt(shown, 3)).toBeNull();
  });
});
