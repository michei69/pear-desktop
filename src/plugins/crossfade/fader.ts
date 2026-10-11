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

// Volume of a fade at the given progress (0 to 1) for a scaling setting, and the
// single owner of the scaling math: a fade in samples this forwards, a fade out
// samples it backwards. Throws a TypeError if the scaling is neither a known name
// nor a positive dB number.
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

// A fade as a curve for the audio thread to follow: a scheduled curve is
// sample-accurate, where a volume written a frame at a time is stepped and stops with
// a window that is not drawn. A fade out runs the same scaler backwards, so the two
// keep a constant combined power where they overlap.
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

// Exponential scaler with dynamic range limit: input is the logarithmic level to
// expand (0…1), dynamicRange is in multiples of 10 dB, and the expanded level (0…1)
// is returned.
const exponentialScaler = (input: number, dynamicRange: number) => {
  // Otherwise zero becomes a small fraction of the range, not silence
  if (input === 0) return 0;

  // Scale 0…1 to minus something × 10 dB
  return 10 ** ((input - 1) * dynamicRange);
};
