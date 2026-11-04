import type { LineLyrics, LyricWord } from '../types';

type SynthesizeOptions = {
  songwriters?: string;
};

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** `hh:mm:ss.mmm`, the clock form both am-lyrics and pear's TTML parsers read. */
const clock = (ms: number): string => {
  const total = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  return [
    pad(Math.floor(total / 3_600_000)),
    pad(Math.floor(total / 60_000) % 60),
    `${pad(Math.floor(total / 1_000) % 60)}.${pad(total % 1_000, 3)}`,
  ].join(':');
};

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A timed word, with the separator space left outside the span. */
const wordXml = (word: LyricWord, fallbackEnd: number): string => {
  const knownEnd =
    Number.isFinite(word.duration) && word.duration > 0
      ? word.timeInMs + word.duration
      : fallbackEnd;
  const text = word.text.replace(/\s+$/, '');
  // am-lyrics re-attaches the whitespace text node after a span to that span,
  // so spaces between words must live between the tags rather than inside them.
  return `<span begin="${clock(word.timeInMs)}" end="${clock(Math.max(word.timeInMs, knownEnd))}">${escapeXml(text)}</span>${/\s$/.test(word.text) ? ' ' : ''}`;
};

/** A line ends at its duration, else at its last timed word or the next line. */
const lineEnd = (line: LineLyrics, next: LineLyrics | undefined): number => {
  const start = Number.isFinite(line.timeInMs) ? line.timeInMs : 0;
  if (Number.isFinite(line.duration) && line.duration > 0)
    return start + line.duration;

  const timedEnds = [...(line.words ?? []), ...(line.background ?? [])]
    .map(
      (word) =>
        word.timeInMs + (Number.isFinite(word.duration) ? word.duration : 0),
    )
    .filter((end) => Number.isFinite(end));
  const nextStart =
    next && Number.isFinite(next.timeInMs) ? next.timeInMs : start;
  return Math.max(start, nextStart, ...timedEnds);
};

const lineXml = (line: LineLyrics, index: number, end: number): string => {
  const main = line.words?.length
    ? line.words.map((word) => wordXml(word, end)).join('')
    : escapeXml(line.text.trim());

  const background = line.background?.length
    ? `<span ttm:role="x-bg">${line.background.map((word) => wordXml(word, end)).join('')}</span>`
    : '';

  const backgroundFirst = line.background?.[0];
  const mainStart = line.words?.[0]?.timeInMs ?? line.timeInMs;
  const content = !background
    ? main
    : backgroundFirst && backgroundFirst.timeInMs < mainStart
      ? background + main
      : main + background;

  const attributes = [
    `begin="${clock(line.timeInMs)}"`,
    `end="${clock(end)}"`,
    `itunes:key="L${index + 1}"`,
  ];
  if (line.alignment === 'start') attributes.push('ttm:agent="v1"');
  if (line.alignment === 'end') attributes.push('ttm:agent="v2"');
  if (line.rtl) attributes.push('dir="rtl"');

  return `      <p ${attributes.join(' ')}>${content}</p>`;
};

/**
 * Builds the Apple-Music TTML dialect am-lyrics parses: `<ttm:agent>` singers
 * (right-aligned lines alternate between `v1`/`v2`), `<p>` lines with timed
 * `<span>` words, `ttm:role="x-bg"` background vocals and `dir="rtl"` lines.
 * `v2` is typed `other` so a duet that opens on the right still starts there.
 */
export const synthesizeTTML = (
  lines: LineLyrics[],
  options: SynthesizeOptions = {},
): string => {
  const hasAgents = lines.some((line) => line.alignment !== undefined);

  const head: string[] = [];
  if (hasAgents || options.songwriters) {
    head.push('  <head>', '    <metadata>');
    if (hasAgents)
      head.push(
        '      <ttm:agent xml:id="v1" type="person"/>',
        '      <ttm:agent xml:id="v2" type="other"/>',
      );
    if (options.songwriters)
      head.push(
        `      <songwriter>${escapeXml(options.songwriters)}</songwriter>`,
      );
    head.push('    </metadata>', '  </head>');
  }

  const paragraphs = lines.map((line, index) =>
    lineXml(line, index, lineEnd(line, lines[index + 1])),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyrics">',
    ...head,
    '  <body>',
    '    <div>',
    ...paragraphs,
    '    </div>',
    '  </body>',
    '</tt>',
  ].join('\n');
};
