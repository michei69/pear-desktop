import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import playbackRecovery from '../src/plugins/playback-recovery';

import type { MusicPlayer } from '../src/types/music-player';

type FakeVideo = {
  currentTime: number;
  duration: number;
  paused: boolean;
  readyState: number;
  buffered: { length: number };
  error?: { code: number; message: string };
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  dispatch: (type: string) => void;
};

const fakeVideo = (): FakeVideo => {
  const listeners = new Map<string, Set<() => void>>();
  const video: FakeVideo = {
    currentTime: 10,
    duration: 200,
    paused: false,
    readyState: 4,
    buffered: { length: 0 },
    addEventListener: (type, listener) => {
      const forType = listeners.get(type) ?? new Set();
      forType.add(listener);
      listeners.set(type, forType);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    dispatch: (type) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
  return video;
};

const withDom = (run: (window: Window) => void) => {
  const window = new Window();
  const previous = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
  });

  try {
    run(window);
  } finally {
    Object.assign(globalThis, previous);
    window.happyDOM.close();
  }
};

/** The plugin renderer with a fake `this`, its video and its player API. */
const makeContext = (video: FakeVideo) => {
  const calls: string[] = [];
  const api = {
    seekTo: (seconds: number) => calls.push(`seek:${seconds}`),
    playVideo: () => calls.push('play'),
    nextVideo: () => calls.push('next'),
    getPlayerState: () => 1,
  } as unknown as MusicPlayer;

  const context = {
    ...playbackRecovery.renderer,
    config: {
      enabled: true,
      stallTimeoutMs: 50,
      maxRetries: 5,
      logToConsole: false,
    },
    api,
    getVideo: () => video as unknown as HTMLVideoElement,
    log: () => {},
  };

  return { context, calls };
};

test('every attempt under the retry cap runs a recovery strategy', () =>
  withDom((window) => {
    const { context, calls } = makeContext(fakeVideo());

    const strategies: string[][] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      context.recovering = false;
      context.consecutiveFailures = attempt - 1;
      calls.length = 0;

      playbackRecovery.renderer.attemptRecovery.call(context, 'test');

      window.clearTimeout(context.recoveryTimer);
      context.recoveryTimer = undefined;
      strategies.push([...calls]);
    }

    // Attempts 1-2 seek to the current position, 3 and up seek forward. The
    // dead band (attempt 5 with the default maxRetries) used to run nothing.
    expect(strategies[0]).toEqual(['seek:10', 'play']);
    expect(strategies[1]).toEqual(['seek:10', 'play']);
    expect(strategies[2]).toEqual(['seek:11', 'play']);
    expect(strategies[3]).toEqual(['seek:11', 'play']);
    expect(strategies[4]).toEqual(['seek:11', 'play']);
  }));

test('an attempt past the retry cap skips the track and resets the ladder', () =>
  withDom((window) => {
    const { context, calls } = makeContext(fakeVideo());
    context.consecutiveFailures = 5;

    playbackRecovery.renderer.attemptRecovery.call(context, 'test');

    expect(calls).toEqual(['next']);
    expect(context.consecutiveFailures).toBe(0);
    expect(context.recovering).toBe(true);
    window.clearTimeout(context.recoveryTimer);
  }));

test('a brief resume does not reset the retry ladder', () =>
  withDom((window) => {
    const video = fakeVideo();
    const { context } = makeContext(video);
    playbackRecovery.renderer.hookMediaEvents.call(context);

    context.consecutiveFailures = 2;
    context.recovering = true;
    context.lastFailureTimestamp = Date.now() - 1000;

    context._onTimeUpdate?.();

    expect(context.consecutiveFailures).toBe(2);
    expect(context.recovering).toBe(true);

    // Once the failure is older than the healthy window, the ladder resets.
    context.lastFailureTimestamp = Date.now() - 11_000;
    context._onTimeUpdate?.();

    expect(context.consecutiveFailures).toBe(0);
    expect(context.recovering).toBe(false);
    window.clearTimeout(context.stallTimer);
  }));

