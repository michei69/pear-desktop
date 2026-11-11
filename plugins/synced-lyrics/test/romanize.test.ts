import { describe, expect, test } from "vitest";
import { fillUnknownJapanese, prepareJapaneseLine } from "../romanize.ts";

const tify = (text: string) => text.replaceAll("夺", "奪");

describe("Japanese romanization fallbacks", () => {
  test("replaces only UNKNOWN kanji tokens before the line is converted", async () => {
    const analyzer = {
      parse: async () => [
        { surface_form: "彼", verbose: { word_type: "KNOWN" } },
        { surface_form: "は", verbose: { word_type: "KNOWN" } },
        { surface_form: "夺", verbose: { word_type: "UNKNOWN" } },
        { surface_form: "を", verbose: { word_type: "UNKNOWN" } },
      ],
    };
    expect(await prepareJapaneseLine("彼は夺を", analyzer, tify)).toBe("彼は奪を");
  });

  test("prepares a line without unknown kanji unchanged", async () => {
    const analyzer = { parse: async () => [{ surface_form: "学生", verbose: { word_type: "KNOWN" } }] };
    expect(await prepareJapaneseLine("学生", analyzer, tify)).toBe("学生");
  });

  test("romanizes a leftover glyph through its Japanese/traditional form", async () => {
    const convert = async (text: string) => text.replace("奪", "datsu");
    expect(await fillUnknownJapanese("kare wa 夺", convert, tify, () => "duo")).toBe("kare wa datsu");
  });

  test("falls back to pinyin when no Japanese reading exists", async () => {
    const convert = async (text: string) => text;
    expect(await fillUnknownJapanese("kare wa 龘", convert, tify, () => "dá")).toBe("kare wa dá");
  });

  test("leaves romanized text alone", async () => {
    expect(
      await fillUnknownJapanese(
        "kare wa utau",
        async () => "x",
        tify,
        () => "x",
      ),
    ).toBe("kare wa utau");
  });
});
