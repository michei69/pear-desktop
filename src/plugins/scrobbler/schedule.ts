/** Seconds of playback before a scrobble counts: half the track, capped at 4 minutes. */
export const scrobbleThresholdSeconds = (songDuration: number): number =>
  Math.min(Math.ceil(songDuration / 2), 240);

export type ScrobbleDecision =
  | { action: 'none' }
  | { action: 'now' }
  | { action: 'after'; delayMs: number };

/**
 * When to submit the current track's scrobble. `alreadyScrobbled` is the
 * per-track "submitted" state: without it a pause, seek back and resume would
 * submit the same track twice. A track first seen already past its threshold
 * (seek/resume from a restored position) is scrobbled now instead of never.
 */
export const decideScrobble = (options: {
  elapsedSeconds: number;
  songDuration: number;
  alreadyScrobbled: boolean;
}): ScrobbleDecision => {
  // No duration means the threshold is unknown; the old code never scrobbled
  // those either, so keep that behaviour rather than submitting at position 0.
  if (options.alreadyScrobbled || !(options.songDuration > 0)) {
    return { action: 'none' };
  }

  const remaining =
    scrobbleThresholdSeconds(options.songDuration) - options.elapsedSeconds;
  if (remaining <= 0) return { action: 'now' };

  return { action: 'after', delayMs: remaining * 1000 };
};

/**
 * Elapsed position at `now` for a track last seen at `elapsedSeconds`. No
 * song-info events arrive during uninterrupted playback, so a config-change
 * re-arm has to advance the clock itself.
 */
export const elapsedAt = (
  elapsedSeconds: number,
  lastEventAt: number,
  now = Date.now(),
): number => elapsedSeconds + Math.max(0, now - lastEventAt) / 1000;
