import type { PageContextOf } from "@pear/sdk";
import { onQueueChange, queueItems, queueShuffle, queueShuffleEnabled } from "@pear/sdk";
import { resumeShuffleConfig } from "./config.ts";
import { isShuffled, RESTORE_TIMEOUT_MS, type ShuffleAdapter, shuffleWhenReady } from "./restore.ts";

type Ctx = PageContextOf<typeof resumeShuffleConfig>;

/** The queue, as the restore needs it: item count, shuffle flag and changes. */
const adapter: ShuffleAdapter = {
  items: () => queueItems().length,
  shuffled: queueShuffleEnabled,
  shuffle: queueShuffle,
  subscribe: onQueueChange,
};

export async function startResumeShuffle(ctx: Ctx) {
  // A restore is wanted when the app reopened on the track it closed with, the
  // queue was shuffled then, and resuming the last song is on.
  const shouldRestore =
    location.pathname === "/watch" && ctx.config.shuffled && ctx.core("general").resumeOnStart;

  // Saving stays off while a restore is pending: the resumed queue loads with
  // shuffle off, which must not overwrite the saved "true" first.
  let save = !shouldRestore;
  let unsubscribeState: (() => void) | undefined;

  const persist = () => {
    if (save) ctx.setConfig({ shuffled: queueShuffleEnabled() });
  };

  // Safe to register before the app element exists: it waits for it.
  unsubscribeState = adapter.subscribe(persist);
  persist();

  if (!shouldRestore) return () => unsubscribeState?.();

  const cancel = shuffleWhenReady(adapter, () => {
    save = true;
  });
  ctx.log.info(`resume-shuffle: restoring a shuffled queue (${isShuffled(adapter) ? "already shuffled" : "shuffling"})`);

  return () => {
    cancel();
    unsubscribeState?.();
  };
}
