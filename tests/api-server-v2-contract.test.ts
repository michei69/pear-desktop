import { registerHooks } from 'node:module';

import { expect, test } from '@playwright/test';

import {
  ApiActions,
  apiRequest,
  commandActions,
  type ApiAction,
} from '../src/plugins/api-server/channels';
import { registerV2 } from '../src/plugins/api-server/renderer/v2';
import { providerNames } from '../src/plugins/synced-lyrics/providers';
import { PageType } from '../src/types/datahost-get-state';

/**
 * The seam between the API server's backend and its renderer half: the backend
 * sends an action plus arguments, the renderer's handler performs a player
 * action. Nothing type-checks the argument *shape* across that boundary, so
 * these tests execute the real handlers and assert what they actually do —
 * which is how the `addToQueue` double-wrap (`videoIds: [['v1']]`) was found.
 */

type Recorded = {
  fetch: { url: string; data: unknown }[];
  dispatches: unknown[];
  player: string[];
  replies: { channel: string; payload: unknown }[];
  invoke: { channel: string; payload: unknown }[];
};

/** One parsed `/video/search` result, as the renderer replies with it. */
type SearchResult = {
  title?: string;
  artist?: string;
  type?: string;
  thumbnail?: string;
  thumbnails?: Size[];
  videoId?: string;
  browseId?: string;
  url?: string;
};

type Size = { url: string; width?: number; height?: number };

/** One mapped queue entry, as the renderer replies with it. */
type QueueEntry = {
  videoId: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  duration?: string;
  thumbnails?: Size[];
  thumbnail?: string;
  url: string;
  selected: boolean;
  index: number;
  playlistSetVideoId?: string;
  canReorder: boolean;
  renderer?: unknown;
};

type QueueReply = {
  items?: QueueEntry[];
  autoplay?: boolean;
  isInfinite?: boolean;
  nextQueueItemId?: string;
  playbackContentMode?: string;
  repeatMode?: string;
  currentPlayingItemId?: number;
  shuffleEnabled?: boolean;
  continuation?: string;
};

const queueState = {
  autoplay: false,
  isInfinite: false,
  items: [] as unknown[],
  automixItems: [] as unknown[],
  nextQueueItemId: 'next',
  playbackContentMode: 'MODE',
  repeatMode: 'NONE',
  selectedItemIndex: 0,
  shuffleEnabled: false,
  queueContextParams: 'context-params',
};

const THUMBNAIL = 'https://lh3.example/thumb.jpg';
/** The single size a plain row or card offers. */
const THUMBNAILS: Size[] = [{ url: THUMBNAIL }];

/** A linked byline run, as YTM sends it: a browse endpoint and a page type. */
const linkedRun = (text: string, pageType: PageType) => ({
  text,
  navigationEndpoint: {
    browseEndpoint: {
      browseId: 'UCartist',
      browseEndpointContextSupportedConfigs: {
        browseEndpointContextMusicConfig: { pageType },
      },
    },
  },
});

/**
 * A byline run. A bare string is a linked artist credit; an object names its
 * link, so `pageType` covers the album link a filtered search adds.
 */
type BylineEntry =
  | string
  | { text: string; linked?: boolean; pageType?: PageType };

const bylineRun = (entry: BylineEntry) => {
  if (typeof entry === 'string') {
    return linkedRun(entry, PageType.MusicPageTypeArtist);
  }
  if (entry.pageType) return linkedRun(entry.text, entry.pageType);
  return entry.linked
    ? linkedRun(entry.text, PageType.MusicPageTypeArtist)
    : { text: entry.text };
};

type RowOptions = {
  title: string;
  /** Byline type label, then the credited entities after it. */
  byline: [string, ...BylineEntry[]];
  /**
   * A `params`-filtered row has no type label: its byline is the artist, then
   * the album, so the first run is a credit rather than a label.
   */
  unlabelled?: boolean;
  /** `playlistItemData.videoId`: what Song, Video and most Episode rows carry. */
  videoId?: string;
  /** Row-level `navigationEndpoint`: what browse rows and some shelf rows carry. */
  rowNav?: { videoId?: string; browseId?: string };
  /** `flexColumns[0].runs[0].navigationEndpoint`: songs and `MPED` episodes. */
  titleNav?: { videoId?: string; browseId?: string };
  /** Thumbnail sizes; omit for the usual single one, `false` for none at all. */
  sizes?: Size[] | false;
};

/** The byline runs of a row: an optional label, then the credited entities. */
const bylineRuns = (byline: RowOptions['byline'], unlabelled = false) => {
  const [first, ...rest] = byline;
  const entries: BylineEntry[] = unlabelled ? byline : rest;
  const separator = unlabelled ? ' • ' : ', ';
  return [
    ...(unlabelled ? [] : [{ text: first }, { text: ' • ' }]),
    ...entries.flatMap((entry, index) => [
      ...(index ? [{ text: separator }] : []),
      bylineRun(entry),
    ]),
  ];
};

/** A `musicResponsiveListItemRenderer`, trimmed to the fields that matter. */
const row = ({
  title,
  byline,
  unlabelled,
  videoId,
  rowNav,
  titleNav,
  sizes,
}: RowOptions) => ({
  musicResponsiveListItemRenderer: {
    ...(sizes !== false && {
      thumbnail: {
        musicThumbnailRenderer: {
          thumbnail: { thumbnails: sizes ?? THUMBNAILS },
        },
      },
    }),
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [
              {
                text: title,
                ...(titleNav && {
                  navigationEndpoint: {
                    ...(titleNav.videoId && {
                      watchEndpoint: { videoId: titleNav.videoId },
                    }),
                    ...(titleNav.browseId && {
                      browseEndpoint: { browseId: titleNav.browseId },
                    }),
                  },
                }),
              },
            ],
          },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: bylineRuns(byline, unlabelled) },
        },
      },
    ],
    ...(videoId && { playlistItemData: { videoId } }),
    ...(rowNav && {
      navigationEndpoint: {
        ...(rowNav.videoId && { watchEndpoint: { videoId: rowNav.videoId } }),
        ...(rowNav.browseId && {
          browseEndpoint: { browseId: rowNav.browseId },
        }),
      },
    }),
  },
});

const itemSection = (...contents: unknown[]) => ({
  itemSectionRenderer: { contents },
});
const shelfSection = (...contents: unknown[]) => ({
  musicShelfRenderer: { contents },
});
/** A card section; `contents` is optional in live responses. */
const cardSection = (card: unknown, contents: unknown[] = []) => ({
  musicCardShelfRenderer: { ...(card as object), contents },
});
/** A filter-chip section: no rows, and never a result. */
const chipSection = () => ({ chipCloudRenderer: { chips: [] } });
const messageSection = () =>
  itemSection({
    messageRenderer: { text: { runs: [{ text: 'About these' }] } },
  });

/** The top-result card: id on `onTap`, which is a watch *or* a browse. */
const card = ({
  title,
  subtitle,
  videoId,
  browseId,
  sizes,
}: {
  title: string;
  /** Only the credited run links, exactly as in live card subtitles. */
  subtitle: BylineEntry[];
  videoId?: string;
  browseId?: string;
  sizes?: Size[] | false;
}) => ({
  title: { runs: [{ text: title }] },
  subtitle: { runs: subtitle.map(bylineRun) },
  ...(sizes !== false && {
    thumbnail: {
      musicThumbnailRenderer: {
        thumbnail: { thumbnails: sizes ?? THUMBNAILS },
      },
    },
  }),
  onTap: {
    ...(videoId && { watchEndpoint: { videoId } }),
    ...(browseId && { browseEndpoint: { browseId } }),
  },
});

