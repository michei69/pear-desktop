export const scrobbleThresholdSeconds = (songDuration: number): number =>
  Math.min(Math.ceil(songDuration / 2), 240);

export type ScrobbleDecision =
  | { action: 'none' }
  | { action: 'now' }
  | { action: 'after'; delayMs: number };

// alreadyScrobbled suppresses pause/seek/resume duplicates; past-threshold is "now".
export const decideScrobble = (options: {
  elapsedSeconds: number;
  songDuration: number;
  alreadyScrobbled: boolean;
}): ScrobbleDecision => {
  if (options.alreadyScrobbled || !(options.songDuration > 0)) {
    return { action: 'none' };
  }

  const remaining =
    scrobbleThresholdSeconds(options.songDuration) - options.elapsedSeconds;
  if (remaining <= 0) return { action: 'now' };

  return { action: 'after', delayMs: remaining * 1000 };
};

export const elapsedAt = (
  elapsedSeconds: number,
  lastEventAt: number,
  now = Date.now(),
): number => elapsedSeconds + Math.max(0, now - lastEventAt) / 1000;
