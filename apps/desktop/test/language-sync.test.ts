import { describe, expect, test, vi } from "vitest";
import { appLanguage, ytmLanguage } from "../src/main/language-sync.ts";

vi.mock("electron", () => ({}));

describe("appLanguage", () => {
  test.each([
    ["en", "en"],
    ["en-GB", "en"],
    ["fr-CA", "fr"],
    ["es-419", "es"],
    ["pt", "pt-BR"],
    ["pt-PT", "pt"],
    ["no", "nb"],
    ["zh-HK", "zh-TW"],
    ["zh-CN", "zh-CN"],
    ["de", "de"],
    ["xx", undefined],
    ["", undefined],
  ])("%s -> %s", (hl, expected) => {
    expect(appLanguage(hl)).toBe(expected);
  });
});

describe("ytmLanguage", () => {
  test.each([
    ["pt", "pt-PT"],
    ["pt-BR", "pt"],
    ["nb", "no"],
    ["be-Latn", "be"],
    ["ckb", "en"],
    ["sah", "ru"],
    ["de", "de"],
  ])("%s -> %s", (language, expected) => {
    expect(ytmLanguage(language)).toBe(expected);
  });
});