/** A `/search` response with one catalog tab holding `sections`. */
const searchResponse = (...sections: unknown[]) => ({
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            tabIdentifier: 'music_search_catalog',
            content: { sectionListRenderer: { contents: sections } },
          },
        },
      ],
    },
  },
});

/**
 * Registers v2 against a fake player and returns the recording helpers. The
 * redux store really is nested twice — `ytmusicReduxBehavior.store.store` — as
 * `src/plugins/music-together/queue/queue.ts` also reads it.
 */
const setup = (
  search: unknown = { queueDatas: [] },
  items: unknown[] = [],
  extra: { automixItems?: unknown[]; browse?: unknown; next?: unknown } = {},
) => {
  const recorded: Recorded = {
    fetch: [],
    dispatches: [],
    player: [],
    replies: [],
    invoke: [],
  };

  const app = {
    queue: {
      shuffle: async () => recorded.player.push('queue.shuffle'),
      continuation: 'continuation',
    },
    dispatch: (action: unknown) => recorded.dispatches.push(action),
    networkManager: {
      fetch: async (url: string, data: unknown) => {
        recorded.fetch.push({ url, data });
        if (url === '/search') return search;
        if (url.startsWith('/browse')) return extra.browse ?? {};
        if (url.startsWith('/next')) return extra.next ?? {};
        return { queueDatas: [] };
      },
    },
    ytmusicReduxBehavior: {
      store: {
        store: {
          getState: () => ({
            queue: {
              ...queueState,
              items,
              automixItems: extra.automixItems ?? [],
            },
          }),
        },
      },
    },
  };

  const likeButton = {
    likeStatus: 'LIKE',
    updateLikeStatus: (status: string) =>
      recorded.player.push(`like:${status}`),
  };

  (globalThis as unknown as { document: unknown }).document = {
    querySelector: (selector: string) => {
      if (selector === 'ytmusic-app') return app;
      if (selector === 'ytmusic-search-box') {
        return { getSearchboxStats: () => ({ stats: true }) };
      }
      if (selector === '#like-button-renderer') return likeButton;
      return null;
    },
  };

  const api = {
    getPlayerResponse: () => ({ videoDetails: { title: 'T' } }),
    nextVideo: () => recorded.player.push('nextVideo'),
    previousVideo: () => recorded.player.push('previousVideo'),
    playVideo: () => recorded.player.push('playVideo'),
    pauseVideo: () => recorded.player.push('pauseVideo'),
    getPlayerState: () => 2,
    getPlaybackRate: () => 1.25,
    setPlaybackRate: (rate: number) =>
      recorded.player.push(`setPlaybackRate:${rate}`),
    getProgressState: () => ({ current: 5, duration: 10 }),
    seekTo: (seconds: number) => recorded.player.push(`seekTo:${seconds}`),
    seekBy: (seconds: number) => recorded.player.push(`seekBy:${seconds}`),
    getVolume: () => 50,
    setVolume: (volume: number) => recorded.player.push(`setVolume:${volume}`),
    isMuted: () => false,
    mute: () => recorded.player.push('mute'),
    unMute: () => recorded.player.push('unMute'),
  };

  const listeners = new Map<string, (...args: unknown[]) => void>();
  const context = {
    ipc: {
      on: (channel: string, listener: (...args: unknown[]) => void) =>
        listeners.set(channel, listener),
      off: (channel: string) => listeners.delete(channel),
      send: (channel: string, payload: unknown) =>
        recorded.replies.push({ channel, payload }),
      invoke: (channel: string, ...args: unknown[]) => {
        recorded.invoke.push({ channel, payload: args[0] });
        return Promise.resolve(undefined);
      },
    },
  };

  const dispose = registerV2(api as never, context as never);

  /** Fires an action the way the backend does, then lets async work settle. */
  const fire = async (action: ApiAction, ...args: unknown[]) => {
    const handler = listeners.get(apiRequest(action));
    expect(handler, `no listener registered for ${action}`).toBeTruthy();
    handler?.(...args);
    await new Promise((resolve) => setTimeout(resolve, 10));
  };

  return { recorded, listeners, dispose, fire };
};

test('registers exactly one listener per action and unregisters them all', () => {
  const { listeners, dispose } = setup();
  const actions = Object.values(ApiActions);

  expect(listeners.size).toBe(actions.length);
  for (const action of actions) {
    expect(listeners.has(apiRequest(action)), `${action} has no listener`).toBe(
      true,
    );
  }

  dispose();
  expect(listeners.size).toBe(0);
});

test('addToQueue forwards a flat videoIds array, not a nested one', async () => {
  const { recorded, fire } = setup();

  await fire(ApiActions.addToQueue, ['v1', 'v2'], 'INSERT_AT_END');

  expect(recorded.fetch).toHaveLength(1);
  expect(recorded.fetch[0].url).toBe('/music/get_queue');
  expect(recorded.fetch[0].data).toMatchObject({
    queueInsertPosition: 'INSERT_AT_END',
    videoIds: ['v1', 'v2'],
  });
});

test('addToQueue defaults to inserting after the current video', async () => {
  const { recorded, fire } = setup();

  await fire(ApiActions.addToQueue, ['only'], 'INSERT_AFTER_CURRENT_VIDEO');

  expect(recorded.fetch[0].data).toMatchObject({
    queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO',
    videoIds: ['only'],
  });
});

test('addToQueue forwards playlistIds, alone and alongside videoIds', async () => {
  const playlists = setup();
  await playlists.fire(ApiActions.addToQueue, [], 'INSERT_AT_END', [
    'PLone',
    'PLtwo',
  ]);

  expect(playlists.recorded.fetch[0].data).toMatchObject({
    queueInsertPosition: 'INSERT_AT_END',
    playlistIds: ['PLone', 'PLtwo'],
  });
  expect(playlists.recorded.fetch[0].data).not.toHaveProperty('videoIds');

  const both = setup();
  await both.fire(ApiActions.addToQueue, ['v1'], 'INSERT_AT_END', ['PLone']);

  expect(both.recorded.fetch[0].data).toMatchObject({
    videoIds: ['v1'],
    playlistIds: ['PLone'],
  });
});

test('addToQueue fetches nothing when it has no ids', async () => {
  const { recorded, fire } = setup();

  await fire(ApiActions.addToQueue, [], 'INSERT_AT_END', []);

  expect(recorded.fetch).toHaveLength(0);
});

test('addToQueue survives a malformed queue entry and still inserts after the current one', async () => {
  // The redux queue is runtime data: a slot can hold null, or a wrapper whose
  // primary renderer is missing. Reading through it used to throw inside the
  // fetch callback, which turned the whole command into an unhandled rejection.
  const { recorded, fire } = setup(undefined, [
    { playlistPanelVideoRenderer: { videoId: 'first' } },
    null,
    { playlistPanelVideoWrapperRenderer: { primaryRenderer: {} } },
    { playlistPanelVideoRenderer: { videoId: 'current', selected: true } },
  ]);

  await fire(ApiActions.addToQueue, ['new'], 'INSERT_AFTER_CURRENT_VIDEO');

  expect(recorded.dispatches).toContainEqual(
    expect.objectContaining({
      type: 'ADD_ITEMS',
      payload: expect.objectContaining({ index: 4 }),
    }),
  );
});

test('addToQueue falls back to the end when no entry is selected', async () => {
  const { recorded, fire } = setup(undefined, [
    null,
    { playlistPanelVideoRenderer: { videoId: 'first' } },
  ]);

  await fire(ApiActions.addToQueue, ['new'], 'INSERT_AFTER_CURRENT_VIDEO');

  expect(recorded.dispatches).toContainEqual(
    expect.objectContaining({
      type: 'ADD_ITEMS',
      payload: expect.objectContaining({ index: 2 }),
    }),
  );
});

