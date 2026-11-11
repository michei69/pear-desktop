// The Apple Music timeline: what to render, when a line or an instrumental
// break is active, and how far a word or the gap dots have progressed.
// Framework-free so the DOM code stays thin and the timing is testable.

import { clamp } from "@pear/sdk/util";
import type { LyricLine, LyricWord } from "../../types.ts";

/** Breaks shorter than this stay in the normal line flow, as the previous renderer did. */
export const GAP_MIN_MS = 7_000;
/** Hebrew and Arabic ranges: a line is right-to-left even without a provider flag. */
const RTL_TEXT = /[\u0590-\u08ff]/;
/** The fallback length of a final line that carries no end time. */
export const LAST_LINE_MS = 5_000;
/** The upcoming line starts un-blurring this long before it is sung. */
export const PRE_ACTIVE_MS = 500;
/** The next line starts un-blurring this long before it is sung. */
export const UNBLUR_MS = 2_000;

export interface AppleWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface AppleText {
  kind: "line";
  /** Stable across rerenders and provider changes. */
  key: string;
  /** The line's index in the store's raw list, for translations. */
  sourceIndex: number;
  startMs: number;
  /** The end of the line's active interval (see highlightEnd). */
  endMs: number;
  text: string;
  words: AppleWord[];
  background: AppleWord[];
  alignment?: "start" | "end";
  rtl?: boolean;
  translation: string | null;
}

export interface AppleGap {
  kind: "gap";
  key: string;
  startMs: number;
  endMs: number;
}

export type AppleRow = AppleText | AppleGap;

export interface AppleLyrics {
  rows: AppleRow[];
  /** Line ordinal per row index, and -1 for a gap. */
  lineOrdinal: number[];
  hasDuet: boolean;
}

export interface TimelineState {
  /** The row whose interval contains the time, or the last row before it. */
  activeRow: number;
  /** The active row when it is a line; -1 during a gap or between lines. */
  activeLine: number;
  /** The row to keep in view; during a gap it is the next line. */
  scrollRow: number;
  /** The first line after the time, or -1. */
  nextLine: number;
  /** Whether the active row is an instrumental gap. */
  inGap: boolean;
}

const finite = (value: number): boolean => Number.isFinite(value);

const cleanWord = (word: LyricWord): AppleWord | null => {
  if (!word.text.trim() || !finite(word.startMs)) return null;
  const startMs = Math.max(0, word.startMs);
  return { text: word.text, startMs, endMs: finite(word.endMs) && word.endMs > startMs ? word.endMs : startMs };
};

/** Words end at their own end, the next word, or the line's end. */
function fillWords(words: AppleWord[], lineEnd: number): AppleWord[] {
  return words.map((word, index) => {
    if (word.endMs > word.startMs) return word;
    const next = words[index + 1];
    const endMs = Math.max(word.startMs, next?.startMs ?? lineEnd);
    return { ...word, endMs };
  });
}

interface RenderableLine {
  sourceIndex: number;
  startMs: number;
  /** The stored end, or 0 when the provider only knows the start. */
  explicitEnd: number;
  /** The line's own end, before the active interval's hold rules. */
  rawEnd: number;
  endMs: number;
  text: string;
  words: AppleWord[];
  background: AppleWord[];
  alignment?: "start" | "end";
  rtl?: boolean;
  translation: string | null;
}

/**
 * The end of a line's active interval. A line normally stays active until the
 * next one starts; a line with its own end retires at that end when the next
 * start is a long gap away, and overlaps end at their own explicit end. The
 * final line lingers 200 ms past its end, as the source component did.
 */
function highlightEnd(line: RenderableLine, next: RenderableLine | undefined): number {
  const start = line.startMs;
  const rawEnd = line.rawEnd;
  const mainEnd = line.words.at(-1)?.endMs ?? start;
  const backgroundEnd = line.background.at(-1)?.endMs ?? start;

  if (!next || next.startMs <= start) return rawEnd > start ? rawEnd + 200 : rawEnd;
  if (backgroundEnd > Math.max(mainEnd, next.startMs)) return Math.max(mainEnd, next.startMs);
  if (rawEnd > start) {
    if (next.startMs < rawEnd) return rawEnd;
    if (next.startMs - rawEnd >= GAP_MIN_MS) return rawEnd;
    return next.startMs;
  }
  return next.startMs;
}

/**
 * Builds the render list. Blank timed lines are LRC interlude markers: they
 * become instrumental gaps instead of empty rows. Any real break >= 7 s between
 * rendered lines also gets the dots, including the intro before the first line.
 */
