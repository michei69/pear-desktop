// The silence latch, in the style of hark (https://github.com/otalk/hark),
// kept out of the plugin so the timing and onlySkipBeginning rules are testable
// without an AudioContext.

/** -100 is absolute silence, 0 the loudest. */
export const THRESHOLD_DB = -100;
/** Sampling period: the 10-slot history covers the ~250 ms a quiet run must last. */
export const INTERVAL_MS = 25;
export const HISTORY = 10;
/** The lowest bins (DC and rumble) don't count as sound. */
export const FIRST_BIN = 4;
// Sound again once 2 of the last 3 checks were loud.
const RECENT = 3;
const RECENT_LOUD = 2;

export interface Latch {
  /** One flag per sample, oldest first: 1 where the sample was loud. */
  readonly history: number[];
  /** A silence run is latched; seek ahead until audio is heard again. */
  silent: boolean;
  /** Real audio was heard since the track began; onlySkipBeginning keys off this. */
  audioStarted: boolean;
}

export function createLatch(): Latch {
  return { history: Array.from({ length: HISTORY }, () => 0), silent: false, audioStarted: false };
}

/** A new track re-arms beginning-only skipping. */
export function resetLatch(latch: Latch) {
  latch.history.fill(0);
  latch.silent = false;
  latch.audioStarted = false;
}

/**
 * A seek (the tracker's own skips included) drops only the samples from before
 * the jump: a seek is not a new track, so `audioStarted` survives.
 */
export function afterSeek(latch: Latch) {
  latch.history.fill(0);
}

export interface Sample {
  loud: boolean;
  /** Seeking, ended, muted or at volume 0: a quiet sample proves nothing. */
  muted: boolean;
}

/** One sampling step; returns whether this step latches a silence run to skip. */
export function sample(latch: Latch, { loud, muted }: Sample): boolean {
  let latched = false;
  if (loud) {
    if (latch.history.slice(-RECENT).reduce((sum, flag) => sum + flag, 0) >= RECENT_LOUD) {
      latch.silent = false;
      latch.audioStarted = true;
    }
  } else if (!latch.silent && latch.history.every((flag) => flag === 0) && !muted) {
    latch.silent = true;
    latched = true;
  }
  latch.history.shift();
  latch.history.push(loud ? 1 : 0);
  return latched;
}

export interface SkipConditions {
  onlySkipBeginning: boolean;
  paused: boolean;
  /** An ad is playing: never seek it. */
  ad: boolean;
}

/** Whether a latched silence may advance the track now. */
export function shouldSkip(latch: Latch, { onlySkipBeginning, paused, ad }: SkipConditions): boolean {
  if (!latch.silent || paused || ad) return false;
  return !(onlySkipBeginning && latch.audioStarted);
}
