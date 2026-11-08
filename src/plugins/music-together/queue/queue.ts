import { t } from '@/i18n';

import { getMusicQueueRenderer } from './song';
import {
  hasSameVideoIds,
  indexOfQueueVideoId,
  insertVideoData,
  mapQueueItem,
  moveVideoData,
  queueEntries,
  queueVideoIds,
  reconcileVideoData,
  removeVideoData,
  selectedQueueIndex,
} from './utils';

import { getDefaultProfile, type Profile, type VideoData } from '../types';

import type { ConnectionEventUnion } from '@/plugins/music-together/connection';
import type { QueueItem } from '@/types/datahost-get-state';
import type { QueueElement, Store } from '@/types/queue';

const getHeaderPayload = (() => {
  let payload: {
    items?: QueueItem[] | undefined;
    title: {
      runs: {
        text: string;
      }[];
    };
    subtitle: {
      runs: {
        text: string;
      }[];
    };
    buttons: {
      chipCloudChipRenderer: {
        style: {
          styleType: string;
        };
        text: {
          runs: {
            text: string;
          }[];
        };
        navigationEndpoint: {
          saveQueueToPlaylistCommand: unknown;
        };
        icon: {
          iconType: string;
        };
        accessibilityData: {
          accessibilityData: {
            label: string;
          };
        };
        isSelected: boolean;
        uniqueId: string;
      };
    }[];
  } | null = null;

  return () => {
    if (!payload) {
      payload = {
        title: {
          runs: [
            {
              text: t('plugins.music-together.internal.track-source'),
            },
          ],
        },
        subtitle: {
          runs: [
            {
              text: t('plugins.music-together.name'),
            },
          ],
        },
        buttons: [
          {
            chipCloudChipRenderer: {
              style: {
                styleType: 'STYLE_TRANSPARENT',
              },
              text: {
                runs: [
                  {
                    text: t('plugins.music-together.internal.save'),
                  },
                ],
              },
              navigationEndpoint: {
                saveQueueToPlaylistCommand: {},
              },
              icon: {
                iconType: 'ADD_TO_PLAYLIST',
              },
              accessibilityData: {
                accessibilityData: {
                  label: t('plugins.music-together.internal.save'),
                },
              },
              isSelected: false,
              uniqueId: t('plugins.music-together.internal.save'),
            },
          },
        ],
      };
    }

    return payload;
  };
})();

export type QueueOptions = {
  videoList?: VideoData[];
  owner?: Profile;
  queue?: QueueElement;
  getProfile: (id: string) => Profile | undefined;
};
export type QueueEventListener = (event: ConnectionEventUnion) => void;

/** Coalesces the bursts of `SYNC_QUEUE` that follow a join or a resync. */
const SYNC_DEBOUNCE_MS = 100;

export class Queue {
  private readonly queue: QueueElement;

  private originalDispatch?: (obj: {
    type: string;
    payload?: { items?: QueueItem[] | undefined };
  }) => void;

  /** Depth of our own store dispatches; nested ones must stay silent too. */
  private internalDispatch = 0;
  private ignoreFlag = false;
  private listeners: QueueEventListener[] = [];

  private owner: Profile | null;
  private readonly getProfile: (id: string) => Profile | undefined;

  /** Set while a queued `syncVideo` fetch is waiting for the debounce. */
  private syncTimeout?: number;
  /** Bumped when a newer full sync supersedes one that is already in flight. */
  private syncToken = 0;
  /** Bumped on a local queue edit so in-flight fetches cannot undo it. */
  private revision = 0;
  /** Bumped on clear so a stale fetch cannot repopulate the queue. */
  private generation = 0;
  /** Runs the queue fetches one at a time, in the order the events arrived. */
  private mutations: Promise<unknown> = Promise.resolve();
  /** Last index either peer asked for; restored after a full queue replacement. */
  private requestedIndex?: number;
  /** Index a peer sent while a full sync was pending, to apply after it. */
  private pendingSyncIndex?: number;
  /** Set while `replaceQueue` holds the queue being replaced. */
  private syncing = false;
  /** Set while an owner-marker patch is waiting for the next frame. */
  private ownerFrame?: number;
  /** Last owner data written per rendered row, to skip unchanged rows. */
  private ownerSignatures = new WeakMap<HTMLElement, string>();
  /** `selectedIndex` scans every queue item, so it is cached until a dispatch. */
  private cachedSelectedIndex?: number;

