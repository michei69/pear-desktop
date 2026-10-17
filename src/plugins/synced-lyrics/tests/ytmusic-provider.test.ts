import { expect, test } from '@playwright/test';

import {
  installDom,
  setUpModuleStubs,
  song,
  startStubbing,
  stopStubbing,
} from './harness';

/**
 * The lyrics tab is whatever the browse response holds. YouTube answers a song
 * without lyrics with a localized message ("Lyrics not available at this time.",
 * "Không có lời bài hát", …) in `messageRenderer` or `musicMessageModel`; that is
 * not lyrics, and rendering it made the tab claim a hit (issue #53). Only timed
 * lyrics or a `musicDescriptionShelfRenderer` shelf may count.
 *
 * The provider's UI half cannot load outside the bundler, so `config` is stubbed
 * for the duration of the import. The module is imported through a query-suffixed
 * URL: a Playwright worker reuses its module registry across test files, so that
 * gives this file its own copy of the graph wired to these stubs. The shared
 * stubbing plumbing lives in `./harness`.
 */
const FRESH = '?ytmusic-provider';
const CONFIG_STUB =
  'data:text/javascript,export const config = () => ({ useYTMLyricsWithoutProxy: true });';

/** True only while the entry import below is resolving its graph. */
let importing = false;

setUpModuleStubs({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);

    if (
      (importing || context.parentURL?.includes(FRESH)) &&
      resolved.url.endsWith('/synced-lyrics/renderer/renderer.tsx')
    ) {
      return { url: CONFIG_STUB, shortCircuit: true };
    }

    if (
      importing &&
      resolved.url.endsWith('/synced-lyrics/providers/YTMusic.ts')
    ) {
      return { url: `${resolved.url}${FRESH}`, shortCircuit: true };
    }

    return resolved;
  },
  load(url, context, nextLoad) {
    if (url.includes(FRESH)) {
      return { ...nextLoad(url.split('?')[0], context), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

type YTMusicClass = typeof import('../providers/YTMusic').YTMusic;

let YTMusic: YTMusicClass;

test.beforeAll(async () => {
  installDom();
  startStubbing();
  importing = true;
  try {
    ({ YTMusic } = await import('../providers/YTMusic'));
  } finally {
    importing = false;
    stopStubbing();
  }
});

/** A watch-next page whose only lyrics tab points at `browseId`. */
const watchNext = (browseId: string) => ({
  contents: {
    singleColumnMusicWatchNextResultsRenderer: {
      tabbedRenderer: {
        watchNextTabbedResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                endpoint: {
                  browseEndpoint: {
                    browseId,
                    browseEndpointContextSupportedConfigs: {
                      browseEndpointContextMusicConfig: {
                        pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS',
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
});

/** Run `search` against an app whose `/browse` answers with `browse`. */
const searchWithBrowse = async (browse: unknown) => {
  const app = document.createElement('ytmusic-app');
  (app as unknown as { networkManager: unknown }).networkManager = {
    fetch: (path: string) =>
      Promise.resolve(
        path.startsWith('/next') ? watchNext('lyrics-tab') : browse,
      ),
  };
  document.body.append(app);

  try {
    return await new YTMusic().search(song('FCJ3m089p9Q'));
  } finally {
    app.remove();
  }
};

const timedLyrics = () => ({
  contents: {
    elementRenderer: {
      newElement: {
        type: {
          componentType: {
            model: {
              timedLyricsModel: {
                lyricsData: {
                  timedLyricsData: [
                    {
                      lyricLine: 'first line',
                      cueRange: {
                        startTimeMilliseconds: '100',
                        endTimeMilliseconds: '900',
                      },
                    },
                    {
                      lyricLine: 'second line',
                      cueRange: {
                        startTimeMilliseconds: '1000',
                        endTimeMilliseconds: '1900',
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
});

const plainLyrics = () => ({
  contents: {
    sectionListRenderer: {
      contents: [
        {
          musicDescriptionShelfRenderer: {
            description: {
              runs: [{ text: 'plain line one' }, { text: 'plain line two' }],
            },
          },
        },
      ],
    },
  },
});

test('a localized music message is not lyrics', async () => {
  const result = await searchWithBrowse({
    contents: {
      elementRenderer: {
        newElement: {
          type: {
            componentType: {
              model: {
                musicMessageModel: { text: 'Không có lời bài hát' },
              },
            },
          },
        },
      },
    },
  });

  expect(result).toBeNull();
});

test('a legacy message renderer is not lyrics (issue #53)', async () => {
  const result = await searchWithBrowse({
    contents: {
      messageRenderer: {
        text: {
          runs: [{ text: 'No lyrics provided.' }],
        },
      },
    },
  });

  expect(result).toBeNull();
});

test('timed lyrics become synced lines', async () => {
  const result = await searchWithBrowse(timedLyrics());

  expect(result?.lines?.map((line) => line.text)).toEqual([
    'first line',
    'second line',
  ]);
  expect(result?.lyrics).toBeUndefined();
});

test('a description shelf becomes plain lyrics', async () => {
  const result = await searchWithBrowse(plainLyrics());

  expect(result?.lyrics).toBe('plain line one\nplain line two');
  expect(result?.lines).toBeUndefined();
});
