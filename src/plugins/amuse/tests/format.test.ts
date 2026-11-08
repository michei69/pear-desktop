import { expect, test } from '@playwright/test';

import { emptyQuery, formatSongInfo } from '../format';

import type { SongInfo } from '@/providers/song-info';
import type { MediaType } from '@/providers/song-info-data';

const song = (overrides: Partial<SongInfo> = {}): SongInfo =>
  ({
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    songDuration: 200,
    elapsedSeconds: 42.6,
    isPaused: false,
    imageSrc: 'https://example.test/cover.jpg',
    url: 'https://music.youtube.com/watch?v=abc',
    videoId: 'abc',
    playlistId: 'LIST',
    mediaType: 'AUDIO' as MediaType,
    ...overrides,
  }) as SongInfo;

test('empty query keeps every field the clients read', () => {
  const query = emptyQuery();

  expect(query.apiVersion).toBe(2);
  expect(query.player).toEqual({
    hasSong: false,
    isPaused: true,
    volumePercent: 0,
    seekbarCurrentPosition: 0,
    seekbarCurrentPositionHuman: '0:00',
    statePercent: 0,
    likeStatus: 'INDIFFERENT',
    repeatType: 'NONE',
    positionUpdatedAt: 0,
  });
  expect(query.track).toMatchObject({
    album: '',
    mediaType: 'AUDIO',
    playlistId: null,
    isAdvertisement: false,
    isVideo: false,
  });
});

test('formats a playing song with a live position', () => {
  const query = formatSongInfo(song(), false, 1_700_000_000_000);

  expect(query.player).toMatchObject({
    hasSong: true,
    isPaused: false,
    seekbarCurrentPosition: 42,
    seekbarCurrentPositionHuman: '0:42',
    statePercent: 21,
    positionUpdatedAt: 1_700_000_000_000,
  });
  expect(query.track).toMatchObject({
    author: 'Artist',
    title: 'Song',
    album: 'Album',
    duration: 200,
    durationHuman: '3:20',
    id: 'abc',
    mediaType: 'AUDIO',
    playlistId: 'LIST',
    isVideo: false,
    isAdvertisement: false,
  });
});

test('carries the ad flag and detects video media types', () => {
  const ad = formatSongInfo(
    song({ mediaType: 'PODCAST_EPISODE' as MediaType, playlistId: '' }),
    true,
    123,
  );

  expect(ad.player.positionUpdatedAt).toBe(123);
  expect(ad.track.isAdvertisement).toBe(true);
  expect(ad.track.isVideo).toBe(true);
  expect(ad.track.playlistId).toBeNull();
});

test('falls back to an empty query before the first song', () => {
  expect(formatSongInfo({} as SongInfo, false, 99)).toEqual(emptyQuery());
});

test('keeps the ad flag in the empty query', () => {
  // The empty branch used to hardcode `isAdvertisement: false`, so an ad with
  // no artist/title collapsed both modes into one on the wire.
  expect(emptyQuery(true).track.isAdvertisement).toBe(true);
  expect(emptyQuery().track.isAdvertisement).toBe(false);
  expect(formatSongInfo({} as SongInfo, true, 99)).toEqual(emptyQuery(true));
});
