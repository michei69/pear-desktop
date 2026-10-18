import { expect, test } from '@playwright/test';

import {
  DEFAULT_THRESHOLD_MB,
  liveBytes,
  thresholdBytesFor,
} from '../src/plugins/memory-saver/usage';

test('live cache bytes are summed across every Blink bucket', () => {
  expect(
    liveBytes({
      images: { liveSize: 1024, size: 4096 },
      scripts: { liveSize: 2048 },
      fonts: { liveSize: 0 },
    }),
  ).toBe(3072);
});

test('missing or unusable usage reports nothing rather than throwing', () => {
  expect(liveBytes(undefined)).toBe(0);
  expect(liveBytes(null)).toBe(0);
  expect(liveBytes('nope')).toBe(0);
  expect(liveBytes({ images: undefined, cssStyleSheets: {} })).toBe(0);
});

test('the threshold falls back to the default when the stored value is not a positive number', () => {
  expect(thresholdBytesFor(128)).toBe(128 * 1024 * 1024);
  expect(thresholdBytesFor('32')).toBe(32 * 1024 * 1024);
  expect(thresholdBytesFor(0)).toBe(DEFAULT_THRESHOLD_MB * 1024 * 1024);
  expect(thresholdBytesFor(-1)).toBe(DEFAULT_THRESHOLD_MB * 1024 * 1024);
  expect(thresholdBytesFor(Number.NaN)).toBe(
    DEFAULT_THRESHOLD_MB * 1024 * 1024,
  );
  expect(thresholdBytesFor(undefined)).toBe(DEFAULT_THRESHOLD_MB * 1024 * 1024);
});
