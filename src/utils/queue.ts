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
