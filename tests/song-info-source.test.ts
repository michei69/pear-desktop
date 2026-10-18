import { expect, test } from '@playwright/test';

import {
  buildSongInfo,
  toSongInfoSource,
} from '../src/providers/song-info-data';

import type { GetPlayerResponse } from '../src/types/get-player-response';

// The renderer sends this projection over `peard:video-src-changed` instead of
// the whole player response. It must keep everything song info reads (including
// what the MPRIS, SponsorBlock and downloader listeners read) and nothing else.

const raw = {
  streamingData: {
    adaptiveFormats: [{ url: 'https://rr.example.com/audio?expire=1' }],
  },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
  playabilityStatus: { status: 'OK' },
  videoDetails: {
    videoId: 'vid',
    title: 'A Song',
    author: 'An Artist',
    viewCount: '12',
    lengthSeconds: '200',
    musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
    elapsedSeconds: 0,
    isPaused: false,
    album: 'An Album',
    thumbnail: {
      thumbnails: [
        { url: 'https://i.ytimg.com/a.jpg?w=1', width: 1, height: 1 },
        { url: 'https://i.ytimg.com/a.jpg?w=2', width: 2, height: 2 },
      ],
    },
  },
  microformat: {
    microformatDataRenderer: {
      urlCanonical: 'https://music.youtube.com/watch?v=vid&list=PL1',
      uploadDate: '2024-01-02',
      tags: ['Tag Artist'],
      description: 'A long description nothing reads',
      pageOwnerDetails: {
        externalChannelId: 'UC1',
        name: 'Page Owner',
        youtubeProfileUrl: 'https://www.youtube.com/channel/UC1',
      },
      linkAlternates: [
        { hrefUrl: 'https://example.com', title: 'Alternative Title' },
      ],
    },
  },
  responseContext: {
    serviceTrackingParams: [
      {
        service: 'GFEEDBACK',
        params: [
          { key: 'ipcc', value: '0' },
          { key: 'unused', value: 'x' },
        ],
      },
    ],
  },
} as unknown as GetPlayerResponse;

test('the IPC payload keeps the fields song info reads and drops the rest', () => {
  const source = toSongInfoSource(raw, 'An Album');

  expect(source).not.toHaveProperty('streamingData');
  expect(source).not.toHaveProperty('captions');
  expect(source).not.toHaveProperty('playabilityStatus');
  expect(source).not.toHaveProperty(
    'microformat.microformatDataRenderer.description',
  );

  expect(source.videoDetails?.thumbnail?.thumbnails).toEqual([
    { url: 'https://i.ytimg.com/a.jpg?w=1' },
    { url: 'https://i.ytimg.com/a.jpg?w=2' },
  ]);
  expect(source.microformat?.microformatDataRenderer?.urlCanonical).toBe(
    'https://music.youtube.com/watch?v=vid&list=PL1',
  );
  expect(
    source.responseContext?.serviceTrackingParams?.[0]?.params?.[0],
  ).toEqual({ key: 'ipcc', value: '0' });
});

test('buildSongInfo derives the same song from the projected payload', () => {
  expect(
    buildSongInfo(toSongInfoSource(raw, 'An Album'), {
      usePodcastParticipantAsArtist: true,
    }),
  ).toEqual(
    buildSongInfo(raw, {
      usePodcastParticipantAsArtist: true,
    }),
  );
});