test('commands never reply, so no route can wait on one', async () => {
  const args: Partial<Record<ApiAction, unknown[]>> = {
    [ApiActions.setPlaybackSpeed]: [1.5],
    [ApiActions.seekTo]: [12],
    [ApiActions.seekBy]: [-5],
    [ApiActions.setShuffle]: [true],
    [ApiActions.setRepeat]: ['ALL'],
    [ApiActions.setVolume]: [40],
    [ApiActions.setMute]: [true],
    [ApiActions.setLikeState]: ['LIKE'],
    [ApiActions.moveInQueue]: [0, 1],
    [ApiActions.removeFromQueue]: [0],
    [ApiActions.setQueueIndex]: [0],
    [ApiActions.downloadVideo]: ['a-video-id'],
  };

  for (const action of Object.values(commandActions)) {
    const { recorded, fire } = setup();
    await fire(action, ...(args[action] ?? []));
    expect(recorded.replies, `${action} replied`).toHaveLength(0);
  }
});

test('getPlaybackPosition reports seconds, and a 0 fraction without a duration', async () => {
  const { recorded, fire } = setup();

  await fire(ApiActions.getPlaybackPosition, false);
  expect(recorded.replies.at(-1)?.payload).toBe(5);

  await fire(ApiActions.getPlaybackPosition, true);
  expect(recorded.replies.at(-1)?.payload).toBe(0.5);
});

test('setVolume clamps to 0-100 and syncs the UI', async () => {
  const { recorded, fire } = setup();

  await fire(ApiActions.setVolume, 150);

  expect(recorded.player).toContain('setVolume:100');
  expect(recorded.dispatches).toContainEqual({
    type: 'SET_VOLUME',
    payload: 100,
  });
});

/**
 * `apiSearch` parses YouTube Music's search response instead of forwarding it.
 * These cases mirror live shapes: rows carry the id in one of three places
 * (`playlistItemData`, a row-level endpoint, or an `MPED<videoId>` browse id),
 * sections come in four flavours, and the top-result card's `onTap` is either a
 * watch or a browse endpoint.
 */
const search = async (...sections: unknown[]) => {
  const { recorded, fire } = setup(searchResponse(...sections));
  await fire(ApiActions.search, 'taylor swift');

  const payload = recorded.replies.at(-1)?.payload as
    | { query: string; results: SearchResult[] }
    | undefined;
  expect(payload, 'the handler replied').toBeTruthy();
  return payload as { query: string; results: SearchResult[] };
};

test('search returns an id, a type, an artist and a url for every row kind', async () => {
  const { query, results } = await search(
    itemSection(
      row({
        title: 'Anti-Hero',
        byline: ['Song', 'Taylor Swift'],
        videoId: 'b1kbLwvqugk',
        titleNav: { videoId: 'b1kbLwvqugk' },
      }),
      row({
        title: 'Anti-Hero (Official Music Video)',
        byline: ['Video', 'Taylor Swift'],
        videoId: '2Jg7WZ6mN3Q',
      }),
      row({
        title: 'Sleep and Anxiety',
        byline: ['Episode', 'Huberman Lab'],
        rowNav: { browseId: 'MPEDgBHLMkBnWB8' },
      }),
      row({
        title: 'Taylor Swift Essentials',
        byline: ['Playlist', 'YouTube Music'],
        rowNav: { browseId: 'VLPL147KeAbZcBNVt1EPjwjVEdivocWEox' },
      }),
      row({
        title: 'Midnights',
        byline: ['Album', 'Taylor Swift'],
        rowNav: { browseId: 'MPREb_2E43T4ixGB4' },
      }),
      row({
        title: 'Taylor Swift',
        byline: ['Artist'],
        rowNav: { browseId: 'UCPC0L1d253x-KuMNwa05TpA' },
      }),
      row({
        title: 'The Daily',
        byline: ['Podcast', 'The New York Times'],
        rowNav: { browseId: 'MPSPPLPNW_gerXa4Pc8S2qoUQc5e8Ir97RLuVW' },
      }),
    ),
  );

  expect(query).toBe('taylor swift');
  expect(results).toEqual([
    {
      title: 'Anti-Hero',
      type: 'Song',
      artist: 'Taylor Swift',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      videoId: 'b1kbLwvqugk',
      url: 'https://music.youtube.com/watch?v=b1kbLwvqugk',
    },
    {
      title: 'Anti-Hero (Official Music Video)',
      type: 'Video',
      artist: 'Taylor Swift',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      videoId: '2Jg7WZ6mN3Q',
      url: 'https://music.youtube.com/watch?v=2Jg7WZ6mN3Q',
    },
    {
      // An `MPED` browse id is the episode's video id, so it plays, not browses.
      title: 'Sleep and Anxiety',
      type: 'Episode',
      artist: 'Huberman Lab',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      videoId: 'gBHLMkBnWB8',
      url: 'https://music.youtube.com/watch?v=gBHLMkBnWB8',
    },
    {
      title: 'Taylor Swift Essentials',
      type: 'Playlist',
      artist: 'YouTube Music',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      browseId: 'VLPL147KeAbZcBNVt1EPjwjVEdivocWEox',
      url: 'https://music.youtube.com/playlist?list=PL147KeAbZcBNVt1EPjwjVEdivocWEox',
    },
    {
      title: 'Midnights',
      type: 'Album',
      artist: 'Taylor Swift',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      browseId: 'MPREb_2E43T4ixGB4',
      url: 'https://music.youtube.com/browse/MPREb_2E43T4ixGB4',
    },
    {
      title: 'Taylor Swift',
      type: 'Artist',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      browseId: 'UCPC0L1d253x-KuMNwa05TpA',
      url: 'https://music.youtube.com/browse/UCPC0L1d253x-KuMNwa05TpA',
    },
    {
      title: 'The Daily',
      type: 'Podcast',
      artist: 'The New York Times',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      browseId: 'MPSPPLPNW_gerXa4Pc8S2qoUQc5e8Ir97RLuVW',
      url: 'https://music.youtube.com/browse/MPSPPLPNW_gerXa4Pc8S2qoUQc5e8Ir97RLuVW',
    },
  ]);
});

test('search reads a shelf section, and never a message or chip section', async () => {
  const { results } = await search(
    messageSection(),
    chipSection(),
    shelfSection(
      row({
        title: 'Sleep: Ambient Music Therapy',
        byline: ['Song', 'Ambient Therapy'],
        rowNav: { videoId: 'zlGL5b0fk-g' },
      }),
    ),
    messageSection(),
  );

  expect(results).toEqual([
    {
      title: 'Sleep: Ambient Music Therapy',
      type: 'Song',
      artist: 'Ambient Therapy',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      videoId: 'zlGL5b0fk-g',
      url: 'https://music.youtube.com/watch?v=zlGL5b0fk-g',
    },
  ]);
});

