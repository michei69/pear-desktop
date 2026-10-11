import { expect, test } from '@playwright/test';

import {
  allowedNames,
  compileKeywords,
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

test('a keyword matches a whole word, not a fragment of one', () => {
  const [ai] = compileKeywords(['ai']);

  expect(ai.test('AI Cover')).toBe(true);
  expect(ai.test('Mai Tai')).toBe(false);
  expect(ai.test('Tchaikovsky')).toBe(false);
});

test('a multi-word keyword matches across any whitespace', () => {
  const [cover] = compileKeywords(['ai cover']);

  expect(cover.test('AI Cover')).toBe(true);
  expect(cover.test('ai   cover')).toBe(true);
  expect(cover.test('AI Coverband')).toBe(false);
});

test('keyword text is matched literally, regex characters included', () => {
  const [cpp] = compileKeywords(['c++']);
  const [dotted] = compileKeywords(['lo.fi']);

  expect(cpp.test('C++ tutorial')).toBe(true);
  expect(cpp.test('CXX tutorial')).toBe(false);
  expect(dotted.test('lo.fi beats')).toBe(true);
  // The `.` is escaped, so it cannot stand in for any character.
  expect(dotted.test('loXfi beats')).toBe(false);
});

test('only enabled keywords are compiled', () => {
  expect(compileKeywords([{ text: 'slop', enabled: false }])).toEqual([]);
  expect(compileKeywords(['   '])).toEqual([]);
  expect(compileKeywords(undefined)).toEqual([]);
});

test('allowed channel names skip entries that are only an id', () => {
  const names = allowedNames(['UC1', { id: 'UC2', name: 'Real Name' }]);

  // The plain id carries no name to allow by, so only the named one counts.
  expect(names).toEqual(new Set(['real name']));
  expect(allowedNames(undefined)).toEqual(new Set());
});
