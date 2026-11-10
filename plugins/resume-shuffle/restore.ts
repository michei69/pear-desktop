// pear-desktop's resume-shuffle: the last queue's shuffle state is saved, and the
// next launch shuffles the resumed queue again.

/** How long a resumed queue may take to fill before the restore gives up. */
export const RESTORE_TIMEOUT_MS = 10_000;

/** The part of YTM's queue store this plugin needs; a fake satisfies it in tests. */
export interface ShuffleStore {
  getState(): { queue: { items: unknown[]; shuffleEnabled?: boolean } };
  subscribe?(listener: () => void): () => void;
}

export interface ShuffleQueue {
  store: { store: ShuffleStore };
  shuffle?(): Promise<unknown>;
}

/** Whether the queue is shuffled right now. */
export function isShuffled(queue: ShuffleQueue | undefined): boolean {
  return queue?.store.store.getState().queue.shuffleEnabled ?? false;
}

/**
 * Shuffles once the queue has items, since the resumed queue fills
 * asynchronously. Returns the canceller, so a pending shuffle cannot outlive the
 * plugin or surprise a queue the user starts later.
 */
export function shuffleWhenReady(
  queue: ShuffleQueue,
  onDone: () => void,
  timeoutMs: number = RESTORE_TIMEOUT_MS,
): () => void {
  const store = queue.store.store;
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
    if (!store.getState().queue.items.length) return;
    finish();
    // The queue can report itself shuffled already: then there is nothing to do.
    if (!isShuffled(queue)) {
      void queue.shuffle?.().catch((error: unknown) => console.error("[resume-shuffle] couldn't shuffle", error));
    }
  };

  unsubscribe = store.subscribe?.(shuffle);
  shuffle();
  timeout = setTimeout(finish, timeoutMs);

  return () => {
    finished = true;
    if (timeout !== undefined) clearTimeout(timeout);
    unsubscribe?.();
  };
}
