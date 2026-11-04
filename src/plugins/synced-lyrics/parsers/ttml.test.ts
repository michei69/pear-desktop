import { Window } from 'happy-dom';
import { test, expect } from '@playwright/test';

import { parseTTML, parseTTMLTime } from './ttml';

const DomParser = new Window().DOMParser as unknown as typeof DOMParser;

const parse = (ttml: string) => parseTTML(ttml, DomParser);

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:lrc="http://lrc.red/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="en">
  <head>
    <metadata>
      <ttm:agent type="person" xml:id="v1"/>
      <ttm:agent type="person" xml:id="v2"/>
      <ttm:translation xml:lang="ja"><ttm:text for="L1">こんにちは世界</ttm:text></ttm:translation>
      <ttm:translation xml:lang="en"><ttm:text for="L2">same language, dropped</ttm:text></ttm:translation>
    </metadata>
  </head>
  <body>
    <div lrc:songPart="Verse">
      <p begin="1.0" end="3.0" lrc:key="L1" ttm:agent="v1"><span begin="1.0" end="1.5">Hello</span> <span begin="1.5" end="2.2">world</span> <span ttm:role="x-bg"><span begin="2.3" end="2.6">(ooh</span> <span begin="2.6" end="2.9">yeah)</span></span></p>
      <p begin="4.0" end="6.0" lrc:key="L2" ttm:agent="v2"><span begin="4.0" end="5.0">Second</span> <span begin="5.0" end="6.0">singer</span></p>
      <p begin="7.0" end="9.0"></p>
    </div>
  </body>
</tt>`;

test('word and syllable timings, background vocals and line end', () => {
  const result = parse(TTML);
  expect(result).not.toBeNull();

  const [first, second, gap] = result!.lines;

  expect(first.timeInMs).toBe(1000);
  expect(first.duration).toBe(2000);
  expect(first.text).toBe('Hello world');
  expect(first.words).toStrictEqual([
    { duration: 500, text: 'Hello ', timeInMs: 1000 },
    { duration: 1500, text: 'world ', timeInMs: 1500 },
  ]);
  expect(first.background).toStrictEqual([
    { duration: 300, text: '(ooh ', timeInMs: 2300 },
    { duration: 400, text: 'yeah)', timeInMs: 2600 },
  ]);

  expect(second.timeInMs).toBe(4000);
  expect(second.duration).toBe(2000);
  expect(second.words.map((word) => word.duration)).toStrictEqual([1000, 1000]);

  // An empty <p> is an instrumental gap the renderer shows its dots for.
  expect(gap).toMatchObject({ timeInMs: 7000, duration: 2000, text: '' });
});

test('translations keep the other-language lines only', () => {
  const result = parse(TTML)!;

  expect(result.translations).toStrictEqual({ L1: 'こんにちは世界' });
  expect(result.translationLanguage).toBe('ja');
});

test('duet lines alternate sides and untagged lines stay centered', () => {
  const result = parse(TTML)!;

  expect(result.lines.map((line) => line.alignment)).toStrictEqual([
    'start',
    'end',
    undefined,
  ]);
});

test('right-to-left documents mark their lines', () => {
  const result = parse(`<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="he">
  <body><div><p begin="1.0" end="2.0"><span begin="1.0" end="1.5">שלום</span></p></div></body>
</tt>`)!;

  expect(result.lines[0].rtl).toBe(true);
});

test('line-synced TTML has text but no word timings', () => {
  const result = parse(`<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
  <p begin="0:01.000" end="0:03.000">Just a line</p>
</div></body></tt>`)!;

  expect(result.lines[0]).toMatchObject({
    timeInMs: 1000,
    duration: 2000,
    text: 'Just a line',
    words: [],
  });
});

test('times accept clock, seconds and unit-suffixed forms', () => {
  expect(parseTTMLTime('1:02.500')).toBe(62500);
  expect(parseTTMLTime('01:02:03.004')).toBe(3723004);
  expect(parseTTMLTime('12.5')).toBe(12500);
  expect(parseTTMLTime('250ms')).toBe(250);
  expect(parseTTMLTime('1.5s')).toBe(1500);
  expect(parseTTMLTime(null, 42)).toBe(42);
  expect(parseTTMLTime('nonsense', 7)).toBe(7);
});

test('unusable payloads return null', () => {
  expect(parse('')).toBeNull();
  expect(parse('not xml at all')).toBeNull();
  expect(
    parse('<?xml version="1.0"?><tt><body><div></div></body></tt>'),
  ).toBeNull();
});
