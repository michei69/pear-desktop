export const MIN_PLAYBACK_SPEED = 0.07;
export const MAX_PLAYBACK_SPEED = 16;

export const SETTINGS_MIN_PLAYBACK_SPEED = 0.5;
export const SETTINGS_MAX_PLAYBACK_SPEED = 2;

export const roundToTwo = (value: number) => Math.round(value * 1e2) / 1e2;

export const normalizePlaybackSpeed = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;

  return Math.min(
    Math.max(roundToTwo(numeric), MIN_PLAYBACK_SPEED),
    MAX_PLAYBACK_SPEED,
  );
};

export const formatPlaybackSpeed = (value: number) =>
  `${roundToTwo(normalizePlaybackSpeed(value))}×`;
