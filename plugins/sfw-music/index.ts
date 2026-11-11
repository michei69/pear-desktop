import {
  appQueueStore,
  definePlugin,
  onQueueChange,
  playerQueue,
  queueDispatch,
  queueItems,
  queueSelectedIndex,
  type QueueItem,
} from "@pear/sdk";

const EXPLICIT_BADGE = "MUSIC_EXPLICIT_BADGE";
const ROW_SELECTOR =
  "ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-player-queue-item, ytmusic-card-shelf-renderer";
const CONTROL_SELECTOR = "a, button, ytmusic-menu-renderer, yt-icon-button, tp-yt-paper-icon-button";
const PLAYBACK_SELECTOR = 'ytmusic-play-button-renderer, a[href*="watch?"]';

interface BadgeIcon {
  data?: { icon?: { iconType?: string } };
}
type Badge = HTMLElement & BadgeIcon;

interface QueueVideo {
  videoId?: string;
  playlistSetVideoId?: string;
  badges?: { musicInlineBadgeRenderer?: { icon?: { iconType?: string } } }[];
}

type QueueRenderer = { playlistPanelVideoRenderer?: QueueVideo };
interface QueueWrapper {
  primaryRenderer?: QueueRenderer;
  counterpart?: { counterpartRenderer?: QueueRenderer }[];
}

interface QueueState {
  items?: QueueItem[];
  selectedItemIndex?: number;
  repeatMode?: string;
}

/** Every video a queue row can play: its own, or a wrapper's primary and counterparts. */
const videosOf = (item?: QueueItem): (QueueVideo | undefined)[] => {
  // The store's renderers carry badges and wrapper counterparts beyond the SDK's minimal item type.
  const wrapper = item?.playlistPanelVideoWrapperRenderer as unknown as QueueWrapper | undefined;
  return [
    item?.playlistPanelVideoRenderer as unknown as QueueVideo | undefined,
    wrapper?.primaryRenderer?.playlistPanelVideoRenderer,
    ...(wrapper?.counterpart?.map((entry) => entry.counterpartRenderer?.playlistPanelVideoRenderer) ?? []),
  ];
};

const isExplicitVideo = (video?: QueueVideo) =>
  !!video?.badges?.some((badge) => badge.musicInlineBadgeRenderer?.icon?.iconType === EXPLICIT_BADGE);

/** An Explicit badge belonging to this row rather than a nested one. */
const isExplicitRow = (row: Element, badgeSelector: string) =>
  [...row.querySelectorAll<Badge>(badgeSelector)].some(
    (badge) => badge.closest(ROW_SELECTOR) === row && badge.data?.icon?.iconType === EXPLICIT_BADGE,
  );

const itemKeysOf = (items: QueueItem[]) =>
  items.map((item) =>
    videosOf(item)
      .map((video) => video?.videoId)
      .join("/"),
  );

/**
 * The queue state, from the `#queue` store, with the app element's own queue
 * slice as a fallback (the slice outlives the queue element, and exists on UIs
 * that don't expose one). The player bar's legacy `getState().queue` is gone.
 */
const queueState = (): QueueState | undefined => {
  // getState() is typed with the SDK's minimal queue; the stores keep these fields beside it.
  const stored = playerQueue()?.queue?.store?.store?.getState()?.queue as QueueState | undefined;
  if (stored?.items?.length) return stored;
  return (appQueueStore()?.getState().queue as unknown as QueueState | undefined) ?? stored;
};

export default definePlugin({
  id: "sfw-music",
  name: "SFW music",
  description: "Skips YTM's explicit tracks, and blocks starting them from a list or the queue.",
  enabledByDefault: false,
  page: (ctx) => {
    const badgeSelector = ctx.sel("queue.explicit_badge");
    // Entry keys already skipped: an all-explicit queue must not skip forever.
    const skipped = new Set<string>();
    let lastItems: QueueItem[] | undefined;
    let itemKeys: string[] = [];
    let currentEntry: string | undefined;
    let handled = false;
    let blockedVideoId: string | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const check = () => {
      if (stopped) return;

      const videoId = ctx.player.api?.getVideoData()?.video_id;
      if (!videoId) return;
      // The queue can advance before the player leaves the blocked song.
      if (videoId === blockedVideoId && ctx.player.state.status === "playing") {
        ctx.player.control({ type: "pause" });
      }

      const state = queueState();
      const items = state?.items ?? queueItems();
      if (items !== lastItems) {
        const keys = itemKeysOf(items);
        // A radio continuation appends to the queue; only a replaced queue clears the loop guard.
        const appended = itemKeys.length > 0 && keys.length >= itemKeys.length && itemKeys.every((key, index) => keys[index] === key);
        itemKeys = keys;
        lastItems = items;
        if (!appended) {
          currentEntry = undefined;
          skipped.clear();
        }
      }

      const matches = (item?: QueueItem) => videosOf(item).some((video) => video?.videoId === videoId);
      // A direct selection can leave the queue index on a different song.
      let index = state?.selectedItemIndex ?? queueSelectedIndex(items);
      if (!matches(items[index])) index = items.findIndex(matches);
      const video = videosOf(items[index]).find((entry) => entry?.videoId === videoId);
      if (!video) return;

      const entryKey = video.playlistSetVideoId ?? `${index}:${videoId}`;
      if (entryKey !== currentEntry) {
        currentEntry = entryKey;
        handled = false;
      }
      if (handled) return;

      if (!isExplicitVideo(video)) {
        skipped.clear();
        return;
      }

      handled = true;
      blockedVideoId = videoId;
      ctx.player.control({ type: "pause" });

      // Master's per-entry loop guard: an explicit entry that was already skipped
      // is not advanced again, so an all-explicit queue settles paused instead of
      // skipping forever. A replaced queue or a clean song clears the guard.
      if (skipped.has(entryKey)) return;
      skipped.add(entryKey);

      if (index !== state?.selectedItemIndex) {
        const nextIndex = index + 1 < items.length ? index + 1 : 0;
        if (nextIndex > 0 || state?.repeatMode === "ALL") {
          queueDispatch({ type: "SET_INDEX", payload: nextIndex });
          return;
        }
      }
      ctx.player.control({ type: "next" });
    };

    // Let YTM finish its update before changing the queue again.
    const schedule = () => {
      if (stopped) return;
      ctx.clearTimeout(pending);
      pending = ctx.setTimeout(check, 0);
    };

    /** Cancels clicks on a play control inside an Explicit row. */
    const blockExplicitSelection = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest(ROW_SELECTOR);
      if (!row || !isExplicitRow(row, badgeSelector)) return;
      // Menu and byline links are not playback controls.
      if (target?.closest(CONTROL_SELECTOR) && !target.closest(PLAYBACK_SELECTOR)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    ctx.player.on("trackChange", schedule);
    ctx.player.on("trackLoading", schedule);
    ctx.player.on("statusChange", schedule);
    // Queue metadata and rows can arrive without another player event. The app
    // store survives the queue element being re-created, so no re-hooking is needed.
    const offQueue = onQueueChange(schedule);
    ctx.listen(document, "click", blockExplicitSelection, { capture: true });
    ctx.listen(document, "tap", blockExplicitSelection, { capture: true });

    check();

    ctx.onCleanup(() => {
      stopped = true;
      offQueue();
      ctx.clearTimeout(pending);
      pending = undefined;
      skipped.clear();
    });
  },
});
