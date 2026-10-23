import { readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { i18nModule } from "../src/index.ts";

const RESOURCES = new URL("../../../src/i18n/resources/", import.meta.url);
const FILES = readdirSync(RESOURCES)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.slice(0, -5))
  .sort((a, b) => a.localeCompare(b));
const CODE = i18nModule(() => {});

describe("virtual:pear/i18n", () => {
  test("lists every translation file, sorted, with its metadata", () => {
    const codes = JSON.parse(/export const languageCodes = (\[[^\]]*\]);/.exec(CODE)?.[1] ?? "[]") as string[];
    expect(codes).toEqual(FILES);
    expect(codes).toContain("en");
    expect(CODE).toContain('"en":{"code":"en","name":"English","local-name":"English"}');
  });

  test("puts every language behind its own dynamic import", () => {
    for (const code of FILES) {
      expect(CODE).toContain(`${JSON.stringify(code)}: () => import(`);
    }
    // The resource itself, not an i18next-style `{ translation }` wrapper.
    expect(CODE).toContain("return load ? [code, (await load()).default] : undefined;");
    expect(CODE).not.toContain("translation:");
  });
});
