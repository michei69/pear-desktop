import { expect, test } from '@playwright/test';

import {
  installDom,
  uninstallDom,
} from '../src/plugins/synced-lyrics/tests/harness';

import {
  linesFromJson,
  LrcRed,
} from '../src/plugins/synced-lyrics/providers/LrcRed';
import { setNetFetch } from '../src/plugins/synced-lyrics/renderer/ipc-bridge';

import type { SearchSongInfo } from '../src/plugins/synced-lyrics/types';

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:lrc="http://lrc.red/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="en">
  <head><metadata>
    <ttm:agent type="person" xml:id="v1"/>
    <ttm:agent type="person" xml:id="v2"/>
    <ttm:translation xml:lang="ja"><ttm:text for="L1">こんにちは</ttm:text></ttm:translation>
  </metadata></head>
  <body><div lrc:songPart="Verse">
    <p begin="1.0" end="3.0" lrc:key="L1" ttm:agent="v1"><span begin="1.0" end="1.5">Hello</span> <span begin="1.5" end="2.0">world</span> <span ttm:role="x-bg"><span begin="2.0" end="2.5">(ooh)</span></span></p>
    <p begin="4.0" end="5.0" ttm:agent="v2">Second line</p>
  </div></body>
</tt>`;

const song = (over: Partial<SearchSongInfo> = {}): SearchSongInfo => ({
  title: 'APT.',
  alternativeTitle: '',
  artist: 'ROSÉ & Bruno Mars',
  album: 'rosie',
  songDuration: 180,
  videoId: 'ekr2nIex040',
  tags: [],
  ...over,
});

type FetchCall = { url: string; init?: RequestInit };

/** Answers the match and song endpoints; `calls` records the requests. */
const stubLrcRed = (
  songPayload: unknown,
  {
    hit = {
      isrc: 'USAT22409184',
      title: 'APT.',
      artist: 'ROSÉ, Bruno Mars',
      duration: 178,
    } as Record<string, unknown> | null,
    calls = [],
    matchStatus = 200,
    songStatus = 200,
  }: {
    hit?: Record<string, unknown> | null;
    calls?: FetchCall[];
    matchStatus?: number;
    songStatus?: number;
  } = {},
) => {
  setNetFetch(async (url, init) => {
    calls.push({ url, init });

    if (url.includes('/match.json')) {
      return [matchStatus, JSON.stringify({ hits: hit ? [hit] : [] }), {}];
    }

    if (url.includes('.song.json')) {
      return [songStatus, JSON.stringify(songPayload), {}];
    }

    return [404, '{}', {}];
  });
};

test.beforeAll(() => installDom());
test.afterAll(() => uninstallDom());

test('matches a track and turns lrc.red TTML into word-synced lines', async () => {
  const calls: FetchCall[] = [];
  stubLrcRed(
    {
      title: 'APT.',
      artist: 'ROSÉ, Bruno Mars',
      source: TTML,
      lyrics: { lines: [] },
    },
    { calls },
  );

  const result = await new LrcRed().search(song());

  const matchUrl = new URL(calls[0].url);
  expect(matchUrl.origin + matchUrl.pathname).toBe(
    'https://lrc.red/match.json',
  );
  expect(Object.fromEntries(matchUrl.searchParams)).toEqual({
    track: 'APT.',
    artist: 'ROSÉ & Bruno Mars',
    album: 'rosie',
    duration: '180',
  });
  expect(calls[1].url).toBe('https://lrc.red/s/USAT22409184.song.json');
  // The request crosses the plugin IPC bridge; an AbortSignal is not cloneable
  // there, so the provider must not pass one (the timeout is raced instead).
  expect(calls[0].init?.signal).toBeUndefined();

  expect(result?.title).toBe('APT.');
  expect(result?.artists).toEqual(['ROSÉ', 'Bruno Mars']);

  const [first, second] = result!.lines!;
  expect(first).toMatchObject({
    timeInMs: 1000,
    duration: 2000,
    text: 'Hello world',
    alignment: 'start',
    status: 'upcoming',
  });
  expect(first.words).toStrictEqual([
    { duration: 500, text: 'Hello ', timeInMs: 1000 },
    { duration: 500, text: 'world ', timeInMs: 1500 },
  ]);
  expect(first.background).toStrictEqual([
    { duration: 500, text: '(ooh)', timeInMs: 2000 },
  ]);
  expect(second).toMatchObject({ alignment: 'end', text: 'Second line' });
  expect(second.words).toBeUndefined();

  expect(result?.translation).toMatchObject({
    language: 'ja',
    lines: [{ text: 'こんにちは', timeInMs: 1000 }],
  });
});

test('a hit whose duration is another recording is rejected', async () => {
  const calls: FetchCall[] = [];
  stubLrcRed(
    { title: 'APT.', artist: 'ROSÉ', source: TTML, lyrics: { lines: [] } },
    { calls, hit: { isrc: 'USAT22409184', duration: 300 } },
  );

  expect(await new LrcRed().search(song())).toBeNull();
  expect(calls).toHaveLength(1);
});

test('falls back to the JSON lines and their word groups', async () => {
  const calls: FetchCall[] = [];
  stubLrcRed(
    {
      title: 'APT.',
      artist: 'ROSÉ, Bruno Mars',
      duration: 178,
      lyrics: {
        lines: [
          {
            begin: 1,
            end: 2.5,
            text: 'Say my name',
            words: [
              [{ begin: 1, end: 1.3, text: 'Say' }],
              [{ begin: 1.3, end: 1.7, text: 'my' }],
              [{ begin: 1.7, end: 2.5, text: 'name' }],
            ],
          },
        ],
      },
    },
    { calls },
  );

  const result = await new LrcRed().search(song());

  expect(result?.lines).toStrictEqual([
    {
      time: '0:01',
      timeInMs: 1000,
      duration: 1500,
      text: 'Say my name',
      status: 'upcoming',
      words: [
        { duration: 300, text: 'Say ', timeInMs: 1000 },
        { duration: 400, text: 'my ', timeInMs: 1300 },
        { duration: 800, text: 'name', timeInMs: 1700 },
      ],
    },
  ]);
  expect(result?.lyrics).toBe('Say my name');
});

test('missing or failing endpoints mean no lyrics, never an error', async () => {
  stubLrcRed({}, { hit: null });
  expect(await new LrcRed().search(song())).toBeNull();

  stubLrcRed({}, { songStatus: 404 });
  expect(await new LrcRed().search(song())).toBeNull();

  setNetFetch(async () => {
    throw new Error('network down');
  });
  expect(await new LrcRed().search(song())).toBeNull();
});

test('the JSON fallback ignores untimed lines', () => {
  expect(
    linesFromJson({
      lyrics: { lines: [{ text: 'no timing' }] },
    }),
  ).toStrictEqual([]);
});