export function buildAppleLyrics(
  raw: readonly LyricLine[],
  translations: readonly (string | null | undefined)[] = [],
  texts: readonly (string | null | undefined)[] = [],
): AppleLyrics {
  const rendered: RenderableLine[] = [];

  raw.forEach((line, sourceIndex) => {
    if (!finite(line.startMs)) return;
    const startMs = Math.max(0, line.startMs);
    const words = (line.words ?? []).map(cleanWord).filter((word): word is AppleWord => word !== null);
    const background = (line.background ?? []).map(cleanWord).filter((word): word is AppleWord => word !== null);
    const text = (texts[sourceIndex] || line.text || words.map((word) => word.text).join("")).trim();
    if (!text && words.length === 0 && background.length === 0) return;

    const translationText = translations[sourceIndex]?.trim() || null;
    const translation = translationText && translationText !== text ? translationText : null;
    const rtl = Boolean(line.rtl || RTL_TEXT.test(text) || words.some((word) => RTL_TEXT.test(word.text)));

    rendered.push({
      sourceIndex,
      startMs,
      explicitEnd: finite(line.endMs) && line.endMs > startMs ? line.endMs : 0,
      rawEnd: startMs,
      endMs: startMs,
      text:
        text ||
        words
          .map((word) => word.text)
          .join("")
          .trim(),
      words,
      background,
      ...(line.alignment ? { alignment: line.alignment } : {}),
      ...(rtl ? { rtl: true as const } : {}),
      translation,
    });
  });

  rendered.sort((a, b) => a.startMs - b.startMs);

  // A line ends at its stored end; without one it lasts until the next line,
  // or a few seconds for the final line.
  rendered.forEach((line, index) => {
    const next = rendered[index + 1];
    const wordEnds = [...line.words, ...line.background].map((word) => word.endMs);
    line.rawEnd = Math.max(line.startMs, line.explicitEnd || next?.startMs || line.startMs + LAST_LINE_MS, ...wordEnds);
    line.words = fillWords(line.words, line.rawEnd);
    line.background = fillWords(line.background, line.rawEnd);
    line.endMs = highlightEnd(line, next);
  });

  const rows: AppleRow[] = [];
  const lineOrdinal: number[] = [];
  let ordinal = 0;
  let previousEnd = 0;

  for (const line of rendered) {
    if (line.startMs - previousEnd >= GAP_MIN_MS) {
      rows.push({ kind: "gap", key: `gap-${line.sourceIndex}`, startMs: previousEnd, endMs: line.startMs });
      lineOrdinal.push(-1);
    }
    rows.push({
      kind: "line",
      key: `line-${line.sourceIndex}`,
      sourceIndex: line.sourceIndex,
      startMs: line.startMs,
      endMs: line.endMs,
      text: line.text,
      words: line.words,
      background: line.background,
      ...(line.alignment ? { alignment: line.alignment } : {}),
      ...(line.rtl ? { rtl: true as const } : {}),
      translation: line.translation,
    });
    lineOrdinal.push(ordinal++);
    previousEnd = Math.max(previousEnd, line.rawEnd);
  }

  return {
    rows,
    lineOrdinal,
    hasDuet: rendered.some((line) => line.alignment !== "end") && rendered.some((line) => line.alignment === "end"),
  };
}

/** The last row whose start is at or before `time`; -1 before the first row. */
function rowAt(rows: readonly AppleRow[], time: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (rows[mid]!.startMs <= time) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

/** What is active, what comes next, and which row should be scrolled to. */
export function timelineAt(lyrics: AppleLyrics, time: number): TimelineState {
  const { rows } = lyrics;
  if (rows.length === 0) return { activeRow: -1, activeLine: -1, scrollRow: -1, nextLine: -1, inGap: false };

  const rowIndex = rowAt(rows, time);
  const nextLine = rows.findIndex((row, index) => index > rowIndex && row.kind === "line");

  if (rowIndex < 0) {
    const firstLine = rows.findIndex((row) => row.kind === "line");
    return { activeRow: -1, activeLine: -1, scrollRow: firstLine, nextLine: firstLine, inGap: false };
  }

  const row = rows[rowIndex]!;
  if (row.kind === "gap") {
    if (time < row.endMs) {
      return {
        activeRow: rowIndex,
        activeLine: -1,
        scrollRow: rowIndex,
        nextLine,
        inGap: true,
      };
    }
    // A gap's end is the next line's start, so this only happens at its edge.
  }

  if (row.kind === "line" && time < row.endMs) {
    return { activeRow: rowIndex, activeLine: rowIndex, scrollRow: rowIndex, nextLine, inGap: false };
  }

  return {
    activeRow: row.kind === "line" ? rowIndex : -1,
    activeLine: -1,
    scrollRow: nextLine === -1 ? Math.max(0, rowIndex) : nextLine,
    nextLine,
    inGap: false,
  };
}

/** Whether the upcoming line is close enough to un-blur before it starts. */
export function isPreActive(lyrics: AppleLyrics, state: TimelineState, time: number): boolean {
  if (state.nextLine === -1 || state.nextLine === state.activeLine) return false;
  const row = lyrics.rows[state.nextLine];
  return row?.kind === "line" && row.startMs - time <= PRE_ACTIVE_MS && row.startMs - time > 0;
}

/** 0 before a range, 1 after it. */
export function progressAt(time: number, startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  if (endMs <= startMs) return time >= startMs ? 1 : 0;
  return clamp((time - startMs) / (endMs - startMs), 0, 1);
}
