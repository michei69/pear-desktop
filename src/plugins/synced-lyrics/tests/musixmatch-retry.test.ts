import { expect, test } from '@playwright/test';

import { installDom, uninstallDom } from './harness';

import { MusixMatch } from '../providers/MusixMatch';
import { netFetch, setNetFetch } from '../renderer/ipc-bridge';

import type { SearchSongInfo } from '../types';

/**
 * A 401 makes MusixMatch refresh its token and retry the query. That retry used
 * to recurse with no cap, so an endpoint (or token) the API keeps rejecting left
 * the provider fetching forever.
 */
const info = {
  videoId: 'mxm-retry',
  title: 'Song',
  artist: 'Artist',
  songDuration: 200,
} as SearchSongInfo;

/** `netFetch` is a shared module binding; put back whatever was there. */
const originalNetFetch = netFetch;

test.beforeAll(() => {
  installDom();
});

test.afterAll(() => {
  setNetFetch(originalNetFetch);
  uninstallDom();
});

test('a token the API keeps rejecting fails after one refresh', async () => {
  let fetches = 0;
  setNetFetch((url) => {
    fetches += 1;
    if (url.includes('token.get')) {
      return Promise.resolve([
        200,
        JSON.stringify({ message: { body: { user_token: 'token' } } }),
        {},
      ]);
    }
    return Promise.resolve([
      200,
      JSON.stringify({ message: { header: { status_code: 401 } } }),
      {},
    ]);
  });

  const provider = new MusixMatch();

  await expect(provider.search(info)).rejects.toThrow(
    /rejected the refreshed token/,
  );

  // token, query, token, query — one reinit, never an unbounded loop.
  expect(fetches).toBe(4);
});
