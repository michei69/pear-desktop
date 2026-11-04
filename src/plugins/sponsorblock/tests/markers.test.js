import { test, expect } from '@playwright/test';

import { buildSegmentsGradient, CATEGORY_COLORS, markerAt } from '../markers';

test('paints one hard-stop run per segment', () => {
  expect(
    buildSegmentsGradient([{ segment: [30, 50], category: 'sponsor' }], 300),
  ).toBe(
    'linear-gradient(to right, transparent 10.00%, #00d400 10.00%, #00d400 16.67%, transparent 16.67%)',
  );
});

test('sorts markers so gradient stops never go backwards', () => {
  expect(
    buildSegmentsGradient(
      [
        { segment: [150, 180], category: 'music_offtopic' },
        { segment: [30, 50], category: 'sponsor' },
      ],
      300,
    ),
  ).toBe(
    'linear-gradient(to right, transparent 10.00%, #00d400 10.00%, #00d400 16.67%, transparent 16.67%, transparent 50.00%, #ff9900 50.00%, #ff9900 60.00%, transparent 60.00%)',
  );
});

test('clamps segments to the track and drops ones outside it', () => {
  expect(
    buildSegmentsGradient([{ segment: [-10, 30], category: 'intro' }], 300),
  ).toBe(
    'linear-gradient(to right, transparent 0.00%, #00ffff 0.00%, #00ffff 10.00%, transparent 10.00%)',
  );

  expect(
    buildSegmentsGradient([{ segment: [320, 400], category: 'outro' }], 300),
  ).toBe('');
});

test('unknown categories fall back to the sponsor colour', () => {
  expect(
    buildSegmentsGradient([{ segment: [0, 30], category: 'unknown' }], 300),
  ).toContain(CATEGORY_COLORS.sponsor);
});

test('draws nothing without segments or a usable duration', () => {
  const markers = [{ segment: [30, 50], category: 'sponsor' }];

  expect(buildSegmentsGradient([], 300)).toBe('');
  expect(buildSegmentsGradient(markers, 0)).toBe('');
  expect(buildSegmentsGradient(markers, Number.NaN)).toBe('');
  expect(buildSegmentsGradient(markers, Number.POSITIVE_INFINITY)).toBe('');
});

test('leaves the input untouched', () => {
  const markers = [
    { segment: [150, 180], category: 'music_offtopic' },
    { segment: [30, 50], category: 'sponsor' },
  ];

  buildSegmentsGradient(markers, 300);

  expect(markers[0].segment).toEqual([150, 180]);
  expect(markers[1].segment).toEqual([30, 50]);
});

test('finds the topmost marker under a time', () => {
  const markers = [
    { segment: [0, 100], category: 'sponsor' },
    { segment: [20, 40], category: 'outro' },
  ];

  expect(markerAt(markers, 0)?.category).toBe('sponsor');
  expect(markerAt(markers, 30)?.category).toBe('outro');
  expect(markerAt(markers, 50)?.category).toBe('sponsor');
  expect(markerAt(markers, 100)).toBeUndefined();
  expect(markerAt(markers, -1)).toBeUndefined();
  expect(markerAt([], 10)).toBeUndefined();
});
