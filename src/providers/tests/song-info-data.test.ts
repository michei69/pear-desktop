import { expect, test } from '@playwright/test';

import {
  buildSongInfo,
  cleanupName,
  getScrobbleMetadata,
  MediaType,
} from '../song-info-data';

import type { GetPlayerResponse } from '@/types/get-player-response';

// The frozen pure module the main-process song-info provider and the API
// server's v2 renderer half both build from. These pin the behaviour the
// scrobbler and the v2 `/video` route rely on.

const microformat = (over: Record<string, unknown> = {}) => ({
  microformatDataRenderer: {
    uploadDate: '2024-01-02',
    urlCanonical: 'https://music.youtube.com/watch?v=vid&list=PL1',
    pageOwnerDetails: { externalChannelId: 'UC1', name: 'Page Owner' },
    linkAlternates: [{ title: 'Alternative Title' }],
    tags: ['Tag Artist'],
    ...over,
  },
});

const videoDetails = (over: Record<string, unknown> = {}) => ({
  title: 'A Song',
  author: 'An Artist',
  viewCount: '12',
  lengthSeconds: '200',
  videoId: 'vid',
  musicVideoType: 'MUSIC_VIDEO_TYPE_ATV',
  ...over,
});

/** A minimal player response; only the fields under test are present. */
const player = (
  over: Record<string, unknown> = {},
  micro = microformat(),
): GetPlayerResponse =>
  ({
    microformat: micro,
    videoDetails: videoDetails(),
    ...over,
  }) as unknown as GetPlayerResponse;

const song = (over: Record<string, unknown> = {}, micro = microformat()) =>
  buildSongInfo(player(over, micro));

test('cleanupName strips the - Topic and VEVO artist suffixes', () => {
  expect(cleanupName('An Artist - Topic')).toBe('An Artist');
  expect(cleanupName('An ArtistVEVO')).toBe('An Artist');
  expect(cleanupName('An Artistvevo')).toBe('An Artist');
  expect(cleanupName('An Artist')).toBe('An Artist');
});

test('cleanupName strips the bracketed tag forms', () => {
  expect(cleanupName('A Song (Official Video)')).toBe('A Song');
  expect(cleanupName('A Song [Official Music Video]')).toBe('A Song');
  expect(cleanupName('A Song (Lyrics)')).toBe('A Song');
  expect(cleanupName('A Song (HD)')).toBe('A Song');
  expect(cleanupName('A Song (Live)')).toBe('A Song');
  expect(cleanupName('A Song (4K Upgrade)')).toBe('A Song');
});

test('cleanupName leaves a plain name alone and passes an empty one through', () => {
  expect(cleanupName('A Song')).toBe('A Song');
  expect(cleanupName('')).toBe('');
});

const metadata = {
  title: 'Plain Title',
  alternativeTitle: 'Alternative Title',
  artist: 'Plain Artist',
  tags: ['Tag Artist'],
};

test('getScrobbleMetadata prefers the alternative title only when alternativeTitles is on', () => {
  expect(getScrobbleMetadata(metadata).scrobbleTitle).toBe('Alternative Title');
  expect(
    getScrobbleMetadata(metadata, { alternativeTitles: false }).scrobbleTitle,
  ).toBe('Plain Title');
});

test('getScrobbleMetadata prefers tags[0] as the artist only when alternativeArtist is on', () => {
  expect(getScrobbleMetadata(metadata).scrobbleArtist).toBe('Tag Artist');
  expect(
    getScrobbleMetadata(metadata, { alternativeArtist: false }).scrobbleArtist,
  ).toBe('Plain Artist');
});

test('getScrobbleMetadata falls back when the alternative is missing or empty', () => {
  expect(
    getScrobbleMetadata({ ...metadata, alternativeTitle: '' }).scrobbleTitle,
  ).toBe('Plain Title');
  expect(getScrobbleMetadata({ ...metadata, tags: [] }).scrobbleArtist).toBe(
    'Plain Artist',
  );
  expect(
    getScrobbleMetadata({ ...metadata, tags: undefined }).scrobbleArtist,
  ).toBe('Plain Artist');
});

test('getScrobbleMetadata applies the custom filters to both fields', () => {
  expect(
    getScrobbleMetadata(metadata, {
      customRegexFilters: ['Alternative ', 'Tag '],
    }),
  ).toEqual({ scrobbleTitle: 'Title', scrobbleArtist: 'Artist' });
});

test('getScrobbleMetadata applies no filter when the list is empty', () => {
  expect(getScrobbleMetadata(metadata, { customRegexFilters: [] })).toEqual({
    scrobbleTitle: 'Alternative Title',
    scrobbleArtist: 'Tag Artist',
  });
});

