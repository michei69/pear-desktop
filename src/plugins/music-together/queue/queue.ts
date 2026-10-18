import { t } from '@/i18n';

import { getMusicQueueRenderer } from './song';
import { hasSameVideoIds, mapQueueItem } from './utils';

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

  private internalDispatch = false;
  private ignoreFlag = false;
  private listeners: QueueEventListener[] = [];

  private owner: Profile | null;
  private readonly getProfile: (id: string) => Profile | undefined;

  /** Set while a queued `syncVideo` fetch is waiting for the debounce. */
  private syncTimeout?: number;
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
    this.cachedSelectedIndex ??= mapQueueItem(
      (it) => it?.selected,
      this.queue.queue.store.store.getState().queue.items,
    ).findIndex(Boolean);

    return this.cachedSelectedIndex;
  }

  get rawItems() {
    return this.queue?.queue.store.store.getState().queue.items;
  }

  get flatItems() {
    return mapQueueItem((it) => it, this.rawItems);
  }

  setOwner(owner: Profile) {
    this.owner = owner;
  }

  /* public */
  setVideoList(videoList: VideoData[], sync = true) {
    const sameVideos = hasSameVideoIds(videoList, this._videoList);

    this._videoList = videoList;

    if (!sync) return;

    // A repeated full sync (the host re-sends on joins and permission
    // rejections) does not need another `/music/get_queue` fetch or re-render.
    if (sameVideos) {
      this.syncQueueOwner();
      return;
    }

    clearTimeout(this.syncTimeout);
    this.syncTimeout = window.setTimeout(async () => {
      this.syncTimeout = undefined;
      await this.syncVideo();
    }, SYNC_DEBOUNCE_MS);
  }

  async addVideos(videos: VideoData[], index?: number) {
    const response = await getMusicQueueRenderer(
      videos.map((it) => it.videoId),
    );
    if (!response) return false;

    const items = response.queueDatas.map((it) => it?.content).filter(Boolean);
    if (!items) return false;

    this.internalDispatch = true;
    this._videoList = this._videoList.map(
      (it) =>
        ({
          videoId: it.videoId,
          ownerId: it.ownerId ?? this.owner!.id,
        }) satisfies VideoData,
    );

    const state = this.queue.queue.store.store.getState();
    const indexToUse = index ?? this._videoList.length;

    this.queue?.dispatch({
      type: 'ADD_ITEMS',
      payload: {
        nextQueueItemId: state.queue.nextQueueItemId,
        // The queue store inserts before `index`; indexToUse is the plain
        // _videoList position.
        index: indexToUse,
        items,
        shuffleEnabled: false,
        shouldAssignIds: true,
      },
    });

    const insertedItem = this._videoList[indexToUse];
    if (
      !insertedItem ||
      (insertedItem.videoId !== videos[0].videoId &&
        insertedItem.ownerId !== videos[0].ownerId)
    ) {
      this._videoList.splice(
        indexToUse,
        0,
        ...videos.map((it) => ({
          ...it,
          ownerId: it.ownerId ?? this.owner?.id,
        })),
      );
    }

    this.internalDispatch = false;
    setTimeout(() => {
      this.initQueue();
      this.syncQueueOwner();
    }, 0);

    return true;
  }

  removeVideo(index: number) {
    this.internalDispatch = true;
    this._videoList.splice(index, 1);
    this.queue?.dispatch({
      type: 'REMOVE_ITEM',
      payload: index,
    });
    this.internalDispatch = false;
    setTimeout(() => {
      this.initQueue();
      this.syncQueueOwner();
    }, 0);
  }

  setIndex(index: number) {
    this.internalDispatch = true;
    this.queue?.dispatch({
      type: 'SET_INDEX',
      payload: index,
    });
    this.internalDispatch = false;
  }

  moveItem(fromIndex: number, toIndex: number) {
    this.internalDispatch = true;
    const data = this._videoList.splice(fromIndex, 1)[0];
    this._videoList.splice(toIndex, 0, data);
    this.queue?.dispatch({
      type: 'MOVE_ITEM',
      payload: {
        fromIndex,
        toIndex,
      },
    });
    this.internalDispatch = false;
    setTimeout(() => {
      this.initQueue();
      this.syncQueueOwner();
    }, 0);
  }

  clear() {
    this.internalDispatch = true;
    this._videoList = [];
    this.queue?.dispatch({
      type: 'CLEAR',
    });
    this.internalDispatch = false;
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
    this.cachedSelectedIndex = undefined;

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

      if (!this.internalDispatch) {
        if (event.type === 'CLEAR') {
          this.ignoreFlag = true;
          this.broadcast({
            type: 'CLEAR_QUEUE',
            payload: null,
          });
          return;
        }
        if (event.type === 'ADD_ITEMS') {
          if (this.ignoreFlag) {
            this.ignoreFlag = false;
            const videoList = mapQueueItem(
              (it) =>
                ({
                  videoId: it!.videoId,
                  ownerId: this.owner!.id,
                }) satisfies VideoData,
              (
                event.payload! as {
                  items: QueueItem[];
                }
              ).items,
            );
            const index = this._videoList.length;

            if (videoList.length > 0) {
              this._videoList = [
                ...videoList.map((it) => ({
                  ...it,
                  ownerId: it.ownerId ?? this.owner?.id,
                })),
              ];
              this.broadcast({
                // play
                type: 'ADD_SONGS',
                payload: {
                  videoList,
                },
                after: [
                  {
                    type: 'SET_INDEX',
                    payload: {
                      index,
                    },
                  },
                ],
              });
            }
          } else if (
            (
              event.payload as {
                items: unknown[];
              }
            ).items.length === 1
          ) {
            const videoList = mapQueueItem(
              (it) =>
                ({
                  videoId: it!.videoId,
                  ownerId: this.owner!.id,
                }) satisfies VideoData,
              (
                event.payload! as {
                  items: QueueItem[];
                }
              ).items,
            );
            this.broadcast({
              // add playlist
              type: 'ADD_SONGS',
              payload: {
                index:
                  event.payload && Object.hasOwn(event.payload, 'index')
                    ? (
                        event.payload as {
                          index: number;
                        }
                      ).index
                    : undefined,
                videoList,
              },
            });
            this._videoList.splice(
              event.payload && Object.hasOwn(event.payload, 'index')
                ? (
                    event.payload as {
                      index: number;
                    }
                  ).index
                : this._videoList.length,
              0,
              ...videoList.map((it) => ({
                ...it,
                ownerId: it.ownerId ?? this.owner?.id,
              })),
            );
          }

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
            this.videoList.length > 0
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

    this.internalDispatch = true;
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
    this.internalDispatch = false;
  }

  async syncVideo() {
    const response = await getMusicQueueRenderer(
      this._videoList.map((it) => it.videoId),
    );
    if (!response) return false;

    const items = response.queueDatas.map((it) => it.content);

    this.internalDispatch = true;
    this.queue?.dispatch({
      type: 'UPDATE_ITEMS',
      payload: {
        items: items,
        nextQueueItemId:
          this.queue.queue.store.store.getState().queue.nextQueueItemId,
        shouldAssignIds: true,
        currentIndex: -1,
      },
    });
    this.internalDispatch = false;
    setTimeout(() => {
      this.initQueue();
      this.syncQueueOwner();
    }, 0);

    return true;
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
