// pear-desktop's resume-shuffle: the last queue's shuffle state is saved, and the
// next launch shuffles the resumed queue again.

/** How long a resumed queue may take to fill before the restore gives up. */
export const RESTORE_TIMEOUT_MS = 10_000;

/** What the restore needs from the player page; a fake satisfies it in tests. */
export interface ShuffleAdapter {
  /** How many items the queue has; the resumed queue fills asynchronously. */
  items(): number;
  shuffled(): boolean;
  /** Asks YTM to shuffle (its own button). */
  shuffle(): boolean;
  /** Fires on every queue change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** Whether the queue is shuffled right now, through the adapter. */
export function isShuffled(adapter: Pick<ShuffleAdapter, "shuffled">): boolean {
  return adapter.shuffled();
}

/**
 * Shuffles once the queue has items, since the resumed queue fills
 * asynchronously. Returns the canceller, so a pending shuffle cannot outlive the
 * plugin or surprise a queue the user starts later.
 */
export function shuffleWhenReady(
  adapter: ShuffleAdapter,
  onDone: () => void,
  timeoutMs: number = RESTORE_TIMEOUT_MS,
): () => void {
  let unsubscribe: (() => void) | undefined;
  let finished = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const finish = () => {
    if (finished) return;
    finished = true;
    if (timeout !== undefined) clearTimeout(timeout);
    unsubscribe?.();
    onDone();
  };

  const shuffle = () => {
    if (adapter.items() === 0) return;
    const already = adapter.shuffled();
    finish();
    // The queue can report itself shuffled already: then there is nothing to do.
    if (!already && !adapter.shuffle()) console.warn("[resume-shuffle] couldn't find the shuffle button");
  };

  unsubscribe = adapter.subscribe(shuffle);
  shuffle();
  timeout = setTimeout(finish, timeoutMs);

  return () => {
    finished = true;
    if (timeout !== undefined) clearTimeout(timeout);
    unsubscribe?.();
  };
}
