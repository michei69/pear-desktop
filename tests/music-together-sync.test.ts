import { expect, test } from '@playwright/test';

import {
  hasSameVideoIds,
  indexOfQueueVideoId,
  insertVideoData,
  mapQueueItem,
  moveVideoData,
  queueEntries,
  queueVideoIds,
  reconcileVideoData,
  removeVideoData,
  selectedQueueIndex,
} from '../src/plugins/music-together/queue/utils';

import type { VideoData } from '../src/plugins/music-together/types';
import type { QueueItem } from '../src/types/datahost-get-state';

const owner = (videoId: string, ownerId = 'host'): VideoData => ({
  videoId,
  ownerId,
});

const video = (videoId: string, selected = false) =>
  ({
    playlistPanelVideoRenderer: { videoId, selected },
  }) as unknown as QueueItem;

const wrapper = (videoId: string, selected = false) =>
  ({
    playlistPanelVideoWrapperRenderer: {
      primaryRenderer: {
        playlistPanelVideoRenderer: { videoId, selected },
      },
    },
  }) as unknown as QueueItem;

test('a repeated queue sync with the same tracks is detected', () => {
  const host = [owner('a'), owner('b', 'guest')];
  // The host re-sends the list on a join or a rejected action, with owner ids
  // filled in: same tracks, so the guest must not re-fetch the queue.
  const resent = [owner('a'), owner('b', 'host')];

  expect(hasSameVideoIds(resent, host)).toBe(true);
});

test('an added, removed, reordered or replaced track is a real change', () => {
  const base = [owner('a'), owner('b')];

  expect(hasSameVideoIds([...base, owner('c')], base)).toBe(false);
  expect(hasSameVideoIds(base.slice(0, 1), base)).toBe(false);
  expect(hasSameVideoIds([base[1], base[0]], base)).toBe(false);
  expect(hasSameVideoIds([base[0], owner('z')], base)).toBe(false);
});

test('empty lists match', () => {
  expect(hasSameVideoIds([], [])).toBe(true);
});

test('inserting rows keeps the surrounding owners and clamps the position', () => {
  const base = [owner('a'), owner('b', 'guest')];

  expect(insertVideoData(base, [owner('x')], 1)).toEqual([
    owner('a'),
    owner('x'),
    owner('b', 'guest'),
  ]);
  // A play-next at the end, or a stale index from a peer, must not drop rows.
  expect(insertVideoData(base, [owner('x')], 99)).toEqual([
    owner('a'),
    owner('b', 'guest'),
    owner('x'),
  ]);
  expect(insertVideoData(base, [owner('x')], -3)).toEqual([
    owner('x'),
    owner('a'),
    owner('b', 'guest'),
  ]);
  expect(insertVideoData(base, [owner('x')])).toEqual([
    owner('a'),
    owner('b', 'guest'),
    owner('x'),
  ]);
  expect(base).toHaveLength(2);
});

test('removing and moving rows follow the queue store semantics', () => {
  const base = [owner('a'), owner('b', 'guest'), owner('c')];

  expect(removeVideoData(base, 1)).toEqual([owner('a'), owner('c')]);
  expect(removeVideoData(base, -1)).toBe(base);
  expect(removeVideoData(base, 9)).toBe(base);

  expect(moveVideoData(base, 0, 2)).toEqual([
    owner('b', 'guest'),
    owner('c'),
    owner('a'),
  ]);
  expect(moveVideoData(base, 2, 0)).toEqual([
    owner('c'),
    owner('a'),
    owner('b', 'guest'),
  ]);
  // Moving to the end passes the list length, as the queue store allows.
  expect(moveVideoData(base, 0, base.length)).toEqual([
    owner('b', 'guest'),
    owner('c'),
    owner('a'),
  ]);
  expect(moveVideoData(base, 0, 9)).toBe(base);
  expect(moveVideoData(base, 9, 0)).toBe(base);
});

test('reconciling a replaced queue keeps owners and defaults the new rows', () => {
  const previous = [owner('a'), owner('b', 'guest')];

  expect(
    reconcileVideoData(previous, [video('a'), video('b')], 'host'),
  ).toEqual([owner('a'), owner('b', 'guest')]);

  // The queue reordered: match by video id instead of position.
  expect(
    reconcileVideoData(previous, [video('b'), video('a')], 'host'),
  ).toEqual([owner('b', 'guest'), owner('a')]);

  // A row the previous list did not have falls back to its added owner.
  expect(
    reconcileVideoData(previous, [video('a'), video('x')], 'host'),
  ).toEqual([owner('a'), owner('x', 'host')]);

  // Removed rows do not leave a stale tail behind.
  expect(reconcileVideoData(previous, [video('a')], 'host')).toEqual([
    owner('a'),
  ]);
});

test('queue rows are flattened for owner matching and selection', () => {
  const items = [video('a'), wrapper('b', true), null as unknown as QueueItem];

  expect(queueEntries(items)).toEqual([
    { videoId: 'a', selected: false },
    { videoId: 'b', selected: true },
    undefined,
  ]);
  expect(queueVideoIds(items)).toEqual(['a', 'b', undefined]);
  expect(selectedQueueIndex(items)).toBe(1);
  expect(indexOfQueueVideoId(items, 'b')).toBe(1);
  expect(indexOfQueueVideoId(items, 'missing')).toBe(-1);
});

test('malformed rows never throw while the queue is read', () => {
  // The redux queue is runtime data: slots can be null and a wrapper can have
  // no primary renderer after YouTube Music switches player pages.
  const items = [
    null as unknown as QueueItem,
    {} as QueueItem,
    { playlistPanelVideoWrapperRenderer: {} } as unknown as QueueItem,
    video('a'),
  ];

  expect(() => mapQueueItem((it) => it?.videoId, items)).not.toThrow();
  expect(queueVideoIds(items)).toEqual([undefined, undefined, undefined, 'a']);
  expect(selectedQueueIndex(items)).toBe(-1);
});
