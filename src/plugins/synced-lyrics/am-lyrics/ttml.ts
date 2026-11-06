import type { LineLyrics, LyricWord } from '../types';

type SynthesizeOptions = {
  songwriters?: string;
  /** Translated line per line index; entries without text are left out. */
  translations?: readonly (string | undefined)[];
  /** Language of the translations, for the `<translation>` label. */
  translationLanguage?: string;
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

/**
 * Whether a line has anything to render. Blank timed lines are interlude
 * markers in LRC data (the parser also inserts one for an intro over 300 ms);
 * they carry the timing of the gap but must not become empty rows, or the
 * component renders a block of whitespace instead of its animated dots.
 */
const hasRenderableText = (line: LineLyrics) =>
  Boolean(
    line.text.trim() ||
    line.words?.some((word) => word.text.trim()) ||
    line.background?.some((word) => word.text.trim()),
  );

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
 *
 * Blank timed lines are interlude markers (LRC data uses them for breaks, and
 * the parser inserts one for a long intro): they are dropped, leaving their
 * musically timed gap between the surrounding paragraphs so the component can
 * draw its instrumental dots instead of blank rows.
 */
export const synthesizeTTML = (
  lines: LineLyrics[],
  options: SynthesizeOptions = {},
): string => {
  // Keep each line's original end (computed against the next input line) so a
  // dropped interlude marker still leaves the gap between the surrounding
  // lines for am-lyrics to animate.
  const paragraphsIn = lines
    .map((line, index) => ({
      line,
      index,
      end: lineEnd(line, lines[index + 1]),
    }))
    .filter(({ line }) => hasRenderableText(line));

  const rendered = new Set(paragraphsIn.map(({ index }) => index));
  const hasTranslations = Boolean(
    options.translations?.some(
      (text, index) => text?.trim() && rendered.has(index),
    ),
  );
  const hasAgents = paragraphsIn.some(
    ({ line }) => line.alignment !== undefined,
  );
  const hasHead = hasAgents || options.songwriters || hasTranslations;

  const head: string[] = [];
  if (hasHead) {
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
    if (hasTranslations) {
      const language = options.translationLanguage
        ? ` xml:lang="${escapeXml(options.translationLanguage)}"`
        : '';
      head.push(`      <translation${language}>`);
      options.translations?.forEach((text, index) => {
        const line = text?.trim();
        if (line && rendered.has(index)) {
          head.push(
            `        <text for="L${index + 1}">${escapeXml(line)}</text>`,
          );
        }
      });
      head.push('      </translation>');
    }
    head.push('    </metadata>', '  </head>');
  }

  const paragraphs = paragraphsIn.map(({ line, index, end }) =>
    lineXml(line, index, end),
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
