/**
 * Volume scaling for the crossfade's fades.
 *
 * MIT licensed, from Nick Schwarzenberg's VolumeFader v0.2.0 (07/2016).
 */

/** Dynamic range of a scaling setting, in multiples of 10 dB. */
const dynamicRangeOf = (fadeScaling: string | number | undefined) => {
  // Default dynamic range: 60 dB
  if (fadeScaling === undefined || fadeScaling === 'logarithmic') return 3;

  if (
    typeof fadeScaling === 'number' &&
    !Number.isNaN(fadeScaling) &&
    fadeScaling > 0
  ) {
    // Amplitude dB as a multiple of 10 power dB
    return fadeScaling / 2 / 10;
  }

  throw new TypeError(
    "Expected 'linear', 'equalPower', 'logarithmic' or a positive number as fade scaling preference!",
  );
};

/**
 * Volume of a fade at the given progress, from 0 to 1, for a scaling setting.
 * The single owner of the scaling math: a fade in is this curve sampled
 * forwards, a fade out is the same curve sampled backwards.
 *
 * @throws {TypeError} if the scaling is neither a known name nor a positive dB number
 */
export const fadeVolumeAt = (
  progress: number,
  fadeScaling?: string | number,
) => {
  if (fadeScaling === 'linear') return progress;

  if (fadeScaling === 'equalPower') {
    return Math.sin((progress * Math.PI) / 2);
  }

  return exponentialScaler(progress, dynamicRangeOf(fadeScaling));
};

/** Points a scheduled fade curve is sampled at. */
const CURVE_POINTS = 64;

/**
 * A fade as a curve for the audio thread to follow: a scheduled curve is
 * sample-accurate, where a volume written a frame at a time is stepped and
 * stops with a window that is not being drawn. A fade out is the same scaler
 * run backwards, so the two keep a constant combined power where they overlap.
 */
export const fadeCurve = (
  fadeScaling: string | number | undefined,
  direction: 'in' | 'out',
) => {
  const curve = new Float32Array(CURVE_POINTS + 1);

  for (let point = 0; point <= CURVE_POINTS; point += 1) {
    const progress = point / CURVE_POINTS;

    curve[point] = fadeVolumeAt(
      direction === 'in' ? progress : 1 - progress,
      fadeScaling,
    );
  }

  return curve;
};

/**
 * Exponential scaler with dynamic range limit.
 *
 * @param input logarithmic input level to be expanded (float, 0…1)
 * @param dynamicRange expanded output range, in multiples of 10 dB (float, 0…∞)
 * @returns expanded level (float, 0…1)
 */
const exponentialScaler = (input: number, dynamicRange: number) => {
  // A limited dynamic range would turn zero into a small fraction of it, and
  // audio would not be recognized as silent
  if (input === 0) return 0;

  // Scale 0…1 to minus something × 10 dB
  return 10 ** ((input - 1) * dynamicRange);
};