test('search parses a top-result card whose onTap only browses', async () => {
  const { results } = await search(
    cardSection(
      card({
        title: 'Abbey Road (Super Deluxe Edition)',
        subtitle: [
          { text: 'Album' },
          { text: 'The Beatles', linked: true },
          { text: '1969' },
        ],
        browseId: 'MPREb_tQfaWH32ovE',
      }),
      [
        {
          messageRenderer: { text: { runs: [{ text: 'More from YouTube' }] } },
        },
        row({
          title: 'A Day In The Life (2017 Mix)',
          byline: ['Song', 'The Beatles'],
          videoId: 'wPsiNGQHjaI',
        }),
      ],
    ),
  );

  expect(results).toEqual([
    {
      title: 'Abbey Road (Super Deluxe Edition)',
      type: 'Album',
      artist: 'The Beatles',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      browseId: 'MPREb_tQfaWH32ovE',
      url: 'https://music.youtube.com/browse/MPREb_tQfaWH32ovE',
    },
    {
      title: 'A Day In The Life (2017 Mix)',
      type: 'Song',
      artist: 'The Beatles',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      videoId: 'wPsiNGQHjaI',
      url: 'https://music.youtube.com/watch?v=wPsiNGQHjaI',
    },
  ]);
});

test('search parses a playable top-result card and a card without contents', async () => {
  const { results } = await search(
    cardSection(
      card({
        title: 'Never Gonna Give You Up',
        subtitle: [
          { text: 'Song' },
          { text: 'Rick Astley', linked: true },
          { text: '3:34' },
        ],
        videoId: 'Ln6UjrS1AZ4',
      }),
    ),
  );

  expect(results).toEqual([
    {
      title: 'Never Gonna Give You Up',
      type: 'Song',
      artist: 'Rick Astley',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      videoId: 'Ln6UjrS1AZ4',
      url: 'https://music.youtube.com/watch?v=Ln6UjrS1AZ4',
    },
  ]);
});

test('search keeps an unlinked artist, drops metadata, and joins several artists', async () => {
  const { results } = await search(
    itemSection(
      // 24 live rows credit an artist with no endpoint at all.
      row({
        title: 'The Daily Struggle',
        byline: ['Song', { text: 'Urban Barbarian', linked: false }],
        videoId: 'ARWYel1rfso',
      }),
      // An artist row has no credited entity, only its audience size.
      row({
        title: 'Ed Sheeran',
        byline: ['Artist', { text: '209M monthly audience', linked: false }],
        rowNav: { browseId: 'UClmXPfaYhXOYsNn_QUyheWQ' },
      }),
      // A real channel name that reads like metadata.
      row({
        title: 'In Da Club',
        byline: ['Song', '50 Cent'],
        videoId: '5qm8PH4xAss',
      }),
      row({
        title: 'HipHop Livestream',
        byline: [
          'Album',
          { text: 'HipHop Livestream', linked: false },
          { text: 'HipHop Playlist', linked: false },
          { text: '2022', linked: false },
        ],
        rowNav: { browseId: 'MPREb_yXhSI4FCUo6' },
      }),
    ),
  );

  expect(results.map((result) => result.artist)).toEqual([
    'Urban Barbarian',
    undefined,
    '50 Cent',
    'HipHop Livestream, HipHop Playlist',
  ]);
});

test('search replies with the raw response when asked', async () => {
  const rawResponse = searchResponse(
    itemSection(
      row({
        title: 'Anti-Hero',
        byline: ['Song', 'Taylor Swift'],
        videoId: 'b1kbLwvqugk',
      }),
    ),
  );
  const { recorded, fire } = setup(rawResponse);

  await fire(ApiActions.search, 'taylor swift', undefined, undefined, true);

  expect(recorded.replies.at(-1)?.payload).toEqual(rawResponse);
});

/** A browse page: a header, one track shelf and its continuation. */
const browsePage = () => ({
  header: {
    musicResponsiveHeaderRenderer: {
      title: { runs: [{ text: 'Abbey Road' }] },
      subtitle: { runs: [{ text: 'The Beatles' }] },
      description: { runs: [{ text: 'Remastered' }] },
      thumbnail: {
        musicThumbnailRenderer: { thumbnail: { thumbnails: SIZES } },
      },
    },
  },
  contents: {
    singleColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  itemSection(
                    row({
                      title: 'Come Together',
                      byline: ['Song', 'The Beatles'],
                      videoId: 'come-together',
                    }),
                  ),
                ],
                continuations: [
                  { nextContinuationData: { continuation: 'browse-next' } },
                ],
              },
            },
          },
        },
      ],
    },
  },
});

test('browse parses the page header, items and continuation', async () => {
  const { recorded, fire } = setup(undefined, [], { browse: browsePage() });

  await fire(ApiActions.browse, 'MPREb_x');

  expect(recorded.fetch[0]).toMatchObject({
    url: '/browse?prettyPrint=false',
    data: { browseId: 'MPREb_x' },
  });

  const payload = recorded.replies.at(-1)?.payload as
    | {
        browseId: string | null;
        title?: string;
        subtitle?: string;
        description?: string;
        thumbnail?: string;
        results: SearchResult[];
        continuation?: string;
      }
    | undefined;
  expect(payload).toMatchObject({
    browseId: 'MPREb_x',
    title: 'Abbey Road',
    subtitle: 'The Beatles',
    description: 'Remastered',
    thumbnail: 'https://lh3.example/w544.jpg',
    continuation: 'browse-next',
  });
  expect(payload?.results).toEqual([
    {
      title: 'Come Together',
      type: 'Song',
      artist: 'The Beatles',
      thumbnail: THUMBNAIL,
      thumbnails: THUMBNAILS,
      videoId: 'come-together',
      url: 'https://music.youtube.com/watch?v=come-together',
    },
  ]);
});

test('browse asks for the continuation page when given a token', async () => {
  const { recorded, fire } = setup(undefined, [], { browse: browsePage() });

  await fire(ApiActions.browse, undefined, 'next-token');

  expect(recorded.fetch[0]).toMatchObject({
    url: '/browse?prettyPrint=false',
    data: { continuation: 'next-token' },
  });
});

test('browse returns the raw response when asked', async () => {
  const page = browsePage();
  const { recorded, fire } = setup(undefined, [], { browse: page });

  await fire(ApiActions.browse, 'MPREb_x', undefined, true);

  expect(recorded.replies.at(-1)?.payload).toEqual(page);
});

test('search echoes the query, and replies empty rather than throwing', async () => {
  const { recorded, fire } = setup({
    contents: { tabbedSearchResultsRenderer: { tabs: [] } },
  });
  await fire(ApiActions.search, 'taylor swift');

  expect(recorded.replies.at(-1)?.payload).toEqual({
    query: 'taylor swift',
    results: [],
  });
});

test('search still replies when the response is truncated at any level', async () => {
  const catalogTab = (tabRenderer: unknown) => ({
    contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer }] } },
  });
  const truncated = [
    null,
    {},
    { contents: null },
    { contents: { tabbedSearchResultsRenderer: { tabs: null } } },
    // The catalog tab with no content: the whole section lookup is optional.
    catalogTab({ tabIdentifier: 'music_search_catalog' }),
    catalogTab({
      tabIdentifier: 'music_search_catalog',
      content: { sectionListRenderer: {} },
    }),
    // A card whose every field is missing, and a row with no flex columns.
    searchResponse({ musicCardShelfRenderer: {} }),
    searchResponse(itemSection({ musicResponsiveListItemRenderer: {} })),
    searchResponse(itemSection({ messageRenderer: { button: {} } })),
  ];

  for (const payload of truncated) {
    const { recorded, fire } = setup(payload);
    await fire(ApiActions.search, 'taylor swift');

    const reply = recorded.replies.at(-1)?.payload as
      | { query: string; results: unknown[] }
      | undefined;
    expect(reply, `${JSON.stringify(payload)} produced no reply`).toBeTruthy();
    expect(reply?.query).toBe('taylor swift');
    expect(Array.isArray(reply?.results)).toBe(true);
  }
});

