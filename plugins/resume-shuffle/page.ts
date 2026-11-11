import { appQueueStore, onQueueChange, type PageContextOf, playerQueue, queueItems, queueShuffleEnabled } from "@pear/sdk";
import { selectors } from "@pear/sdk/selectors";
import type { resumeShuffleConfig } from "./config.ts";
import { isShuffled, type ShuffleAdapter, shuffleWhenReady } from "./restore.ts";

type Ctx = PageContextOf<typeof resumeShuffleConfig>;

/**
 * The restore only cares about the queue, but the app's store dispatches on every
 * state change (volume, likes, navigation). Comparing the queue slice keeps the
 * startup scan off those.
 */
function onQueueSliceChange(listener: () => void): () => void {
  let last = appQueueStore()?.getState().queue;
  return onQueueChange(() => {
    const next = appQueueStore()?.getState().queue;
    if (next === last) return;
    last = next;
    listener();
  });
}

/**
 * Shuffles the queue through YTM's own action: like master's `queue.shuffle()`, it
 * does not depend on the player bar's markup or on the UI language. The bar's
 * control is the fallback for builds that do not expose the action.
 */
export function shuffleQueue(): boolean {
  const queue = playerQueue()?.queue;
  if (!queue?.shuffle) return clickShuffleButton();
  // The queue fills asynchronously, so the action may reject while it is empty.
  void queue.shuffle().catch((error: unknown) => console.error("[resume-shuffle] shuffle failed", error));
  return true;
}

/** YTM's shuffle control in either player bar layout. */
function clickShuffleButton(): boolean {
  const button = document.querySelector<HTMLElement>(selectors["player_bar.shuffle"]);
  if (!button) return false;
  button.click();
  return true;
}

/** The queue, as the restore needs it: item count, shuffle flag and changes. */
function shuffleAdapter(): ShuffleAdapter {
  return {
    items: () => queueItems().length,
    shuffled: queueShuffleEnabled,
    shuffle: shuffleQueue,
    subscribe: onQueueSliceChange,
  };
}

export async function startResumeShuffle(ctx: Ctx, adapter: ShuffleAdapter = shuffleAdapter()) {
  // A restore is wanted when the app reopened on the track it closed with, the
  // queue was shuffled then, and resuming the last song is on.
  const shouldRestore = location.pathname === "/watch" && ctx.config.shuffled && ctx.core("general").resumeOnStart;

  // Saving stays off while a restore is pending: the resumed queue loads with
  // shuffle off, which must not overwrite the saved "true" first.
  let save = !shouldRestore;

  const persist = () => {
    if (save) ctx.setConfig({ shuffled: adapter.shuffled() });
  };

  // Safe to register before the app element exists: it waits for it.
  const unsubscribeState = adapter.subscribe(persist);
  persist();

  if (!shouldRestore) return () => unsubscribeState();

  const cancel = shuffleWhenReady(adapter, () => {
    save = true;
  });
  ctx.log.info(`resume-shuffle: restoring a shuffled queue (${isShuffled(adapter) ? "already shuffled" : "shuffling"})`);

  return () => {
    cancel();
    unsubscribeState();
  };
}
