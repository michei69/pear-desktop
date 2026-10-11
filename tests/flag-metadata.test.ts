import { expect, test } from '@playwright/test';

import { sanitizeFlagMetadata } from '../src/types/flag-metadata';

test('keeps the fields the settings UI reads', () => {
  expect(
    sanitizeFlagMetadata({
      flag_a: {
        description: 'What it does',
        requires_restart: true,
        family: 'player/playback',
      },
      flag_b: { requires_restart: false, family: 'misc' },
    }),
  ).toEqual({
    flag_a: {
      description: 'What it does',
      requires_restart: true,
      family: 'player/playback',
    },
    flag_b: { description: undefined, requires_restart: false, family: 'misc' },
  });
});

test('drops entries that are not the published shape', () => {
  expect(
    sanitizeFlagMetadata({
      bad_number: 12,
      bad_null: null,
      bad_string: 'nope',
      good: { family: 'misc' },
    }),
  ).toEqual({
    good: { description: undefined, requires_restart: false, family: 'misc' },
  });
});

test('coerces a wrong-typed field instead of rendering it', () => {
  expect(
    sanitizeFlagMetadata({
      flag_a: { description: { nested: true }, family: ['a'] },
      flag_b: { requires_restart: 'yes' },
    }),
  ).toEqual({
    flag_a: { description: undefined, requires_restart: false, family: '' },
    flag_b: { description: undefined, requires_restart: false, family: '' },
  });
});

test('a payload that is not an object at all yields nothing', () => {
  expect(sanitizeFlagMetadata(null)).toEqual({});
  expect(sanitizeFlagMetadata([1, 2])).toEqual({});
  expect(sanitizeFlagMetadata('{}')).toEqual({});
});