test('search keeps the artist of a filtered row but not its album', async () => {
  const { results } = await search(
    itemSection(
      // A `params`-filtered search drops the type label and links the album:
      // "Artist • Album • 3:34". Only the artist is a credit.
      row({
        title: 'Never Gonna Give You Up',
        unlabelled: true,
        byline: [
          'Rick Astley',
          {
            text: 'Whenever You Need Somebody',
            pageType: PageType.MusicPageTypeAlbum,
          },
        ],
        videoId: 'lYBUbBu4W08',
      }),
      row({
        title: 'Creep',
        unlabelled: true,
        byline: [
          'Radiohead',
          { text: 'Creep', pageType: PageType.MusicPageTypeAlbum },
        ],
        videoId: 'XFkzRNyygfk',
      }),
    ),
  );

  expect(results.map((result) => result.artist)).toEqual([
    'Rick Astley',
    'Radiohead',
  ]);
  expect(results.map((result) => result.type)).toEqual([undefined, undefined]);
});

test('search drops a relative timestamp instead of crediting it', async () => {
  const { results } = await search(
    itemSection(
      row({
        title: 'The Daily Beast Podcast',
        byline: [
          'Episode',
          { text: '4d ago', linked: false },
          'The Daily Beast',
        ],
        rowNav: { browseId: 'MPEDgBHLMkBnWB8' },
      }),
    ),
  );

  expect(results[0]?.artist).toBe('The Daily Beast');
});

test('search drops a bare byline date instead of crediting it', async () => {
  const { results } = await search(
    itemSection(
      row({
        title: 'Jerome87 on Radiohead',
        // Episode bylines date themselves without a year: "Episode • Sep 25 • Show".
        byline: [
          'Episode',
          { text: 'Sep 25', linked: false },
          'Podcast Playlist',
        ],
        rowNav: { browseId: 'MPEDgBHLMkBnWB8' },
      }),
      // Nothing but a date is left, so there is no credited entity at all.
      row({
        title: 'A dated episode',
        byline: ['Episode', { text: 'Jul 28', linked: false }],
        rowNav: { browseId: 'MPEDgBHLMkBnWB9' },
      }),
    ),
  );

  expect(results.map((result) => result.artist)).toEqual([
    'Podcast Playlist',
    undefined,
  ]);
});

test('search gives every result exactly one id and a url', async () => {
  const { results } = await search(
    itemSection(
      row({
        title: 'Anti-Hero',
        byline: ['Song', 'Taylor Swift'],
        videoId: 'b1kbLwvqugk',
      }),
    ),
    cardSection(
      card({
        title: 'Midnights',
        subtitle: [{ text: 'Album' }, { text: 'Taylor Swift', linked: true }],
        browseId: 'MPREb_2E43T4ixGB4',
      }),
    ),
  );

  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(Boolean(result.videoId) !== Boolean(result.browseId)).toBe(true);
    expect(result.url).toBeTruthy();
    expect(result.title).toBeTruthy();
  }
});

/** Three sizes, as a live row and a live queue item both offer them. */
const SIZES: Size[] = [
  { url: 'https://lh3.example/w60.jpg', width: 60, height: 60 },
  { url: 'https://lh3.example/w226.jpg', width: 226, height: 226 },
  { url: 'https://lh3.example/w544.jpg', width: 544, height: 544 },
];

test('search returns every thumbnail size, with the largest kept as thumbnail', async () => {
  const { results } = await search(
    itemSection(
      row({
        title: 'Anti-Hero',
        byline: ['Song', 'Taylor Swift'],
        videoId: 'b1kbLwvqugk',
        sizes: SIZES,
      }),
    ),
    cardSection(
      card({
        title: 'Midnights',
        subtitle: [{ text: 'Album' }, { text: 'Taylor Swift', linked: true }],
        browseId: 'MPREb_2E43T4ixGB4',
        sizes: SIZES,
      }),
    ),
  );

  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(result.thumbnails).toEqual(SIZES);
    expect(result.thumbnail).toBe('https://lh3.example/w544.jpg');
  }
});

test('search omits thumbnails when the renderer carries none', async () => {
  const { results } = await search(
    itemSection(
      // An empty size list, and a renderer with no thumbnail at all.
      row({
        title: 'Anti-Hero',
        byline: ['Song', 'Taylor Swift'],
        videoId: 'b1kbLwvqugk',
        sizes: [],
      }),
      row({
        title: 'Creep',
        byline: ['Song', 'Radiohead'],
        videoId: 'XFkzRNyygfk',
        sizes: false,
      }),
    ),
    cardSection(
      card({
        title: 'Midnights',
        subtitle: [{ text: 'Album' }, { text: 'Taylor Swift', linked: true }],
        browseId: 'MPREb_2E43T4ixGB4',
        sizes: false,
      }),
    ),
  );

  expect(results).toHaveLength(3);
  for (const result of results) {
    expect('thumbnails' in result).toBe(false);
    expect(result.thumbnail).toBeUndefined();
  }
});

/** The queue item the user pasted, trimmed to the fields the mapping reads. */
const rawQueueItem = (overrides: Record<string, unknown> = {}) => ({
  title: { runs: [{ text: 'Born This Way' }] },
  longBylineText: {
    runs: [
      { text: 'Lady Gaga' },
      { text: ' • ' },
      { text: 'Born This Way (International Special Edition Version)' },
      { text: ' • ' },
      { text: '2011' },
    ],
  },
  thumbnail: { thumbnails: SIZES },
  lengthText: { runs: [{ text: '4:21' }] },
  selected: true,
  videoId: 'fn8JP4rUP2I',
  canReorder: true,
  // The pasted item had none; its placeholder is kept as-is.
  playlistSetVideoId: 'PLACEHOLDER_SET_VIDEO_ID',
  ...overrides,
});

/** Fires `getQueue` against a fake queue holding `items`. */
const queue = async (items: unknown[], raw?: boolean) => {
  const { recorded, fire } = setup(undefined, items);
  await fire(ApiActions.getQueue, ...(raw === undefined ? [] : [raw]));

  const payload = recorded.replies.at(-1)?.payload as QueueReply | undefined;
  expect(payload, 'the handler replied').toBeTruthy();
  return payload as QueueReply;
};

test('queue maps a raw item into a human-readable entry', async () => {
  const reply = await queue([{ playlistPanelVideoRenderer: rawQueueItem() }]);

  expect(reply.items).toEqual([
    {
      videoId: 'fn8JP4rUP2I',
      title: 'Born This Way',
      artist: 'Lady Gaga',
      album: 'Born This Way (International Special Edition Version)',
      year: '2011',
      duration: '4:21',
      thumbnails: SIZES,
      thumbnail: 'https://lh3.example/w544.jpg',
      url: 'https://music.youtube.com/watch?v=fn8JP4rUP2I',
      selected: true,
      index: 0,
      playlistSetVideoId: 'PLACEHOLDER_SET_VIDEO_ID',
      canReorder: true,
    },
  ]);
});

test('queue counts a wrapped item once, at its own index', async () => {
  const reply = await queue([
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: { playlistPanelVideoRenderer: rawQueueItem() },
        // The counterpart is the same entry's other half, not a second entry.
        counterpart: [
          {
            counterpartRenderer: {
              playlistPanelVideoRenderer: { videoId: 'fn8JP4rUP2I' },
            },
          },
        ],
      },
    },
    {
      playlistPanelVideoRenderer: rawQueueItem({
        videoId: 'second',
        title: { runs: [{ text: 'Judas' }] },
      }),
    },
  ]);

  expect(
    reply.items?.map((item) => [item.index, item.videoId, item.title]),
  ).toEqual([
    [0, 'fn8JP4rUP2I', 'Born This Way'],
    [1, 'second', 'Judas'],
  ]);
});

