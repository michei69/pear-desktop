import { expect, test } from '@playwright/test';

import { flatProfile } from '../src/plugins/equalizer/config';
import { interpolatedResponse } from '../src/plugins/equalizer/response';

test('the editor curve passes through every band control dot', () => {
  const bands = flatProfile().filters.map((band, index) => ({
    ...band,
    gain: [-6, 9, -18, 3, 24, -12, 7, -3, 14, -9, 5][index],
  }));
  const curve = interpolatedResponse(bands);
  for (const band of bands) {
    const point = curve.find(
      (candidate) => Math.abs(candidate.frequency - band.frequency) < 1e-6,
    );
    expect(point).toBeDefined();
    expect(point!.db).toBeCloseTo(band.gain, 6);
  }
});
