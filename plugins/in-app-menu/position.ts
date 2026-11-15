// Where menu panels open, kept on screen.

/** Between the trigger and the top-level menu. */
const TRIGGER_GAP = 6;
/** Between a submenu and the item that opened it. */
const SUBMENU_GAP = 4;
/** A panel's padding plus border: a submenu moves up by it so its first item lines up with its owner. */
const PANEL_INSET = 7;
/** The closest a panel comes to the window's edges. */
const SCREEN_MARGIN = 8;
/** The least room a panel is given (a window smaller than that still scrolls the menu). */
const MIN_ROOM = 120;

export interface Point {
  left: number;
  top: number;
}

export function belowTrigger(trigger: Element): Point {
  const rect = trigger.getBoundingClientRect();
  return { left: rect.left, top: rect.bottom + TRIGGER_GAP };
}

export function besideItem(item: Element): Point {
  const rect = item.getBoundingClientRect();
  return { left: rect.right + SUBMENU_GAP, top: rect.top - PANEL_INSET };
}

/**
 * Moves the (already rendered) `panel` to `at`, keeping it on screen; a submenu flips
 * left of its `owner` when it doesn't fit. A panel taller than the window scrolls
 * (styles.ts) rather than running off it.
 */
export function placePanel(panel: HTMLElement, at: Point, owner?: Element) {
  const width = capWidth(panel);
  const overflowsRight = at.left + width > innerWidth - SCREEN_MARGIN;
  const left = owner && overflowsRight ? owner.getBoundingClientRect().left - width - SUBMENU_GAP : at.left;
  panel.style.left = `${keepWithin(left, innerWidth - width)}px`;
  const height = capHeight(panel, at, owner);
  panel.style.top = `${keepWithin(at.top, innerHeight - height)}px`;
}

/** Caps the panel to the window before it is measured, and returns the width it will take. */
function capWidth(panel: HTMLElement) {
  const max = Math.max(MIN_ROOM, innerWidth - 2 * SCREEN_MARGIN);
  panel.style.maxWidth = `${max}px`;
  return Math.min(panel.offsetWidth, max);
}

/**
 * The room a panel may use: below its trigger (a long menu must not cover the top bar,
 * it scrolls) or, beside an item, the whole window (a submenu slides up to fit).
 */
function capHeight(panel: HTMLElement, at: Point, owner?: Element) {
  const max = Math.max(MIN_ROOM, owner ? innerHeight - 2 * SCREEN_MARGIN : innerHeight - SCREEN_MARGIN - at.top);
  panel.style.maxHeight = `${max}px`;
  return Math.min(panel.offsetHeight, max);
}

/** `value`, at least SCREEN_MARGIN and at most `end` minus SCREEN_MARGIN (the start wins if both can't hold). */
function keepWithin(value: number, end: number) {
  return Math.max(SCREEN_MARGIN, Math.min(value, end - SCREEN_MARGIN));
}
