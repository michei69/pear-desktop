import {
  buildSongInfo,
  resolveScrobbleOptions,
  type ScrobbleOptions,
} from '@/providers/song-info-data';
import { type AppAPI } from '@/types/queue';
import { type SearchBoxElement } from '@/types/search-box-element';
import { clamp } from '@/utils/math';

import { ApiActions, apiReply, apiRequest, type ApiAction } from '../channels';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { PluginConfig } from '@/types/plugins';

type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';
type QueueInsertPosition = 'INSERT_AFTER_CURRENT_VIDEO' | 'INSERT_AT_END';

/**
 * v2's renderer half: the listeners that answer the API server's backend on the
 * `peard-api:` channels declared in `channels.ts`. `registerV2` wires every
 * action to the player API and returns the disposer that removes exactly the
 * listeners it registered, so the plugin can re-register against a new player
 * API and tear everything down on `stop`. A future v3 gets its own module next
 * to this one; v1 has no renderer half (see `../renderer.ts`).
 */
export const registerV2 = (
  api: MusicPlayer,
  context: RendererContext<PluginConfig>,
): (() => void) => {
  const app = document.querySelector<HTMLElement & AppAPI>('ytmusic-app');
  const getState = app?.ytmusicReduxBehavior.store.getState;
  const getQueue = () => getState?.().queue;
  const getLikeButtonRenderer = () =>
    document.querySelector<
      HTMLElement & {
        updateLikeStatus: (status: LikeStatus) => void;
        likeStatus: string;
      }
    >('#like-button-renderer');

  /** Answers a getter on its matching reply channel. */
  const reply = (action: ApiAction, payload: unknown) => {
    context.ipc.send(apiReply(action), payload);
  };

  const apiNextVideo = () => api.nextVideo();
  const apiPrevVideo = () => api.previousVideo();
  const apiPlay = () => api.playVideo();
  const apiPause = () => api.pauseVideo();
  const apiGetPlaying = () => {
    reply(ApiActions.getPlaying, api.getPlayerState() !== 2);
  };
  const apiTogglePlaying = () => {
    if (api.getPlayerState() === 2) api.playVideo();
    else api.pauseVideo();
  };
  const apiGetPlaybackSpeed = () => {
    reply(ApiActions.getPlaybackSpeed, api.getPlaybackRate());
  };
  const apiSetPlaybackSpeed = (value = 1) => {
    api.setPlaybackRate(value);
  };
  const apiGetPlaybackPosition = (percentage = false) => {
    const { current, duration } = api.getProgressState();
    // Without a duration (live, or before metadata loads) the fraction is 0,
    // not Infinity — which JSON.stringify would turn into null.
    reply(
      ApiActions.getPlaybackPosition,
      percentage ? (duration ? current / duration : 0) : current,
    );
  };
  const apiSeekTo = (t: number) => api.seekTo(t);
  const apiSeekBy = (t: number) => api.seekBy(t);
  const apiShuffle = () => app?.queue.shuffle();
  const apiGetShuffle = () => {
    reply(ApiActions.getShuffle, getQueue()?.shuffleEnabled);
  };
  const apiSetShuffle = (status = false) => {
    if (status != getQueue()?.shuffleEnabled) app?.queue.shuffle();
  };
  const apiGetVolume = () => {
    reply(ApiActions.getVolume, api.getVolume());
  };
  const apiSetVolume = (v = 100) => {
    v = clamp(v, 0, 100);
    api.setVolume(v);

    // sync UI
    app?.dispatch({
      type: 'SET_VOLUME',
      payload: v,
    });
  };
  const apiGetMute = () => {
    reply(ApiActions.getMute, api.isMuted());
  };
  const apiSetMute = (status = false) => {
    if (status) api.mute();
    else api.unMute();

    // sync UI
    app?.dispatch({
      type: 'SET_MUTED',
      payload: status,
    });
  };
  const apiToggleMute = () => apiSetMute(!api.isMuted());
  const apiGetRepeat = () => {
    reply(ApiActions.getRepeat, getQueue()?.repeatMode);
  };
  const apiSetRepeat = (status: 'NONE' | 'ALL' | 'ONE' = 'NONE') =>
    app?.dispatch({
      type: 'SET_REPEAT',
      payload: status,
    });
  const apiSwitchRepeat = () => {
    switch (getQueue()?.repeatMode) {
      case 'NONE':
        return apiSetRepeat('ALL');
      case 'ALL':
        return apiSetRepeat('ONE');
      default:
        return apiSetRepeat('NONE');
    }
  };
  const apiGetCurrentVideoLikedStatus = () => {
    reply(ApiActions.getLikeState, getLikeButtonRenderer()?.likeStatus);
  };
  const apiSetCurrentVideoLikedStatus = (
    status: LikeStatus = 'INDIFFERENT',
  ) => {
    getLikeButtonRenderer()?.updateLikeStatus(status);
  };
  const apiLikeCurrentVideo = () =>
    getLikeButtonRenderer()?.updateLikeStatus('LIKE');
  const apiDislikeCurrentVideo = () =>
    getLikeButtonRenderer()?.updateLikeStatus('DISLIKE');
  const apiUnlikeCurrentVideo = () =>
    getLikeButtonRenderer()?.updateLikeStatus('INDIFFERENT');
  const apiGetQueue = () => {
    const data = getQueue();
    reply(ApiActions.getQueue, {
      autoplay: data?.autoplay,
      isInfinite: data?.isInfinite,
      items: data?.items,
      nextQueueItemId: data?.nextQueueItemId,
      playbackContentMode: data?.playbackContentMode,
      repeatMode: data?.repeatMode,
      currentPlayingItemId: data?.selectedItemIndex,
      shuffleEnabled: data?.shuffleEnabled,
      continuation: app?.queue.continuation,
    });
  };
  const apiAddVideosToQueue = (
    videoIds: string[],
    queueInsertPosition: QueueInsertPosition = 'INSERT_AFTER_CURRENT_VIDEO',
  ) => {
    const queue = getQueue();
    if (!app || !queue || !videoIds) return;
    app.networkManager
      .fetch('/music/get_queue', {
        queueContextParams: queue.queueContextParams,
        queueInsertPosition,
        videoIds: videoIds,
      })
      .then((result) => {
        if (
          result &&
          typeof result === 'object' &&
          'queueDatas' in result &&
          Array.isArray(result.queueDatas)
        ) {
          const queueItems = queue.items;
          const queueItemsLength = queueItems.length ?? 0;
          app.dispatch({
            type: 'ADD_ITEMS',
            payload: {
              nextQueueItemId: queue.nextQueueItemId,
              index:
                queueInsertPosition === 'INSERT_AFTER_CURRENT_VIDEO'
                  ? queueItems.findIndex(
                      (it) =>
                        (
                          it.playlistPanelVideoRenderer ||
                          it.playlistPanelVideoWrapperRenderer?.primaryRenderer
                            .playlistPanelVideoRenderer
                        )?.selected,
                    ) + 1 || queueItemsLength
                  : queueItemsLength,
              items: result.queueDatas
                .map((it) =>
                  typeof it === 'object' && it && 'content' in it
                    ? it.content
                    : null,
                )
                .filter(Boolean),
              shuffleEnabled: queue.shuffleEnabled,
              shouldAssignIds: true,
            },
          });
        }
      });
  };
  const apiMoveVideoInQueue = (from: number | string, to: number | string) => {
    if (typeof from === 'string' && Number.isNaN(Number(from))) {
      // from is a video id
      from =
        getQueue()?.items.findIndex(
          (v) => v.playlistPanelVideoRenderer?.videoId === from,
        ) || -1;
      if (from == -1) return;
    }
    if (typeof to === 'string' && Number.isNaN(Number(to))) {
      // to is a video id
      to =
        getQueue()?.items.findIndex(
          (v) => v.playlistPanelVideoRenderer?.videoId === to,
        ) || -1;
      if (to == -1) return;
    }
    app?.dispatch({
      type: 'MOVE_ITEM',
      payload: {
        fromIndex: from,
        toIndex: to,
      },
    });
  };
  const apiRemoveVideoFromQueue = (video: number | string) => {
    if (typeof video === 'string' && Number.isNaN(Number(video))) {
      // from is a video id
      video =
        getQueue()?.items.findIndex(
          (v) => v.playlistPanelVideoRenderer?.videoId === video,
        ) || -1;
      if (video == -1) return;
    }
    app?.dispatch({
      type: 'REMOVE_ITEM',
      payload: video,
    });
  };
  const apiSetQueueIndex = (video: number | string) => {
    if (typeof video === 'string' && Number.isNaN(Number(video))) {
      // from is a video id
      video =
        getQueue()?.items.findIndex(
          (v) => v.playlistPanelVideoRenderer?.videoId === video,
        ) || -1;
      if (video == -1) return;
    }
    app?.dispatch({
      type: 'SET_INDEX',
      payload: video,
    });
  };
  const apiClearQueue = () => {
    app?.dispatch({
      type: 'SET_PLAYER_PAGE_INFO',
      payload: { open: false },
    });
    app?.dispatch({
      type: 'CLEAR',
    });
  };
  const apiSearch = (query: string, params?: string, continuation?: string) => {
    const searchBox =
      document.querySelector<SearchBoxElement>('ytmusic-search-box');
    if (!app || !searchBox) return;

    app.networkManager
      .fetch<
        unknown,
        {
          query: string;
          params?: string;
          continuation?: string;
          suggestStats?: unknown;
        }
      >('/search', {
        query,
        params,
        continuation,
        suggestStats: searchBox.getSearchboxStats(),
      })
      .then((result) => {
        reply(ApiActions.search, result);
      });
  };
  const apiGetCurrentVideo = () => {
    reply(
      ApiActions.getVideo,
      buildSongInfo(api.getPlayerResponse(), {
        ...resolveScrobbleOptions(
          window.mainConfig.get('plugins.scrobbler') as
            | ScrobbleOptions
            | undefined,
        ),
        usePodcastParticipantAsArtist: window.mainConfig.get(
          'options.usePodcastParticipantAsArtist',
        ),
      }),
    );
  };

  // One entry per action in `channels.ts`; the same list registers and
  // unregisters, so a listener can never outlive its registration.
  const listeners: { channel: string; handler: CallableFunction }[] = [
    { channel: apiRequest(ApiActions.getVideo), handler: apiGetCurrentVideo },
    { channel: apiRequest(ApiActions.getPlaying), handler: apiGetPlaying },
    {
      channel: apiRequest(ApiActions.getPlaybackSpeed),
      handler: apiGetPlaybackSpeed,
    },
    {
      channel: apiRequest(ApiActions.getPlaybackPosition),
      handler: apiGetPlaybackPosition,
    },
    { channel: apiRequest(ApiActions.getShuffle), handler: apiGetShuffle },
    { channel: apiRequest(ApiActions.getRepeat), handler: apiGetRepeat },
    { channel: apiRequest(ApiActions.getVolume), handler: apiGetVolume },
    { channel: apiRequest(ApiActions.getMute), handler: apiGetMute },
    {
      channel: apiRequest(ApiActions.getLikeState),
      handler: apiGetCurrentVideoLikedStatus,
    },
    { channel: apiRequest(ApiActions.getQueue), handler: apiGetQueue },
    { channel: apiRequest(ApiActions.search), handler: apiSearch },

    { channel: apiRequest(ApiActions.nextVideo), handler: apiNextVideo },
    { channel: apiRequest(ApiActions.previousVideo), handler: apiPrevVideo },
    { channel: apiRequest(ApiActions.play), handler: apiPlay },
    { channel: apiRequest(ApiActions.pause), handler: apiPause },
    { channel: apiRequest(ApiActions.togglePlay), handler: apiTogglePlaying },
    {
      channel: apiRequest(ApiActions.setPlaybackSpeed),
      handler: apiSetPlaybackSpeed,
    },
    { channel: apiRequest(ApiActions.seekTo), handler: apiSeekTo },
    { channel: apiRequest(ApiActions.seekBy), handler: apiSeekBy },
    { channel: apiRequest(ApiActions.shuffle), handler: apiShuffle },
    { channel: apiRequest(ApiActions.setShuffle), handler: apiSetShuffle },
    { channel: apiRequest(ApiActions.setRepeat), handler: apiSetRepeat },
    { channel: apiRequest(ApiActions.switchRepeat), handler: apiSwitchRepeat },
    { channel: apiRequest(ApiActions.setVolume), handler: apiSetVolume },
    { channel: apiRequest(ApiActions.setMute), handler: apiSetMute },
    { channel: apiRequest(ApiActions.toggleMute), handler: apiToggleMute },
    {
      channel: apiRequest(ApiActions.setLikeState),
      handler: apiSetCurrentVideoLikedStatus,
    },
    { channel: apiRequest(ApiActions.like), handler: apiLikeCurrentVideo },
    {
      channel: apiRequest(ApiActions.dislike),
      handler: apiDislikeCurrentVideo,
    },
    { channel: apiRequest(ApiActions.unlike), handler: apiUnlikeCurrentVideo },
    {
      channel: apiRequest(ApiActions.addToQueue),
      handler: apiAddVideosToQueue,
    },
    {
      channel: apiRequest(ApiActions.moveInQueue),
      handler: apiMoveVideoInQueue,
    },
    {
      channel: apiRequest(ApiActions.removeFromQueue),
      handler: apiRemoveVideoFromQueue,
    },
    {
      channel: apiRequest(ApiActions.setQueueIndex),
      handler: apiSetQueueIndex,
    },
    { channel: apiRequest(ApiActions.clearQueue), handler: apiClearQueue },
  ];

  for (const { channel, handler } of listeners) {
    context.ipc.on(channel, handler);
  }

  return () => {
    for (const { channel, handler } of listeners) {
      context.ipc.off(channel, handler);
    }
  };
};