test('getScrobbleMetadata skips a filter that fails to compile instead of throwing', () => {
  expect(() =>
    getScrobbleMetadata(metadata, {
      customRegexFilters: ['(unclosed', 'Alternative '],
    }),
  ).not.toThrow();
  expect(
    getScrobbleMetadata(metadata, {
      customRegexFilters: ['(unclosed', 'Alternative '],
    }),
  ).toEqual({ scrobbleTitle: 'Title', scrobbleArtist: 'Tag Artist' });
});

test('buildSongInfo maps every musicVideoType to its MediaType', () => {
  const mediaTypeFor = (musicVideoType: string | undefined) =>
    buildSongInfo(player({ videoDetails: videoDetails({ musicVideoType }) }))
      ?.mediaType;

  expect(mediaTypeFor('MUSIC_VIDEO_TYPE_ATV')).toBe(MediaType.Audio);
  expect(mediaTypeFor('MUSIC_VIDEO_TYPE_OMV')).toBe(
    MediaType.OriginalMusicVideo,
  );
  expect(mediaTypeFor('MUSIC_VIDEO_TYPE_UGC')).toBe(
    MediaType.UserGeneratedContent,
  );
  expect(mediaTypeFor('MUSIC_VIDEO_TYPE_PODCAST_EPISODE')).toBe(
    MediaType.PodcastEpisode,
  );
  // Anything else, including a missing type, is an "other" video.
  expect(mediaTypeFor('MUSIC_VIDEO_TYPE_UNKNOWN')).toBe(MediaType.OtherVideo);
  expect(mediaTypeFor(undefined)).toBe(MediaType.OtherVideo);
});

test('buildSongInfo uses the podcast page owner as the artist only when usePodcastParticipantAsArtist is false', () => {
  const podcast = player({
    videoDetails: videoDetails({
      musicVideoType: 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE',
    }),
  });

  expect(
    buildSongInfo(podcast, { usePodcastParticipantAsArtist: false })?.artist,
  ).toBe('Page Owner');
  expect(
    buildSongInfo(podcast, { usePodcastParticipantAsArtist: true })?.artist,
  ).toBe('An Artist');
});

test('buildSongInfo applies the same page-owner hack to untyped podcasts, keyed on the ipcc param', () => {
  const untyped = (ipcc: string | undefined) =>
    player({
      videoDetails: videoDetails({ musicVideoType: undefined }),
      ...(ipcc === undefined
        ? {}
        : {
            responseContext: {
              serviceTrackingParams: [
                { params: [{ key: 'ipcc', value: ipcc }] },
              ],
            },
          }),
    });

  expect(
    buildSongInfo(untyped('1'), { usePodcastParticipantAsArtist: false })
      ?.artist,
  ).toBe('Page Owner');
  // ipcc=0 marks a real podcast, so the video author stays the artist.
  expect(
    buildSongInfo(untyped('0'), { usePodcastParticipantAsArtist: false })
      ?.artist,
  ).toBe('An Artist');
  expect(
    buildSongInfo(untyped('1'), { usePodcastParticipantAsArtist: true })
      ?.artist,
  ).toBe('An Artist');
  // No ipcc param at all defaults to '1', so the hack still applies.
  expect(
    buildSongInfo(untyped(undefined), {
      usePodcastParticipantAsArtist: false,
    })?.artist,
  ).toBe('Page Owner');
});

test('buildSongInfo returns null for a missing response', () => {
  expect(buildSongInfo(undefined)).toBeNull();
});

test('buildSongInfo always fills scrobbleTitle and scrobbleArtist', () => {
  // With metadata present the scrobbler's alternatives win by default.
  expect(song()).toMatchObject({
    scrobbleTitle: 'Alternative Title',
    scrobbleArtist: 'Tag Artist',
  });

  // Without a microformat there is nothing to fall back on but the video
  // details, and both fields must still be strings.
  const bare = buildSongInfo(
    player({}, null as unknown as ReturnType<typeof microformat>),
  );
  expect(bare?.scrobbleTitle).toBe('A Song');
  expect(bare?.scrobbleArtist).toBe('An Artist');
});

test('buildSongInfo carries the video details, views and duration through', () => {
  expect(song()).toMatchObject({
    title: 'A Song',
    artist: 'An Artist',
    views: 12,
    songDuration: 200,
    videoId: 'vid',
    uploadDate: '2024-01-02',
    url: 'https://music.youtube.com/watch?v=vid',
    playlistId: 'PL1',
    artistUrl: 'https://music.youtube.com/channel/UC1',
    alternativeTitle: 'Alternative Title',
    tags: ['Tag Artist'],
  });
});
