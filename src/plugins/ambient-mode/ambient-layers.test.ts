import { expect, test } from '@playwright/test';

import { ambientLayerRects } from './ambient-layers';

const canvas = { width: 640, height: 400 };
const frame = { x: 150, y: 125, width: 250, height: 150 };
const rects = ambientLayerRects(frame, canvas);

test('the outermost layer covers the canvas', () => {
  const [outer] = rects;

  expect(outer.x).toBeLessThanOrEqual(0);
  expect(outer.y).toBeLessThanOrEqual(0);
  expect(outer.x + outer.width).toBeGreaterThanOrEqual(canvas.width);
  expect(outer.y + outer.height).toBeGreaterThanOrEqual(canvas.height);
});

test('the innermost layer is the frame itself', () => {
  const inner = rects[rects.length - 1];

  expect(inner.x).toBeCloseTo(frame.x);
  expect(inner.y).toBeCloseTo(frame.y);
  expect(inner.width).toBeCloseTo(frame.width);
  expect(inner.height).toBeCloseTo(frame.height);
});

test('layers shrink around the same centre', () => {
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;

  for (const [index, rect] of rects.entries()) {
    expect(rect.x + rect.width / 2).toBeCloseTo(centerX);
    expect(rect.y + rect.height / 2).toBeCloseTo(centerY);
    expect(rect.width / rect.height).toBeCloseTo(frame.width / frame.height);

    if (index > 0) expect(rect.width).toBeLessThan(rects[index - 1].width);
  }
});
