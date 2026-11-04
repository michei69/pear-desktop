import { test, expect } from '@playwright/test';

import { LRC } from './lrc';

test('empty string', () => {
  const lrc = LRC.parse('');
  expect(lrc).toStrictEqual({ lines: [], tags: [] });
});

test('chorus', () => {
  const lrc = LRC.parse(`\
[00:12.00]Line 1 lyrics
[00:17.20]Line 2 lyrics
[00:21.10][00:45.10]Repeating lyrics (e.g. chorus)
[mm:ss.xx]Last lyrics line\
`);

  expect(lrc).toStrictEqual({
    lines: [
      { duration: 12000, text: '', words: [], time: '00:00:00', timeInMs: 0 },
      {
        duration: 5200,
        text: 'Line 1 lyrics',
        words: [],
        time: '00:12:00',
        timeInMs: 12000,
      },
      {
        duration: 3900,
        text: 'Line 2 lyrics',
        words: [],
        time: '00:17:20',
        timeInMs: 17200,
      },
      {
        duration: 24000,
        text: 'Repeating lyrics (e.g. chorus)',
        words: [],
        time: '00:21:10',
        timeInMs: 21100,
      },
      {
        duration: Infinity,
        text: 'Repeating lyrics (e.g. chorus)',
        words: [],
        time: '00:45:10',
        timeInMs: 45100,
      },
    ],
    tags: [],
  });
});

test('attributes', () => {
  const lrc = LRC.parse(
    `[ar:Chubby Checker oppure  Beatles, The]
[al:Hits Of The 60's - Vol. 2 – Oldies]
[ti:Let's Twist Again]
[au:Written by Kal Mann / Dave Appell, 1961]
[length: 2:23]

[00:12.00]Naku Penda Piya-Naku Taka Piya-Mpenziwe
[00:15.30]Some more lyrics ...`,
  );

  expect(lrc).toStrictEqual({
    lines: [
      { duration: 12000, text: '', words: [], time: '00:00:00', timeInMs: 0 },
      {
        duration: 3300,
        text: 'Naku Penda Piya-Naku Taka Piya-Mpenziwe',
        words: [],
        time: '00:12:00',
        timeInMs: 12000,
      },
      {
        duration: Infinity,
        text: 'Some more lyrics ...',
        words: [],
        time: '00:15:30',
        timeInMs: 15300,
      },
    ],
    tags: [
      { tag: 'ar', value: 'Chubby Checker oppure  Beatles, The' },
      { tag: 'al', value: "Hits Of The 60's - Vol. 2 – Oldies" },
      { tag: 'ti', value: "Let's Twist Again" },
      { tag: 'au', value: 'Written by Kal Mann / Dave Appell, 1961' },
      { tag: 'length', value: '2:23' },
    ],
  });
});

test('karaoke word timings', () => {
  const lrc = LRC.parse(
    '[00:00.00] <00:00.04> When <00:00.16> the <00:00.82> truth <00:01.29> is <00:01.63> found <00:03.09> to <00:03.37> be <00:05.92> lies',
  );

  expect(lrc).toStrictEqual({
    lines: [
      {
        duration: Infinity,
        text: 'When the truth is found to be lies',
        time: '00:00:00',
        timeInMs: 0,
        words: [
          { duration: 120, text: 'When ', timeInMs: 40 },
          { duration: 660, text: 'the ', timeInMs: 160 },
          { duration: 470, text: 'truth ', timeInMs: 820 },
          { duration: 340, text: 'is ', timeInMs: 1290 },
          { duration: 1460, text: 'found ', timeInMs: 1630 },
          { duration: 280, text: 'to ', timeInMs: 3090 },
          { duration: 2550, text: 'be ', timeInMs: 3370 },
          { duration: Infinity, text: 'lies', timeInMs: 5920 },
        ],
      },
    ],
    tags: [],
  });
});

test('hospitality: word tags keep CJK, apostrophes and punctuation', () => {
  const lrc = LRC.parse(`\
[00:01.00]<00:01.00>ア<00:01.25>パート <00:01.80>歌おう
[00:03.00]<00:03.00>I'm <00:03.50>here, <00:04.00>“right”?`);

  const line = (index: number) => lrc.lines[index];
  expect(line(0)).toMatchObject({ timeInMs: 0, duration: 1000, text: '' });
  expect(line(1)).toMatchObject({
    timeInMs: 1000,
    duration: 2000,
    text: 'アパート 歌おう',
    words: [
      { duration: 250, text: 'ア', timeInMs: 1000 },
      { duration: 550, text: 'パート ', timeInMs: 1250 },
      { duration: 1200, text: '歌おう', timeInMs: 1800 },
    ],
  });
  expect(line(2)).toMatchObject({
    timeInMs: 3000,
    text: "I'm here, “right”?",
    words: [
      { duration: 500, text: "I'm ", timeInMs: 3000 },
      { duration: 500, text: 'here, ', timeInMs: 3500 },
      { duration: Infinity, text: '“right”?', timeInMs: 4000 },
    ],
  });
});

test('timestamp variants', () => {
  const lrc = LRC.parse(`\
[1:02]line a
[01:02.5]line b
[01:02.500][01:03]line c`);

  expect(
    lrc.lines.map(({ timeInMs, time, text }) => ({ timeInMs, time, text })),
  ).toStrictEqual([
    { timeInMs: 0, time: '00:00:00', text: '' },
    { timeInMs: 62000, time: '01:02:00', text: 'line a' },
    { timeInMs: 62500, time: '01:02:50', text: 'line b' },
    { timeInMs: 62500, time: '01:02:50', text: 'line c' },
    { timeInMs: 63000, time: '01:03:00', text: 'line c' },
  ]);
});

test('last word duration stops at the next line', () => {
  const lrc = LRC.parse(`\
[00:10.00]<00:10.00>Hello <00:11.00>world
[00:12.00]Next`);

  expect(lrc.lines[1]).toMatchObject({
    timeInMs: 10000,
    duration: 2000,
    words: [
      { duration: 1000, text: 'Hello ', timeInMs: 10000 },
      { duration: 1000, text: 'world', timeInMs: 11000 },
    ],
  });
});

test('a trailing karaoke tag ends the last word', () => {
  const lrc = LRC.parse(`\
[00:06.00]<00:06.00>hello <00:06.50>world <00:07.00>
[00:09.00]Next`);

  expect(lrc.lines[1].words).toStrictEqual([
    { duration: 500, text: 'hello ', timeInMs: 6000 },
    { duration: 500, text: 'world ', timeInMs: 6500 },
  ]);
});

test('offset shifts lines and words', () => {
  const lrc = LRC.parse(`\
[offset:500]
[00:10.00]<00:10.00>Line <00:11.00>1 lyrics
[00:20.00]Line 2 lyrics\
`);

  expect(
    lrc.lines
      .filter((it) => it.text)
      .map((it) => ({ timeInMs: it.timeInMs, duration: it.duration })),
  ).toStrictEqual([
    { timeInMs: 10500, duration: 10000 },
    { timeInMs: 20500, duration: Infinity },
  ]);
  expect(lrc.lines[1].words.map((word) => word.timeInMs)).toStrictEqual([
    10500, 11500,
  ]);
});
