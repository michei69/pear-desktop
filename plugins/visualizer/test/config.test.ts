import { normalizeConfig } from "@pear/sdk";
import { describe, expect, test } from "vitest";
import { schema } from "../config.ts";

describe("visualizer config", () => {
  test("Vudio accuracy keeps pear-desktop's powers of two, including 1024", () => {
    expect(schema.vudioAccuracy.options.map((option) => option.value)).toEqual(["32", "64", "128", "256", "512", "1024"]);
  });

  test("a stored 1024 survives normalization (it isn't reset to the default)", () => {
    expect(normalizeConfig(schema, { vudioAccuracy: "1024" }).vudioAccuracy).toBe("1024");
  });

  test("an accuracy pear-desktop never offered resets to the default", () => {
    expect(normalizeConfig(schema, { vudioAccuracy: "16" }).vudioAccuracy).toBe("128");
    expect(normalizeConfig(schema, { vudioAccuracy: "900" }).vudioAccuracy).toBe("128");
  });
});
