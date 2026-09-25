import { expect, test } from '@playwright/test';
import CryptoJS from 'crypto-js';

import {
  bonusCompare,
  comparableText,
  Netease,
  normalizedLevenshtein,
  scoreCandidate,
  splitTitle,
} from '../src/plugins/synced-lyrics/providers/NetEase';

const EAPI_AES_KEY = 'e82ckenh8dichen8';

const query = (title: string, artist: string) => {
  const parts = splitTitle(title.normalize('NFKC'));

  return {
    title: title.normalize('NFKC'),
    artist: artist.normalize('NFKC'),
    parts: parts.length > 0 ? parts : [title.normalize('NFKC')],
  };
};

const candidate = (title: string, artists: string[]) => ({
  title: title.normalize('NFKC'),
  artists: artists.map((artist) => artist.normalize('NFKC')),
});

test.describe('title splitting', () => {
  test('keeps a plain title as is', () => {
    expect(splitTitle('Lemon')).toEqual(['Lemon']);
  });

  test('drops version suffixes and bracket noise', () => {
    expect(splitTitle('残酷な天使のテーゼ (Cover)')).toEqual([
      '残酷な天使のテーゼ',
    ]);
    expect(splitTitle('Song feat. Someone')).toEqual(['Song']);
    expect(splitTitle('Song MV')).toEqual(['Song']);
  });

  test('splits title and artist delimiters', () => {
    expect(splitTitle('Lemon - 米津玄師')).toEqual(['Lemon', '米津玄師']);
    expect(splitTitle('Song / Artist')).toEqual(['Song', 'Artist']);
  });

  test('extracts quoted titles', () => {
    expect(splitTitle('「君の名は。」より 前前前世')).toEqual([
      '君の名は。',
      'より 前前前世',
    ]);
  });

  test('ignores duplicate parts', () => {
    expect(splitTitle('Lemon (Lemon)')).toEqual(['Lemon']);
  });
});

test.describe('comparison helpers', () => {
  test('normalizes full-width characters', () => {
    expect(comparableText('Ｌｅｍｏｎ')).toBe('lemon');
    expect(comparableText('ｱｲｳｴｵ')).toBe('aiueo');
  });

  test('romanizes kana so romaji titles match', () => {
    expect(comparableText('ひまわり')).toBe('himawari');
    expect(comparableText('ヒマワリ')).toBe('himawari');
    // Long vowels lose their macron: romaji is usually written without one.
    expect(comparableText('コーヒー')).toBe('kohi');
  });

  test('measures similarity in [0, 1]', () => {
    expect(normalizedLevenshtein('', '')).toBe(0);
    expect(normalizedLevenshtein('Lemon', 'Lemon')).toBe(1);
    expect(normalizedLevenshtein('Lemon', 'Lemons')).toBeCloseTo(5 / 6, 5);
  });

  test('weights down titles that are neither a prefix nor a substring', () => {
    expect(bonusCompare('Lemon', 'Lemon')).toBe(1);
    // A version suffix is a prefix match, so it keeps a good share of the score.
    expect(bonusCompare('Lemon (Live)', 'Lemon')).toBeCloseTo(5 / 12, 5);
    expect(bonusCompare('LemonS', 'Lemon')).toBeCloseTo(5 / 6, 5);
    // The same kind of similarity without the prefix bonus scores half as much.
    expect(bonusCompare('Melon', 'Lemon')).toBeCloseTo(0.3, 5);
  });
});

test.describe('candidate scoring', () => {
  const lemon = query('Lemon', '米津玄師');

  test('prefers the exact release over a version of it', () => {
    const exact = scoreCandidate(candidate('Lemon', ['米津玄師']), lemon);
    const live = scoreCandidate(candidate('Lemon (Live)', ['米津玄師']), lemon);

    expect(exact).toBeCloseTo(11.1, 5);
    expect(live).toBeCloseTo(11, 5);
    expect(exact).toBeGreaterThan(live);
  });

  test('keeps covers and drops unrelated songs', () => {
    const cover = scoreCandidate(candidate('Lemon', ['某翻唱歌手']), lemon);
    const unrelated = scoreCandidate(
      candidate('Shape of You', ['Ed Sheeran']),
      lemon,
    );

    expect(cover).toBeGreaterThanOrEqual(4.5);
    expect(unrelated).toBeLessThan(4.5);
  });

  test('matches a kana title against its romaji spelling', () => {
    const kana = scoreCandidate(
      candidate('ひまわり', ['秦基博']),
      query('Himawari', '秦基博'),
    );

    expect(kana).toBeCloseTo(11.1, 5);
  });

  test('does not punish candidates without artists', () => {
    expect(scoreCandidate(candidate('Lemon', []), lemon)).toBeCloseTo(10.1, 5);
  });
});

type EapiCall = { path: string; data: Record<string, unknown> };

const decryptParams = (params: string) => {
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.enc.Hex.parse(decodeURIComponent(params)) },
    CryptoJS.enc.Utf8.parse(EAPI_AES_KEY),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  ).toString(CryptoJS.enc.Utf8);

  return JSON.parse(decrypted.split('-36cd479b6b5-')[1]) as Record<
    string,
    unknown
  >;
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const song = (id: number, name: string, artists: string[], seconds: number) => ({
  resourceId: id,
  baseInfo: {
    simpleSongData: {
      name,
      ar: artists.map((artist, index) => ({ id: index + 1, name: artist })),
      dt: seconds * 1000,
    },
  },
});