test('queue skips an item with no videoId and keeps the raw index of the rest', async () => {
  const reply = await queue([
    { playlistPanelVideoRenderer: rawQueueItem({ videoId: undefined }) },
    { playlistPanelVideoRenderer: rawQueueItem() },
    // Not a playlist panel at all: nothing to map, and nothing to crash on.
    { someOtherRenderer: {} },
  ]);

  expect(reply.items).toHaveLength(1);
  expect(reply.items?.[0].videoId).toBe('fn8JP4rUP2I');
  // The index addresses the raw queue, which is what move/remove take.
  expect(reply.items?.[0].index).toBe(1);
});

test('queue drops a null entry instead of failing the whole reply', async () => {
  const reply = await queue([
    { playlistPanelVideoRenderer: rawQueueItem() },
    // The redux queue is runtime data: a slot can hold null even though the
    // type says QueueItem, and one such entry must not cost every other item.
    null,
    { playlistPanelVideoRenderer: rawQueueItem({ videoId: 'third' }) },
  ]);

  expect(reply.items?.map((item) => [item.index, item.videoId])).toEqual([
    [0, 'fn8JP4rUP2I'],
    // The gap is the null slot's, as it is for any skipped entry.
    [2, 'third'],
  ]);
});

test('queue replies with no items when every entry is null', async () => {
  const reply = await queue([null, undefined]);

  expect(reply.items).toEqual([]);
});

test('queue adds the raw renderer only with raw=true', async () => {
  const raw = rawQueueItem();
  const items = [{ playlistPanelVideoRenderer: raw }];

  const plain = await queue(items);
  expect(plain.items?.[0]).not.toHaveProperty('renderer');

  const withRaw = await queue(items, true);
  expect(withRaw.items?.[0].renderer).toEqual(raw);
});

test('queue leaves the other reply fields alone', async () => {
  const reply = await queue([{ playlistPanelVideoRenderer: rawQueueItem() }]);

  expect(reply).toMatchObject({
    autoplay: false,
    isInfinite: false,
    nextQueueItemId: 'next',
    playbackContentMode: 'MODE',
    repeatMode: 'NONE',
    currentPlayingItemId: 0,
    shuffleEnabled: false,
    continuation: 'continuation',
  });
});

test('autoplay maps the automix entries, which are not part of the queue', async () => {
  const { recorded, fire } = setup(
    undefined,
    [{ playlistPanelVideoRenderer: rawQueueItem() }],
    {
      automixItems: [
        {
          playlistPanelVideoRenderer: rawQueueItem({
            videoId: 'radio-1',
            title: { runs: [{ text: 'Radio Song' }] },
          }),
        },
        // A runtime slot can hold null; it must not take the page down.
        null,
      ],
    },
  );

  await fire(ApiActions.getAutoplay, false);

  expect(recorded.replies.at(-1)?.payload).toMatchObject({
    continuation: 'continuation',
  });
  const payload = recorded.replies.at(-1)?.payload as
    | { items?: QueueEntry[] }
    | undefined;
  expect(payload?.items?.map((item) => [item.videoId, item.title])).toEqual([
    ['radio-1', 'Radio Song'],
  ]);
});

test('autoplay continuation fetches the next page and returns its token', async () => {
  const { recorded, fire } = setup(undefined, [], {
    next: {
      continuationContents: {
        playlistPanelContinuation: {
          contents: [
            {
              playlistPanelVideoRenderer: rawQueueItem({
                videoId: 'radio-2',
                title: { runs: [{ text: 'Next Radio Song' }] },
              }),
            },
          ],
          continuations: [
            { nextRadioContinuationData: { continuation: 'radio-next' } },
          ],
        },
      },
    },
  });

  await fire(ApiActions.getAutoplay, false, 'radio-token');

  expect(recorded.fetch[0]).toMatchObject({
    url: '/next?prettyPrint=false',
    data: { continuation: 'radio-token' },
  });
  const payload = recorded.replies.at(-1)?.payload as
    | { items?: QueueEntry[]; continuation?: string }
    | undefined;
  expect(payload?.items?.map((item) => item.videoId)).toEqual(['radio-2']);
  expect(payload?.continuation).toBe('radio-next');
});

test('download hands the video URL to the downloader plugin', async () => {
  const { recorded, fire } = setup();

  await fire(ApiActions.downloadVideo, 'a-video-id');

  expect(recorded.invoke).toEqual([
    {
      channel: 'download-song',
      payload: 'https://music.youtube.com/watch?v=a-video-id',
    },
  ]);
  // The download itself belongs to the downloader plugin; the API never replies.
  expect(recorded.replies).toHaveLength(0);
});

test('queue reads a partial byline, and one that is not there at all', async () => {
  const reply = await queue([
    {
      playlistPanelVideoRenderer: rawQueueItem({
        videoId: 'only-artist',
        longBylineText: { runs: [{ text: 'Lady Gaga' }] },
      }),
    },
    {
      // A year with no album: the year is not an album title.
      playlistPanelVideoRenderer: rawQueueItem({
        videoId: 'year-only',
        longBylineText: {
          runs: [{ text: 'Lady Gaga' }, { text: ' • ' }, { text: '2011' }],
        },
      }),
    },
    {
      playlistPanelVideoRenderer: rawQueueItem({
        videoId: 'no-byline',
        longBylineText: undefined,
        title: undefined,
      }),
    },
  ]);

  const [onlyArtist, yearOnly, noByline] = reply.items ?? [];
  expect(onlyArtist.artist).toBe('Lady Gaga');
  expect(onlyArtist.album).toBeUndefined();
  expect(onlyArtist.year).toBeUndefined();

  expect(yearOnly.artist).toBe('Lady Gaga');
  expect(yearOnly.year).toBe('2011');
  expect(yearOnly.album).toBeUndefined();

  expect(noByline.videoId).toBe('no-byline');
  expect(noByline.title).toBeUndefined();
  expect(noByline.artist).toBeUndefined();
  expect(noByline.url).toBe('https://music.youtube.com/watch?v=no-byline');
});

test('queue keeps the year when a run follows it', async () => {
  const reply = await queue([
    {
      playlistPanelVideoRenderer: rawQueueItem({
        videoId: 'year-then-run',
        longBylineText: {
          runs: [
            { text: 'Lady Gaga' },
            { text: ' • ' },
            { text: 'Born This Way' },
            { text: ' • ' },
            { text: '2011' },
            { text: ' • ' },
            { text: 'Bonus Track' },
          ],
        },
      }),
    },
  ]);

  const [entry] = reply.items ?? [];
  expect(entry.artist).toBe('Lady Gaga');
  expect(entry.album).toBe('Born This Way');
  expect(entry.year).toBe('2011');
});

test('queue reads a four-digit album title as the year, not the album', async () => {
  const reply = await queue([
    {
      playlistPanelVideoRenderer: rawQueueItem({
        videoId: 'prince',
        longBylineText: {
          runs: [{ text: 'Prince' }, { text: ' • ' }, { text: '1999' }],
        },
      }),
    },
  ]);

  const [entry] = reply.items ?? [];
  expect(entry.artist).toBe('Prince');
  expect(entry.album).toBeUndefined();
  expect(entry.year).toBe('1999');
});

/**
 * `apiGetLyrics` imports the synced-lyrics store dynamically, because that module
 * has top-level Solid side effects and must not be evaluated while the plugin is
 * off. The store is not loadable outside the bundler (`virtual:` modules, DOM
 * deps), so the hook below serves it from a stub that reads its state off
 * `globalThis` — and records whether it was evaluated at all, which is the part
 * the disabled path must not do. The hook is armed only for the tests below.
 */
