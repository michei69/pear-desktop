// YTM reuses one `tp-yt-paper-toast` element for every message. When a close
// and a reopen land in the same observer batch, the toast's *current* class
// list already reads "open" again, so only the records' old values show that a
// new message arrived (pear-desktop's d0e31b13).

export const OPEN_CLASS = "paper-toast-open";

export interface ToastClassChange<T> {
  toast: T;
  /** The class attribute before this change. */
  oldValue: string | null | undefined;
}

const wasOpen = (classAttribute: string | null | undefined) => (classAttribute ?? "").split(/\s+/).includes(OPEN_CLASS);

/**
 * Whether a toast's batch, walked backwards, contains an open → closed step.
 * `currentOpen` is the class list after the batch; `oldValues` are its class
 * values in the order the records arrived.
 */
export function closedDuringBatch(currentOpen: boolean, oldValues: readonly (string | null | undefined)[]): boolean {
  let open = currentOpen;
  for (let index = oldValues.length - 1; index >= 0; index--) {
    const before = wasOpen(oldValues[index]);
    if (before && !open) return true;
    open = before;
  }
  return false;
}

/** The toasts that closed during a batch, even when a later reopen made their class list look open now. */
export function toastsClosedDuringBatch<T>(changes: readonly ToastClassChange<T>[], isOpen: (toast: T) => boolean): T[] {
  const oldValues = new Map<T, (string | null | undefined)[]>();
  for (const { toast, oldValue } of changes) {
    const values = oldValues.get(toast);
    if (values) values.push(oldValue);
    else oldValues.set(toast, [oldValue]);
  }
  return [...oldValues].filter(([toast, values]) => closedDuringBatch(isOpen(toast), values)).map(([toast]) => toast);
}
