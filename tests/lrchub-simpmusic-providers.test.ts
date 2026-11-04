import { expect, test } from '@playwright/test';

import {
  LRCHub,
  pickLrchubLrc,
} from '../src/plugins/synced-lyrics/providers/LRCHub';
import {
  decodeHtmlEntities,
  pickBestSimpMusicEntry,
  richSyncToLrc,
  SimpMusic,
} from '../src/plugins/synced-lyrics/providers/SimpMusic';
import { setNetFetch } from '../src/plugins/synced-lyrics/renderer/ipc-bridge';

import type { SearchSongInfo } from '../src/plugins/synced-lyrics/types';

type FetchCall = { url: string; init?: RequestInit };

const song = (over: Partial<SearchSongInfo> = {}): SearchSongInfo => ({
  title: 'APT.',
  alternativeTitle: '',
  artist: 'ROSÉ & Bruno Mars',
  album: '',
  songDuration: 173,
  videoId: 'ekr2nIex040',
  tags: [],
  ...over,
});

/** Point the renderer netFetch bridge at a canned response. */
const stubFetch = (status: number, body: unknown, calls: FetchCall[] = []) => {
  setNetFetch(async (url, init) => {
    calls.push({ url, init });
    return [status, typeof body === 'string' ? body : JSON.stringify(body), {}];
  });
};

const texts = (lines?: { text: string }[]) =>
  lines?.map((line) => line.text).filter(Boolean) ?? [];

test('LRCHub posts track/artist/video id and reads the line-synced LRC', async () => {
  const calls: FetchCall[] = [];
  stubFetch(
    200,
    {
      track: 'APT.',
      artist: 'ROSÉ & Bruno Mars',
      synced_lyrics: '[00:00.00]아파트 아파트\n[00:02.50]Uh uh huh uh huh',
    },
    calls,
  );

  const result = await new LRCHub().search(song());

  expect(calls[0]?.url).toBe('https://lrchub.coreone.work/api/lyrics');
  expect(calls[0]?.init?.method).toBe('POST');
  expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
    track: 'APT.',
    artist: 'ROSÉ & Bruno Mars',
    video_id: 'ekr2nIex040',
  });
  expect(texts(result?.lines)).toEqual(['아파트 아파트', 'Uh uh huh uh huh']);
  expect(result?.lines?.[1].timeInMs).toBe(2500);
  expect(result?.artists).toEqual(['ROSÉ', 'Bruno Mars']);
});

test('LRCHub keeps the word timings of its word-synced fields', async () => {
  stubFetch(200, {
    lyrics: '[00:00.00]<00:00.00>아<00:00.25>파트',
  });

  const result = await new LRCHub().search(song());

  expect(texts(result?.lines)).toEqual(['아파트']);
  expect(result?.lines?.[0].words).toStrictEqual([
    { duration: 250, text: '아', timeInMs: 0 },
    { duration: Infinity, text: '파트', timeInMs: 250 },
  ]);
  expect(pickLrchubLrc({ synced_lyrics: 'a', lyrics: 'b' })).toBe('a');
});

test('LRCHub treats the overloaded SERVER_BUSY answer as no lyrics', async () => {
  let calls = 0;
  setNetFetch(async () => {
    calls += 1;
    return [
      503,
      JSON.stringify({ code: 'SERVER_BUSY', found: false, ok: false }),
      {},
    ];
  });

  expect(await new LRCHub().search(song())).toBeNull();
  expect(calls).toBe(3);
});

test('LRCHub returns null when the server has no record', async () => {
  stubFetch(404, {});

  expect(await new LRCHub().search(song())).toBeNull();
});

test('SimpMusic sends its client User-Agent and converts rich sync to line LRC', async () => {
  const calls: FetchCall[] = [];
  stubFetch(
    200,
    {
      type: 'success',
      data: [
        {
          songTitle: 'APT.',
          artistName: 'ROSÉ & Bruno Mars',
          richSyncLyrics:
            '[00:06.677]v1:<00:06.677>아<00:07.066>파트 <00:07.439>\n[00:08.240]v2:<00:08.240>Kissy <00:08.629>face ',
          vote: 1,
        },
      ],
    },
    calls,
  );

  const result = await new SimpMusic().search(song());
  const headers = calls[0]?.init?.headers as Record<string, string>;

  expect(calls[0]?.url).toBe('https://api-lyrics.simpmusic.org/v1/ekr2nIex040');
  expect(headers['User-Agent']).toBe('SimpMusicLyrics/1.0');
  expect(texts(result?.lines)).toEqual(['아파트', 'Kissy face']);
  const first = result?.lines?.find((line) => line.text === '아파트');
  expect(first?.timeInMs).toBe(6677);
  expect(first?.words).toStrictEqual([
    { duration: 389, text: '아', timeInMs: 6677 },
    { duration: 373, text: '파트 ', timeInMs: 7066 },
  ]);
});

test('SimpMusic prefers rich sync over synced over plain and decodes entities', () => {
  expect(
    pickBestSimpMusicEntry([{ plainLyric: 'p' }, { syncedLyrics: 's' }])
      ?.syncedLyrics,
  ).toBe('s');
  expect(richSyncToLrc('[00:01.00]v1:<00:01.00>a <00:01.50>b')).toBe(
    '[00:01.00]<00:01.00>a <00:01.50>b',
  );
  expect(decodeHtmlEntities('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
  expect(decodeHtmlEntities('&#x27;Cause you&#x27;re')).toBe("'Cause you're");
});

test('SimpMusic returns null when the API has no lyrics for the video', async () => {
  stubFetch(404, {});

  expect(await new SimpMusic().search(song())).toBeNull();
});
