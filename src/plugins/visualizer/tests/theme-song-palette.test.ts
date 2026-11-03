import { expect, test } from '@playwright/test';

import {
  getAccentHsl,
  getThemeSongPalette,
  hexToRgb,
  hslToCss,
  parseCssColor,
  rgbToHsl,
} from '../visualizers/theme-song-palette';

type StyleStub = {
  document?: unknown;
  getComputedStyle?: unknown;
};

const withComputedStyle = (values: Record<string, string>) => {
  const globals = globalThis as unknown as StyleStub;
  const previous = {
    document: globals.document,
    getComputedStyle: globals.getComputedStyle,
  };

  globals.document = { documentElement: {} };
  globals.getComputedStyle = () => ({
    getPropertyValue: (property: string) => values[property] ?? '',
  });

  return () => {
    if (previous.document === undefined) delete globals.document;
    else globals.document = previous.document;
    if (previous.getComputedStyle === undefined) {
      delete globals.getComputedStyle;
    } else {
      globals.getComputedStyle = previous.getComputedStyle;
    }
  };
};

test('the accent follows the color the theme publishes', () => {
  const restore = withComputedStyle({
    '--paper-progress-active-color-1': '#00ff00',
  });
  try {
    const accent = getAccentHsl();
    expect(accent.h).toBeCloseTo(120, 5);
    expect(accent.s).toBeCloseTo(1, 5);
  } finally {
    restore();
  }
});

test('every palette entry is a parsed color, not a mix of hex strings and hsl', () => {
  const restore = withComputedStyle({
    '--paper-progress-active-color-1': '#f03',
  });
  try {
    const palette = getThemeSongPalette();
    expect(palette).toHaveLength(6);
    for (const color of palette) {
      expect(color.h).toBeGreaterThanOrEqual(0);
      expect(color.h).toBeLessThan(360);
      expect(color.s).toBeGreaterThanOrEqual(0);
      expect(color.s).toBeLessThanOrEqual(1);
      expect(color.l).toBeGreaterThanOrEqual(0);
      expect(color.l).toBeLessThanOrEqual(1);
    }
    const fallback = rgbToHsl(hexToRgb('#06d6a0'));
    expect(palette[5]?.h).toBeCloseTo(fallback.h, 5);
    expect(palette[5]?.s).toBeCloseTo(fallback.s, 5);
  } finally {
    restore();
  }
});

test('parses the color forms the theme variables can hold', () => {
  expect(parseCssColor('#f03')).toEqual(parseCssColor('#ff0033'));

  const green = { h: 120, s: 1, l: 0.5 };
  expect(parseCssColor(hslToCss(green))).toEqual(green);
  expect(parseCssColor('rgb(0, 255, 0)')).toEqual(green);
  expect(parseCssColor('var(--pear-theme-accent)')).toBeNull();
});
