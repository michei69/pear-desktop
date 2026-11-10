// Builds the Apple-Music TTML dialect am-lyrics parses: `<ttm:agent>` singers
// (right-aligned lines alternate between `v1`/`v2`), `<p>` lines with timed
// `<span>` words, `ttm:role="x-bg"` background vocals and `dir="rtl"` lines.
// `v2` is typed `other` so a duet that opens on the right still starts there.
//
// Blank timed lines are interlude markers (LRC data uses them for breaks, and
// the parser inserts one for a long intro): they are dropped, leaving their
// musically timed gap between the surrounding paragraphs so the component can
// draw its instrumental dots instead of blank rows.

import type { LyricLine, LyricWord } from "../types.ts";

interface SynthesizeOptions {
  /** Translated line per line index; entries without text are left out. */
  translations?: readonly (string | null | undefined)[];
  /** Language of the translations, for the `<translation>` label. */
  translationLanguage?: string;
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** `hh:mm:ss.mmm`, the clock form both am-lyrics and pear's TTML parsers read. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  return [
    pad(Math.floor(total / 3_600_000)),
    pad(Math.floor(total / 60_000) % 60),
    `${pad(Math.floor(total / 1_000) % 60)}.${pad(total % 1_000, 3)}`,
  ].join(":");
}

const escapeXml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * Whether a line has anything to render. Blank timed lines are interlude
 * markers; they carry the timing of the gap but must not become empty rows.
 */
const hasRenderableText = (line: LyricLine) =>
  Boolean(line.text.trim() || line.words?.some((word) => word.text.trim()) || line.background?.some((word) => word.text.trim()));

/** A timed word, with the separator space left outside the span. */
function wordXml(word: LyricWord, fallbackEnd: number): string {
  const knownEnd = Number.isFinite(word.endMs) && word.endMs > word.startMs ? word.endMs : fallbackEnd;
  const text = word.text.replace(/\s+$/, "");
  // am-lyrics re-attaches the whitespace text node after a span to that span,
  // so spaces between words live between the tags rather than inside them.
  return `<span begin="${clock(word.startMs)}" end="${clock(Math.max(word.startMs, knownEnd))}">${escapeXml(text)}</span>${/\s$/.test(word.text) ? " " : ""}`;
}

/** A line ends at its own end, else at its last timed word or the next line. */
function lineEnd(line: LyricLine, next: LyricLine | undefined): number {
  const start = Number.isFinite(line.startMs) ? line.startMs : 0;
  if (Number.isFinite(line.endMs) && line.endMs > start) return line.endMs;

  const timedEnds = [...(line.words ?? []), ...(line.background ?? [])].map((word) => word.endMs).filter((end) => Number.isFinite(end));
  const nextStart = next && Number.isFinite(next.startMs) ? next.startMs : start;
  return Math.max(start, nextStart, ...timedEnds);
}

function lineXml(line: LyricLine, index: number, end: number): string {
  const main = line.words?.length ? line.words.map((word) => wordXml(word, end)).join("") : escapeXml(line.text.trim());

  const background = line.background?.length
    ? `<span ttm:role="x-bg">${line.background.map((word) => wordXml(word, end)).join("")}</span>`
    : "";

  const backgroundFirst = line.background?.[0];
  const mainStart = line.words?.[0]?.startMs ?? line.startMs;
  const content = !background ? main : backgroundFirst && backgroundFirst.startMs < mainStart ? background + main : main + background;

  const attributes = [`begin="${clock(line.startMs)}"`, `end="${clock(end)}"`, `itunes:key="L${index + 1}"`];
  if (line.alignment === "start") attributes.push('ttm:agent="v1"');
  if (line.alignment === "end") attributes.push('ttm:agent="v2"');
  if (line.rtl) attributes.push('dir="rtl"');

  return `      <p ${attributes.join(" ")}>${content}</p>`;
}

export function synthesizeTTML(lines: readonly LyricLine[], options: SynthesizeOptions = {}): string {
  // Keep each line's original end, computed against the next input line, so a
  // dropped interlude marker still leaves the gap for am-lyrics to animate.
  const paragraphsIn = lines
    .map((line, index) => ({ line, index, end: lineEnd(line, lines[index + 1]) }))
    .filter(({ line }) => hasRenderableText(line));

  const rendered = new Set(paragraphsIn.map(({ index }) => index));
  const hasTranslations = Boolean(options.translations?.some((text, index) => text?.trim() && rendered.has(index)));
  const hasAgents = paragraphsIn.some(({ line }) => line.alignment !== undefined);
  const hasHead = hasAgents || hasTranslations;

  const head: string[] = [];
  if (hasHead) {
    head.push("  <head>", "    <metadata>");
    if (hasAgents) {
      head.push('      <ttm:agent xml:id="v1" type="person"/>', '      <ttm:agent xml:id="v2" type="other"/>');
    }
    if (hasTranslations) {
      const language = options.translationLanguage ? ` xml:lang="${escapeXml(options.translationLanguage)}"` : "";
      head.push(`      <translation${language}>`);
      options.translations?.forEach((text, index) => {
        const translated = text?.trim();
        if (translated && rendered.has(index)) head.push(`        <text for="L${index + 1}">${escapeXml(translated)}</text>`);
      });
      head.push("      </translation>");
    }
    head.push("    </metadata>", "  </head>");
  }

  const paragraphs = paragraphsIn.map(({ line, index, end }) => lineXml(line, index, end));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyrics">',
    ...head,
    "  <body>",
    "    <div>",
    ...paragraphs,
    "    </div>",
    "  </body>",
    "</tt>",
  ].join("\n");
}
