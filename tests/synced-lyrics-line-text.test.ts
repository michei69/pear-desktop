import { expect, test } from '@playwright/test';

import { lineTextForTranslation } from '../src/plugins/synced-lyrics/renderer/line-text';

import type { LineLyrics, LyricWord } from '../src/plugins/synced-lyrics/types';

const words = (text: string): LyricWord[] =>
  text.split(/(?= )/).map((piece, index) => ({
    text: piece,
    timeInMs: index * 100,
    duration: 100,
  }));

const line = (over: Partial<LineLyrics>): LineLyrics => ({
  time: '0:00',
  timeInMs: 0,
  duration: 1000,
  text: '',
  status: 'upcoming',
  ...over,
});

test('lines without background vocals are sent unchanged', () => {
  expect(lineTextForTranslation(line({ text: 'Hello world ' }))).toBe(
    'Hello world',
  );
});

test('background vocals are translated with their line', () => {
  expect(
    lineTextForTranslation(
      line({
        text: "I'm too hot",
        background: words('(Hot damn)'),
      }),
    ),
  ).toBe("I'm too hot (Hot damn)");
});

test('a line made only of background vocals still translates', () => {
  expect(lineTextForTranslation(line({ background: words('(ooh ooh)') }))).toBe(
    '(ooh ooh)',
  );
});

test('empty background entries do not add stray spacing', () => {
  expect(lineTextForTranslation(line({ text: 'Hello', background: [] }))).toBe(
    'Hello',
  );
});
