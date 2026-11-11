// The window geometry pear-desktop used (config/defaults.ts' window-size and
// src/index.ts' minWidth/minHeight), kept in one place so a merge can't change
// one use without the others.

export const MIN_WIDTH = 325;
export const MIN_HEIGHT = 425;
/** A fresh install opens at pear-desktop's 1100×550, not a larger default. */
export const DEFAULT_WINDOW_SIZE = { width: 1100, height: 550 };
