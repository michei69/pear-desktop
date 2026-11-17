// Shared TTML -> LyricResult conversion. lrc.red, BetterLyrics and Paxsenix all
// serve Apple-style TTML, which the root parser turns into the same line shape.

import { parseTTML, type TTMLParseResult } from "../ttml.ts";
import type { LyricLine, LyricResult, LyricTranslation } from "../types.ts";

const toLine = (line: TTMLParseResult["lines"][number]): LyricLine => ({
  startMs: line.startMs,
  endMs: line.endMs,
  text: line.text,
  ...(line.words.length ? { words: line.words } : {}),
  ...(line.background.length ? { background: line.background } : {}),
  ...(line.alignment ? { alignment: line.alignment } : {}),
  ...(line.rtl ? { rtl: true } : {}),
});

/** Timed lines and the translation shipped inside one parsed TTML document. */
export function ttmlContent(parsed: TTMLParseResult, provider: string) {
  const lines = parsed.lines.map(toLine);
  const translationLines: LyricLine[] = parsed.lines.flatMap((line) => {
    const text = line.key ? parsed.translations[line.key] : undefined;
    return text ? [{ startMs: line.startMs, endMs: line.endMs, text }] : [];
  });
  const translation: LyricTranslation | undefined = translationLines.length
    ? {
        lines: translationLines,
        provider,
        ...(parsed.translationLanguage ? { language: parsed.translationLanguage } : {}),
      }
    : undefined;
  return { lines, translation };
}

/** Parses provider TTML into a complete result, or null when it has no lines. */
export function ttmlToResult(ttml: string, title: string, artist: string, provider: string): LyricResult | null {
  const parsed = parseTTML(ttml);
  if (!parsed?.lines.length) return null;
  const { lines, translation } = ttmlContent(parsed, provider);
  if (!lines.some((line) => line.text.trim())) return null;
  return {
    title,
    artists: artist ? [artist] : [],
    lines,
    ...(translation ? { translation } : {}),
  };
}
