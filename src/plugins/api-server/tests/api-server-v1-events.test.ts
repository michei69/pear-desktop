import { expect, test } from '@playwright/test';

import { LikeType } from '@/types/datahost-get-state';

import {
  createV1EventAdapter,
  v1PlayerInfo,
} from '../backend/websocket-v1-events';

import type { PlayerSnapshot, WireSongInfo } from '../backend/state';

/**
 * v1 has always reported whole seconds. The player API's `onVideoProgress`
 * reports floats, so v1's socket adapter floors every position and drops ticks
 * that do not change the reported second. v2 keeps the float precision.
 */
const song = (elapsedSeconds?: number): WireSongInfo =>
  ({
    title: 'Song',
    artist: 'Artist',
    views: 0,
    songDuration: 200,
    videoId: 'vid',
    mediaType: 'AUDIO',
    ...(elapsedSeconds !== undefined && { elapsedSeconds }),
  }) as unknown as WireSongInfo;

const snapshot = (overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  song: undefined,
  isPlaying: true,
  muted: false,
  position: 12.8,
  volume: 80,
  repeat: 'NONE',
  shuffle: false,
  ...overrides,
});

test('PLAYER_INFO reports whole-second positions', () => {
  const info = v1PlayerInfo(snapshot({ position: 12.8, song: song(12.8) }));

  expect(info.position).toBe(12);
  expect(info.song?.elapsedSeconds).toBe(12);
  // Everything else is passed through unchanged.
  expect(info.isPlaying).toBe(true);
  expect(info.volume).toBe(80);
});

test('PLAYER_INFO keeps a missing song missing', () => {
  const info = v1PlayerInfo(snapshot());

  expect(info.position).toBe(12);
  expect(info.song).toBeUndefined();
});

test('POSITION_CHANGED is floored and sent only when the second changes', () => {
  const adapt = createV1EventAdapter();

  expect(adapt({ type: 'POSITION_CHANGED', position: 5.1 })).toEqual({
    type: 'POSITION_CHANGED',
    position: 5,
  });
  // 5.9 still reports the same second: v1 never sent it.
  expect(adapt({ type: 'POSITION_CHANGED', position: 5.9 })).toBeUndefined();
  expect(adapt({ type: 'POSITION_CHANGED', position: 6.01 })).toEqual({
    type: 'POSITION_CHANGED',
    position: 6,
  });
});

test('VIDEO_CHANGED and PLAYER_STATE_CHANGED positions are floored too', () => {
  const adapt = createV1EventAdapter();

  expect(
    adapt({ type: 'VIDEO_CHANGED', song: song(3.7), position: 0.4 }),
  ).toMatchObject({ position: 0, song: { elapsedSeconds: 3 } });

  expect(
    adapt({ type: 'PLAYER_STATE_CHANGED', isPlaying: false, position: 27.9 }),
  ).toEqual({ type: 'PLAYER_STATE_CHANGED', isPlaying: false, position: 27 });
});

test('RATING_CHANGED is dropped: v1 never published the rating', () => {
  const adapter = createV1EventAdapter();

  expect(adapter({ type: 'RATING_CHANGED', rating: LikeType.Like })).toBe(
    undefined,
  );
});

test('events without a position are passed through untouched', () => {
  const adapt = createV1EventAdapter();
  const volume = { type: 'VOLUME_CHANGED' as const, volume: 50, muted: false };

  expect(adapt(volume)).toBe(volume);
});
