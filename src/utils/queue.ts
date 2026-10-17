import type { LongBylineTextRun, QueueItem } from '@/types/datahost-get-state';

/**
 * A queue entry's renderer: the item itself, or a wrapper's primary half. The
 * redux queue is runtime data, so a slot can hold `null`.
 */
export const queueRenderer = (item: QueueItem | null | undefined) =>
  item?.playlistPanelVideoRenderer ??
  item?.playlistPanelVideoWrapperRenderer?.primaryRenderer
    ?.playlistPanelVideoRenderer;

/** The run that divides a queue byline: `artist • album • year`. */
const bylineDivider = ' • ';

/** A byline part that reads as a release year. */
export const yearPattern = /^\d{4}$/;

/** A byline's parts, with the empty ones a stray divider leaves behind gone. */
export const bylineParts = (runs?: LongBylineTextRun[]) =>
  (runs ?? [])
    .map((run) => run.text)
    .join('')
    .split(bylineDivider)
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * `artist • album • year`: the year is the last part that reads as one, and the
 * album the first part after the artist that is not the year.
 */
export const parseByline = (runs?: LongBylineTextRun[]) => {
  const parts = bylineParts(runs);
  const year = parts.filter((part) => yearPattern.test(part)).at(-1);

  return {
    artist: parts[0],
    album: parts.slice(1).find((part) => part !== year),
    year,
  };
};