  constructor(options: QueueOptions) {
    this.getProfile = options.getProfile;
    this.queue =
      options.queue ?? document.querySelector<QueueElement>('#queue')!;
    this.owner = options.owner ?? null;
    this._videoList = options.videoList ?? [];
  }

  private _videoList: VideoData[] = [];

  /* utils */
  get videoList() {
    return this._videoList;
  }

  get selectedIndex() {
    this.cachedSelectedIndex ??= selectedQueueIndex(this.rawItems);

    return this.cachedSelectedIndex;
  }

  get rawItems(): QueueItem[] {
    return this.queue?.queue.store.store.getState().queue.items ?? [];
  }

  setOwner(owner: Profile) {
    this.owner = owner;
  }

  /** The rendered queue as owner data, for broadcasting a full queue sync. */
  videoDataFromQueue() {
    return this.currentVideoData();
  }

  /** The owner mirror the rendered queue store implies, in store order. */
  private currentVideoData(): VideoData[] {
    return queueVideoIds(this.rawItems).map((videoId, index) => ({
      videoId: videoId ?? '',
      ownerId: this._videoList[index]?.ownerId ?? this.owner?.id ?? '',
    }));
  }

  /**
   * Rebuilds the owner mirror from the store. Every queue edit ends here, so a
   * stale index from a peer can never leave the mirror one row behind the list
   * YouTube Music actually renders.
   */
  private reconcileVideoList() {
    this._videoList = reconcileVideoData(
      this._videoList,
      this.rawItems,
      this.owner?.id ?? '',
    );
  }

  /** Dispatches through the wrapped store without re-broadcasting the edit. */
  private dispatchInternal(event: { type: string; payload?: unknown }) {
    this.internalDispatch += 1;
    try {
      this.queue?.dispatch(event);
    } finally {
      this.internalDispatch -= 1;
    }
  }

  /** Runs the queue fetches in order, so rapid edits cannot be reordered. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(task, task);
    this.mutations = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private afterMutation() {
    setTimeout(() => {
      this.initQueue();
      this.syncQueueOwner();
    }, 0);
  }

  /* public */
  setVideoList(videoList: VideoData[], sync = true) {
    // The list comes from the peer: drop anything that is not a real row so a
    // malformed message cannot poison the owner mirror.
    const videos = videoList.filter(
      (it): it is VideoData => Boolean(it) && typeof it.videoId === 'string',
    );

    // Compare against the rows YouTube Music actually has, not against the
    // cached mirror: an optimistic local edit must never hide a missing row.
    const sameVideos = hasSameVideoIds(videos, this.currentVideoData());

    this._videoList = videos;

    if (!sync) return;

    // An empty host queue means the rendered queue is gone; the store has to
    // follow instead of keeping rows nobody can play.
    if (!videos.length) {
      if (this.rawItems.length) this.clear();
      return;
    }

    // A repeated full sync (the host re-sends on joins and permission
    // rejections) does not need another `/music/get_queue` fetch or re-render.
    // It also supersedes any sync still queued or running for an older list.
    if (sameVideos) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = undefined;
      this.syncToken += 1;
      // The cancelled sync will never rebuild the queue, so the index it was
      // holding must not re-select an old row after a later replacement.
      this.pendingSyncIndex = undefined;
      this.syncQueueOwner();
      return;
    }

