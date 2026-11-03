import { expect, test } from '@playwright/test';

import { toPlain } from '../renderer/to-plain';

test('toPlain unwraps the proxies a store payload carries', () => {
  const payload = {
    videoId: 'v',
    lines: new Proxy(['a', 'b'], {}),
    meta: new Proxy({ state: 'done' }, {}),
  };

  expect(() => structuredClone(payload)).toThrow();

  const plain = toPlain(payload);
  expect(plain).toEqual({
    videoId: 'v',
    lines: ['a', 'b'],
    meta: { state: 'done' },
  });
  expect(structuredClone(plain)).toEqual(plain);
});

test('toPlain passes undefined through', () => {
  expect(toPlain(undefined)).toBeUndefined();
});
