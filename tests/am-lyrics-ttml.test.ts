import { expect, test } from '@playwright/test';

import { synthesizeTTML } from '../src/plugins/synced-lyrics/am-lyrics/ttml';
import {
  installDom,
  uninstallDom,
} from '../src/plugins/synced-lyrics/tests/harness';

import type { LineLyrics } from '../src/plugins/synced-lyrics/types';

type ParsedSyllable = {
  text: string;
  timestamp: number;
  endtime: number;
  part: boolean;
  lineSynced?: boolean;
};

type ParsedLine = {
  text: ParsedSyllable[];
  backgroundText: ParsedSyllable[];
  timestamp: number;
  endtime: number;
  isWordSynced?: boolean;
  oppositeTurn: boolean;
  alignment?: 'start' | 'end';
  direction?: 'ltr' | 'rtl';
};

type ParseTTML = (ttml: string) => {
  lines: ParsedLine[];
  songwriters?: string;
} | null;

let parseTTML: ParseTTML;

const line = (over: Partial<LineLyrics>): LineLyrics => ({
  time: '00:00:00.00',
  timeInMs: 0,
  duration: 1000,
  text: '',
  status: 'upcoming',
  ...over,
});

test.beforeAll(async () => {
  installDom();
  const globals = globalThis as Record<string, unknown>;
  const window = globals.window as Record<string, unknown>;
  // Lit's style engine touches these globals while the bundle registers the
  // element; the shared harness predates the component and does not set them.
  const litGlobals = ['ShadowRoot', 'Document', 'CSSStyleSheet'];
  const restoring = new Map(litGlobals.map((key) => [key, globals[key]]));
  for (const key of litGlobals) globals[key] = window[key];

  // 1.8.9 publishes only the side-effect bundle: its `exports["."]` points at
  // an index.js that was never built. Importing the bundle after a DOM exists
  // registers the class, which is then read back from the registry.
  await import('@uimaxbai/am-lyrics/am-lyrics.js');

  for (const [key, value] of restoring) {
    if (value === undefined) delete globals[key];
    else globals[key] = value;
  }
  const element = (globals.customElements as CustomElementRegistry).get(
    'am-lyrics',
  ) as unknown as { parseTTML: ParseTTML };
  parseTTML = element.parseTTML;
});

test.afterAll(() => uninstallDom());