type LyricsStub = {
  enabled: boolean;
  /** Make the store module throw while it is evaluated. */
  broken: boolean;
  videoId: string | null;
  provider: string;
  states: Record<string, unknown>;
  loads: number;
};

/** The state behind the `translateForLanguage` stub. */
type TranslateStub = {
  /** Make the translation module throw while it is evaluated. */
  broken: boolean;
  /** What `translateForLanguage` resolves with. */
  result: {
    provider: string | null;
    language: string;
    lines: string[];
    fromCache?: boolean;
    error?: string;
    reason?: 'disabled' | 'no-lyrics' | 'same-language' | 'provider-error';
  };
  /** Every language the handler asked for. */
  calls: string[];
  loads: number;
};

const translateStubState = (): TranslateStub =>
  (globalThis as unknown as { lyricsTranslateStub: TranslateStub })
    .lyricsTranslateStub;

const STORE_SPECIFIER = '@/plugins/synced-lyrics/renderer/store';
const TRANSLATION_SPECIFIER =
  '@/plugins/synced-lyrics/renderer/translation-store';

let serveStoreStub = false;
/** Makes each import its own module, so every one of them is observable. */
let storeImport = 0;

const lyricsStubState = (): LyricsStub =>
  (globalThis as unknown as { lyricsStub: LyricsStub }).lyricsStub;

const storeStubSource = () =>
  lyricsStubState().broken
    ? 'throw new Error("store unavailable");'
    : `globalThis.lyricsStub.loads += 1;
export const lyricsStore = {
  get provider() {
    return globalThis.lyricsStub.provider;
  },
};
export const currentLyricsVideoId = () => globalThis.lyricsStub.videoId;
export const allProviderLyrics = () => Promise.resolve(globalThis.lyricsStub.states);
`;

/**
 * `apiTranslateLyrics` imports `translateForLanguage` the same way, and for the
 * same reason. The stub exposes that ONE export and nothing else: the handler
 * has no other handle on the plugin, so it structurally cannot touch the
 * translation the app is showing. That the real function leaves the store alone
 * is proven against the real module in the plugin's own suite.
 */
const translateStubSource = () =>
  translateStubState().broken
    ? 'throw new Error("translation store unavailable");'
    : `globalThis.lyricsTranslateStub.loads += 1;
export const translateForLanguage = (language) => {
  globalThis.lyricsTranslateStub.calls.push(language);
  return Promise.resolve(globalThis.lyricsTranslateStub.result);
};
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!serveStoreStub) return nextResolve(specifier, context);

    if (specifier === STORE_SPECIFIER) {
      const source = `${storeStubSource()}\n// import ${storeImport++}`;
      return {
        url: `data:text/javascript,${encodeURIComponent(source)}`,
        shortCircuit: true,
      };
    }

    if (specifier === TRANSLATION_SPECIFIER) {
      const source = `${translateStubSource()}\n// import ${storeImport++}`;
      return {
        url: `data:text/javascript,${encodeURIComponent(source)}`,
        shortCircuit: true,
      };
    }

    return nextResolve(specifier, context);
  },
});

test.afterAll(() => {
  serveStoreStub = false;
});

/** Fires `getLyrics` with the plugin in the state `overrides` describes. */
const lyrics = async (overrides: Partial<LyricsStub>) => {
  const state: LyricsStub = {
    enabled: true,
    broken: false,
    videoId: 'vid',
    provider: 'YTMusic',
    states: {},
    loads: 0,
    ...overrides,
  };
  (globalThis as unknown as { lyricsStub: LyricsStub }).lyricsStub = state;
  (globalThis as unknown as { window: unknown }).window = {
    mainConfig: {
      plugins: { isEnabled: () => Promise.resolve(state.enabled) },
    },
  };

  serveStoreStub = true;
  const { recorded, fire } = setup();
  await fire(ApiActions.getLyrics);

  return {
    payload: recorded.replies.at(-1)?.payload,
    replies: recorded.replies,
    state,
  };
};

const syncedLine = {
  time: '00:12:00',
  timeInMs: 12_000,
  duration: 5_200,
  status: 'current',
  text: 'Line 1 lyrics',
};

/**
 * The per-provider record `allProviderLyrics` returns: every provider in
 * `providerNames`, only the ones named in `results` holding a result.
 */
const lyricsStates = (
  results: Partial<
    Record<string, { state?: string; data?: unknown; error?: unknown }>
  > = {},
) =>
  Object.fromEntries(
    providerNames.map((provider) => {
      const result = results[provider];

      return [
        provider,
        {
          state: result?.state ?? 'done',
          data: result?.data ?? null,
          error: result?.error ?? null,
        },
      ];
    }),
  );

test('getLyrics replies null and never loads the store while the plugin is off', async () => {
  const { payload, replies, state } = await lyrics({ enabled: false });

  expect(payload).toBeNull();
  expect(replies).toHaveLength(1);
  // The dynamic import is what must not happen: the store has Solid side effects.
  expect(state.loads).toBe(0);
});

test('getLyrics replies null when the store cannot be loaded', async () => {
  const { payload, replies } = await lyrics({ broken: true });

  expect(payload).toBeNull();
  expect(replies).toHaveLength(1);
});

test('getLyrics reports every provider with lyrics, in provider order', async () => {
  const { payload, state } = await lyrics({
    videoId: 'vid-1',
    provider: 'NetEase',
    states: lyricsStates({
      LRCLib: {
        data: { title: 'Song', artists: ['Artist'], lyrics: 'plain words' },
      },
      MusixMatch: { state: 'error', error: new Error('down') },
      LyricsGenius: {
        data: { title: 'Song', artists: ['Artist'], lines: [syncedLine] },
      },
      NetEase: { state: 'fetching' },
    }),
  });

  expect(state.loads).toBe(1);
  expect(payload).toEqual({
    videoId: 'vid-1',
    activeProvider: 'NetEase',
    providers: [
      {
        provider: 'LRCLib',
        state: 'done',
        title: 'Song',
        artists: ['Artist'],
        lyrics: 'plain words',
      },
      {
        provider: 'LyricsGenius',
        state: 'done',
        title: 'Song',
        artists: ['Artist'],
        lines: [
          {
            time: '00:12:00',
            timeInMs: 12_000,
            duration: 5_200,
            text: 'Line 1 lyrics',
          },
        ],
      },
    ],
  });

  // The UI-only field is stripped, not carried along as undefined.
  const [line] = (payload as { providers: { lines: object[] }[] }).providers[1]
    .lines;
  expect('status' in line).toBe(false);
});

test('getLyrics strips the status of translation lines too', async () => {
  const { payload } = await lyrics({
    states: lyricsStates({
      YTMusic: {
        data: {
          title: 'Song',
          artists: ['Artist'],
          lines: [syncedLine],
          translation: {
            lines: [{ ...syncedLine, text: 'Translated' }],
            language: 'en',
            provider: 'official',
          },
        },
      },
    }),
  });

  expect(payload).toEqual({
    videoId: 'vid',
    activeProvider: 'YTMusic',
    providers: [
      {
        provider: 'YTMusic',
        state: 'done',
        title: 'Song',
        artists: ['Artist'],
        lines: [
          {
            time: '00:12:00',
            timeInMs: 12_000,
            duration: 5_200,
            text: 'Line 1 lyrics',
          },
        ],
        translation: {
          lines: [
            {
              time: '00:12:00',
              timeInMs: 12_000,
              duration: 5_200,
              text: 'Translated',
            },
          ],
          language: 'en',
          provider: 'official',
        },
      },
    ],
  });
});

