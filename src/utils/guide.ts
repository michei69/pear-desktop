/**
 * YouTube Music mounts its sidebar as two guides: `#guide-renderer` (the full
 * one) and `#mini-guide-renderer` (the collapsed icon rail). Once the mini
 * guide has been created both stay in the DOM, and the inactive one is hidden
 * with `visibility`/an off-screen transform instead of being removed — so
 * `querySelector` still returns it. Patching "the guide" therefore means
 * patching every mounted copy, and watching for copies YTM creates later (the
 * mini guide is mounted only once the window narrows).
 */
export const GUIDE_SELECTOR = '#guide-renderer, #mini-guide-renderer';

/** The primary (Home/Explore/Library) entry list of a guide. */
export const GUIDE_ITEMS_SELECTOR =
  'ytmusic-guide-section-renderer[is-primary] > #items';

/** Marks the entry this app injects, so it is never mistaken for YTM's own. */
export const SETTINGS_ENTRY_CLASS = 'pear-settings-btn';

/**
 * YTM's Premium upsell: the last primary entry of a guide, ignoring the settings
 * entry appended after it. Expressed as one selector so a stylesheet rule covers
 * every guide YTM mounts, including the mini guide created later.
 */
export const GUIDE_UPSELL_SELECTOR = `ytmusic-guide-section-renderer[is-primary] > #items > ytmusic-guide-entry-renderer:not(.${SETTINGS_ENTRY_CLASS}):not(:has(~ ytmusic-guide-entry-renderer:not(.${SETTINGS_ENTRY_CLASS})))`;

export type GuideList = {
  guide: HTMLElement;
  items: HTMLElement;
};

/** The primary entry list of every mounted guide, in DOM order. */
export const getGuideLists = (root: ParentNode = document): GuideList[] => {
  const lists: GuideList[] = [];

  for (const guide of root.querySelectorAll<HTMLElement>(GUIDE_SELECTOR)) {
    const items = guide.querySelector<HTMLElement>(GUIDE_ITEMS_SELECTOR);
    if (items) lists.push({ guide, items });
  }

  return lists;
};

/**
 * Runs `sync` immediately, then again (at most once per frame) after any DOM
 * change, so guides that are created or rebuilt later get patched too. Returns
 * the unsubscribe function.
 */
export const watchGuides = (sync: () => void): (() => void) => {
  let frame: number | undefined;

  const observer = new MutationObserver(() => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      sync();
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  sync();

  return () => {
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
};
