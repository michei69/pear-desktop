// What only the page knows (its queue store and full-screen player) mapped to
// the MPRIS capabilities and fullscreen property.

import type { RepeatMode } from "@pear/sdk";

/** The page's part of the mirror: MPRIS capabilities and fullscreen. */
export interface PageNav {
  fullscreen: boolean;
  /** Tracks before and after the playing one. */
  before: number;
  after: number;
  /** YTM keeps adding or loading tracks (radio autoplay, a queue continuation). */
  more: boolean;
}

/** The fields of YTM's app-level queue store this mirror reads. */
export interface QueueSnapshot {
  fullscreen: boolean;
  itemCount: number;
  /** Index of the playing item, -1 while nothing is selected yet. */
  selectedIndex: number;
  /** YTM's radio autoplay (or an endless mix) will add tracks. */
  autoplay: boolean;
  /** The queue has more pages to load after the rendered items. */
  continuation: boolean;
}

/** pear-desktop's rules: previous unless at the queue's start; next while tracks follow (autoplay adds them) or the queue repeats. */
export function capabilities(nav: PageNav, repeat: RepeatMode) {
  return {
    canGoPrevious: nav.before > 0,
    canGoNext: nav.more || nav.after > 0 || repeat === "all",
  };
}

export function pageNav({ fullscreen, itemCount, selectedIndex, autoplay, continuation }: QueueSnapshot): PageNav {
  return {
    fullscreen,
    before: Math.max(0, selectedIndex),
    after: selectedIndex < 0 ? itemCount : itemCount - selectedIndex - 1,
    more: autoplay || continuation,
  };
}