test('getLyrics reports no song as a null videoId and no providers', async () => {
  const { payload } = await lyrics({
    videoId: null,
    states: lyricsStates({ YTMusic: { state: 'fetching' } }),
  });

  expect(payload).toEqual({
    videoId: null,
    activeProvider: null,
    providers: [],
  });
});

/** Fires `translateLyrics` with the plugin and translation in the given state. */
const translate = async (
  overrides: Partial<TranslateStub> = {},
  args: unknown[] = ['fr'],
) => {
  const state: TranslateStub = {
    broken: false,
    result: {
      provider: 'google-translate',
      language: 'fr',
      lines: ['un', 'deux'],
      fromCache: false,
    },
    calls: [],
    loads: 0,
    ...overrides,
  };
  (
    globalThis as unknown as { lyricsTranslateStub: TranslateStub }
  ).lyricsTranslateStub = state;
  (globalThis as unknown as { window: unknown }).window = {
    mainConfig: { plugins: { isEnabled: () => Promise.resolve(true) } },
  };

  serveStoreStub = true;
  const { recorded, fire } = setup();
  await fire(ApiActions.translateLyrics, ...args);

  return {
    payload: recorded.replies.at(-1)?.payload,
    replies: recorded.replies,
    state,
  };
};

test('translateLyrics replies with the translation and never touches the plugin UI', async () => {
  const { payload, replies, state } = await translate();

  expect(replies).toHaveLength(1);
  expect(state.calls).toEqual(['fr']);
  expect(payload).toEqual({
    provider: 'google-translate',
    language: 'fr',
    lines: ['un', 'deux'],
    fromCache: false,
  });
});

test('translateLyrics passes a refusal through as data, for every reason', async () => {
  const reasons = [
    'disabled',
    'no-lyrics',
    'same-language',
    'provider-error',
  ] as const;

  for (const reason of reasons) {
    const { payload, replies } = await translate({
      result: {
        provider: 'google-translate',
        language: 'fr',
        lines: [],
        error: `cannot translate: ${reason}`,
        reason,
      },
    });

    // The handler never throws: the reason is what the backend maps to a status.
    expect(replies).toHaveLength(1);
    expect(payload).toMatchObject({ lines: [], reason });
  }
});

test('translateLyrics replies null without loading the module when the plugin is off', async () => {
  const state: TranslateStub = {
    broken: false,
    result: { provider: null, language: 'fr', lines: [] },
    calls: [],
    loads: 0,
  };
  (
    globalThis as unknown as { lyricsTranslateStub: TranslateStub }
  ).lyricsTranslateStub = state;
  (globalThis as unknown as { window: unknown }).window = {
    mainConfig: { plugins: { isEnabled: () => Promise.resolve(false) } },
  };

  serveStoreStub = true;
  const { recorded, fire } = setup();
  await fire(ApiActions.translateLyrics, 'fr');

  expect(recorded.replies.at(-1)?.payload).toBeNull();
  // The dynamic import must not run: the store has Solid side effects.
  expect(state.loads).toBe(0);
});

test('translateLyrics replies null for a missing or blank language, without loading the module', async () => {
  for (const args of [[], [''], ['   ']]) {
    const { payload, state } = await translate({}, args);

    expect(payload).toBeNull();
    expect(state.calls).toEqual([]);
    expect(state.loads).toBe(0);
  }
});

test('translateLyrics replies null when the translation module throws', async () => {
  const { payload, replies } = await translate({ broken: true });

  expect(replies).toHaveLength(1);
  expect(payload).toBeNull();
});

/**
 * The queue actions take a video id as well as an index. The routes only ever
 * send an index (`z.number()`), but the IPC action itself accepts an id, and the
 * lookup that resolves it used to have two defects: `findIndex(...) || -1` read a
 * match at index 0 as "not found", and the entry was dereferenced unguarded, so
 * one null slot threw before the dispatch.
 */
const queueWith = (items: unknown[]) => setup(undefined, items);

const byId = (videoId: string) => ({ playlistPanelVideoRenderer: { videoId } });

test('a video id at index 0 resolves to 0, not "not found"', async () => {
  const { recorded, fire } = queueWith([byId('first'), byId('second')]);

  await fire(ApiActions.moveInQueue, 'first', 1);

  expect(recorded.dispatches).toContainEqual({
    type: 'MOVE_ITEM',
    payload: { fromIndex: 0, toIndex: 1 },
  });
});

test('moveInQueue resolves an id at index 0 for the destination too', async () => {
  const { recorded, fire } = queueWith([byId('first'), byId('second')]);

  await fire(ApiActions.moveInQueue, 1, 'first');

  expect(recorded.dispatches).toContainEqual({
    type: 'MOVE_ITEM',
    payload: { fromIndex: 1, toIndex: 0 },
  });
});

test('removeFromQueue and setQueueIndex resolve an id at index 0', async () => {
  const remove = queueWith([byId('first'), byId('second')]);
  await remove.fire(ApiActions.removeFromQueue, 'first');
  expect(remove.recorded.dispatches).toContainEqual({
    type: 'REMOVE_ITEM',
    payload: 0,
  });

  const setIndex = queueWith([byId('first'), byId('second')]);
  await setIndex.fire(ApiActions.setQueueIndex, 'first');
  expect(setIndex.recorded.dispatches).toContainEqual({
    type: 'SET_INDEX',
    payload: 0,
  });
});

test('the id lookup survives a null entry before the match', async () => {
  const { recorded, fire } = queueWith([
    null,
    { playlistPanelVideoWrapperRenderer: { primaryRenderer: {} } },
    byId('target'),
  ]);

  await fire(ApiActions.removeFromQueue, 'target');

  expect(recorded.dispatches).toContainEqual({
    type: 'REMOVE_ITEM',
    payload: 2,
  });
});

test('an id the queue does not hold dispatches nothing', async () => {
  const { recorded, fire } = queueWith([null, byId('other')]);

  await fire(ApiActions.removeFromQueue, 'missing');

  expect(recorded.dispatches).toHaveLength(0);
});

test('a wrapped entry is addressable by its video id', async () => {
  const { recorded, fire } = queueWith([
    byId('first'),
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: { playlistPanelVideoRenderer: { videoId: 'wrapped' } },
      },
    },
  ]);

  await fire(ApiActions.setQueueIndex, 'wrapped');

  expect(recorded.dispatches).toContainEqual({
    type: 'SET_INDEX',
    payload: 1,
  });
});

test('getLyrics omits a translation that carries nothing', async () => {
  const { payload } = await lyrics({
    states: lyricsStates({
      YTMusic: {
        data: {
          title: 'Song',
          artists: ['Artist'],
          lines: [syncedLine],
          // A provider that advertises a translation object but fills none of
          // it must not produce an empty `translation: {}` in the reply.
          translation: {},
        },
      },
    }),
  });

  const [provider] = (payload as { providers: object[] }).providers;
  expect('translation' in provider).toBe(false);
});

test('getLyrics keeps a translation that only has plain lyrics', async () => {
  const { payload } = await lyrics({
    states: lyricsStates({
      YTMusic: {
        data: {
          title: 'Song',
          artists: ['Artist'],
          lines: [syncedLine],
          translation: { lyrics: '[00:12.00]Translated' },
        },
      },
    }),
  });

  const [provider] = (payload as { providers: { translation?: unknown }[] })
    .providers;
  // Asserted over the wire form, which is what a client sees: an absent `lines`
  // key, not an `undefined` one (toEqual ignores undefined properties).
  expect(JSON.parse(JSON.stringify(provider.translation))).toEqual({
    lyrics: '[00:12.00]Translated',
  });
});
