import type { MusicPlayer } from '@/types/music-player';
import type { QueueElement } from '@/types/queue';

const EXPLICIT_BADGE = 'MUSIC_EXPLICIT_BADGE';
const PLAYING = 1;
const ROW_SELECTOR =
  'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-player-queue-item, ytmusic-card-shelf-renderer';
const CONTROL_SELECTOR =
  'a, button, ytmusic-menu-renderer, yt-icon-button, tp-yt-paper-icon-button';
const PLAYBACK_SELECTOR = 'ytmusic-play-button-renderer, a[href*="watch?"]';

type BadgeIcon = { data?: { icon?: { iconType?: string } } };

type QueueVideo = {
  videoId?: string;
  playlistSetVideoId?: string;
  badges?: {
    musicInlineBadgeRenderer?: { icon?: { iconType?: string } };
  }[];
};

type QueueItem = {
  playlistPanelVideoRenderer?: QueueVideo;
  playlistPanelVideoWrapperRenderer?: {
    primaryRenderer?: { playlistPanelVideoRenderer?: QueueVideo };
    counterpart?: {
      counterpartRenderer?: { playlistPanelVideoRenderer?: QueueVideo };
    }[];
  };
};

type QueueState = {
  items?: QueueItem[];
  selectedItemIndex?: number;
  repeatMode?: string;
};

type PlayerBar = HTMLElement & { getState?: () => { queue?: QueueState } };

/**
 * The queue state, from the UI-agnostic `#queue` store, with the legacy player
 * bar (gone from newer UIs) as a fallback.
 */
const queueState = (): QueueState | undefined => {
  const store =
    document.querySelector<QueueElement>('#queue')?.queue?.store?.store;
  const stored = store?.getState().queue as QueueState | undefined;
  if (stored?.items?.length) return stored;
  const bar = document
    .querySelector<PlayerBar>('ytmusic-player-bar')
    ?.getState?.()?.queue;
  return bar ?? stored;
};

/** Every video a row can play: its own, or a wrapper's primary and counterparts. */
const videosOf = (item?: QueueItem) => {
  const wrapper = item?.playlistPanelVideoWrapperRenderer;
  return [
    item?.playlistPanelVideoRenderer,
    wrapper?.primaryRenderer?.playlistPanelVideoRenderer,
    ...(wrapper?.counterpart?.map(
      (entry) => entry.counterpartRenderer?.playlistPanelVideoRenderer,
    ) ?? []),
  ];
};

const isExplicitVideo = (video?: QueueVideo) =>
  !!video?.badges?.some(
    (badge) =>
      badge.musicInlineBadgeRenderer?.icon?.iconType === EXPLICIT_BADGE,
  );

/** An Explicit badge belonging to this row rather than a nested one. */
const isExplicitRow = (row: Element) =>
  [
    ...row.querySelectorAll<HTMLElement & BadgeIcon>(
      'ytmusic-inline-badge-renderer',
    ),
  ].some(
    (badge) =>
      badge.closest(ROW_SELECTOR) === row &&
      badge.data?.icon?.iconType === EXPLICIT_BADGE,
  );

const itemKeysOf = (items: QueueItem[]) =>
  items.map((item) =>
    videosOf(item)
      .map((video) => video?.videoId)
      .join('/'),
  );

/**
 * Skips songs YouTube Music labels Explicit and blocks selecting them.
 * Returns a cleanup function for the listeners and timers it installs.
 */
export function startSfwMusic(api: MusicPlayer): () => void {
  let lastItems: QueueItem[] | undefined;
  let itemKeys: string[] = [];
  let currentEntry: string | undefined;
  let handled = false;
  let blockedVideoId: string | undefined;
  let pendingCheck: ReturnType<typeof setTimeout> | undefined;
  const skipped = new Set<string>();

  /** Cancels clicks on a play control inside an Explicit row. */
  const blockExplicitSelection = (event: Event) => {
    const target = event.target as Element | null;
    const row = target?.closest(ROW_SELECTOR);
    if (!row || !isExplicitRow(row)) return;
    // Menu and byline links are not playback controls.
    const playback = target?.closest(PLAYBACK_SELECTOR);
    if (target?.closest(CONTROL_SELECTOR) && !playback) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  /** Pauses and skips the playing song if its queue entry is Explicit. */
  const check = () => {
    const videoId = api.getVideoData()?.video_id;
    if (!videoId) return;
    // The queue can advance before the player leaves the blocked song.
    if (videoId === blockedVideoId && api.getPlayerState() === PLAYING) {
      api.pauseVideo();
    }

    const queue = queueState();
    const items = queue?.items ?? [];
    if (items !== lastItems) {
      const keys = itemKeysOf(items);
      // A radio continuation appends to the queue; only a replaced queue
      // clears the loop guard.
      const appended =
        itemKeys.length > 0 &&
        keys.length >= itemKeys.length &&
        itemKeys.every((key, index) => keys[index] === key);
      itemKeys = keys;
      lastItems = items;
      if (!appended) {
        currentEntry = undefined;
        skipped.clear();
      }
    }

    const matches = (item?: QueueItem) =>
      videosOf(item).some((video) => video?.videoId === videoId);
    // A direct selection can leave the queue index on a different song.
    let index = queue?.selectedItemIndex ?? -1;
    if (!matches(items[index])) index = items.findIndex(matches);
    const video = videosOf(items[index]).find(
      (entry) => entry?.videoId === videoId,
    );
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
    api.pauseVideo();
    // An all-explicit queue would otherwise skip forever.
    if (skipped.has(entryKey)) return;
    skipped.add(entryKey);
    if (index !== queue?.selectedItemIndex) {
      const nextIndex = index + 1 < items.length ? index + 1 : 0;
      if (nextIndex > 0 || queue?.repeatMode === 'ALL') {
        document.querySelector<QueueElement>('#queue')?.dispatch({
          type: 'SET_INDEX',
          payload: nextIndex,
        });
        return;
      }
    }
    api.nextVideo();
  };

  // Let YouTube finish its update before changing the queue again.
  const scheduleCheck = () => {
    clearTimeout(pendingCheck);
    pendingCheck = setTimeout(check, 0);
  };
  api.addEventListener('videodatachange', scheduleCheck);
  api.addEventListener('onStateChange', scheduleCheck);
  // A direct selection can replace the queue before its metadata loads.
  document.addEventListener('click', blockExplicitSelection, true);
  document.addEventListener('tap', blockExplicitSelection, true);
  // Queue metadata can arrive without another player event.
  const timer = setInterval(check, 250);
  check();
  return () => {
    clearInterval(timer);
    clearTimeout(pendingCheck);
    api.removeEventListener('videodatachange', scheduleCheck);
    api.removeEventListener('onStateChange', scheduleCheck);
    document.removeEventListener('click', blockExplicitSelection, true);
    document.removeEventListener('tap', blockExplicitSelection, true);
  };
}
