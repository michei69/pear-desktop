import { expect, test } from '@playwright/test';

import {
  normalizeChannels,
  normalizeKeywords,
} from '../src/plugins/skip-ai-slop/config';

test('keywords accept both the current and the older plain-string form', () => {
  expect(normalizeKeywords(['ai cover', { text: 'slop', enabled: false }])).toEqual([
    { text: 'ai cover', enabled: true },
    { text: 'slop', enabled: false },
  ]);
  // `enabled` only reads as false when it is exactly false.
  expect(normalizeKeywords([{ text: 'x', enabled: 0 }])).toEqual([
    { text: 'x', enabled: true },
  ]);
});

test('keywords skip anything without usable text', () => {
  expect(normalizeKeywords(['   ', { text: '  ' }, {}, null, 5, []])).toEqual([]);
  expect(normalizeKeywords(undefined)).toEqual([]);
  expect(normalizeKeywords('not an array')).toEqual([]);
});

test('channels accept plain ids and { id, name } entries', () => {
  expect(normalizeChannels(['UC1', { id: 'UC2', name: 'Two' }])).toEqual([
    { id: 'UC1', name: 'UC1' },
    { id: 'UC2', name: 'Two' },
  ]);
  // A missing or empty name falls back to the id, so the settings row has one.
  expect(normalizeChannels([{ id: 'UC3', name: '' }, { id: 'UC4' }])).toEqual([
    { id: 'UC3', name: 'UC3' },
    { id: 'UC4', name: 'UC4' },
  ]);
});

test('channels drop entries with no usable id, and de-duplicate', () => {
  expect(normalizeChannels([{}, null, 7, [], 'UC1', 'UC1'])).toEqual([
    { id: 'UC1', name: 'UC1' },
  ]);
  expect(normalizeChannels(undefined)).toEqual([]);
});