test('word-synced lines keep their text, begin/end and word timings', () => {
  const ttml = synthesizeTTML([
    line({
      timeInMs: 1000,
      duration: 2000,
      text: 'Hello world',
      words: [
        { text: 'Hello ', timeInMs: 1000, duration: 500 },
        { text: 'world', timeInMs: 1500, duration: 700 },
      ],
    }),
  ]);

  expect(ttml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  expect(ttml).toContain('xmlns:ttm="http://www.w3.org/ns/ttml#metadata"');
  expect(ttml).toContain('xmlns:itunes="http://music.apple.com/lyrics"');

  const parsed = parseTTML(ttml)!;
  expect(parsed.lines).toHaveLength(1);

  const [synced] = parsed.lines;
  expect(synced.timestamp).toBe(1000);
  expect(synced.endtime).toBe(3000);
  expect(synced.isWordSynced).toBe(true);
  expect(
    synced.text
      .map((syllable) => syllable.text)
      .join('')
      .trim(),
  ).toBe('Hello world');
  expect(
    synced.text.map(({ timestamp, endtime }) => ({ timestamp, endtime })),
  ).toStrictEqual([
    { timestamp: 1000, endtime: 1500 },
    { timestamp: 1500, endtime: 2200 },
  ]);
});

test('lines without words stay line-synced', () => {
  const parsed = parseTTML(
    synthesizeTTML([
      line({ timeInMs: 4000, duration: 2000, text: 'Just a line' }),
    ]),
  )!;

  const [plain] = parsed.lines;
  expect(plain.isWordSynced).toBe(false);
  expect(plain.text).toHaveLength(1);
  expect(plain.text[0]).toMatchObject({
    text: 'Just a line',
    timestamp: 4000,
    endtime: 6000,
    lineSynced: true,
  });
});

test('background vocals round-trip through ttm:role="x-bg"', () => {
  const ttml = synthesizeTTML([
    line({
      timeInMs: 1000,
      duration: 2000,
      text: 'Hello world',
      words: [
        { text: 'Hello ', timeInMs: 1000, duration: 500 },
        { text: 'world', timeInMs: 1500, duration: 700 },
      ],
      background: [
        { text: '(ooh ', timeInMs: 2300, duration: 300 },
        { text: 'yeah)', timeInMs: 2600, duration: 300 },
      ],
    }),
  ]);

  expect(ttml).toContain('ttm:role="x-bg"');

  const [synced] = parseTTML(ttml)!.lines;
  expect(synced.text.map((syllable) => syllable.text)).toStrictEqual([
    'Hello ',
    'world',
  ]);
  expect(synced.backgroundText.map((syllable) => syllable.text)).toStrictEqual([
    '(ooh ',
    'yeah)',
  ]);
  expect(
    synced.backgroundText.map((syllable) => syllable.timestamp),
  ).toStrictEqual([2300, 2600]);
});

test('duet alignment round-trips, including a song that opens on the right', () => {
  const parsed = parseTTML(
    synthesizeTTML([
      line({ timeInMs: 0, duration: 1000, text: 'Left', alignment: 'start' }),
      line({ timeInMs: 1000, duration: 1000, text: 'Right', alignment: 'end' }),
      line({
        timeInMs: 2000,
        duration: 1000,
        text: 'Left again',
        alignment: 'start',
      }),
      line({ timeInMs: 3000, duration: 1000, text: 'Untagged' }),
      line({
        timeInMs: 4000,
        duration: 1000,
        text: 'Right again',
        alignment: 'end',
      }),
    ]),
  )!;

  expect(parsed.lines.map((entry) => entry.alignment)).toStrictEqual([
    'start',
    'end',
    'start',
    undefined,
    'end',
  ]);
  expect(parsed.lines.map((entry) => entry.oppositeTurn)).toStrictEqual([
    false,
    true,
    false,
    false,
    true,
  ]);

  const rightOpening = parseTTML(
    synthesizeTTML([
      line({ timeInMs: 0, duration: 1000, text: 'Right', alignment: 'end' }),
      line({
        timeInMs: 1000,
        duration: 1000,
        text: 'Left',
        alignment: 'start',
      }),
    ]),
  )!;
  expect(rightOpening.lines.map((entry) => entry.alignment)).toStrictEqual([
    'end',
    'start',
  ]);
});

test('rtl lines carry dir="rtl"', () => {
  const ttml = synthesizeTTML([
    line({ timeInMs: 6000, duration: 2000, text: 'שלום עולם', rtl: true }),
  ]);

  expect(ttml).toContain('dir="rtl"');
  expect(parseTTML(ttml)!.lines[0].direction).toBe('rtl');
});

test('non-finite durations still produce finite TTML times', () => {
  const ttml = synthesizeTTML([
    line({ timeInMs: 0, duration: 0, text: 'zero length' }),
    line({
      timeInMs: 5000,
      duration: Infinity,
      text: 'last line',
      words: [{ text: 'last ', timeInMs: 5000, duration: 500 }],
    }),
  ]);

  expect(ttml).not.toContain('Infinity');
  expect(ttml).not.toContain('NaN');

  const parsed = parseTTML(ttml)!;
  expect(parsed.lines).toHaveLength(2);
  for (const parsedLine of parsed.lines) {
    expect(Number.isFinite(parsedLine.timestamp)).toBe(true);
    expect(Number.isFinite(parsedLine.endtime)).toBe(true);
    expect(parsedLine.endtime).toBeGreaterThanOrEqual(parsedLine.timestamp);
  }
});

test('songwriters come from the options', () => {
  const parsed = parseTTML(
    synthesizeTTML([line({ text: 'Hi' })], { songwriters: 'A & B' }),
  )!;
  expect(parsed.songwriters).toBe('A & B');
});

test('every input line maps to one paragraph, empty gaps and escaping included', () => {
  const parsed = parseTTML(
    synthesizeTTML([
      line({ timeInMs: 0, duration: 500, text: 'Rock & Roll <3' }),
      line({ timeInMs: 500, duration: 500, text: '' }),
      line({ timeInMs: 1000, duration: 500, text: 'Bye' }),
    ]),
  )!;

  expect(parsed.lines).toHaveLength(3);
  expect(
    parsed.lines.map((entry) =>
      entry.text
        .map((syllable) => syllable.text)
        .join('')
        .trim(),
    ),
  ).toStrictEqual(['Rock & Roll <3', '', 'Bye']);
});
