// Which lyric line the menu bar (statusbar-lyrics) should show: the renderers
// report their active line through this, so the tray no longer reads the view's
// private shadow DOM.

import type { ActiveLyricLine } from "../types.ts";
import type { Shown } from "./store.ts";

/**
 * The line at `index` as statusbar-lyrics shows it, or null when there is
 * nothing to show: before the first line, past the last one, or on an
 * instrumental gap (an empty line).
 */
export function activeLineAt(shown: Pick<Shown, "lines" | "texts" | "romanized">, index: number): ActiveLyricLine | null {
  if (index < 0) return null;
  const text = shown.texts[index] ?? shown.lines[index]?.text ?? "";
  if (!text.trim()) return null;
  return { text, romanized: shown.romanized[index] ?? null };
}
