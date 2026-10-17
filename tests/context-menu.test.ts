import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import {
  hiddenEntryKeys,
  hideMenuEntries,
  MENU_ENTRIES,
  menuEntryKeyOf,
  type MenuItemData,
} from '../src/providers/context-menu';

/**
 * Payloads below are shaped after real browse responses; only the parts the
 * matcher reads are kept. Labels are deliberately not part of any assertion:
 * the plugin must not care what language YouTube renders them in.
 */
const keyOf = (item: MenuItemData) => menuEntryKeyOf(item);

const nav = (
  iconType: string,
  endpoint: Record<string, unknown>,
): MenuItemData => ({
  menuNavigationItemRenderer: {
    icon: { iconType },
    navigationEndpoint: endpoint,
  },
});

const serviceItem = (
  iconType: string,
  endpoint: Record<string, unknown>,
): MenuItemData => ({
  menuServiceItemRenderer: { icon: { iconType }, serviceEndpoint: endpoint },
});

test('recognises the observed entries by their renderer data', () => {
  expect(
    keyOf({
      menuServiceItemDownloadRenderer: {
        serviceEndpoint: { offlineVideoEndpoint: { videoId: 'x' } },
      },
    }),
  ).toBe('download');

  expect(
    keyOf({
      toggleMenuServiceItemRenderer: {
        defaultIcon: { iconType: 'FAVORITE' },
        toggledIcon: { iconType: 'UNFAVORITE' },
        defaultServiceEndpoint: { modalEndpoint: {} },
      },
    }),
  ).toBe('like');

  expect(
    keyOf({
      toggleMenuServiceItemRenderer: {
        defaultIcon: { iconType: 'BOOKMARK_BORDER' },
        defaultServiceEndpoint: { modalEndpoint: {} },
      },
    }),
  ).toBe('save-to-library');

  expect(
    keyOf(
      serviceItem('QUEUE_PLAY_NEXT', {
        queueAddEndpoint: { queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO' },
      }),
    ),
  ).toBe('play-next');
  expect(
    keyOf(
      serviceItem('ADD_TO_REMOTE_QUEUE', {
        queueAddEndpoint: { queueInsertPosition: 'INSERT_AT_END' },
      }),
    ),
  ).toBe('add-to-queue');
  expect(keyOf(serviceItem('REMOVE', { removeFromQueueEndpoint: {} }))).toBe(
    'remove-from-queue',
  );

  expect(
    keyOf(nav('MUSIC_SHUFFLE', { watchPlaylistEndpoint: { playlistId: 'x' } })),
  ).toBe('shuffle-play');
  expect(keyOf(nav('MIX', { watchEndpoint: { playlistId: 'x' } }))).toBe(
    'start-mix',
  );

  expect(
    keyOf(nav('ADD_TO_PLAYLIST', { addToPlaylistEndpoint: { videoId: 'x' } })),
  ).toBe('save-to-playlist');
  // Signed out, the same entry is a sign-in modal; the endpoint type is gone,
  // the icon still says which action it stands for.
  expect(keyOf(nav('ADD_TO_PLAYLIST', { modalEndpoint: {} }))).toBe(
    'save-to-playlist',
  );
});

const browsePage = (pageType: string) =>
  nav('ARROW_FORWARD', {
    browseEndpoint: {
      browseId: 'x',
      browseEndpointContextSupportedConfigs: {
        browseEndpointContextMusicConfig: { pageType },
      },
    },
  });

test('tells the go-to destinations apart by page type', () => {
  expect(keyOf(browsePage('MUSIC_PAGE_TYPE_ARTIST'))).toBe('go-to-artist');
  expect(keyOf(browsePage('MUSIC_PAGE_TYPE_ALBUM'))).toBe('go-to-album');
  expect(keyOf(browsePage('MUSIC_PAGE_TYPE_PLAYLIST'))).toBe('go-to-playlist');
  expect(keyOf(browsePage('MUSIC_PAGE_TYPE_TRACK_LYRICS'))).toBeNull();
});

test('recognises the reporting, sharing and stats entries', () => {
  expect(keyOf(nav('SHARE', { shareEntityEndpoint: { id: 'x' } }))).toBe(
    'share',
  );
  expect(keyOf(nav('SHARE', { shareEndpoint: { id: 'x' } }))).toBe('share');

  expect(keyOf(serviceItem('FLAG', { flagEndpoint: {} }))).toBe('report');
  expect(keyOf(serviceItem('FLAG', { modalEndpoint: {} }))).toBe('report');

  expect(
    keyOf(serviceItem('INSERT_CHART_OUTLINED', { nerdStatsEndpoint: {} })),
  ).toBe('stats-for-nerds');
  expect(
    keyOf(
      serviceItem('NOT_INTERESTED', {
        feedbackEndpoint: { feedbackToken: 'x' },
      }),
    ),
  ).toBe('not-interested');
});

test('recognises playlist-only entries', () => {
  expect(
    keyOf(
      serviceItem('DELETE', {
        playlistEditEndpoint: {
          actions: [{ action: 'ACTION_REMOVE_VIDEO' }],
        },
      }),
    ),
  ).toBe('remove-from-playlist');
  expect(keyOf(serviceItem('DELETE', { deletePlaylistEndpoint: {} }))).toBe(
    'delete-playlist',
  );
});

test('the rendered label does not affect the entry', () => {
  const share = {
    menuNavigationItemRenderer: {
      text: { runs: [{ text: 'Chia sẻ' }] },
      icon: { iconType: 'SHARE' },
      navigationEndpoint: { shareEntityEndpoint: { id: 'x' } },
    },
  } satisfies MenuItemData;

  expect(keyOf(share)).toBe('share');
});

test('an entry it does not know is left alone', () => {
  expect(
    keyOf(serviceItem('SOMETHING_NEW', { newEndpoint: { id: 'x' } })),
  ).toBeNull();
});

test('hideMenuEntries drops known hidden entries only', () => {
  const items: MenuItemData[] = [
    nav('SHARE', { shareEntityEndpoint: { id: 'x' } }),
    serviceItem('INSERT_CHART_OUTLINED', { nerdStatsEndpoint: {} }),
    serviceItem('SOMETHING_NEW', { newEndpoint: {} }),
    serviceItem('QUEUE_PLAY_NEXT', {
      queueAddEndpoint: { queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO' },
    }),
  ];

  expect(hideMenuEntries(items, ['share', 'stats-for-nerds'])).toEqual([
    items[2],
    items[3],
  ]);
  expect(hideMenuEntries(items, [])).toEqual(items);
  expect(items).toHaveLength(4);
});

test('only switched-on entries count as hidden', () => {
  expect(
    hiddenEntryKeys({ 'share': true, 'report': false, 'play-next': true }),
  ).toEqual(['share', 'play-next']);
  expect(hiddenEntryKeys({})).toEqual([]);
  expect(hiddenEntryKeys()).toEqual([]);
});

test('every declared entry has a label', () => {
  const english = JSON.parse(
    readFileSync(
      new URL('../src/i18n/resources/en.json', import.meta.url),
      'utf8',
    ),
  ) as {
    'settings-ui': {
      fields: Record<string, { entries?: Record<string, string> }>;
    };
  };

  const labels = english['settings-ui'].fields['context-menu']?.entries ?? {};

  expect(MENU_ENTRIES.length).toBeGreaterThan(0);
  for (const entry of MENU_ENTRIES) {
    expect(labels[entry.key], `missing label for ${entry.key}`).toBeTruthy();
  }
  expect(Object.keys(labels)).toHaveLength(MENU_ENTRIES.length);
});
