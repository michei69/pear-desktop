import { expect, test } from '@playwright/test';

import {
  lyricsTypes,
  type LyricsType,
  pickWithStar,
  type ProviderName,
  providerNames,
  resolvePriority,
  resolveTypePriority,
  type ProviderState,
} from '../src/plugins/synced-lyrics/providers';

import type {
  LineLyrics,
  LyricResult,
} from '../src/plugins/synced-lyrics/types';

const line = (text: string): LineLyrics => ({
  time: '0:00',
  timeInMs: 0,
  duration: 5000,
  status: 'current',
  text,
});

const result = (data: Partial<LyricResult>): LyricResult => ({
  title: 'Song',
  artists: ['Artist'],
  ...data,
});

/** Every provider, holding what `data` gives it (missing = nothing fetched). */
const states = (
  data: Partial<Record<ProviderName, LyricResult>>,
): Record<ProviderName, ProviderState> =>
  Object.fromEntries(
    providerNames.map((provider) => [
      provider,
      { state: 'done', data: data[provider] ?? null, error: null },
    ]),
  ) as Record<ProviderName, ProviderState>;

const pick = (options: {
  lyrics: Record<ProviderName, ProviderState>;
  priority?: readonly ProviderName[];
  typePriority?: readonly LyricsType[];
  starred?: ProviderName | null;
  usePriorityList?: boolean;
  wantsOfficialTranslation?: boolean;
}) =>
  pickWithStar({
    priority: options.priority ?? [...providerNames],
    lyrics: options.lyrics,
    typePriority: options.typePriority ?? resolveTypePriority(undefined),
    starred: options.starred ?? null,
    usePriorityList: options.usePriorityList ?? true,
    wantsOfficialTranslation: options.wantsOfficialTranslation ?? false,
  });

const plain = result({ lyrics: 'plain words' });
const synced = result({ lines: [line('synced line')] });
const word = result({
  lines: [
    {
      ...line('word by word'),
      words: [{ text: 'word ', timeInMs: 0, duration: 500 }],
    },
  ],
});

test('follows the declared order without a stored one', () => {
  expect(resolvePriority(undefined)).toEqual([...providerNames]);
});

test('names the stored providers first and appends the rest', () => {
  expect(resolvePriority(['NetEase', 'LRCLib'])).toEqual([
    'NetEase',
    'LRCLib',
    ...providerNames.filter(
      (provider) => provider !== 'NetEase' && provider !== 'LRCLib',
    ),
  ]);
});

test('drops unknown and duplicate entries instead of throwing', () => {
  const junk = ['Nope', 'NetEase', 'NetEase'] as unknown as ProviderName[];

  expect(resolvePriority(junk)[0]).toBe('NetEase');
  expect(resolvePriority(junk)).toHaveLength(providerNames.length);
  expect(resolvePriority('LRCLib' as unknown as ProviderName[])).toEqual([
    ...providerNames,
  ]);
});

test('prefers the declared type order, whatever the provider order says', () => {
  expect(resolveTypePriority(undefined)).toEqual([...lyricsTypes]);

  const lyrics = states({ LRCLib: plain, YTMusic: synced, NetEase: word });
  const priority = resolvePriority(['LRCLib', 'YTMusic']);

  // Word-by-word beats synced beats plain, even though NetEase is last.
  expect(pick({ lyrics, priority })).toBe('NetEase');
  expect(
    pick({ lyrics, priority, typePriority: ['synced', 'word', 'plain'] }),
  ).toBe('YTMusic');
  expect(
    pick({ lyrics, priority, typePriority: ['plain', 'synced', 'word'] }),
  ).toBe('LRCLib');
});

test('a custom type order is normalised like the provider one', () => {
  expect(resolveTypePriority(['synced'])).toEqual(['synced', 'word', 'plain']);
  expect(
    resolveTypePriority(['nope', 'plain', 'plain'] as unknown as LyricsType[]),
  ).toEqual(['plain', 'word', 'synced']);
});

test('within a type, the provider order decides', () => {
  const lyrics = states({ LRCLib: synced, YTMusic: synced });

  expect(pick({ lyrics, priority: resolvePriority(['LRCLib']) })).toBe(
    'LRCLib',
  );
  expect(pick({ lyrics, priority: resolvePriority(['YTMusic']) })).toBe(
    'YTMusic',
  );
});

test('plain is the fallback when nothing is timed, and the top provider when nothing is found', () => {
  expect(pick({ lyrics: states({ LRCLib: plain }) })).toBe('LRCLib');
  expect(
    pick({ lyrics: states({}), priority: resolvePriority(['NetEase']) }),
  ).toBe('NetEase');
});

test('a starred provider wins while it has lyrics, and falls back when it does not', () => {
  const lyrics = states({ LRCLib: plain, NetEase: synced });

  // The pin beats the type priority; without it the synced result wins.
  expect(pick({ lyrics, starred: 'LRCLib' })).toBe('LRCLib');
  expect(pick({ lyrics, starred: 'YTMusic' })).toBe('NetEase');
  expect(pick({ lyrics })).toBe('NetEase');
});

test('with the list off, the better result wins over the configured order', () => {
  const lyrics = states({ YTMusic: synced, NetEase: synced });
  const priority = resolvePriority(['NetEase']);

  expect(pick({ lyrics, priority })).toBe('NetEase');
  expect(pick({ lyrics, priority, usePriorityList: false })).toBe('YTMusic');
});

test('with the list off, a wanted official translation is ranked first', () => {
  const lyrics = states({
    LRCLib: synced,
    NetEase: {
      ...synced,
      translation: { lines: [line('translated line')] },
    },
  });
  const priority = resolvePriority(['LRCLib']);

  const off = { lyrics, priority, usePriorityList: false } as const;

  expect(pick(off)).toBe('LRCLib');
  expect(pick({ ...off, wantsOfficialTranslation: true })).toBe('NetEase');
});
