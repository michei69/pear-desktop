import type { PageContextOf } from "@pear/sdk";
import { queueShuffleEnabled, queueStore } from "@pear/sdk";
import { resumeShuffleConfig } from "./config.ts";
import { isShuffled, RESTORE_TIMEOUT_MS, type ShuffleQueue, shuffleWhenReady } from "./restore.ts";

type Ctx = PageContextOf<typeof resumeShuffleConfig>;

/** The queue as this plugin uses it, or undefined while YTM has not built one. */
const readQueue = (): ShuffleQueue | undefined => {
  const queue = queueStore();
  return queue ? (queue as unknown as ShuffleQueue) : undefined;
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

  const subscribe = (): boolean => {
    const queue = readQueue();
    const store = queue?.store.store;
    if (!store?.subscribe) return false;
    unsubscribeState = store.subscribe(persist);
    return true;
  };

  if (subscribe()) persist();

  if (!shouldRestore) return () => unsubscribeState?.();

  let cancel: (() => void) | undefined;
  const queue = readQueue();
  if (queue) {
    cancel = shuffleWhenReady(queue, () => {
      save = true;
    });
  } else {
    // No queue yet: keep the saved flag, and start saving once one appears.
    const timer = ctx.setTimeout(() => {
      save = true;
      if (subscribe()) persist();
    }, RESTORE_TIMEOUT_MS);
    cancel = () => ctx.clearTimeout(timer);
  }

  ctx.log.info(
    `resume-shuffle: restoring a shuffled queue (${isShuffled(queue) ? "already shuffled" : "shuffling"})`,
  );

  return () => {
    cancel?.();
    unsubscribeState?.();
  };
}