/** NetEase answers with `resources: null` when a keyword has no match. */
type SearchResponder =
  | unknown[]
  | null
  | ((keyword: string) => unknown[] | null);

/** Stubs the whole eapi surface and records every call it receives. */
const mockEapi = (
  responder: SearchResponder,
  lyrics: Record<number, string | null>,
) => {
  const calls: EapiCall[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^\/eapi/, '');
    const body = String(init?.body ?? '');
    const data = decryptParams(body.replace(/^params=/, ''));
    calls.push({ path, data });

    switch (path) {
      case '/register/anonimous': {
        return jsonResponse({ code: 200 });
      }
      case '/search/song/list/page': {
        const resources =
          typeof responder === 'function'
            ? responder(String(data.keyword))
            : responder;

        return jsonResponse({
          code: 200,
          message: 'ok',
          data: { resources },
        });
      }
      case '/song/lyric/v1': {
        return jsonResponse({
          code: 200,
          lrc: { lyric: lyrics[Number(data.id)] ?? '' },
        });
      }
      default: {
        throw new Error(`unexpected eapi call: ${path}`);
      }
    }
  }) as typeof fetch;

  return calls;
};

const probedSongIds = (calls: EapiCall[]) =>
  calls
    .filter((call) => call.path === '/song/lyric/v1')
    .map((call) => Number(call.data.id));

test.describe('Netease search', () => {
  test('picks the best candidate whose duration matches and has lyrics', async () => {
    const calls = mockEapi(
      [
        song(101, 'Lemon (Live)', ['米津玄師'], 400),
        song(102, 'Lemon', ['米津玄師'], 256),
        song(103, 'Lemon', ['某翻唱歌手'], 256),
        song(104, 'Shape of You', ['Ed Sheeran'], 256),
      ],
      {
        102: '',
        103: '[00:00.00]first line\n[00:15.00]second line\n{"t":0,"c":[]}',
      },
    );

    const result = await new Netease().search({
      title: 'Lemon',
      artist: '米津玄師',
      songDuration: 256,
    } as Parameters<Netease['search']>[0]);

    // The exact release ranks first but has no lyrics, the live version is
    // skipped for its duration, so the cover is the first usable candidate.
    expect(probedSongIds(calls)).toEqual([102, 103]);
    expect(result?.title).toBe('Lemon');
    expect(result?.artists).toEqual(['某翻唱歌手']);
    expect(result?.lyrics).toBe('[00:00.00]first line\n[00:15.00]second line');
    expect(result?.lines).toHaveLength(2);
    expect(result?.lines?.[0]).toMatchObject({
      timeInMs: 0,
      text: 'first line',
      status: 'upcoming',
    });
  });

  test('searches once per title part plus the artist, deduplicating results', async () => {
    const calls = mockEapi([song(102, 'Lemon', ['米津玄師'], 256)], {
      102: '[00:01.00]only line',
    });

    await new Netease().search({
      title: 'Lemon',
      artist: '米津玄師',
      songDuration: 256,
    } as Parameters<Netease['search']>[0]);

    const searches = calls.filter(
      (call) => call.path === '/search/song/list/page',
    );
    const keywords = searches.map((call) => call.data.keyword);

    expect(keywords).toEqual(['Lemon', 'Lemon 米津玄師']);
    // Every keyword returned the same song, but it is only probed once.
    expect(probedSongIds(calls)).toEqual([102]);
  });

  test('matches full-width and kana titles', async () => {
    const calls = mockEapi([song(201, 'ひまわり', ['秦基博'], 315)], {
      201: '[00:01.00]kana line',
    });

    const result = await new Netease().search({
      title: 'Ｈｉｍａｗａｒｉ',
      artist: 'Motohiro Hata',
      songDuration: 315,
    } as Parameters<Netease['search']>[0]);

    expect(probedSongIds(calls)).toEqual([201]);
    expect(result?.title).toBe('ひまわり');
  });

  test('gives up when no candidate matches the duration', async () => {
    const calls = mockEapi([song(301, 'Lemon', ['米津玄師'], 600)], {
      301: '[00:01.00]too long',
    });

    const result = await new Netease().search({
      title: 'Lemon',
      artist: '米津玄師',
      songDuration: 256,
    } as Parameters<Netease['search']>[0]);

    expect(result).toBeNull();
    expect(probedSongIds(calls)).toEqual([]);
  });

  test('gives up when every result is too different', async () => {
    const calls = mockEapi([song(401, 'Shape of You', ['Ed Sheeran'], 256)], {
      401: '[00:01.00]unrelated',
    });

    const result = await new Netease().search({
      title: 'Lemon',
      artist: '米津玄師',
      songDuration: 256,
    } as Parameters<Netease['search']>[0]);

    expect(result).toBeNull();
    expect(probedSongIds(calls)).toEqual([]);
  });

  test('keeps searching when a keyword has no results', async () => {
    const calls = mockEapi(
      (keyword) =>
        keyword === 'Lemon' ? [song(501, 'Lemon', ['米津玄師'], 256)] : null,
      { 501: '[00:01.00]found anyway' },
    );

    const result = await new Netease().search({
      title: 'Lemon',
      artist: '米津玄師',
      songDuration: 256,
    } as Parameters<Netease['search']>[0]);

    expect(probedSongIds(calls)).toEqual([501]);
    expect(result?.lyrics).toBe('[00:01.00]found anyway');
  });
});
