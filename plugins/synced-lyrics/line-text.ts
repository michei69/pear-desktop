// One lyric line as translation providers see it. Background vocals are sung as
// part of the line, so they are translated with it; the result still has one
// entry per lyric line, which is what the display alignment relies on.

import type { LyricLine } from "./types.ts";

export function lineTextForTranslation(line: LyricLine): string {
  const text = line.text.trim();
  const background = line.background
    ?.map((word) => word.text)
    .join("")
    .trim();
  if (!background) return text;
  return text ? `${text} ${background}` : background;
}
