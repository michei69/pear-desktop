import { expect, test } from '@playwright/test';

import { hasSameVideoIds } from '../src/plugins/music-together/queue/utils';

test('a repeated queue sync with the same tracks is detected', () => {
  const host = [
    { videoId: 'a', ownerId: 'host' },
    { videoId: 'b', ownerId: 'guest' },
  ];
  // The host re-sends the list on a join or a rejected action, with owner ids
  // filled in: same tracks, so the guest must not re-fetch the queue.
  const resent = [
    { videoId: 'a', ownerId: 'host' },
    { videoId: 'b', ownerId: 'host' },
  ];

  expect(hasSameVideoIds(resent, host)).toBe(true);
});

test('an added, removed, reordered or replaced track is a real change', () => {
  const base = [
    { videoId: 'a', ownerId: 'host' },
    { videoId: 'b', ownerId: 'host' },
  ];

  expect(
    hasSameVideoIds([...base, { videoId: 'c', ownerId: 'host' }], base),
  ).toBe(false);
  expect(hasSameVideoIds(base.slice(0, 1), base)).toBe(false);
  expect(hasSameVideoIds([base[1], base[0]], base)).toBe(false);
  expect(
    hasSameVideoIds([base[0], { videoId: 'z', ownerId: 'host' }], base),
  ).toBe(false);
});

test('empty lists match', () => {
  expect(hasSameVideoIds([], [])).toBe(true);
});
