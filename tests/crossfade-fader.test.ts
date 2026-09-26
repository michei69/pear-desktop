import { expect, test } from '@playwright/test';

import { fadeVolumeAt } from '../src/plugins/crossfade/fader';

// Both halves of a crossfade run on this one curve: the fade in forwards, the
// fade out backwards. What is asserted here is the curve the seam depends on.

test('every scaling reaches both ends of a fade', () => {
  for (const fadeScaling of ['linear', 'equalPower', 'logarithmic', 6]) {
    expect(fadeVolumeAt(0, fadeScaling)).toBe(0);
    expect(fadeVolumeAt(1, fadeScaling)).toBeCloseTo(1, 10);
  }
});

test('equal power keeps a paired fade in and fade out at a constant power', () => {
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    const fadingIn = fadeVolumeAt(progress, 'equalPower');
    const fadingOut = fadeVolumeAt(1 - progress, 'equalPower');

    expect(fadingIn ** 2 + fadingOut ** 2).toBeCloseTo(1, 10);
  }
});

test('linear scaling interpolates volumes directly', () => {
  expect(fadeVolumeAt(0.5, 'linear')).toBe(0.5);
  expect(fadeVolumeAt(0.25, 'linear')).toBe(0.25);
});

test('a dB scaling expands over a range of its own', () => {
  // 6 dB of amplitude is 3 power dB, so half way through sits at -3 dB
  expect(fadeVolumeAt(0.5, 6)).toBeCloseTo(10 ** -0.15, 10);
  expect(fadeVolumeAt(0.5, 20)).toBeCloseTo(10 ** -0.5, 10);
});

test('an unusable scaling is refused rather than faded with', () => {
  for (const fadeScaling of ['bogus', -6, 0]) {
    expect(() => fadeVolumeAt(0.5, fadeScaling)).toThrow(TypeError);
    // Refused at the flat end of a fade as well, not only where it is curved
    expect(() => fadeVolumeAt(0, fadeScaling)).toThrow(TypeError);
  }
});
