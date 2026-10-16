import {
  hasLyricText,
  providerNames,
  type ProviderName,
  type ProviderState,
} from '@/plugins/synced-lyrics/providers';
import {
  type LineLyrics,
  type LyricResult,
} from '@/plugins/synced-lyrics/types';
import {
  buildSongInfo,
  resolveScrobbleOptions,
  type ScrobbleOptions,
} from '@/providers/song-info-data';
import {
  PageType,
  type ItemPlaylistPanelVideoRenderer,
  type LongBylineTextRun,
  type MusicCardShelfRenderer,
  type MusicResponsiveListItemRenderer,
  type QueueItem,
  type Response,
  type SectionListRendererContent,
  type ThumbnailDetailsClass,
  type ThumbnailElement,
} from '@/types/datahost-get-state';
import { type AppAPI } from '@/types/queue';
import { type SearchBoxElement } from '@/types/search-box-element';
import { clamp } from '@/utils/math';

import { ApiActions, apiReply, apiRequest, type ApiAction } from '../channels';

// Type-only, so it is erased: the module itself stays behind the dynamic import
// in `apiTranslateLyrics`, which must not evaluate it while the plugin is off.
import type { LanguageTranslationResult } from '@/plugins/synced-lyrics/renderer/translation-store';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { PluginConfig } from '@/types/plugins';

type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';
type QueueInsertPosition = 'INSERT_AFTER_CURRENT_VIDEO' | 'INSERT_AT_END';

/** One search result; exactly one of `videoId`/`browseId` is set. */
type SearchResult = {
  title?: string;
  artist?: string;
  type?: string;
  thumbnail?: string;
  thumbnails?: ThumbnailElement[];
  videoId?: string;
  browseId?: string;
  url?: string;
};

/** One queue item, mapped from its raw playlist panel renderer. */
type QueueItemResult = {
  videoId: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  duration?: string;
  thumbnails?: ThumbnailElement[];
  thumbnail?: string;
  url: string;
  selected: boolean;
  index: number;
  playlistSetVideoId?: string;
  canReorder: boolean;
  renderer?: ItemPlaylistPanelVideoRenderer;
};

/** One line of synced lyrics, minus the UI-only `status` field. */
type LyricsLine = Pick<LineLyrics, 'time' | 'timeInMs' | 'duration' | 'text'>;

/** One provider's lyrics for the current song. */
type LyricsProviderResult = {
  provider: ProviderName;
  state: ProviderState['state'];
  title: string;
  artists: string[];
  lyrics?: string;
  lines?: LyricsLine[];
  translation?: {
    lyrics?: string;
    lines?: LyricsLine[];
    language?: string;
    provider?: string;
  };
};

/** Every provider that found lyrics, plus the one the UI is showing. */
type LyricsReply = {
  videoId: string | null;
  activeProvider: ProviderName | null;
  providers: LyricsProviderResult[];
};

/** A byline run, whichever renderer the byline came from. */
type BylineRun = {
  text: string;
  navigationEndpoint?: {
    browseEndpoint?: {
      browseEndpointContextSupportedConfigs?: {
        browseEndpointContextMusicConfig?: { pageType?: PageType };
      };
    };
  };
};

/** A run made only of separators (` • `, `, `, ` & `) names nothing. */
const bylineSeparator = /^[^\p{L}\p{N}]+$/u;

/**
 * Byline runs that read as metadata rather than as a name: counts, dates,
 * durations, ages and profile handles. The patterns stay loose on purpose —
 * real channels are called "50 Cent" or "The Dev Show - Interviews".
 */
const bylineMetadata = [
  /^@/,
  /\p{N}+:\p{N}/u,
  /\b\d{4}\b/,
  // Episode bylines date themselves without a year: "Episode • Sep 25 • Show".
  /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \p{N}{1,2}$/iu,
  /^\p{N}+\s*(?:s|m|h|d|w|mo|y)\s+ago\b/iu,
  /\b(views|plays|subscribers|audience|songs|episodes)\b/i,
];

/** Page types that make a linked byline run the credited artist, channel or show. */
const creditedPageTypes = new Set<PageType>([
  PageType.MusicPageTypeArtist,
  PageType.MusicPageTypeUserChannel,
  PageType.MusicPageTypePodcastShowDetailPage,
]);

