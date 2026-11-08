import { expect, test } from '@playwright/test';

import {
  emptyFinishTracker,
  type FinishTrackerConfig,
  trackElapsed,
  trackSongChange,
} from '../src/plugins/downloader/main/finish-tracker';

const secondsMode: FinishTrackerConfig = {
  enabled: true,
  mode: 'seconds',
  seconds: 20,
  percent: 10,
};
const percentMode: FinishTrackerConfig = {
  enabled: true,
  mode: 'percent',
  seconds: 20,
  percent: 90,
};
const disabled: FinishTrackerConfig = { ...secondsMode, enabled: false };

const song = (url: string, songDuration: number) => ({ url, songDuration });

test('tracks the elapsed maximum for the current track', () => {
  const tracker = emptyFinishTracker();

  trackElapsed(tracker, 12);
  trackElapsed(tracker, 5);

  expect(tracker.time).toBe(12);
});

test('downloads the track that just ended when it passed the threshold', () => {
  let tracker = emptyFinishTracker();
  let change = trackSongChange(tracker, song('a', 100), secondsMode);
  tracker = change.tracker;
  expect(change.downloadUrl).toBeUndefined();

  trackElapsed(tracker, 90);
  change = trackSongChange(tracker, song('b', 200), secondsMode);

  expect(change.downloadUrl).toBe('a');
  expect(change.tracker).toEqual({ url: 'b', duration: 200, time: 0 });
});

test('pause/resume events for the same track do not reset the elapsed maximum', () => {
  let tracker = emptyFinishTracker();
  tracker = trackSongChange(tracker, song('a', 100), secondsMode).tracker;
  trackElapsed(tracker, 90);

  const change = trackSongChange(tracker, song('a', 100), secondsMode);

  expect(change.tracker).toBe(tracker);
  expect(change.tracker.time).toBe(90);
  expect(change.downloadUrl).toBeUndefined();
});

test('follows track changes while disabled, so a later enable uses the current url', () => {
  let tracker = emptyFinishTracker();
  // Enabled on track a: its fields are seeded.
  tracker = trackSongChange(tracker, song('a', 100), secondsMode).tracker;
  trackElapsed(tracker, 90);

  // Disabled while b plays: the tracker still moves to b.
  tracker = trackSongChange(tracker, song('b', 300), disabled).tracker;
  expect(tracker.url).toBe('b');

  // Re-enabled on b → c: decides on b, never on the stale a.
  trackElapsed(tracker, 10);
  const change = trackSongChange(tracker, song('c', 50), secondsMode);

  expect(change.downloadUrl).toBeUndefined();
  expect(change.tracker.url).toBe('c');
});

test('percent mode compares the elapsed maximum against the track duration', () => {
  let tracker = emptyFinishTracker();
  tracker = trackSongChange(tracker, song('a', 100), percentMode).tracker;

  trackElapsed(tracker, 89);
  let change = trackSongChange(tracker, song('b', 100), percentMode);
  expect(change.downloadUrl).toBeUndefined();
  tracker = change.tracker;

  trackElapsed(tracker, 90);
  change = trackSongChange(tracker, song('c', 100), percentMode);
  expect(change.downloadUrl).toBe('b');
});
