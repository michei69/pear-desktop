// A long playlist loads its rows in batches as the list scrolls, so the bulk
// actions first pull in every batch and then click. This is that wait: it polls
// for growth instead of sleeping a fixed time, scrolls only when the spinner is
// out of view, and ends as soon as the plugin is stopped.

export interface BatchSource {
  /** The continuation spinner, while more rows can be loaded. */
  loader(): Element | null;
  /** How many action rows are loaded. */
  rows(): number;
  /** Brings the spinner into view (only when it is out of view). */
  reveal(loader: Element): void;
  /** Resolves after `ms`, or at once when the plugin stopped. */
  wait(ms: number): Promise<void>;
  stopped(): boolean;
}

export interface BatchOptions {
  /** Batches to load before giving up on a very long list. */
  maxBatches?: number;
  /** How long one batch may take before the list counts as stalled. */
  timeoutMs?: number;
  /** Poll interval while a batch loads. */
  pollMs?: number;
  /** Called after a batch added rows or replaced the spinner. */
  progress?(): void;
}

export type BatchOutcome = "complete" | "stalled" | "capped" | "stopped";

const MAX_BATCHES = 100;
const TIMEOUT_MS = 5000;
const POLL_MS = 100;

/**
 * Loads every remaining batch: `complete` when the spinner is gone, `stalled`
 * when a batch does not arrive in time, `capped` when the list is too long, and
 * `stopped` when the plugin was stopped while waiting.
 */
export async function loadBatches(source: BatchSource, options: BatchOptions = {}): Promise<BatchOutcome> {
  const { maxBatches = MAX_BATCHES, timeoutMs = TIMEOUT_MS, pollMs = POLL_MS, progress } = options;

  for (let batch = 0; ; batch++) {
    if (source.stopped()) return "stopped";
    const loader = source.loader();
    if (!loader) return "complete";
    if (batch >= maxBatches) return "capped";

    source.reveal(loader);
    const before = source.rows();
    let advanced = false;
    for (let waited = 0; waited < timeoutMs; waited += pollMs) {
      await source.wait(pollMs);
      if (source.stopped()) return "stopped";
      if (source.rows() > before || source.loader() !== loader) {
        advanced = true;
        break;
      }
    }
    if (!advanced) return "stalled";
    progress?.();
  }
}

/** Whether `rect` lies outside the viewport, where scrolling to it is needed. */
export const isOutOfView = (rect: Pick<DOMRect, "top" | "bottom">, viewportHeight: number) => rect.top > viewportHeight || rect.bottom < 0;

/** How full an action's icon is: half while the list is still loading. */
export function donePercent(complete: boolean, pressed: number, total: number) {
  if (!complete) return 50;
  if (total === 0) return 0;
  return Math.round((pressed / total) * 100);
}
