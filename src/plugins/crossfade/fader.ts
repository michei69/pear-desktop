/**
 * VolumeFader: media volume fading.
 *
 * MIT licensed, from Nick Schwarzenberg's VolumeFader v0.2.0 (07/2016).
 */

interface VolumeControllable {
  volume: number;
}

interface VolumeFaderOptions {
  /**
   * either 'linear', 'equalPower', 'logarithmic' or a positive number in dB
   * (default: logarithmic)
   */
  fadeScaling?: string | number;
  /** media volume 0…1 to apply during setup (volume not touched by default) */
  initialVolume?: number;
  /** time in milliseconds to complete a fade (default: 1000 ms) */
  fadeDuration?: number;
}

interface VolumeFade {
  volume: {
    start: number;
    end: number;
  };
  time: {
    start: number;
    end: number;
  };
  callback?: () => void;
}

const validateVolumeLevel = (value: number) => {
  if (Number.isNaN(value) || value < 0 || value > 1) {
    throw new TypeError('Number between 0 and 1 expected as volume!');
  }
};

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
 * The single owner of the scaling math, shared with callers that ramp a volume
 * themselves (the crossfade's gain node) instead of through this fader.
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

/**
 * Scaler from a volume back to the internal fading scale, the inverse of
 * `fadeVolumeAt`.
 *
 * @throws {TypeError} if the scaling is neither a known name nor a positive dB number
 */
const internalScalerFor = (fadeScaling?: string | number) => {
  if (fadeScaling === 'linear') return (level: number) => level;

  if (fadeScaling === 'equalPower') {
    return (level: number) => Math.asin(level) / (Math.PI / 2);
  }

  // Throws here, not on the first fade, for an unsupported setting
  const dynamicRange = dynamicRangeOf(fadeScaling);

  return (level: number) => logarithmicScaler(level, dynamicRange);
};

export class VolumeFader {
  private readonly media: VolumeControllable;
  private readonly scale: {
    internalToVolume: (level: number) => number;
    volumeToInternal: (level: number) => number;
  };
  private readonly equalPower: boolean;
  private fadeDuration = 1000;
  private active = false;
  private fade: VolumeFade | undefined;
  private readonly boundUpdateVolume = () => this.updateVolume();

  /**
   * @param media object with a volume property to be controlled
   * @param options optional settings
   * @throws {TypeError} if the media or one of the options is unusable
   */
  constructor(media: VolumeControllable, options: VolumeFaderOptions = {}) {
    if (!media || typeof media.volume === 'undefined') {
      throw new TypeError('Media element with volume property expected!');
    }

    this.media = media;
    this.equalPower = options.fadeScaling === 'equalPower';
    this.scale = {
      internalToVolume: (level) => fadeVolumeAt(level, options.fadeScaling),
      volumeToInternal: internalScalerFor(options.fadeScaling),
    };

    if (options.initialVolume !== undefined) {
      validateVolumeLevel(options.initialVolume);
      this.media.volume = options.initialVolume;
    }

    if (options.fadeDuration !== undefined) {
      if (Number.isNaN(options.fadeDuration) || options.fadeDuration < 0) {
        throw new TypeError('Non-negative number expected as fade duration!');
      }

      this.fadeDuration = options.fadeDuration;
    }
  }

  /** Re(start) the update cycle, interrupting any fade in progress. */
  private start() {
    this.active = true;
    this.updateVolume();
  }

  /**
   * Define a new fade and start fading.
   *
   * @param targetVolume level to fade to in the range 0…1
   * @param callback function to be called when the fade is complete
   * @throws {TypeError} if targetVolume is not in the range 0…1
   */
  fadeTo(targetVolume: number, callback?: () => void) {
    validateVolumeLevel(targetVolume);

    this.fade = {
      // Volume start and end point on the internal fading scale
      volume: {
        start: this.scale.volumeToInternal(this.media.volume),
        end: this.scale.volumeToInternal(targetVolume),
      },
      time: {
        start: Date.now(),
        end: Date.now() + this.fadeDuration,
      },
      callback,
    };

    this.start();

    return this;
  }

  /** Fade to silence, then call back. */
  fadeOut(callback: () => void) {
    this.fadeTo(0, callback);
  }

  /**
   * Cancel the current fade immediately without jumping to the target volume.
   *
   * The callback still runs: callers hand the fading media to it, so a cancel
   * that skipped it would leave that media playing where the fade stopped.
   */
  cancelFade() {
    this.active = false;

    // Cleared before the callback runs, so a callback that starts another fade
    // is not wiped out by this one.
    const { callback } = this.fade ?? {};
    this.fade = undefined;

    callback?.();

    return this;
  }

  /**
   * Volume of a fade at the given progress.
   * (start and end are the fade's endpoints on the internal scale in use)
   *
   * Equal power fades scale the endpoint volumes with a sin/cos curve instead of
   * interpolating their internal angles, so a fade out and its paired fade in
   * keep a constant combined power even below full volume.
   */
  private fadeVolume(progress: number, start: number, end: number) {
    if (!this.equalPower) {
      return this.scale.internalToVolume(progress * (end - start) + start);
    }

    const angle = (progress * Math.PI) / 2;

    return Math.min(
      Math.max(
        this.scale.internalToVolume(start) * Math.cos(angle) +
          this.scale.internalToVolume(end) * Math.sin(angle),
        0,
      ),
      1,
    );
  }

  /** Update media volume. (schedules itself through requestAnimationFrame) */
  updateVolume() {
    if (!this.active || !this.fade) return;

    const now = Date.now();

    if (now < this.fade.time.end) {
      const progress =
        (now - this.fade.time.start) /
        (this.fade.time.end - this.fade.time.start);

      this.media.volume = this.fadeVolume(
        progress,
        this.fade.volume.start,
        this.fade.volume.end,
      );

      window.requestAnimationFrame(this.boundUpdateVolume);
      return;
    }

    // Time is up: jump to the target volume and finish
    this.media.volume = this.scale.internalToVolume(this.fade.volume.end);
    this.active = false;

    const { callback } = this.fade;
    this.fade = undefined;
    callback?.();
  }
}

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

/**
 * Logarithmic scaler with dynamic range limit.
 *
 * @param input exponential input level to be compressed (float, 0…1)
 * @param dynamicRange coerced input range, in multiples of 10 dB (float, 0…∞)
 * @returns compressed level (float, 0…1)
 */
const logarithmicScaler = (input: number, dynamicRange: number) => {
  // Logarithm of zero would be -∞, which maps to zero anyway
  if (input === 0) return 0;

  // Scale minus something × 10 dB to 0…1 (clipping at 0)
  return Math.max(1 + Math.log10(input) / dynamicRange, 0);
};
