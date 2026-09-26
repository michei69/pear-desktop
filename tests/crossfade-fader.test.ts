import { expect, test } from '@playwright/test';

import { VolumeFader } from '../src/plugins/crossfade/fader';

// The fader schedules its updates through requestAnimationFrame, so the tests
// drive updateVolume() by hand on a frozen clock instead.
Object.assign(globalThis, { window: { requestAnimationFrame: () => 0 } });

type FadeOptions = {
  fadeScaling: string;
  initialVolume: number;
  targetVolume: number;
};

/** Volume of a 1000 ms fade after `progress` of its duration. */
const volumeAt = (
  { fadeScaling, initialVolume, targetVolume }: FadeOptions,
  progress: number,
) => {
  const media = { volume: initialVolume };
  const fader = new VolumeFader(media, {
    fadeScaling,
    initialVolume,
    fadeDuration: 1000,
  });

  const start = 1_000_000;
  const realNow = Date.now;

  try {
    Date.now = () => start;
    fader.fadeTo(targetVolume);

    Date.now = () => start + progress * 1000;
    fader.updateVolume();
  } finally {
    Date.now = realNow;
  }

  return media.volume;
};

test('equal power keeps a constant combined power below full volume', () => {
  const fadingOut = volumeAt(
    { fadeScaling: 'equalPower', initialVolume: 0.5, targetVolume: 0 },
    0.5,
  );
  const fadingIn = volumeAt(
    { fadeScaling: 'equalPower', initialVolume: 0, targetVolume: 0.5 },
    0.5,
  );

  expect(fadingOut).toBeCloseTo(fadingIn, 10);
  expect(fadingOut ** 2 + fadingIn ** 2).toBeCloseTo(0.5 ** 2, 6);
});

test('equal power keeps its full-range cos/sin curve', () => {
  expect(
    volumeAt(
      { fadeScaling: 'equalPower', initialVolume: 1, targetVolume: 0 },
      0.5,
    ),
  ).toBeCloseTo(Math.SQRT1_2, 6);

  expect(
    volumeAt(
      { fadeScaling: 'equalPower', initialVolume: 0, targetVolume: 1 },
      0.5,
    ),
  ).toBeCloseTo(Math.SQRT1_2, 6);
});

test('every scaling reaches both of the fade endpoints', () => {
  for (const fadeScaling of ['linear', 'equalPower', 'logarithmic']) {
    const options = { fadeScaling, initialVolume: 0.25, targetVolume: 0.75 };

    expect(volumeAt(options, 0)).toBeCloseTo(0.25, 6);
    expect(volumeAt(options, 1)).toBeCloseTo(0.75, 6);
  }
});

test('cancelling a fade runs its callback and leaves the volume alone', () => {
  const media = { volume: 1 };
  const fader = new VolumeFader(media, {
    fadeScaling: 'linear',
    fadeDuration: 1000,
  });
  let released = 0;

  fader.fadeOut(() => {
    released += 1;
  });
  fader.cancelFade();

  expect(released).toBe(1);
  expect(media.volume).toBe(1);
});

test('a zero duration fade completes on the spot', () => {
  const media = { volume: 1 };
  const fader = new VolumeFader(media, {
    fadeScaling: 'linear',
    fadeDuration: 0,
  });
  let released = 0;

  fader.fadeOut(() => {
    released += 1;
  });

  expect(released).toBe(1);
  expect(media.volume).toBe(0);
});

test('linear scaling still interpolates volumes directly', () => {
  expect(
    volumeAt(
      { fadeScaling: 'linear', initialVolume: 0.5, targetVolume: 0 },
      0.5,
    ),
  ).toBeCloseTo(0.25, 10);
});
