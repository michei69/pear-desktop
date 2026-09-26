/**
 * Fade scaling: the curve both halves of a crossfade run on, sampled into the
 * gain curves the audio thread follows.
 *
 * Scaling math from Nick Schwarzenberg's VolumeFader v0.2.0 (07/2016), MIT
 * licensed.
 */

/** Dynamic range of a scaling setting, in multiples of 10 dB. */
const dynamicRangeOf = (fadeScaling: string | number | undefined) => {
  // Default dynamic range: 60 dB
  if (fadeScaling === undefined || fadeScaling === 'logarithmic') return 3;

  if (typeof fadeScaling === 'number' && fadeScaling > 0) {
    // Amplitude dB as a multiple of 10 power dB
    return fadeScaling / 2 / 10;
  }

  throw new TypeError(
    "Expected 'linear', 'equalPower', 'logarithmic' or a positive number as fade scaling preference!",
  );
};

/**
 * Volume at the given progress of a fade, from 0 to 1, for a scaling setting.
 * A fade out runs the same curve backwards: `fadeVolumeAt(1 - progress)`, which
 * leaves an equal power pair at a constant combined power.
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

  // Checked before the zero shortcut, so an unusable setting is refused on
  // every call and not only on the ones that need a dynamic range.
  const dynamicRange = dynamicRangeOf(fadeScaling);

  // A limited dynamic range would turn zero into a small fraction of it, and
  // audio would not be recognized as silent
  if (progress === 0) return 0;

  // Scale 0…1 to minus something × 10 dB
  return 10 ** ((progress - 1) * dynamicRange);
};
