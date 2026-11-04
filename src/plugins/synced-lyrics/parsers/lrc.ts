import type { LyricWord } from '../types';

interface LRCTag {
  tag: string;
  value: string;
}

interface LRCLine {
  time: string;
  timeInMs: number;
  duration: number;
  text: string;
  words: LyricWord[];
}

interface LRC {
  tags: LRCTag[];
  lines: LRCLine[];
}

// `[mm:ss.xx]`, `[mm:ss.xxx]`, `[mm:ss:xx]` and the fraction-less `[mm:ss]`.
const TIME = String.raw`\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]`;
const timeAtStartRegex = new RegExp(`^${TIME}`);
// Enhanced-LRC karaoke tags, same syntax in `<>` instead of `[]`.
const wordTagRegex = new RegExp(
  String.raw`<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>`,
  'g',
);

const tagRegex = /^\[(?<tag>\w+):\s*(?<value>.*?)\s*\]$/;

/** Fraction digits are centiseconds unless the file uses milliseconds. */
const fractionToMs = (fraction?: string) => {
  if (!fraction) return 0;
  return parseInt(fraction.padEnd(3, '0'));
};

const toTimeInMs = (
  minutes: string,
  seconds: string,
  fraction?: string,
): number =>
  parseInt(minutes) * 60_000 +
  parseInt(seconds) * 1000 +
  fractionToMs(fraction);

/** `mm:ss:xx`, the timestamp shown when the time codes setting is on. */
const toDisplayTime = (timeInMs: number): string => {
  const minutes = Math.floor(timeInMs / 60_000);
  const seconds = Math.floor((timeInMs % 60_000) / 1000);
  const centiseconds = Math.floor((timeInMs % 1000) / 10);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}:${pad(centiseconds)}`;
};

type TimedPiece = { timeInMs: number; text: string };

/**
 * Splits the rest of an enhanced-LRC line into timed pieces. The text between
 * two `<mm:ss.xx>` tags belongs to the first tag, so punctuation, CJK and
 * apostrophes survive untouched instead of being re-joined from `\w+` tokens.
 */
const parseTimedPieces = (line: string): TimedPiece[] => {
  const pieces: TimedPiece[] = [];
  let lastTime: number | null = null;
  let lastIndex = 0;

  for (const match of line.matchAll(wordTagRegex)) {
    const [, minutes, seconds, fraction] = match;
    if (lastTime !== null) {
      pieces.push({
        timeInMs: lastTime,
        // The whitespace before a tag is the source's separator, not part of
        // the word: the previous word already ends with its own spacing.
        text: line.slice(lastIndex, match.index).replace(/^\s+/, ''),
      });
    }
    lastTime = toTimeInMs(minutes, seconds, fraction);
    lastIndex = match.index + match[0].length;
  }

  if (lastTime === null) return [];

  pieces.push({
    timeInMs: lastTime,
    text: line.slice(lastIndex).replace(/^\s+/, ''),
  });
  return pieces;
};

/**
 * Word timings: a word ends at the earlier of the next word and its own known
 * end (a trailing `<mm:ss.xx>` tag with no text marks it, as in Apple-Music
 * rich sync); the last word otherwise runs to the end of the line.
 */
const fillWordDurations = (
  words: LyricWord[],
  lineStart: number,
  lineEnd: number,
) => {
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    const availableEnd = next
      ? next.timeInMs
      : Math.max(lineEnd, Math.max(word.timeInMs, lineStart));
    const explicitEnd =
      word.duration > 0
        ? word.timeInMs + word.duration
        : Number.POSITIVE_INFINITY;

    word.duration = Math.max(
      0,
      Math.min(availableEnd, explicitEnd) - word.timeInMs,
    );
  }
};

/** Splits timed pieces into words, keeping an end marker as the previous end. */
const piecesToWords = (pieces: TimedPiece[]): LyricWord[] => {
  const words: LyricWord[] = [];

  for (const piece of pieces) {
    if (!piece.text.trim()) {
      const previous = words.at(-1);
      if (previous && !piece.text) {
        previous.duration = Math.max(0, piece.timeInMs - previous.timeInMs);
      }
      continue;
    }

    words.push({ ...piece, duration: 0 });
  }

  return words;
};

export const LRC = {
  parse: (text: string): LRC => {
    const lrc: LRC = {
      tags: [],
      lines: [],
    };

    let offset = 0;

    for (const rawLine of text.split('\n')) {
      let line = rawLine.trim();
      if (!line.startsWith('[')) continue;

      const timestamps: { time: string; timeInMs: number }[] = [];
      let match: RegExpExecArray | null;
      while ((match = timeAtStartRegex.exec(line))) {
        const [, minutes, seconds, fraction] = match;
        const timeInMs = toTimeInMs(minutes, seconds, fraction);
        timestamps.push({ time: toDisplayTime(timeInMs), timeInMs });
        line = line.slice(match[0].length);
      }

      if (!timestamps.length) {
        const tag = line.match(tagRegex)?.groups;
        if (tag) {
          if (tag.tag === 'offset') {
            offset = parseInt(tag.value) || 0;
            continue;
          }

          lrc.tags.push({ tag: tag.tag, value: tag.value });
        }
        continue;
      }

      const pieces = parseTimedPieces(line);
      const words = piecesToWords(pieces);
      const content = words.length
        ? words
            .map((word) => word.text)
            .join('')
            .trim()
        : line.trim();

      for (const { time, timeInMs } of timestamps) {
        lrc.lines.push({
          time,
          timeInMs,
          text: content,
          words: words.map((word) => ({ ...word })),
          duration: Infinity,
        });
      }
    }

    lrc.lines.sort(({ timeInMs: timeA }, { timeInMs: timeB }) => timeA - timeB);

    for (const line of lrc.lines) {
      line.timeInMs += offset;
      for (const word of line.words) {
        word.timeInMs += offset;
      }
    }

    for (let i = 0; i < lrc.lines.length; i++) {
      const current = lrc.lines[i];
      const next = lrc.lines[i + 1];

      current.duration = next ? next.timeInMs - current.timeInMs : Infinity;
      fillWordDurations(
        current.words,
        current.timeInMs,
        current.timeInMs + current.duration,
      );
    }

    const first = lrc.lines.at(0);
    if (first && first.timeInMs > 300) {
      lrc.lines.unshift({
        time: '00:00:00',
        timeInMs: 0,
        duration: first.timeInMs,
        text: '',
        words: [],
      });
    }

    return lrc;
  },
};
