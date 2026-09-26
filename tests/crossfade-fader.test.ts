import { expect, test } from '@playwright/test';

import { fadeCurve, fadeVolumeAt } from '../src/plugins/crossfade/fader';

// Every fade the crossfade runs is this curve sampled: forwards for a fade in,
// backwards for a fade out.

test('equal power holds a constant combined power across the pair', () => {
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    const fadingIn = fadeVolumeAt(progress, 'equalPower');
    const fadingOut = fadeVolumeAt(1 - progress, 'equalPower');

    expect(fadingIn ** 2 + fadingOut ** 2).toBeCloseTo(1, 6);
  }
});

test('every scaling reaches both of the fade endpoints', () => {
  for (const fadeScaling of ['linear', 'equalPower', 'logarithmic', 20]) {
    expect(fadeVolumeAt(0, fadeScaling)).toBe(0);
    expect(fadeVolumeAt(1, fadeScaling)).toBeCloseTo(1, 6);
  }
});

test('linear scaling interpolates levels directly', () => {
  expect(fadeVolumeAt(0.25, 'linear')).toBeCloseTo(0.25, 10);
  expect(fadeVolumeAt(0.5, 'equalPower')).toBeCloseTo(Math.SQRT1_2, 6);
});

test('a dynamic range in dB is expanded over the fade', () => {
  // 20 dB of range is half the default 60 dB, so mid-fade sits 10 dB down
  expect(fadeVolumeAt(0.5, 20)).toBeCloseTo(10 ** -0.5, 6);
  expect(fadeVolumeAt(0.5, 'logarithmic')).toBeCloseTo(10 ** -1.5, 6);
});

test('an unusable scaling is refused rather than faded with', () => {
  expect(() => fadeVolumeAt(0.5, 0)).toThrow(TypeError);
  expect(() => fadeVolumeAt(0.5, -10)).toThrow(TypeError);
});

test('a scheduled curve is the scaler sampled forwards and backwards', () => {
  const fadeIn = fadeCurve('equalPower', 'in');
  const fadeOut = fadeCurve('equalPower', 'out');

  expect(fadeIn[0]).toBeCloseTo(0, 6);
  expect(fadeIn.at(-1)).toBeCloseTo(1, 6);

  for (let point = 0; point < fadeIn.length; point += 1) {
    expect(fadeIn[point] ** 2 + fadeOut[point] ** 2).toBeCloseTo(1, 6);
  }
});