/** Episode rows carry a `MPED<videoId>` browse id instead of a video id. */
const episodeBrowsePrefix = 'MPED';

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
  const getState = app?.ytmusicReduxBehavior.store.store.getState;
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
  const apiGetQueue = (raw = false) => {
    const data = getQueue();
    reply(ApiActions.getQueue, {
      autoplay: data?.autoplay,
      isInfinite: data?.isInfinite,
      items: data?.items?.flatMap((item, index) => {
        const renderer = queueRenderer(item);
        const mapped = renderer && queueItem(renderer, index, raw);
        return mapped ? [mapped] : [];
      }),
      nextQueueItemId: data?.nextQueueItemId,
      playbackContentMode: data?.playbackContentMode,
      repeatMode: data?.repeatMode,
      currentPlayingItemId: data?.selectedItemIndex,
      shuffleEnabled: data?.shuffleEnabled,
      continuation: app?.queue.continuation,
    });
  };

  /** Synced lines as the API reports them: no UI-only `status` field. */
  const lyricLines = (lines?: LineLyrics[]) =>
    lines?.map(({ time, timeInMs, duration, text }) => ({
      time,
      timeInMs,
      duration,
      text,
    }));

  /** A provider's result, or nothing when it found no lyrics at all. */
  const lyricsProvider = (
    provider: ProviderName,
    state: ProviderState['state'],
    data: LyricResult | null,
  ): LyricsProviderResult | undefined => {
    if (!hasLyricText(data)) return undefined;

    const result = data as LyricResult;
    const translation = result.translation;
    // Only carry a translation that actually has something in it: the other
    // optional fields follow the same rule, so a client never sees an empty
    // object standing in for "no translation".
    const translationLines = lyricLines(translation?.lines);

    return {
      provider,
      state,
      title: result.title,
      artists: result.artists,
      ...(result.lyrics && { lyrics: result.lyrics }),
      ...(result.lines?.length && { lines: lyricLines(result.lines) }),
      ...((translationLines?.length || translation?.lyrics) && {
        translation: { ...translation, lines: translationLines },
      }),
    };
  };

  /**
   * Every provider's lyrics for the current song. The store is imported
   * dynamically on purpose: it has top-level Solid side effects, so with the
   * plugin off it must not be evaluated at all — and with it on, it is already
   * loaded and this returns the live store. Nothing here may throw before the
   * reply, because the backend gives up after 5s.
   */
  const apiGetLyrics = async () => {
    let lyrics: LyricsReply | null = null;

    try {
      if (await window.mainConfig.plugins.isEnabled('synced-lyrics')) {
        const store = await import('@/plugins/synced-lyrics/renderer/store');
        const videoId = store.currentLyricsVideoId();
        const states = await store.allProviderLyrics();

        lyrics = {
          videoId,
          activeProvider: videoId === null ? null : store.lyricsStore.provider,
          providers: providerNames.flatMap((provider) => {
            const state = states[provider];
            const entry =
              state && lyricsProvider(provider, state.state, state.data);

            return entry ? [entry] : [];
          }),
        };
      }
    } catch (error) {
      console.error('[api-server] getLyrics failed:', error);
    }

    reply(ApiActions.getLyrics, lyrics);
  };

  /**
   * Translate the current song into a caller-supplied language, for the API.
   * `translateForLanguage` writes nothing to the UI, so the lyrics the app shows
   * are unaffected. It reports failures as data with a `reason`, which the
   * backend turns into a status; this handler only has to pass it through
   * without throwing before the reply.
   */
  const apiTranslateLyrics = async (language?: string) => {
    let result: LanguageTranslationResult | null = null;

    try {
      if (
        typeof language === 'string' &&
        language.trim() &&
        (await window.mainConfig.plugins.isEnabled('synced-lyrics'))
      ) {
        const { translateForLanguage } =
          await import('@/plugins/synced-lyrics/renderer/translation-store');

        result = await translateForLanguage(language);
      }
    } catch (error) {
      console.error('[api-server] translateLyrics failed:', error);
    }

    reply(ApiActions.translateLyrics, result);
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
                          it?.playlistPanelVideoRenderer ??
                          it?.playlistPanelVideoWrapperRenderer?.primaryRenderer
                            ?.playlistPanelVideoRenderer
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
      from = queueIndexOfVideo(from);
      if (from == -1) return;
    }
    if (typeof to === 'string' && Number.isNaN(Number(to))) {
      // to is a video id
      to = queueIndexOfVideo(to);
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
      video = queueIndexOfVideo(video);
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
      video = queueIndexOfVideo(video);
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

  /** Every size a thumbnail block carries, absent when it carries none. */
  const thumbnailSizes = (details?: ThumbnailDetailsClass) =>
    details?.thumbnails?.length ? details.thumbnails : undefined;

  /** The largest of a renderer's thumbnails. */
  const thumbnailUrl = (thumbnails?: ThumbnailElement[]) =>
    thumbnails?.at(-1)?.url;

  /**
   * A queue entry's renderer: the item itself, or a wrapper's primary half. The
   * redux queue is runtime data, so a slot can hold `null`; one such entry must
   * not take every other item's reply down with it.
   */
  const queueRenderer = (item: QueueItem | null | undefined) =>
    item?.playlistPanelVideoRenderer ??
    item?.playlistPanelVideoWrapperRenderer?.primaryRenderer
      ?.playlistPanelVideoRenderer;

  /**
   * The queue position of the entry playing `videoId`, or -1 when no entry does.
   * The explicit `=== -1` test at the call sites matters: `findIndex(...) || -1`
   * turns a match at index 0 into "not found", so the first queue item could
   * never be addressed by id. Entries are read through `queueRenderer`, so a
   * wrapped item — which `/queue` reports as one entry carrying an id — is
   * addressable too.
   */
  const queueIndexOfVideo = (videoId: string) =>
    getQueue()?.items.findIndex(
      (item) => queueRenderer(item)?.videoId === videoId,
    ) ?? -1;

  /** The run that divides a queue byline: `artist • album • year`. */
  const bylineDivider = ' • ';

  /** A byline's parts, with the empty ones a stray divider leaves behind gone. */
  const bylineParts = (runs?: LongBylineTextRun[]) =>
    (runs ?? [])
      .map((run) => run.text)
      .join('')
      .split(bylineDivider)
      .map((part) => part.trim())
      .filter(Boolean);

  /** A byline part that reads as a release year. */
  const yearPattern = /^\d{4}$/;

  /**
   * A queue entry, read out of its raw playlist panel renderer. `index` is the
   * item's position in the raw queue — the index the move, remove and set-index
   * endpoints take — so a skipped item leaves a gap rather than shifting the
   * entries after it.
   */
  const queueItem = (
    renderer: ItemPlaylistPanelVideoRenderer,
    index: number,
    raw: boolean,
  ): QueueItemResult | undefined => {
    const { videoId } = renderer;
    // An item with no video id cannot be played, so it is not an entry.
    if (!videoId) return undefined;

    const parts = bylineParts(renderer.longBylineText?.runs);
    // `artist • album • year`, but a run after the year ("… • 2011 • Bonus
    // Track") must not hide it: the year is the last part that reads as one, and
    // the album is the first part after the artist that is not that year — so a
    // byline without an album ("Artist • 2011") does not credit the year as one.
    const year = parts.filter((part) => yearPattern.test(part)).at(-1);
    const album = parts.slice(1).find((part) => part !== year);
    const thumbnails = thumbnailSizes(renderer.thumbnail);

    return {
      videoId,
      title: renderer.title?.runs?.map((run) => run.text).join(''),
      artist: parts[0],
      album,
      year,
      duration: renderer.lengthText?.runs?.[0]?.text,
      ...(thumbnails && { thumbnails }),
      thumbnail: thumbnailUrl(thumbnails),
      url: `https://music.youtube.com/watch?v=${videoId}`,
      selected: renderer.selected,
      index,
      playlistSetVideoId: renderer.playlistSetVideoId,
      canReorder: renderer.canReorder,
      ...(raw && { renderer }),
    };
  };

  /** Every result id points at either a watch page or a browse page. */
  const searchResultUrl = (browseId: string) =>
    browseId.startsWith('VL')
      ? `https://music.youtube.com/playlist?list=${browseId.slice(2)}`
      : `https://music.youtube.com/browse/${browseId}`;
  const searchResultIds = (videoId?: string, browseId?: string) => {
    if (videoId) {
      return { videoId, url: `https://music.youtube.com/watch?v=${videoId}` };
    }
    if (browseId) return { browseId, url: searchResultUrl(browseId) };
    return {};
  };

  /**
   * The credited entities in the runs a byline has left after its type label.
   * A linked run credits whoever it opens — artist, channel or show — but a
   * filtered search also links the album title, so the page type decides. An
   * unlinked run is a name unless it reads as metadata (counts, dates,
   * durations, handles), which is how the endpoint-less credits survive.
   */
  const bylineArtists = (runs: BylineRun[]) =>
    runs
      .filter((run) => {
        if (bylineSeparator.test(run.text)) return false;
        const pageType =
          run.navigationEndpoint?.browseEndpoint
            ?.browseEndpointContextSupportedConfigs
            ?.browseEndpointContextMusicConfig?.pageType;
        if (pageType) return creditedPageTypes.has(pageType);
        return !bylineMetadata.some((pattern) => pattern.test(run.text));
      })
      .map((run) => run.text)
      .join(', ') || undefined;

  /**
   * A row's id: playable rows carry `playlistItemData`, rows that open a page
   * carry a row-level `navigationEndpoint`, and episode rows carry an
   * `MPED<videoId>` browse id. Rows never carry two of them.
   */
  const rowResult = (row: MusicResponsiveListItemRenderer): SearchResult => {
    const columns = row.flexColumns?.map(
      (column) =>
        column.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [],
    );
    // The byline leads with the type label, unless it opens with the channel.
    const byline = columns?.[1] ?? [];
    const labelled = !byline[0]?.navigationEndpoint;
    const firstRun = columns?.[0]?.[0]?.navigationEndpoint;
    const browseId =
      firstRun?.browseEndpoint?.browseId ??
      row.navigationEndpoint?.browseEndpoint?.browseId;
    const videoId =
      row.playlistItemData?.videoId ??
      firstRun?.watchEndpoint?.videoId ??
      row.navigationEndpoint?.watchEndpoint?.videoId ??
      (browseId?.startsWith(episodeBrowsePrefix)
        ? browseId.slice(episodeBrowsePrefix.length)
        : undefined);

    const thumbnails = thumbnailSizes(
      row.thumbnail?.musicThumbnailRenderer?.thumbnail,
    );

    return {
      title: columns?.[0]?.[0]?.text,
      type: labelled ? byline[0]?.text : undefined,
      artist: bylineArtists(byline.slice(labelled ? 1 : 0)),
      thumbnail: thumbnailUrl(thumbnails),
      ...(thumbnails && { thumbnails }),
      ...searchResultIds(videoId, videoId ? undefined : browseId),
    };
  };

  /**
   * The top-result card: the same fields, with its id on `onTap`. A radio card's
   * subtitle is a list of artists with no type label, and a lone run cannot
   * carry one either.
   */
  const cardResult = (card: MusicCardShelfRenderer): SearchResult => {
    const subtitle = card.subtitle?.runs ?? [];
    const labelled = subtitle.length > 1 && !subtitle[0]?.navigationEndpoint;
    const thumbnails = thumbnailSizes(
      card.thumbnail?.musicThumbnailRenderer?.thumbnail,
    );

    return {
      title: card.title?.runs?.[0]?.text,
      type: labelled ? subtitle[0]?.text : undefined,
      artist: bylineArtists(subtitle.slice(labelled ? 1 : 0)),
      thumbnail: thumbnailUrl(thumbnails),
      ...(thumbnails && { thumbnails }),
      ...searchResultIds(
        card.onTap?.watchEndpoint?.videoId,
        card.onTap?.browseEndpoint?.browseId,
      ),
    };
  };

  /** The rows a card's contents, a shelf or an item section carry. */
  const sectionRows = (
    section: SectionListRendererContent,
  ): { musicResponsiveListItemRenderer?: MusicResponsiveListItemRenderer }[] =>
    section.musicCardShelfRenderer?.contents ??
    section.musicShelfRenderer?.contents ??
    section.itemSectionRenderer?.contents ??
    [];

  /** A section's results: the top card itself, then the rows it holds. */
  const sectionResults = (
    section: SectionListRendererContent,
  ): SearchResult[] => {
    const card = section.musicCardShelfRenderer;
    const rows = sectionRows(section).flatMap((content) =>
      content.musicResponsiveListItemRenderer
        ? [rowResult(content.musicResponsiveListItemRenderer)]
        : [],
    );
    return card ? [cardResult(card), ...rows] : rows;
  };

  const apiSearch = (query: string, params?: string, continuation?: string) => {
    const searchBox =
      document.querySelector<SearchBoxElement>('ytmusic-search-box');
    if (!app || !searchBox) return;

    app.networkManager
      .fetch<
        Response,
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
        // The catalog tab is the only one; its sections mix item sections, one
        // shelf and the top-result card. Chip sections carry filters, not rows.
        const tabs = result?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
        const sections =
          tabs.find(
            (tab) => tab.tabRenderer?.tabIdentifier === 'music_search_catalog',
          )?.tabRenderer.content?.sectionListRenderer?.contents ?? [];

        reply(ApiActions.search, {
          query,
          // A result with no id would have no URL, so it is not a result.
          results: sections
            .flatMap(sectionResults)
            .filter((item) => item.videoId || item.browseId),
        });
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
    { channel: apiRequest(ApiActions.getLyrics), handler: apiGetLyrics },
    {
      channel: apiRequest(ApiActions.translateLyrics),
      handler: apiTranslateLyrics,
    },
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
