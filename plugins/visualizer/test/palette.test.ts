import { afterEach, describe, expect, test, vi } from "vitest";
import { accentOf, type Hsl, hexToRgb, hslToCss, parseCssColor, publishedPalette, quantize } from "../palette.ts";

const ALBUM_COLOR_ACTIVE = "pear-album-color";

/** The published palette comes from the root's computed style; stub both. */
function withPublishedColors(values: Record<string, string>, themed = true) {
  vi.stubGlobal("document", {
    documentElement: { classList: { contains: (name: string) => themed && name === ALBUM_COLOR_ACTIVE } },
  });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (property: string) => values[property] ?? "" }));
}

function expectValidEntry(color: Hsl) {
  expect(color.h).toBeGreaterThanOrEqual(0);
  expect(color.h).toBeLessThan(360);
  expect(color.s).toBeGreaterThanOrEqual(0);
  expect(color.s).toBeLessThanOrEqual(1);
  expect(color.l).toBeGreaterThanOrEqual(0);
  expect(color.l).toBeLessThanOrEqual(1);
}

/** Pixels in canvas order (RGBA). */
const pixels = (colors: [number, number, number][]) => new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publishedPalette", () => {
  test("the accent follows the color the theme publishes", () => {
    withPublishedColors({ "--paper-progress-active-color-1": "#00ff00" });
    const [accent] = publishedPalette() ?? [];
    expect(accent?.h).toBeCloseTo(120, 5);
    expect(accent?.s).toBeCloseTo(1, 5);
  });

  test("every entry is a parsed color, padded with the fallback colors", () => {
    withPublishedColors({ "--paper-progress-active-color-1": "#f03" });
    const palette = publishedPalette();
    expect(palette).toHaveLength(6);
    for (const color of palette ?? []) expectValidEntry(color);

    // One published color, then pear-desktop's vivid fallbacks after it.
    expect(palette?.[1]).toEqual(parseCssColor("#fb5607"));
    expect(palette?.[5]).toEqual(parseCssColor("#06d6a0"));
  });

  test("is null while album-color-theme isn't publishing (so the artwork is sampled)", () => {
    withPublishedColors({ "--paper-progress-active-color-1": "#00ff00" }, false);
    expect(publishedPalette()).toBeNull();

    withPublishedColors({});
    expect(publishedPalette()).toBeNull();

    vi.unstubAllGlobals();
    expect(publishedPalette()).toBeNull();
  });

  test("parses the color forms the theme variables can hold", () => {
    expect(hexToRgb("#f03")).toEqual({ r: 255, g: 0, b: 51 });
    expect(parseCssColor("#f03")).toEqual(parseCssColor("#ff0033"));

    const green: Hsl = { h: 120, s: 1, l: 0.5 };
    expect(parseCssColor(hslToCss(green))).toEqual(green);
    expect(parseCssColor("rgb(0, 255, 0)")).toEqual(green);
    expect(parseCssColor("rgba(0, 255, 0, 0.5)")).toEqual(green);
    expect(parseCssColor("var(--pear-theme-accent)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("quantize", () => {
  test("pads with the fallback colors so modulo indexing always has entries", () => {
    const grey = quantize(pixels([[128, 128, 128]]));
    expect(grey).toHaveLength(6);
    for (const color of grey) expectValidEntry(color);
  });

  test("keeps the dominant vivid hue first", () => {
    const red = quantize(pixels([[255, 0, 0]]));
    expect(red).toHaveLength(6);
    // Hue buckets are 30° wide and the color sits mid-bucket.
    expect(red[0]?.h).toBeCloseTo(15, 5);
    expect(red[0]?.s).toBeCloseTo(1, 5);
    expect(red[1]).toEqual(parseCssColor("#fb5607"));
  });
});

describe("accentOf", () => {
  test("falls back to pear-desktop's first vivid color for an empty palette", () => {
    expect(accentOf([])).toEqual(parseCssColor("#ff006e"));
  });
});
