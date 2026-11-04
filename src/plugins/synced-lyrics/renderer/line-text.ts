import type { LineLyrics } from '../types';

/**
 * One line as the translation providers see it. Background vocals are sung as
 * part of the line, so they are translated with it; the result still has one
 * entry per lyric line, which is what the display alignment relies on.
 */
export const lineTextForTranslation = (line: LineLyrics): string => {
  const text = line.text.trim();
  const background = line.background
    ?.map((word) => word.text)
    .join('')
    .trim();
  if (!background) return text;

  return text ? `${text} ${background}` : background;
};