    clearTimeout(this.syncTimeout);
    const token = ++this.syncToken;
    this.syncTimeout = window.setTimeout(() => {
      this.syncTimeout = undefined;
      if (token !== this.syncToken) return;
      this.syncVideo().catch((error: unknown) =>
        console.warn('Music Together: queue sync failed', error),
      );
    }, SYNC_DEBOUNCE_MS);
  }

  async addVideos(videoData: VideoData[], index?: number) {
    // Same guard as `setVideoList`: these rows arrive over the wire.
    const videos = videoData.filter(
      (it): it is VideoData =>
        Boolean(it) && typeof it.videoId === 'string' && it.videoId.length > 0,
    );
    if (!videos.length) return false;

    return this.serialize(() => this.insertVideos(videos, index)).catch(
      (error: unknown) => {
        console.warn('Music Together: queue insert failed', error);
        return false;
      },
    );
  }

  private async insertVideos(videos: VideoData[], index?: number) {
    const generation = this.generation;
    const response = await getMusicQueueRenderer(
      videos.map((it) => it.videoId),
    );
    if (!response || generation !== this.generation) return false;

    const items = response.queueDatas.map((it) => it?.content).filter(Boolean);
    if (!items.length) return false;

    // The payload index addresses the rendered queue, so clamp it there; the
    // mirror is rebuilt from the store right after the dispatch anyway.
    const length = this.rawItems.length;
    const indexToUse = Number.isInteger(index)
      ? Math.min(Math.max(index!, 0), length)
      : length;

    this.revision += 1;
    this.dispatchInternal({
      type: 'ADD_ITEMS',
      payload: {
        nextQueueItemId:
          this.queue.queue.store.store.getState().queue.nextQueueItemId,
        // The queue store inserts before `index`; indexToUse is the plain
        // _videoList position.
        index: indexToUse,
        items,
        shuffleEnabled: false,
        shouldAssignIds: true,
      },
    });

    // The server can return a different number of rows than requested (an
    // unavailable track, for instance); mirror whatever the store inserted.
    this._videoList = insertVideoData(
      this._videoList,
      videos.map(
        (it) =>
          ({
            videoId: it.videoId,
            ownerId: it.ownerId ?? this.owner?.id ?? '',
          }) satisfies VideoData,
      ),
      indexToUse,
    );
    this.reconcileVideoList();

    this.afterMutation();

    return true;
  }

  removeVideo(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.rawItems.length)
      return;

    this.revision += 1;
    this.dispatchInternal({
      type: 'REMOVE_ITEM',
      payload: index,
    });
    this._videoList = removeVideoData(this._videoList, index);
    this.reconcileVideoList();
    this.afterMutation();
  }

  setIndex(index: number) {
    if (!Number.isInteger(index) || index < 0) return;

    // An out-of-range SET_INDEX clears every `selected` flag in the queue
    // store, which leaves YouTube Music with no current item: clamp it.
    const length = this.rawItems.length;
    const target = length > 0 ? Math.min(index, length - 1) : index;
    this.requestedIndex = length > 0 ? target : undefined;

    // A track change can arrive while the guest is re-fetching its queue. The
    // replacement drops the selection flags, so remember this index and apply
    // it once the new rows are in place.
    if (this.syncing || this.syncTimeout !== undefined) {
      this.pendingSyncIndex = target;
    }

    this.dispatchInternal({
      type: 'SET_INDEX',
      payload: target,
    });
  }

  moveItem(fromIndex: number, toIndex: number) {
    const length = this.rawItems.length;
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= length ||
      toIndex > length
    ) {
      return;
    }

    this.revision += 1;
    this.dispatchInternal({
      type: 'MOVE_ITEM',
      payload: {
        fromIndex,
        toIndex,
      },
    });
    this._videoList = moveVideoData(this._videoList, fromIndex, toIndex);
    this.reconcileVideoList();
    this.afterMutation();
  }

  clear() {
    // A queued or in-flight sync belongs to the queue being cleared: never let
    // it repopulate the new one.
    this.generation += 1;
    this.syncToken += 1;
    clearTimeout(this.syncTimeout);
    this.syncTimeout = undefined;

    this.requestedIndex = undefined;
    this.pendingSyncIndex = undefined;
    this.cachedSelectedIndex = undefined;
    this._videoList = [];

    this.dispatchInternal({
      type: 'CLEAR',
    });
  }

  on(listener: QueueEventListener) {
    if (!this.listeners.includes(listener)) {
      this.listeners.push(listener);
    }
  }

  off(listener: QueueEventListener) {
    this.listeners = this.listeners.filter((it) => it !== listener);
  }

  rollbackInjection() {
    if (!this.queue) {
      console.error('Queue is not initialized!');
      return;
    }

    clearTimeout(this.syncTimeout);
    this.syncTimeout = undefined;
    this.syncToken += 1;
    this.cachedSelectedIndex = undefined;
    // A latch left by a swallowed CLEAR must not survive a plugin restart on
    // the same Queue instance (the instance is constructed once).
    this.ignoreFlag = false;

    if (!this.originalDispatch) return;

    this.queue.queue.store.store.dispatch = this
      .originalDispatch as Store['dispatch'];
    this.originalDispatch = undefined;
  }

  injection() {
    if (!this.queue) {
      console.error('Queue is not initialized!');
      return;
    }

    // Re-enabling the plugin must not wrap the already-wrapped dispatch: the
    // second wrap would capture the first as "original" and broadcast twice.
    if (this.originalDispatch) return;

    this.cachedSelectedIndex = undefined;
    this.originalDispatch = this.queue.queue.store.store.dispatch;
    this.queue.queue.store.store.dispatch = (event) => {
      // Selection can change through any queue dispatch.
      this.cachedSelectedIndex = undefined;

      if (!this.queue || !this.owner) {
        console.error('Queue is not initialized!');
        return;
      }

      if (this.internalDispatch === 0) {
        if (event.type === 'UPDATE_ITEMS') {
          // A full replacement after the swallowed CLEAR means the fresh
          // playlist window is over: the next ADD_ITEMS is an ordinary edit,
          // not the playlist that replaces the cleared queue.
          this.ignoreFlag = false;
        }
        if (event.type === 'CLEAR') {
          this.ignoreFlag = true;
          this.broadcast({
            type: 'CLEAR_QUEUE',
            payload: null,
          });
          return;
        }
        if (event.type === 'ADD_ITEMS') {
          const payload = event.payload as {
            items?: QueueItem[] | undefined;
            index?: number;
          };
          const videoList = mapQueueItem(
            (it) =>
              ({
                videoId: it?.videoId ?? '',
                ownerId: this.owner!.id,
              }) satisfies VideoData,
            payload.items ?? [],
          ).filter((it) => it.videoId);

          if (!videoList.length) return;

          if (this.ignoreFlag) {
            // A fresh playlist: the queue was cleared right before this
            // dispatch, so the rows start at the top and playback starts there.
            this.ignoreFlag = false;
            this.broadcast({
              type: 'ADD_SONGS',
              payload: {
                videoList,
              },
              after: [
                {
                  type: 'SET_INDEX',
                  payload: {
                    index: 0,
                  },
                },
              ],
            });
            return;
          }

          // One row is "play next"/"add to queue", several rows are an album
          // or playlist added from a menu; both insert at `index`.
          this.broadcast({
            type: 'ADD_SONGS',
            payload: {
              index: Object.hasOwn(payload, 'index')
                ? payload.index
                : undefined,
              videoList,
            },
          });
          return;
        }

        if (event.type === 'MOVE_ITEM') {
          this.broadcast({
            type: 'MOVE_SONG',
            payload: {
              fromIndex: (
                event.payload as {
                  fromIndex: number;
                }
              ).fromIndex,
              toIndex: (
                event.payload as {
                  toIndex: number;
                }
              ).toIndex,
            },
          });
          return;
        }
        if (event.type === 'REMOVE_ITEM') {
          this.broadcast({
            type: 'REMOVE_SONG',
            payload: {
              index: event.payload as number,
            },
          });
          return;
        }
        if (event.type === 'SET_INDEX') {
          this.broadcast({
            type: 'SYNC_PROGRESS',
            payload: {
              index: event.payload as number,
            },
          });
          return;
        }

        if (event.type === 'SET_HEADER') event.payload = getHeaderPayload();
        if (event.type === 'ADD_STEERING_CHIPS') {
          event.type = 'CLEAR_STEERING_CHIPS';
          event.payload = undefined;
        }
        if (event.type === 'SET_PLAYER_UI_STATE') {
          if (
            (event.payload as string) === 'INACTIVE' &&
            this.rawItems.length > 0
          ) {
            return;
          }
        }
        if (event.type === 'HAS_SHOWN_AUTOPLAY') return;
        if (event.type === 'ADD_AUTOMIX_ITEMS') return;
      }

      /* oxlint-disable typescript/no-misused-spread */
      const fakeContext = {
        ...this.queue,
        queue: {
          ...this.queue.queue,
          store: {
            ...this.queue.queue.store,
            dispatch: this.originalDispatch,
          },
        },
      };
      /* oxlint-enable typescript/no-misused-spread */
      this.originalDispatch?.call(
        fakeContext,
        event as {
          type: string;
          payload?: { items?: QueueItem[] | undefined } | undefined;
        },
      );
    };
  }

  /* sync */
  initQueue() {
    if (!this.queue) return;

    this.internalDispatch += 1;
    try {
      this.queue.dispatch({
        type: 'HAS_SHOWN_AUTOPLAY',
        payload: false,
      });
      this.queue.dispatch({
        type: 'SET_HEADER',
        payload: getHeaderPayload(),
      });
      this.queue.dispatch({
        type: 'CLEAR_STEERING_CHIPS',
      });
    } finally {
      this.internalDispatch -= 1;
    }
  }

  async syncVideo() {
    return this.serialize(() => this.replaceQueue()).catch((error: unknown) => {
      console.warn('Music Together: queue sync failed', error);
      return false;
    });
  }

  /**
   * Replaces the whole queue with the one the host rendered. The store keeps
   * the `selected` flags on the rows it replaces, so the current row has to be
   * restored explicitly afterwards - otherwise YouTube Music loses its
   * "current item" and the player stalls on the next transition.
   */
  private async replaceQueue() {
    const token = this.syncToken;
    const generation = this.generation;
    const revision = this.revision;
    const videoIds = this._videoList.map((it) => it.videoId).filter(Boolean);
    if (!videoIds.length) {
      this.pendingSyncIndex = undefined;
      return false;
    }

    // A sync that never rebuilt the queue must not leave an index behind for a
    // later, unrelated replacement. A newer sync may still consume it.
    const abort = () => {
      if (token === this.syncToken) this.pendingSyncIndex = undefined;
      return false;
    };

    // An index can arrive while this fetch is in flight; keep it until the
    // rebuilt rows are in place (see `setIndex`).
    this.syncing = true;
    let selectedVideoId: string | undefined;

    try {
      const response = await getMusicQueueRenderer(videoIds);
      if (
        !response ||
        generation !== this.generation ||
        revision !== this.revision
      ) {
        return abort();
      }
      if (token !== this.syncToken) return false;

      const items = response.queueDatas
        .map((it) => it?.content)
        .filter(Boolean);
      if (!items.length) return abort();

      selectedVideoId = queueEntries(this.rawItems).find(
        (entry) => entry?.selected,
      )?.videoId;

      this.dispatchInternal({
        type: 'UPDATE_ITEMS',
        payload: {
          items,
          nextQueueItemId:
            this.queue.queue.store.store.getState().queue.nextQueueItemId,
          shouldAssignIds: true,
          currentIndex: -1,
        },
      });
      this.reconcileVideoList();
    } finally {
      this.syncing = false;
    }

    this.restoreSelection(selectedVideoId);
    this.afterMutation();

    return true;
  }

  /** Re-selects the current row after an `UPDATE_ITEMS` replacement. */
  private restoreSelection(videoId?: string) {
    const items = this.rawItems;
    const pending = this.pendingSyncIndex;
    this.pendingSyncIndex = undefined;

    if (!items.length) return;

    // A peer's index for the rebuilt queue wins over the row this peer had
    // selected while its old (possibly incomplete) queue was still rendered.
    if (typeof pending === 'number') {
      this.setIndex(pending);
      return;
    }

    if (selectedQueueIndex(items) >= 0) return;

    const byVideoId = videoId ? indexOfQueueVideoId(items, videoId) : -1;
    if (byVideoId >= 0) {
      this.setIndex(byVideoId);
      return;
    }

    if (typeof this.requestedIndex === 'number') {
      this.setIndex(this.requestedIndex);
    }
  }

  syncQueueOwner() {
    if (this.ownerFrame !== undefined) return;

    this.ownerFrame = requestAnimationFrame(() => {
      this.ownerFrame = undefined;
      this.patchQueueOwner();
    });
  }

  private patchQueueOwner() {
    const allQueue = document.querySelectorAll('#queue');

    allQueue.forEach((queue) => {
      const list = Array.from(
        queue?.querySelectorAll<HTMLElement>(
          '#contents > ytmusic-player-queue-item,#contents > ytmusic-playlist-panel-video-wrapper-renderer > #primary-renderer > ytmusic-player-queue-item',
        ) ?? [],
      );

      list.forEach((item, index: number | undefined) => {
        if (typeof index !== 'number') return;

        const id = this._videoList[index]?.ownerId;
        let data = this.getProfile(id);

        const nameText =
          data?.name ?? t('plugins.music-together.internal.unknown-user');

        if (!data?.name && !data?.handleId) {
          data = getDefaultProfile(data?.id ?? '');
        }

        // Rows keep their identity across renders; only rewrite a row whose
        // owner data (or position) actually changed.
        const signature = [
          index,
          id,
          nameText,
          data?.id,
          data?.name,
          data?.thumbnail,
          data?.handleId,
        ].join('\u0000');
        if (this.ownerSignatures.get(item) === signature) return;
        this.ownerSignatures.set(item, signature);

        const profile =
          item.querySelector<HTMLImageElement>('.music-together-owner') ??
          document.createElement('img');
        profile.classList.add('music-together-owner');
        profile.dataset.id = id;
        profile.dataset.index = index.toString();

        const name =
          item.querySelector<HTMLElement>('.music-together-name') ??
          document.createElement('div');
        name.classList.add('music-together-name');
        name.textContent = nameText;

        if (data) {
          profile.dataset.thumbnail = data.thumbnail ?? '';
          profile.dataset.name = data.name ?? '';
          profile.dataset.handleId = data.handleId ?? '';
          profile.dataset.id = data.id ?? '';

          profile.src = data.thumbnail ?? '';
          profile.title = data.name ?? '';
          profile.alt = data.handleId ?? '';
        }

        if (!profile.isConnected) item.append(profile);
        if (!name.isConnected) item.append(name);
      });
    });
  }

  removeQueueOwner() {
    if (this.ownerFrame !== undefined) {
      cancelAnimationFrame(this.ownerFrame);
      this.ownerFrame = undefined;
    }
    // Markers are gone, so a later sync must write every row again.
    this.ownerSignatures = new WeakMap();

    const allQueue = document.querySelectorAll('#queue');

    allQueue.forEach((queue) => {
      const list = Array.from(
        queue?.querySelectorAll<HTMLElement>('ytmusic-player-queue-item') ?? [],
      );

      list.forEach((item) => {
        const profile = item.querySelector<HTMLImageElement>(
          '.music-together-owner',
        );
        const name = item.querySelector<HTMLElement>('.music-together-name');
        profile?.remove();
        name?.remove();
      });
    });
  }

  private broadcast(event: ConnectionEventUnion) {
    this.listeners.forEach((listener) => listener(event));
  }
}
