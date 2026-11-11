// The skip budget: at most MAX_SKIPS skips per SKIP_WINDOW_MS. A rate-limited
// attempt is not remembered, so the queue scans can retry it once the window
// frees instead of playing the track through.

/** Decides which video ids were already skipped and whether a skip may happen now. */
export interface SkipLimiter {
  /** Whether this playback was already skipped (or attempted within the budget). */
  has(videoId: string): boolean;
  /**
   * Records the skip and whether it may run now: false when the budget is
   * spent (the attempt is not recorded) or when the id was already skipped.
   */
  trySkip(videoId: string): boolean;
  /** A fresh arrival of the track is evaluated and may be skipped again. */
  reset(videoId: string): void;
  clear(): void;
}

export const createSkipLimiter = (maxSkips: number, windowMs: number, now: () => number = Date.now): SkipLimiter => {
  const skipped = new Set<string>();
  let recent: number[] = [];

  return {
    has: (videoId) => skipped.has(videoId),
    trySkip(videoId) {
      if (skipped.has(videoId)) return false;
      const time = now();
      recent = recent.filter((at) => time - at < windowMs);
      if (recent.length >= maxSkips) return false;
      skipped.add(videoId);
      recent.push(time);
      return true;
    },
    reset(videoId) {
      skipped.delete(videoId);
    },
    clear() {
      skipped.clear();
      recent = [];
    },
  };
};
