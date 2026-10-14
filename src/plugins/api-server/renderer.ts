import { ipcRenderer } from 'electron';

import { cleanupName } from '@/providers/song-info';
import { type AppAPI } from '@/types/queue';
import { type SearchBoxElement } from '@/types/search-box-element';
import { createRenderer } from '@/utils';
import { clamp } from '@/utils/math';

export const renderer = createRenderer<{ teardown?: () => void }>({
    onPlayerApiReady(api) {
        this.teardown?.();
        const app = document.querySelector<HTMLElement & AppAPI>('ytmusic-app');
        const getState = app?.ytmusicReduxBehavior.store.getState;
        const getQueue = () => getState?.().queue;
        const getLikeButtonRenderer = () => document.querySelector<HTMLElement & { updateLikeStatus: (status: 'LIKE'|'DISLIKE'|'INDIFFERENT') => void, likeStatus: string }>('#like-button-renderer');

        const apiNextVideo = () => api.nextVideo();
        const apiPrevVideo = () => api.previousVideo();
        const apiPlay = () => api.playVideo();
        const apiPause = () => api.pauseVideo();
        const apiGetPlaying = () => {
            ipcRenderer.send('peard-api:reply-get-playing', api.getPlayerState() !== 2);
        };
        const apiSetPlaying = (_: unknown, state = true) => {
            if (state) api.playVideo();
            else api.pauseVideo();
        };
        const apiTogglePlaying = () => {
            if (api.getPlayerState() === 2) api.playVideo();
            else api.pauseVideo();
        };
        const apiGetPlaybackSpeed = () => {
            ipcRenderer.send('peard-api:reply-get-playback-speed', api.getPlaybackRate());
        };
        const apiSetPlaybackSpeed = (_: unknown, value = 1) => {
            api.setPlaybackRate(value);
        };
        const apiGetPlaybackPosition = (_: unknown, percentage = false) => {
            ipcRenderer.send('peard-api:reply-get-playback-position', percentage ? api.getProgressState().current/api.getProgressState().duration : api.getProgressState().current);  
        };
        const apiSeekTo = (_: unknown, t: number) => api?.seekTo(t);
        const apiSeekBy = (_: unknown, t: number) => api?.seekBy(t);
        const apiShuffle = () => app?.queue.shuffle();
        const apiGetShuffle = () => {
            ipcRenderer.send('peard-api:reply-get-shuffle', getQueue()?.shuffleEnabled);
        };
        const apiSetShuffle = (_: unknown, status = false) => {
            if (status != getQueue()?.shuffleEnabled)
                app?.queue.shuffle();
        };
        const apiGetVolume = () => {
            ipcRenderer.send('peard-api:reply-get-volume', api.getVolume());
        };
        const apiSetVolume = (_: unknown, v = 100) => {
            v = clamp(v, 0, 100);
            api.setVolume(v);

            // sync UI
            app?.dispatch({
                type: 'SET_VOLUME',
                payload: v,
            });
        };
        const apiGetMute = () => {
            ipcRenderer.send('peard-api:reply-get-mute', api.isMuted());
        };
        const apiSetMute = (_: unknown, status = false) => {
            if (status) api.mute();
            else api.unMute();
            
            // sync UI
            app?.dispatch({
                type: 'SET_MUTED',
                payload: status,
            });
        };
        const apiToggleMute = () => apiSetMute(null, !api.isMuted());
        const apiGetRepeat = () => {
            ipcRenderer.send('peard-api:get-repeat', getQueue()?.repeatMode);
        };
        const apiSetRepeat = (_: unknown, status: 'NONE'|'ALL'|'ONE' = 'NONE') => app?.dispatch({
                type: 'SET_REPEAT',
                payload: status,
            });
        const apiSwitchRepeat = () => {
            switch (getQueue()?.repeatMode) {
                case 'NONE':
                    return apiSetRepeat(null, 'ALL');
                case 'ALL':
                    return apiSetRepeat(null, 'ONE');
                default:
                    return apiSetRepeat(null, 'NONE');
            }
        };
        const apiGetCurrentVideoLikedStatus = () => {
            ipcRenderer.send('peard-api:reply-current-video-liked-status', getLikeButtonRenderer()?.likeStatus);
        };
        const apiSetCurrentVideoLikedStatus = (_: unknown, status: 'LIKE'|'DISLIKE'|'INDIFFERENT' = 'INDIFFERENT') => {
            getLikeButtonRenderer()?.updateLikeStatus(status);
        };
        const apiLikeCurrentVideo = () => getLikeButtonRenderer()?.updateLikeStatus('LIKE');
        const apiDislikeCurrentVideo = () => getLikeButtonRenderer()?.updateLikeStatus('DISLIKE');
        const apiUnlikeCurrentVideo = () => getLikeButtonRenderer()?.updateLikeStatus('INDIFFERENT');
        const apiGetQueue = () => {
            const data = getQueue();
            return {
                autoplay: data?.autoplay,
                isInfinite: data?.isInfinite,
                items: data?.items,
                nextQueueItemId: data?.nextQueueItemId,
                playbackContentMode: data?.playbackContentMode,
                repeatMode: data?.repeatMode,
                currentPlayingItemId: data?.selectedItemIndex,
                shuffleEnabled: data?.shuffleEnabled,
                continuation: app?.queue.continuation,
            };
        };
        const apiAddVideosToQueue = (_: unknown, videoIds: string[], queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO'|'INSERT_AT_END' = 'INSERT_AFTER_CURRENT_VIDEO') => {
            const queue = getQueue();
            if (!app || !queue || !videoIds) return;
            app.networkManager.fetch('/music/get_queue', {
                queueContextParams: queue.queueContextParams,
                queueInsertPosition,
                videoIds: videoIds,
            }).then((result) => {
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
                                        it.playlistPanelVideoWrapperRenderer
                                        ?.primaryRenderer.playlistPanelVideoRenderer
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
        const apiAddVideoToQueue = (_: unknown, videoId: string, queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO'|'INSERT_AT_END') => 
            apiAddVideosToQueue(_, [videoId], queueInsertPosition);
        const apiMoveVideoInQueue = (_: unknown, from: number|string, to: number|string) => {
            if (typeof from === 'string' && Number.isNaN(Number(from))) {
                // from is a video id
                from = getQueue()?.items.findIndex((v) => v.playlistPanelVideoRenderer?.videoId === from) || -1;
                if (from == -1) return;
            }
            if (typeof to === 'string' && Number.isNaN(Number(to))) {
                // to is a video id
                to = getQueue()?.items.findIndex((v) => v.playlistPanelVideoRenderer?.videoId === to) || -1;
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
        const apiRemoveVideoFromQueue = (_: unknown, video: number|string) => {
            if (typeof video === 'string' && Number.isNaN(Number(video))) {
                // from is a video id
                video = getQueue()?.items.findIndex((v) => v.playlistPanelVideoRenderer?.videoId === video) || -1;
                if (video == -1) return;
            }
            app?.dispatch({
                type: 'REMOVE_ITEM',
                payload: video,
            });
        };
        const apiSetQueueIndex = (_: unknown, video: number|string) => {
            if (typeof video === 'string' && Number.isNaN(Number(video))) {
                // from is a video id
                video = getQueue()?.items.findIndex((v) => v.playlistPanelVideoRenderer?.videoId === video) || -1;
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
        const apiSearch = (_: unknown, query: string, params?: string, continuation?: string) => {
            const searchBox = document.querySelector<SearchBoxElement>('ytmusic-search-box');
            if (!app || !searchBox) return;
            
            app.networkManager.fetch<
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
            }).then((result) => {
                ipcRenderer.send('peard-api:reply-search', result);
            });
        };

        // TODO: dont hardcode ts
        const MusicVideoTypeToMediaType = {
            'MUSIC_VIDEO_TYPE_ATV': 'AUDIO',
            'MUSIC_VIDEO_TYPE_OMV': 'ORIGINAL_MUSIC_VIDEO',
            'MUSIC_VIDEO_TYPE_UGC': 'USER_GENERATED_CONTENT',
            'MUSIC_VIDEO_TYPE_PODCAST_EPISODE': 'PODCAST_EPISODE',
        } as { [k: string]: string };
        const apiGetCurrentVideo = () => {
            // TODO: unify this with scrobbler and songinfo
            // TODO: make this a separate function for future ws v2
            const { microformat: { microformatDataRenderer: mf }, videoDetails } = api.getPlayerResponse();

            return {
                title: cleanupName(videoDetails.title),
                alternativeTitle: cleanupName(mf.linkAlternates.find((a) => a.title)?.title ?? videoDetails.title),
                artist: cleanupName(
                    videoDetails.musicVideoType === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE' ?
                    mf.pageOwnerDetails.name :
                    videoDetails.author,
                ),
                album: videoDetails.album ?? null,
                views: Number(videoDetails.viewCount),
                duration: Number(videoDetails.lengthSeconds),
                videoId: videoDetails.videoId,
                uploadDate: mf.uploadDate,
                url: mf.urlCanonical.split('&')[0],
                playlistId: URL.parse(mf.urlCanonical)?.searchParams?.get('list') ?? null,
                artistUrl: mf.pageOwnerDetails?.externalChannelId ? `https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/channel/${mf.pageOwnerDetails.externalChannelId}` : null,
                tags: Array.isArray(mf.tags) ? mf.tags : [],
                mediaType: videoDetails.musicVideoType in MusicVideoTypeToMediaType ? MusicVideoTypeToMediaType[videoDetails.musicVideoType] : 'OTHER_VIDEO',
                thumbnail: videoDetails.thumbnail?.thumbnails.at(-1)?.url.split('?')[0],
                // TODO: see if any more info
            };
        };
        // TODO: GET LYRICS
        // TODO: other app related functions

        // TODO: link to ipc, then link in backend
    },
});