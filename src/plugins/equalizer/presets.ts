/** Fixed 11-band layout used by Ears Audio Toolkit. */
export const BAND_FREQUENCIES = [
  20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480,
] as const;

export const DEFAULT_Q = Math.SQRT1_2;

export type FilterConfig = {
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
};

export type Preset = 'flat' | 'bass-booster';

export const defaultPresets = ['flat', 'bass-booster'] as const;

/** Mirrors Ears' built-in Bass Boost curve; the middle bands stay flat. */
const bassBoostGains = [10, 8, 6, 3, 1, 0, 0, 0, 0, 0, 0] as const;

export const presetConfigs: Record<Preset, readonly number[]> = {
  'flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'bass-booster': bassBoostGains,
};

export function filterTypeForBand(index: number): BiquadFilterType {
  if (index === 0) return 'lowshelf';
  if (index === BAND_FREQUENCIES.length - 1) return 'highshelf';
  return 'peaking';
}
