import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { MusicPlayerAppElement } from '@/types/music-player-app-element';
import type { QueueAPI } from '@/types/queue';

/** How long a resumed queue may take to load before the restore gives up. */
const RESTORE_TIMEOUT_MS = 10_000;

export type ResumeShufflePluginConfig = {
  enabled: boolean;
  /** Whether the queue was shuffled when the app was last closed */
  shuffled: boolean;
};

// The app element is the player/queue API the api-server plugin drives too: its
// redux queue slice is the queue state and `queue.shuffle()` is the shuffle
// action. Preferred over poking `ytmusic-player-bar` / `#queue` elements.
const getApp = () =>
  document.querySelector<MusicPlayerAppElement>('ytmusic-app');

const getQueueApi = () => getApp()?.queue;

const readQueue = () =>
  getApp()?.ytmusicReduxBehavior?.store?.store?.getState().queue;

const isShuffled = () => readQueue()?.shuffleEnabled ?? false;

/**
 * Shuffles once the queue has items. Returns a canceller, so a pending shuffle
 * can't outlive the plugin.
 */
const shuffleWhenReady = (queue: QueueAPI, onDone: () => void) => {
  const store = queue.store.store;
  let unsubscribe: (() => void) | undefined;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    unsubscribe?.();
    onDone();
  };

  const shuffle = () => {
    // The queue is filled asynchronously, so wait for it before shuffling
    if (!store.getState().queue.items.length) return;

    finish();
    if (!isShuffled()) {
      queue
        .shuffle()
        .catch((error: unknown) =>
          console.error('Resume shuffle failed', error),
        );
    }
  };

  unsubscribe = store.subscribe(shuffle) as () => void;
  shuffle();
  // Give up if the queue never arrives, so a queue started later isn't
  // shuffled by surprise
  const timeout = setTimeout(finish, RESTORE_TIMEOUT_MS);

  return () => {
    finished = true;
    clearTimeout(timeout);
    unsubscribe?.();
  };
};

export default createPlugin<
  unknown,
  unknown,
  {
    /** Unsubscribes from the queue store once a restore is no longer pending */
    unsubscribeShuffleState: (() => void) | null;
    /** Cancels a pending shuffle restore */
    cancelShuffle: (() => void) | null;
    stopped: boolean;
  },
  ResumeShufflePluginConfig
>({
  name: () => t('plugins.resume-shuffle.name'),
  description: () => t('plugins.resume-shuffle.description'),
  addedVersion: '3.13.X',
  restartNeeded: false,
  config: {
    enabled: false,
    shuffled: false,
  },
  renderer: {
    unsubscribeShuffleState: null,
    cancelShuffle: null,
    stopped: false,
    async onPlayerApiReady(_api, { getConfig, setConfig }) {
      // Defensive: this can run again on plugin re-enable
      teardown(this);
      this.stopped = false;

      const { shuffled } = await getConfig();
      // The plugin may have been disabled while awaiting the config
      if (this.stopped) return;

      const shouldRestore =
        location.pathname === '/watch' &&
        shuffled &&
        window.mainConfig.get('options.resumeOnStart');

      // Persist the shuffle state so the last state before quitting is what the
      // next launch restores. It stays off while a restore is pending: the
      // resumed queue loads with shuffle off, which must not overwrite the saved
      // `true` before the restore is applied.
      let save = !shouldRestore;
      const persistShuffleState = () => {
        if (save) setConfig({ shuffled: isShuffled() });
      };

      const store = getApp()?.ytmusicReduxBehavior?.store?.store;
      if (store) {
        // The subscription only reacts to changes, so record the initial state
        // too (skipped while a restore is pending)
        persistShuffleState();
        this.unsubscribeShuffleState = store.subscribe(
          persistShuffleState,
        ) as () => void;
      }

      if (!shouldRestore) return;

      const queue = getQueueApi();
      if (queue?.store.store) {
        this.cancelShuffle = shuffleWhenReady(queue, () => {
          save = true;
        });
      } else {
        // No queue/store yet: keep the saved flag and subscribe late, or nothing persists.
        const timeout = setTimeout(() => {
          save = true;
          const lateStore = getApp()?.ytmusicReduxBehavior?.store?.store;
          if (lateStore && !this.unsubscribeShuffleState) {
            this.unsubscribeShuffleState = lateStore.subscribe(
              persistShuffleState,
            ) as () => void;
            persistShuffleState();
          }
        }, RESTORE_TIMEOUT_MS);
        this.cancelShuffle = () => clearTimeout(timeout);
      }
    },
    stop() {
      this.stopped = true;
      teardown(this);
    },
  },
});

/** Releases everything a previous start installed. */
function teardown(properties: {
  unsubscribeShuffleState: (() => void) | null;
  cancelShuffle: (() => void) | null;
}) {
  properties.unsubscribeShuffleState?.();
  properties.unsubscribeShuffleState = null;
  properties.cancelShuffle?.();
  properties.cancelShuffle = null;
}
