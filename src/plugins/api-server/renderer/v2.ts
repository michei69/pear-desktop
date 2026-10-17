import {
  buildSongInfo,
  resolveScrobbleOptions,
  type ScrobbleOptions,
} from '@/providers/song-info-data';
import {
  PageType,
  type ItemPlaylistPanelVideoRenderer,
  type MusicCardShelfRenderer,
  type MusicResponsiveListItemRenderer,
  type QueueItem,
  type RepeatMode,
  type Response,
  type SectionListRendererContent,
  type ThumbnailDetailsClass,
  type ThumbnailElement,
} from '@/types/datahost-get-state';
import { type AppAPI } from '@/types/queue';
import { type SearchBoxElement } from '@/types/search-box-element';
import { clamp } from '@/utils/math';
import { parseByline, queueRenderer } from '@/utils/queue';

import { getLyricsReply } from './lyrics-reply';

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
export type SearchResult = {
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
export type QueueItemResult = {
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

/** Autoplay entries, which the queue store keeps outside its `items`. */
type AutoplayReply = {
  items?: QueueItemResult[];
  continuation?: string;
};

/** A text node in a browse renderer: `runs`, `simpleText`, or both. */
type BrowseText = { runs?: { text?: string }[]; simpleText?: string };

/** A browse header, whichever flavour the page uses. */
type BrowseHeaderRenderer = {
  title?: BrowseText;
  subtitle?: BrowseText;
  description?: BrowseText;
  straplineTextOne?: BrowseText;
  thumbnail?: {
    musicThumbnailRenderer?: { thumbnail?: ThumbnailDetailsClass };
    croppedSquareThumbnailRenderer?: { thumbnail?: ThumbnailDetailsClass };
  };
};

/** A two-row item: an album, playlist or artist card in a shelf. */
type MusicTwoRowItemRenderer = {
  title?: BrowseText;
  subtitle?: { runs?: BylineRun[] };
  thumbnailRenderer?: {
    musicThumbnailRenderer?: { thumbnail?: ThumbnailDetailsClass };
  };
  navigationEndpoint?: {
    watchEndpoint?: { videoId?: string };
    browseEndpoint?: { browseId?: string };
  };
};

/** The queue reply `GET /queue` returns. */
export type QueueReply = {
  autoplay?: boolean;
  isInfinite?: boolean;
  items?: QueueItemResult[];
  nextQueueItemId?: string;
  playbackContentMode?: string;
  repeatMode?: RepeatMode;
  currentPlayingItemId?: number;
  shuffleEnabled?: boolean;
  continuation?: string;
};

/** The curated page `browse` answers with. */
type BrowseReply = {
  browseId: string | null;
  title?: string;
  subtitle?: string;
  description?: string;
  thumbnail?: string;
  thumbnails?: ThumbnailElement[];
  results: SearchResult[];
  continuation?: string;
};

/** A JSON object, as read when walking an untyped YouTube Music response. */
type JsonObject = { [key: string]: unknown };

/** A run made only of separators (` • `, `, `, ` & `) names nothing. */
const bylineSeparator = /^[^\p{L}\p{N}]+$/u;

/**
 * Byline runs that read as metadata rather than a name: counts, dates,
 * durations, ages and profile handles. Loose on purpose — real channels are
 * called "50 Cent" or "The Dev Show - Interviews".
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

/** The like button, where the current song's like state lives. */
const getLikeButtonRenderer = () =>
  document.querySelector<
    HTMLElement & {
      updateLikeStatus: (status: LikeStatus) => void;
      likeStatus: string;
    }
  >('#like-button-renderer');

/** Every size a thumbnail block carries, absent when it carries none. */
const thumbnailSizes = (details?: ThumbnailDetailsClass) =>
  details?.thumbnails?.length ? details.thumbnails : undefined;

/** The largest of a renderer's thumbnails. */
const thumbnailUrl = (thumbnails?: ThumbnailElement[]) =>
  thumbnails?.at(-1)?.url;

/**
 * The queue position of the entry playing `videoId`, or -1 when no entry does.
 * Never `findIndex(...) || -1`: a match at index 0 would read as "not found".
 */
const queueIndexOfVideo = (items: QueueItem[] | undefined, videoId: string) =>
  items?.findIndex((item) => queueRenderer(item)?.videoId === videoId) ?? -1;

/**
 * A queue entry, read out of its raw playlist panel renderer. `index` is the
 * item's position in the raw queue, which is what the move, remove and
 * set-index endpoints take.
 */
const queueItem = (
  renderer: ItemPlaylistPanelVideoRenderer,
  index: number,
  raw: boolean,
): QueueItemResult | undefined => {
  const { videoId } = renderer;
  // An item with no video id cannot be played, so it is not an entry.
  if (!videoId) return undefined;

  const { artist, album, year } = parseByline(renderer.longBylineText?.runs);
  const thumbnails = thumbnailSizes(renderer.thumbnail);

  return {
    videoId,
    title: renderer.title?.runs?.map((run) => run.text).join(''),
    artist,
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

/** Every browse result id opens either a playlist page or a browse page. */
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
 * The credited entities in the runs a byline has left after its type label. A
 * linked run credits whoever it opens — artist, channel or show — but a filtered
 * search also links the album, so the page type decides. An unlinked run is a
 * name unless it reads as metadata.
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
 * `MPED<videoId>` browse id.
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
 * subtitle is a list of artists with no type label, and a lone run cannot carry
 * one either.
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

/** A search response's results, from its catalog tab only. */
const searchResults = (result: Response) => {
  const tabs = result?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
  const sections =
    tabs.find(
      (tab) => tab.tabRenderer?.tabIdentifier === 'music_search_catalog',
    )?.tabRenderer.content?.sectionListRenderer?.contents ?? [];

  // A result with no id would have no URL, so it is not a result.
  return sections
    .flatMap(sectionResults)
    .filter((item) => item.videoId || item.browseId);
};

/** Maps raw queue-style items to the reply shape, skipping unplayable ones. */
const queueItems = (items: QueueItem[] | undefined, raw: boolean) =>
  items?.flatMap((item, index) => {
    const renderer = queueRenderer(item);
    const mapped = renderer && queueItem(renderer, index, raw);
    return mapped ? [mapped] : [];
  });

/** The text of a browse text node. */
const browseText = (node?: BrowseText) =>
  node?.simpleText ??
  node?.runs?.map((run) => run.text ?? '').join('') ??
  undefined;

/** A browse header, flattened to the fields a client needs. */
const browseHeader = (
  node: JsonObject,
):
  | Pick<
      BrowseReply,
      'title' | 'subtitle' | 'description' | 'thumbnail' | 'thumbnails'
    >
  | undefined => {
  const header = (node.musicResponsiveHeaderRenderer ??
    node.musicDetailHeaderRenderer ??
    node.musicImmersiveHeaderRenderer ??
    node.musicVisualHeaderRenderer) as BrowseHeaderRenderer | undefined;
  if (!header?.title) return undefined;

  const thumbnails = thumbnailSizes(
    header.thumbnail?.musicThumbnailRenderer?.thumbnail ??
      header.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail,
  );

  return {
    title: browseText(header.title),
    subtitle:
      browseText(header.subtitle) ?? browseText(header.straplineTextOne),
    description: browseText(header.description),
    thumbnail: thumbnailUrl(thumbnails),
    ...(thumbnails && { thumbnails }),
  };
};

/** A two-row item (album, playlist or artist card) as one search-shaped result. */
const twoRowResult = (item: MusicTwoRowItemRenderer): SearchResult => {
  const subtitle = item.subtitle?.runs ?? [];
  const labelled = subtitle.length > 1 && !subtitle[0]?.navigationEndpoint;
  const thumbnails = thumbnailSizes(
    item.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail,
  );
  const videoId = item.navigationEndpoint?.watchEndpoint?.videoId;
  const browseId = item.navigationEndpoint?.browseEndpoint?.browseId;

  return {
    title: browseText(item.title),
    type: labelled ? subtitle[0]?.text : undefined,
    artist: bylineArtists(subtitle.slice(labelled ? 1 : 0)),
    thumbnail: thumbnailUrl(thumbnails),
    ...(thumbnails && { thumbnails }),
    ...searchResultIds(videoId, videoId ? undefined : browseId),
  };
};

/** The next page token a continuations array carries, if any. */
const continuationToken = (continuations?: unknown) => {
  const list = continuations as
    | {
        nextRadioContinuationData?: { continuation?: string };
        nextContinuationData?: { continuation?: string };
      }[]
    | undefined;

  for (const entry of list ?? []) {
    const token =
      entry.nextRadioContinuationData?.continuation ??
      entry.nextContinuationData?.continuation;
    if (token) return token;
  }
  return undefined;
};

/** Visits every object in a JSON tree, depth first, in response order. */
const walkJson = (node: unknown, visit: (object: JsonObject) => void) => {
  if (Array.isArray(node)) {
    for (const entry of node) walkJson(entry, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;

  const object = node as JsonObject;
  visit(object);
  for (const value of Object.values(object)) walkJson(value, visit);
};

/**
 * Flattens an untyped browse response: its header, every item renderer it
 * carries (rows, cards and two-row shelf items) and its continuation token.
 */
const browseContent = (
  response: unknown,
  browseId: string | null,
): BrowseReply => {
  const results: SearchResult[] = [];
  let header: ReturnType<typeof browseHeader>;
  let continuation: string | undefined;

  walkJson(response, (node) => {
    const row = node.musicResponsiveListItemRenderer as
      | MusicResponsiveListItemRenderer
      | undefined;
    if (row) results.push(rowResult(row));

    const card = node.musicCardShelfRenderer as
      | MusicCardShelfRenderer
      | undefined;
    if (card) results.push(cardResult(card));

    const twoRow = node.musicTwoRowItemRenderer as
      | MusicTwoRowItemRenderer
      | undefined;
    if (twoRow) results.push(twoRowResult(twoRow));

    header ??= browseHeader(node);
    continuation ??= continuationToken([node]);
  });

  return {
    browseId,
    ...(header ?? {}),
    results,
    ...(continuation && { continuation }),
  };
};

/**
 * v2's renderer half: the listeners that answer the API server's backend on the
 * `peard-api:` channels declared in `channels.ts`. `registerV2` wires every
 * action to the player API and returns a disposer that removes exactly the
 * listeners it registered.
 */
export const registerV2 = (
  api: MusicPlayer,
  context: RendererContext<PluginConfig>,
): (() => void) => {
  const app = document.querySelector<HTMLElement & AppAPI>('ytmusic-app');
  const getState = app?.ytmusicReduxBehavior.store.store.getState;
  const getQueue = () => getState?.().queue;

  /** Answers a getter on its matching reply channel. */
  const reply = (action: ApiAction, payload: unknown) => {
    context.ipc.send(apiReply(action), payload);
  };

  const apiNextVideo = () => api.nextVideo();
  const apiPrevVideo = () => api.previousVideo();
  const apiPlay = () => api.playVideo();
  const apiPause = () => api.pauseVideo();
  const apiTogglePlaying = () => {
    if (api.getPlayerState() === 2) api.playVideo();
    else api.pauseVideo();
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
  const apiSetShuffle = (status = false) => {
    if (status != getQueue()?.shuffleEnabled) app?.queue.shuffle();
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
    const payload: QueueReply = {
      autoplay: data?.autoplay,
      isInfinite: data?.isInfinite,
      items: queueItems(data?.items, raw),
      nextQueueItemId: data?.nextQueueItemId?.toString(),
      playbackContentMode: data?.playbackContentMode,
      repeatMode: data?.repeatMode,
      currentPlayingItemId: data?.selectedItemIndex,
      shuffleEnabled: data?.shuffleEnabled,
      continuation: app?.queue.continuation,
    };
    reply(ApiActions.getQueue, payload);
  };

  /**
   * The autoplay entries, which the queue store keeps in `automixItems` rather
   * than `items`. A continuation asks `/next` for the next automix page.
   */
  const apiGetAutoplay = async (raw = false, continuation?: string) => {
    if (!app) return reply(ApiActions.getAutoplay, null);

    if (continuation) {
      try {
        const data = await app.networkManager.fetch<
          {
            continuationContents?: {
              playlistPanelContinuation?: {
                contents?: QueueItem[];
                continuations?: unknown;
              };
            };
          },
          { continuation: string }
        >('/next?prettyPrint=false', { continuation });
        const panel = data?.continuationContents?.playlistPanelContinuation;

        reply(ApiActions.getAutoplay, {
          items: queueItems(panel?.contents, raw),
          continuation: continuationToken(panel?.continuations),
        } satisfies AutoplayReply);
      } catch (error) {
        console.error('[api-server] autoplay continuation failed:', error);
        reply(ApiActions.getAutoplay, null);
      }
      return;
    }

    const data = getQueue();
    reply(ApiActions.getAutoplay, {
      items: queueItems(data?.automixItems as QueueItem[] | undefined, raw),
      continuation: app.queue.continuation,
    } satisfies AutoplayReply);
  };

  /**
   * Curated info for a YouTube Music browse page (album, playlist, artist, ...),
   * or its raw response with `raw`. A continuation asks for the next page.
   */
  const apiBrowse = async (
    browseId?: string,
    continuation?: string,
    raw = false,
  ) => {
    if (!app) return reply(ApiActions.browse, null);

    try {
      const data = await app.networkManager.fetch<
        unknown,
        { browseId?: string; continuation?: string }
      >(
        '/browse?prettyPrint=false',
        continuation ? { continuation } : { browseId },
      );

      reply(
        ApiActions.browse,
        raw ? data : browseContent(data, browseId ?? null),
      );
    } catch (error) {
      console.error('[api-server] browse failed:', error);
      reply(ApiActions.browse, null);
    }
  };

  /** The same reply `GET /video/lyrics` builds, from the shared helper. */
  const apiGetLyrics = async (videoId?: string) => {
    reply(ApiActions.getLyrics, await getLyricsReply(videoId));
  };

  /**
   * Translate a song into a caller-supplied language, for the API. `videoId`
   * asks about another video. `translateForLanguage` writes nothing to the UI,
   * and reports failures as data with a `reason` for the backend to turn into a
   * status.
   *
   * A null reply only means "nothing was attempted" (the plugin is off); a
   * thrown provider or cache failure is reported as data too, or the backend
   * would answer "plugin disabled" for a real failure.
   */
  const apiTranslateLyrics = async (language?: string, videoId?: string) => {
    let result: LanguageTranslationResult | null = null;

    try {
      if (
        typeof language === 'string' &&
        language.trim() &&
        (await window.mainConfig.plugins.isEnabled('synced-lyrics'))
      ) {
        const { translateForLanguage } =
          await import('@/plugins/synced-lyrics/renderer/translation-store');

        result = await translateForLanguage(language, videoId);
      }
    } catch (error) {
      console.error('[api-server] translateLyrics failed:', error);
      result = {
        provider: null,
        language: typeof language === 'string' ? language : '',
        lines: [],
        reason: 'provider-error',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    reply(ApiActions.translateLyrics, result);
  };

  const apiAddVideosToQueue = (
    videoIds: string[] = [],
    queueInsertPosition: QueueInsertPosition = 'INSERT_AFTER_CURRENT_VIDEO',
    playlistIds: string[] = [],
  ) => {
    const queue = getQueue();
    if (!app || !queue) return;
    if (!videoIds.length && !playlistIds.length) return;

    app.networkManager
      .fetch('/music/get_queue', {
        queueContextParams: queue.queueContextParams,
        queueInsertPosition,
        ...(videoIds.length && { videoIds }),
        ...(playlistIds.length && { playlistIds }),
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
                  ? queueItems.findIndex((it) => queueRenderer(it)?.selected) +
                      1 || queueItemsLength
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
  /**
   * A queue position from either an index or a video id. `-1` means the id is
   * not in the queue, and the action has to be dropped.
   */
  const queuePosition = (value: number | string) =>
    typeof value === 'string' && Number.isNaN(Number(value))
      ? queueIndexOfVideo(getQueue()?.items, value)
      : Number(value);

  const apiMoveVideoInQueue = (from: number | string, to: number | string) => {
    const fromIndex = queuePosition(from);
    const toIndex = queuePosition(to);
    if (fromIndex === -1 || toIndex === -1) return;

    app?.dispatch({ type: 'MOVE_ITEM', payload: { fromIndex, toIndex } });
  };
  const apiRemoveVideoFromQueue = (video: number | string) => {
    const index = queuePosition(video);
    if (index === -1) return;

    app?.dispatch({ type: 'REMOVE_ITEM', payload: index });
  };
  const apiSetQueueIndex = (video: number | string) => {
    const index = queuePosition(video);
    if (index === -1) return;

    app?.dispatch({ type: 'SET_INDEX', payload: index });
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
  /** Hands the video to the downloader plugin, which owns the download itself. */
  const apiDownloadVideo = (videoId: string) => {
    const url = `https://music.youtube.com/watch?v=${videoId}`;
    context.ipc
      .invoke('download-song', url)
      .catch((error: unknown) =>
        console.error('[api-server] download failed:', error),
      );
  };

  const apiSearch = (
    query: string,
    params?: string,
    continuation?: string,
    raw = false,
  ) => {
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
        reply(
          ApiActions.search,
          raw ? result : { query, results: searchResults(result) },
        );
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
    {
      channel: apiRequest(ApiActions.getPlaybackPosition),
      handler: apiGetPlaybackPosition,
    },
    { channel: apiRequest(ApiActions.getQueue), handler: apiGetQueue },
    {
      channel: apiRequest(ApiActions.getAutoplay),
      handler: apiGetAutoplay,
    },
    { channel: apiRequest(ApiActions.getLyrics), handler: apiGetLyrics },
    {
      channel: apiRequest(ApiActions.translateLyrics),
      handler: apiTranslateLyrics,
    },
    { channel: apiRequest(ApiActions.search), handler: apiSearch },
    { channel: apiRequest(ApiActions.browse), handler: apiBrowse },

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
    {
      channel: apiRequest(ApiActions.downloadVideo),
      handler: apiDownloadVideo,
    },
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
