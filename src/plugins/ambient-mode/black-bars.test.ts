import { expect, test } from '@playwright/test';

import { detectBlackBars } from './black-bars';

/** A solid frame with an optional lighter picture area inside it. */
const frame = (
  width: number,
  height: number,
  picture: { x: number; y: number; width: number; height: number },
  color = [200, 120, 40],
) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside =
        x >= picture.x &&
        x < picture.x + picture.width &&
        y >= picture.y &&
        y < picture.y + picture.height;
      const offset = (y * width + x) * 4;
      const [r, g, b] = inside ? color : [0, 0, 0];
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
};

test('a full-screen picture has no bars', () => {
  const bars = detectBlackBars(
    frame(20, 10, { x: 0, y: 0, width: 20, height: 10 }),
    20,
    10,
  );

  expect(bars).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
});

test('letterbox bars are detected on both sides', () => {
  const bars = detectBlackBars(
    frame(20, 10, { x: 0, y: 2, width: 20, height: 6 }),
    20,
    10,
  );

  expect(bars.top).toBeCloseTo(0.2);
  expect(bars.bottom).toBeCloseTo(0.2);
  expect(bars.left).toBeCloseTo(0);
  expect(bars.right).toBeCloseTo(0);
});

test('pillarbox bars are detected on both sides', () => {
  const bars = detectBlackBars(
    frame(20, 10, { x: 5, y: 0, width: 10, height: 10 }),
    20,
    10,
  );

  expect(bars.left).toBeCloseTo(0.25);
  expect(bars.right).toBeCloseTo(0.25);
  expect(bars.top).toBeCloseTo(0);
  expect(bars.bottom).toBeCloseTo(0);
});

test('a bright band inside a dark frame is not a bar', () => {
  // The top rows are dark but 40% of the width is lit: a dark scene, not a bar.
  const pixels = frame(20, 10, { x: 0, y: 0, width: 20, height: 10 });
  for (let x = 0; x < 8; x++) {
    for (const y of [0, 1]) {
      const offset = (y * 20 + x) * 4;
      pixels[offset] = 240;
      pixels[offset + 1] = 240;
      pixels[offset + 2] = 240;
    }
  }

  const bars = detectBlackBars(pixels, 20, 10);

  expect(bars.top).toBe(0);
});

test('bars never eat more than half the frame', () => {
  const bars = detectBlackBars(
    frame(20, 10, { x: 0, y: 0, width: 0, height: 0 }),
    20,
    10,
  );

  expect(bars.top).toBeLessThanOrEqual(0.5);
  expect(bars.bottom).toBeLessThanOrEqual(0.5);
  expect(bars.left).toBeLessThanOrEqual(0.5);
  expect(bars.right).toBeLessThanOrEqual(0.5);
});
