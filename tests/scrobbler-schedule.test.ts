import { expect, test } from '@playwright/test';

import {
  decideScrobble,
  elapsedAt,
  scrobbleThresholdSeconds,
} from '../src/plugins/scrobbler/schedule';

test('threshold is half the track, capped at four minutes', () => {
  expect(scrobbleThresholdSeconds(100)).toBe(50);
  expect(scrobbleThresholdSeconds(3)).toBe(2);
  expect(scrobbleThresholdSeconds(1000)).toBe(240);
});

test('a track already past the threshold is scrobbled now', () => {
  expect(
    decideScrobble({
      elapsedSeconds: 50,
      songDuration: 100,
      alreadyScrobbled: false,
    }),
  ).toEqual({ action: 'now' });
  expect(
    decideScrobble({
      elapsedSeconds: 400,
      songDuration: 1000,
      alreadyScrobbled: false,
    }),
  ).toEqual({ action: 'now' });
});

test('a track before the threshold is scheduled for the remainder', () => {
  expect(
    decideScrobble({
      elapsedSeconds: 40,
      songDuration: 100,
      alreadyScrobbled: false,
    }),
  ).toEqual({ action: 'after', delayMs: 10_000 });
});

test('an already submitted track is not scrobbled again', () => {
  expect(
    decideScrobble({
      elapsedSeconds: 50,
      songDuration: 100,
      alreadyScrobbled: true,
    }),
  ).toEqual({ action: 'none' });
  expect(
    decideScrobble({
      elapsedSeconds: 0,
      songDuration: 100,
      alreadyScrobbled: true,
    }),
  ).toEqual({ action: 'none' });
});

test('an unknown duration never scrobbles', () => {
  expect(
    decideScrobble({
      elapsedSeconds: 30,
      songDuration: 0,
      alreadyScrobbled: false,
    }),
  ).toEqual({ action: 'none' });
});

test('elapsedAt advances a track last seen at a past event', () => {
  expect(elapsedAt(10, 1_000, 6_000)).toBe(15);
  // A clock that went backwards must not move the position backwards.
  expect(elapsedAt(10, 6_000, 1_000)).toBe(10);
});