test('repeated stall events keep the timer instead of extending it', () =>
  withDom((window) => {
    const { context } = makeContext(fakeVideo());
    playbackRecovery.renderer.hookMediaEvents.call(context);

    context._onWaiting?.();
    const first = context.stallTimer;
    expect(first).not.toBeUndefined();

    context._onWaiting?.();
    expect(context.stallTimer).toBe(first);

    // A stalled event must not restart the buffer timeout either.
    context._onStalled?.();
    expect(context.stallTimer).toBe(first);

    window.clearTimeout(first);
    context.stallTimer = undefined;
  }));

test('progress clears a pending stall timer', () =>
  withDom((window) => {
    const { context } = makeContext(fakeVideo());
    playbackRecovery.renderer.hookMediaEvents.call(context);

    context._onWaiting?.();
    expect(context.stallTimer).not.toBeUndefined();

    context._onTimeUpdate?.();

    expect(context.stallTimer).toBeUndefined();
  }));

test('the watchdog starts with a grace period and does not fire immediately', () =>
  withDom((window) => {
    const video = fakeVideo();
    video.readyState = 0;
    const { context, calls } = makeContext(video);

    const originalSetInterval = window.setInterval;
    let tick: (() => void) | undefined;
    window.setInterval = ((fn: () => void) => {
      tick = fn;
      return 1;
    }) as unknown as typeof window.setInterval;

    playbackRecovery.renderer.startWatchdog.call(context);
    window.setInterval = originalSetInterval;

    expect(tick).toBeDefined();
    expect(context.lastGoodTimestamp).toBeGreaterThan(0);

    // A dead element right after the watchdog starts is still inside the grace
    // period: `lastGoodTimestamp = 0` used to make this look infinitely stale.
    tick?.();
    expect(calls).toEqual([]);

    context.lastGoodTimestamp = Date.now() - 1000;
    tick?.();
    expect(calls).toEqual(['seek:10', 'play']);

    window.clearTimeout(context.recoveryTimer);
  }));

test('a waiting-armed timer still recovers when a stalled event lands at readyState 2', () =>
  withDom((window) => {
    const video = fakeVideo();
    const { context, calls } = makeContext(video);
    playbackRecovery.renderer.hookMediaEvents.call(context);

    // Capture the stall timer instead of waiting it out.
    const originalSetTimeout = window.setTimeout;
    let stallTimeout: (() => void) | undefined;
    window.setTimeout = ((fn: () => void) => {
      stallTimeout = fn;
      return 1;
    }) as unknown as typeof window.setTimeout;
    try {
      video.dispatch('waiting');
    } finally {
      window.setTimeout = originalSetTimeout;
    }
    expect(stallTimeout).toBeDefined();

    // `stalled` must not leave the pending buffer watch stranded: both
    // handlers use the same `readyState < 3` predicate, so HAVE_CURRENT_DATA
    // (readyState 2) is still a recoverable stall.
    video.dispatch('stalled');
    video.readyState = 2;
    calls.length = 0;
    stallTimeout?.();

    expect(calls).toEqual(['seek:10', 'play']);
    window.clearTimeout(context.recoveryTimer);
  }));

test('a new track starts the retry ladder from the first attempt', () =>
  withDom((window) => {
    const video = fakeVideo();
    const { context, calls } = makeContext(video);
    playbackRecovery.renderer.hookMediaEvents.call(context);

    // Two failures on the first track, mid-recovery.
    context.consecutiveFailures = 2;
    context.lastFailureTimestamp = Date.now();
    context.recovering = true;

    // A recovery-induced seek is not a track change.
    video.dispatch('seeked');
    expect(context.consecutiveFailures).toBe(2);

    // The media element starts loading the next track.
    video.dispatch('emptied');

    expect(context.consecutiveFailures).toBe(0);
    expect(context.lastFailureTimestamp).toBe(0);
    expect(context.recovering).toBe(false);

    calls.length = 0;
    playbackRecovery.renderer.attemptRecovery.call(context, 'test');

    // Attempt 1 (seek-to-current), not the seek-forward band the previous
    // track left the ladder in.
    expect(calls).toEqual(['seek:10', 'play']);
    window.clearTimeout(context.recoveryTimer);

    // `loadstart` is the other load signal the element can report.
    context.consecutiveFailures = 3;
    video.dispatch('loadstart');
    expect(context.consecutiveFailures).toBe(0);
  }));
