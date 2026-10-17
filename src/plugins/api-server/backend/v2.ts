import { OpenAPIHono, createRoute, type z } from '@hono/zod-openapi';

import * as config from '@/config';
import { isEnabled } from '@/config/plugins';
import { cacheEntriesForVideo } from '@/plugins/synced-lyrics/translation/cache';
import { getAppMeta } from '@/providers/app-meta';
import { getSongControls } from '@/providers/song-controls';

import { requireAuth } from './auth';
import { callRenderer, callRendererWithTimeout, sendToRenderer } from './ipc';
import {
  AddToQueueSchema,
  AppMetaSchema,
  AutoplayQuerySchema,
  AutoplaySchema,
  BrowseQuerySchema,
  BrowseRequestSchema,
  BrowseResponseSchema,
  ConfigSchema,
  DownloadVideoSchema,
  ErrorSchema,
  FeatureFlagDeleteSchema,
  FeatureFlagOverridesSchema,
  FeatureFlagsSchema,
  LikeStateSchema,
  LyricsQuerySchema,
  LyricsSchema,
  LyricsTranslationRequestSchema,
  LyricsTranslationSchema,
  LyricsTranslationsQuerySchema,
  LyricsTranslationsSchema,
  MoveInQueueSchema,
  MuteStateSchema,
  PlaybackPositionQuerySchema,
  PlaybackPositionSchema,
  PlaybackSpeedSchema,
  PlayingStateSchema,
  PlayVideoSchema,
  QueueIndexParamSchema,
  QueueQuerySchema,
  QueueSchema,
  RepeatModeSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  SearchSchema,
  SeekSchema,
  SetLikeStateSchema,
  SetMuteSchema,
  SetPlaybackSpeedSchema,
  SetQueueIndexSchema,
  SetRepeatSchema,
  SetShuffleSchema,
  SetVolumeSchema,
  ShuffleStateSchema,
  SongInfoSchema,
  VolumeSchema,
  type ResponseAutoplay,
  type ResponseBrowseRaw,
  type ResponseLyrics,
  type ResponseQueue,
  type ResponseSearch,
  type ResponseSongInfo,
} from './schemas-v2';
import { v2Tag } from './tags';
import { registerV2Websocket } from './websocket-v2';

import { ApiActions } from '../channels';

import type { APIServerConfig } from '../config';
import type { PlayerState } from './state';
import type { LanguageTranslationResult } from '@/plugins/synced-lyrics/renderer/translation-store';
import type { BackendContext } from '@/types/contexts';
import type { LikeType, RepeatMode } from '@/types/datahost-get-state';
import type { Context } from 'hono';

const SUCCESS = { 204: { description: 'Success' } };
const JSON_CONTENT = 'application/json';

const noContent = (ctx: Context) => ctx.body(null, 204);

/**
 * Translations run through a provider, and the local-cli one may take minutes,
 * so this action gets far more room than the renderer's default 5s.
 */
const TRANSLATION_TIMEOUT_MS = 120_000;

/** A non-2xx JSON response, so a client can parse failures like successes. */
const errorResponse = (description: string) => ({
  description,
  content: { [JSON_CONTENT]: { schema: ErrorSchema } },
});

const body = <S extends z.ZodType>(schema: S) => ({
  required: true,
  content: { [JSON_CONTENT]: { schema } },
});

/** A route that performs a player action and reports 204. */
const action = (
  method: 'post' | 'patch' | 'delete',
  path: string,
  summary: string,
  description: string,
  tags: string[],
) =>
  createRoute({
    method,
    path,
    summary,
    description,
    tags,
    responses: SUCCESS,
  });

/** A 204 route that also takes a JSON body. */
const actionWithBody = <S extends z.ZodType>(
  method: 'post' | 'patch' | 'delete',
  path: string,
  summary: string,
  description: string,
  schema: S,
  tags: string[],
) =>
  createRoute({
    method,
    path,
    summary,
    description,
    tags,
    request: { body: body(schema) },
    responses: SUCCESS,
  });

/** A GET route returning JSON, optionally 204 when there's nothing to report. */
const readable = <S extends z.ZodType>({
  path,
  summary,
  description,
  schema,
  emptyDescription,
  tags,
}: {
  path: string;
  summary: string;
  description: string;
  schema: S;
  emptyDescription?: string;
  tags: string[];
}) =>
  createRoute({
    method: 'get',
    path,
    summary,
    description,
    tags,
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema } },
      },
      ...(emptyDescription ? { 204: { description: emptyDescription } } : {}),
    },
  });

/** A GET route returning JSON, with validated query parameters. */
const readableWithQuery = <S extends z.ZodType, Q extends z.ZodObject>({
  path,
  summary,
  description,
  schema,
  query,
  emptyDescription,
  tags,
}: {
  path: string;
  summary: string;
  description: string;
  schema: S;
  query: Q;
  emptyDescription?: string;
  tags: string[];
}) =>
  createRoute({
    method: 'get',
    path,
    summary,
    description,
    tags,
    request: { query },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema } },
      },
      ...(emptyDescription ? { 204: { description: emptyDescription } } : {}),
    },
  });

export const routes = {
  // Video
  video: readable({
    path: '/video',
    summary: 'get current video info',
    description: 'Get the current video as the unified song info object',
    schema: SongInfoSchema,
    emptyDescription: 'No video playing',
    tags: [v2Tag('Video')],
  }),
  nextVideo: action(
    'post',
    '/video/next',
    'play next song',
    'Plays the next song in the queue',
    [v2Tag('Video')],
  ),
  previousVideo: action(
    'post',
    '/video/prev',
    'play previous song',
    'Plays the previous song in the queue',
    [v2Tag('Video')],
  ),
  previousVideoAlias: action(
    'post',
    '/video/previous',
    'play previous song',
    'Alias of `/video/prev`; plays the previous song in the queue',
    [v2Tag('Video')],
  ),
  playVideo: createRoute({
    method: 'post',
    path: '/video/play',
    summary: 'play a video',
    description: 'Replace the queue with the given video and play it',
    request: { body: body(PlayVideoSchema) },
    responses: SUCCESS,
    tags: [v2Tag('Video')],
  }),
  downloadVideo: createRoute({
    method: 'post',
    path: '/video/download',
    summary: 'download a video',
    description:
      'Download the current song, or `videoId`, with the downloader plugin. The plugin has to be enabled.',
    // Optional body: no `videoId` means the current song.
    request: { body: { ...body(DownloadVideoSchema), required: false } },
    responses: {
      204: { description: 'Success' },
      400: errorResponse('No video is playing and no `videoId` was given'),
      404: errorResponse('The downloader plugin is disabled'),
    },
    tags: [v2Tag('Video')],
  }),
  searchQuery: readableWithQuery({
    path: '/video/search',
    summary: 'search for a song',
    description: 'Search for a song and return its parsed results',
    schema: SearchResponseSchema,
    query: SearchQuerySchema,
    tags: [v2Tag('Video')],
  }),
  search: createRoute({
    method: 'post',
    path: '/video/search',
    summary: 'search for a song',
    description: 'Search for a song and return its parsed results',
    request: { body: body(SearchSchema) },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: SearchResponseSchema } },
      },
    },
    tags: [v2Tag('Video')],
  }),
  // QUERY (draft-ietf-httpbis-safe-method-w-body): a safe search that still
  // takes a body. Same body and handler as the POST above.
  searchByQueryMethod: createRoute({
    method: 'query',
    path: '/video/search',
    summary: 'search for a song',
    description:
      'Search for a song and return its parsed results. Safe: the same request as POST /video/search, without the side-effect semantics.',
    request: { body: body(SearchSchema) },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: SearchResponseSchema } },
      },
    },
    tags: [v2Tag('Video')],
  }),
  browse: createRoute({
    method: 'get',
    path: '/browse',
    summary: 'browse a YouTube Music page',
    description:
      'Get curated info about a browse id page (album, playlist, artist, ...), or the raw response with `raw=true`. Pass `continuation` for the next page.',
    request: { query: BrowseQuerySchema },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: BrowseResponseSchema } },
      },
      502: errorResponse('The browse request failed'),
    },
    tags: [v2Tag('Video')],
  }),
  browsePost: createRoute({
    method: 'post',
    path: '/browse',
    summary: 'browse a YouTube Music page',
    description:
      'Get curated info about a browse id page, or the raw response with `raw: true`. Pass `continuation` for the next page.',
    request: { body: body(BrowseRequestSchema) },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: BrowseResponseSchema } },
      },
      502: errorResponse('The browse request failed'),
    },
    tags: [v2Tag('Video')],
  }),
  browseByQueryMethod: createRoute({
    method: 'query',
    path: '/browse',
    summary: 'browse a YouTube Music page',
    description:
      'Safe: the same request as POST /browse, without the side-effect semantics.',
    request: { body: body(BrowseRequestSchema) },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: BrowseResponseSchema } },
      },
      502: errorResponse('The browse request failed'),
    },
    tags: [v2Tag('Video')],
  }),
  lyrics: createRoute({
    method: 'get',
    path: '/video/lyrics',
    summary: 'get lyrics from every provider',
    description:
      'Get the lyrics from every synced-lyrics provider that found some. Pass `?videoId=` to answer for another song (cached, or fetched for that video) instead of the current one. The plugin has to be enabled.',
    tags: [v2Tag('Video')],
    request: { query: LyricsQuerySchema },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: LyricsSchema } },
      },
      204: { description: 'No lyrics available' },
      404: errorResponse('The synced-lyrics plugin is disabled'),
    },
  }),
  lyricsTranslations: createRoute({
    method: 'get',
    path: '/video/lyrics/translations',
    summary: 'get cached lyrics translations',
    description:
      "Get the cached translations of the current song's lyrics that match the current translation strategy. Pass `?videoId=` to look up another song; empty when nothing is cached. The plugin has to be enabled.",
    tags: [v2Tag('Video')],
    request: { query: LyricsTranslationsQuerySchema },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: LyricsTranslationsSchema } },
      },
      404: errorResponse('The synced-lyrics plugin is disabled'),
    },
  }),
  translateLyrics: createRoute({
    method: 'post',
    path: '/video/lyrics/translations',
    summary: 'translate lyrics',
    description:
      "Translate a song's lyrics into `lang` and cache the result, without changing the translation the app shows. Already in `lang` answers with the original lines. Pass `videoId` to translate another song instead of the current one.",
    tags: [v2Tag('Video')],
    request: { body: body(LyricsTranslationRequestSchema) },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: LyricsTranslationSchema } },
      },
      404: errorResponse(
        'Plugin disabled, no lyrics, translation disabled, or already in that language',
      ),
      502: errorResponse('The translation provider failed'),
    },
  }),

  // Playback
  playing: readable({
    path: '/playback',
    summary: 'get playing state',
    description: 'Get whether the player is currently playing',
    schema: PlayingStateSchema,
    tags: [v2Tag('Playback')],
  }),
  play: action(
    'post',
    '/playback/play',
    'Play',
    'Change the state of the player to play',
    [v2Tag('Playback')],
  ),
  pause: action(
    'post',
    '/playback/pause',
    'Pause',
    'Change the state of the player to pause',
    [v2Tag('Playback')],
  ),
  togglePlay: action(
    'post',
    '/playback/toggle',
    'Toggle play/pause',
    'Change the state of the player to play if paused, or pause if playing',
    [v2Tag('Playback')],
  ),
  playbackSpeed: readable({
    path: '/playback/speed',
    summary: 'get playback speed',
    description: 'Get the current playback speed',
    schema: PlaybackSpeedSchema,
    tags: [v2Tag('Playback')],
  }),
  setPlaybackSpeed: actionWithBody(
    'post',
    '/playback/speed',
    'set playback speed',
    'Set the playback speed',
    SetPlaybackSpeedSchema,
    [v2Tag('Playback')],
  ),
  setPlaybackSpeedPatch: actionWithBody(
    'patch',
    '/playback/speed',
    'set playback speed',
    'Set the playback speed',
    SetPlaybackSpeedSchema,
    [v2Tag('Playback')],
  ),
  playbackPosition: readableWithQuery({
    path: '/playback/position',
    summary: 'get playback position',
    description:
      'Get the current playback position: a 0..1 fraction of the song when `percentage=true`, seconds otherwise',
    schema: PlaybackPositionSchema,
    query: PlaybackPositionQuerySchema,
    tags: [v2Tag('Playback')],
  }),
  seekTo: actionWithBody(
    'post',
    '/playback/position',
    'seek',
    'Seek to a specific time in the current song',
    SeekSchema,
    [v2Tag('Playback')],
  ),
  seekToPatch: actionWithBody(
    'patch',
    '/playback/position',
    'seek',
    'Seek to a specific time in the current song',
    SeekSchema,
    [v2Tag('Playback')],
  ),
  seekBy: actionWithBody(
    'post',
    '/playback/position/seek-by',
    'seek by',
    'Move the current song forward or backward by a number of seconds',
    SeekSchema,
    [v2Tag('Playback')],
  ),
  shuffleState: readable({
    path: '/playback/shuffle',
    summary: 'get shuffle state',
    description: 'Get the current shuffle state',
    schema: ShuffleStateSchema,
    tags: [v2Tag('Playback')],
  }),
  shuffle: action('post', '/playback/shuffle', 'shuffle', 'Shuffle the queue', [
    v2Tag('Playback'),
  ]),
  setShuffle: actionWithBody(
    'patch',
    '/playback/shuffle',
    'set shuffle',
    'Enable or disable shuffle',
    SetShuffleSchema,
    [v2Tag('Playback')],
  ),
  repeatMode: readable({
    path: '/playback/repeat',
    summary: 'get current repeat mode',
    description: 'Get the current repeat mode (NONE, ALL, ONE)',
    schema: RepeatModeSchema,
    tags: [v2Tag('Playback')],
  }),
  setRepeat: actionWithBody(
    'patch',
    '/playback/repeat',
    'set repeat mode',
    'Set the repeat mode',
    SetRepeatSchema,
    [v2Tag('Playback')],
  ),
  switchRepeat: action(
    'post',
    '/playback/repeat/next',
    'switch repeat',
    'Switch to the next repeat mode',
    [v2Tag('Playback')],
  ),

  // Volume
  volume: readable({
    path: '/volume',
    summary: 'get volume',
    description: 'Get the current volume of the player',
    schema: VolumeSchema,
    tags: [v2Tag('Volume')],
  }),
  setVolume: actionWithBody(
    'post',
    '/volume',
    'set volume',
    'Set the volume of the player',
    SetVolumeSchema,
    [v2Tag('Volume')],
  ),
  setVolumePatch: actionWithBody(
    'patch',
    '/volume',
    'set volume',
    'Set the volume of the player',
    SetVolumeSchema,
    [v2Tag('Volume')],
  ),
  muteState: readable({
    path: '/volume/mute',
    summary: 'get mute state',
    description: 'Get whether the player is muted',
    schema: MuteStateSchema,
    tags: [v2Tag('Volume')],
  }),
  setMute: actionWithBody(
    'post',
    '/volume/mute',
    'set mute',
    'Mute or unmute the player',
    SetMuteSchema,
    [v2Tag('Volume')],
  ),
  setMutePatch: actionWithBody(
    'patch',
    '/volume/mute',
    'set mute',
    'Mute or unmute the player',
    SetMuteSchema,
    [v2Tag('Volume')],
  ),
  unmute: action('post', '/volume/unmute', 'unmute', 'Unmute the player', [
    v2Tag('Volume'),
  ]),
  toggleMute: action(
    'post',
    '/volume/toggle-mute',
    'toggle mute',
    'Toggle the mute state of the player',
    [v2Tag('Volume')],
  ),

  // Rating
  likeState: readable({
    path: '/rating',
    summary: 'get like state',
    description: 'Get the current like state',
    schema: LikeStateSchema,
    tags: [v2Tag('Rating')],
  }),
  setLikeState: actionWithBody(
    'post',
    '/rating',
    'set like state',
    'Set the like state of the current song',
    SetLikeStateSchema,
    [v2Tag('Rating')],
  ),
  like: action(
    'post',
    '/rating/like',
    'like song',
    'Set the current song as liked',
    [v2Tag('Rating')],
  ),
  dislike: action(
    'post',
    '/rating/dislike',
    'dislike song',
    'Set the current song as disliked',
    [v2Tag('Rating')],
  ),
  unlike: action(
    'post',
    '/rating/unlike',
    'unlike song',
    'Clear the like state of the current song',
    [v2Tag('Rating')],
  ),

  // Queue
  queue: readableWithQuery({
    path: '/queue',
    summary: 'get current queue info',
    description:
      "Get the current queue info. Add `raw=true` to include each item's raw YouTube Music renderer.",
    schema: QueueSchema,
    query: QueueQuerySchema,
    emptyDescription: 'No queue info',
    tags: [v2Tag('Queue')],
  }),
  addToQueue: actionWithBody(
    'post',
    '/queue',
    'add songs to queue',
    'Add songs to the queue',
    AddToQueueSchema,
    [v2Tag('Queue')],
  ),
  moveInQueue: createRoute({
    method: 'patch',
    path: '/queue/{index}',
    summary: 'move song in queue',
    description: 'Move the song at `index` to another position in the queue',
    request: {
      params: QueueIndexParamSchema,
      body: body(MoveInQueueSchema),
    },
    responses: SUCCESS,
    tags: [v2Tag('Queue')],
  }),
  removeFromQueue: createRoute({
    method: 'delete',
    path: '/queue/{index}',
    summary: 'remove song from queue',
    description: 'Remove the song at `index` from the queue',
    request: { params: QueueIndexParamSchema },
    responses: SUCCESS,
    tags: [v2Tag('Queue')],
  }),
  setQueueIndex: actionWithBody(
    'post',
    '/queue/index',
    'set queue index',
    'Set the current index of the queue',
    SetQueueIndexSchema,
    [v2Tag('Queue')],
  ),
  autoplay: createRoute({
    method: 'get',
    path: '/queue/autoplay',
    summary: 'get autoplay entries',
    description:
      'Get the autoplay entries, which the queue keeps separate from its items. Pass `raw=true` for raw renderers and `continuation` for the next page.',
    request: { query: AutoplayQuerySchema },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: AutoplaySchema } },
      },
      502: errorResponse('The next autoplay page could not be fetched'),
    },
    tags: [v2Tag('Queue')],
  }),
  clearQueue: action('delete', '/queue', 'clear queue', 'Clear the queue', [
    v2Tag('Queue'),
  ]),

  // Config
  config: readable({
    path: '/pear/config',
    summary: 'get the app config',
    description: 'Get the app config as stored on disk',
    schema: ConfigSchema,
    tags: [v2Tag('Config')],
  }),
  settings: readable({
    path: '/pear/settings',
    summary: 'get the app config',
    description: 'Alias of `GET /pear/config`',
    schema: ConfigSchema,
    tags: [v2Tag('Config')],
  }),
  patchConfig: actionWithBody(
    'patch',
    '/pear/config',
    'change the app config',
    'Deep-merge a partial config into the stored one',
    ConfigSchema,
    [v2Tag('Config')],
  ),
  patchSettings: actionWithBody(
    'patch',
    '/pear/settings',
    'change the app config',
    'Alias of `PATCH /pear/config`',
    ConfigSchema,
    [v2Tag('Config')],
  ),
  appMeta: readable({
    path: '/pear',
    summary: 'get app metadata',
    description:
      'The app version, build, platform, CPU, GPU and memory info, as the settings window shows it',
    schema: AppMetaSchema,
    tags: [v2Tag('Config')],
  }),
  featureFlags: readable({
    path: '/pear/feature-flags',
    summary: 'get feature flags',
    description:
      'Every feature flag the page carries or the user overrode, with its effective value',
    schema: FeatureFlagsSchema,
    tags: [v2Tag('Config')],
  }),
  patchFeatureFlags: actionWithBody(
    'patch',
    '/pear/feature-flags',
    'set feature flag overrides',
    'Apply the given flags as overrides, live where the page allows it',
    FeatureFlagOverridesSchema,
    [v2Tag('Config')],
  ),
  deleteFeatureFlags: actionWithBody(
    'delete',
    '/pear/feature-flags',
    'remove feature flag overrides',
    'Drop the overrides for the given flags',
    FeatureFlagDeleteSchema,
    [v2Tag('Config')],
  ),
} as const;

const registerRoutes = (
  app: OpenAPIHono,
  { window }: BackendContext<APIServerConfig>,
  playerState: PlayerState,
) => {
  const controller = getSongControls(window);

  // Video
  app.openapi(routes.video, async (ctx) => {
    const info = await callRenderer<ResponseSongInfo | undefined>(
      window,
      ApiActions.getVideo,
    );

    if (!info) {
      return noContent(ctx);
    }

    return ctx.json(info, 200);
  });
  app.openapi(routes.nextVideo, (ctx) => {
    sendToRenderer(window, ApiActions.nextVideo);
    return noContent(ctx);
  });
  app.openapi(routes.previousVideo, (ctx) => {
    sendToRenderer(window, ApiActions.previousVideo);
    return noContent(ctx);
  });
  app.openapi(routes.previousVideoAlias, (ctx) => {
    sendToRenderer(window, ApiActions.previousVideo);
    return noContent(ctx);
  });
  // Same as v1's loadVideo: the renderer clears the queue, loads the video's
  // watch-next page and plays it.
  app.openapi(routes.playVideo, (ctx) => {
    controller.loadVideo(ctx.req.valid('json').videoId);
    return noContent(ctx);
  });
  app.openapi(routes.downloadVideo, async (ctx) => {
    if (!(await isEnabled('downloader'))) {
      return ctx.json({ error: 'The downloader plugin is disabled' }, 404);
    }

    const videoId = ctx.req.valid('json')?.videoId || playerState.song?.videoId;
    if (!videoId) {
      return ctx.json({ error: 'No video is playing' }, 400);
    }

    sendToRenderer(window, ApiActions.downloadVideo, videoId);
    return noContent(ctx);
  });
  const runSearch = async (
    ctx: Context,
    {
      query,
      params,
      continuation,
    }: { query: string; params?: string; continuation?: string },
    raw = false,
  ) => {
    const response = await callRenderer<ResponseSearch>(
      window,
      ApiActions.search,
      query,
      params,
      continuation,
      raw,
    );

    return ctx.json(response, 200);
  };
  app.openapi(routes.searchQuery, (ctx) => {
    const query = ctx.req.valid('query');
    return runSearch(ctx, query, query.raw === 'true');
  });
  app.openapi(routes.search, (ctx) => {
    const body = ctx.req.valid('json');
    return runSearch(ctx, body, body.raw === true);
  });
  app.openapi(routes.searchByQueryMethod, (ctx) => {
    const body = ctx.req.valid('json');
    return runSearch(ctx, body, body.raw === true);
  });
  const runBrowse = async (
    ctx: Context,
    { browseId, continuation }: { browseId?: string; continuation?: string },
    raw = false,
  ) => {
    const response = await callRenderer<ResponseBrowseRaw | null>(
      window,
      ApiActions.browse,
      browseId,
      continuation,
      raw,
    );

    if (!response) {
      return ctx.json({ error: 'The browse request failed' }, 502);
    }

    return ctx.json(response, 200);
  };
  app.openapi(routes.browse, (ctx) => {
    const query = ctx.req.valid('query');
    return runBrowse(ctx, query, query.raw === 'true');
  });
  app.openapi(routes.browsePost, (ctx) => {
    const body = ctx.req.valid('json');
    return runBrowse(ctx, body, body.raw === true);
  });
  app.openapi(routes.browseByQueryMethod, (ctx) => {
    const body = ctx.req.valid('json');
    return runBrowse(ctx, body, body.raw === true);
  });
  app.openapi(routes.lyrics, async (ctx) => {
    // A disabled plugin would time out waiting for a renderer that won't answer.
    if (!(await isEnabled('synced-lyrics'))) {
      return ctx.json({ error: 'The synced-lyrics plugin is disabled' }, 404);
    }

    const lyrics = await callRenderer<ResponseLyrics | null>(
      window,
      ApiActions.getLyrics,
      ctx.req.valid('query').videoId,
    );

    if (!lyrics) {
      return noContent(ctx);
    }

    return ctx.json(lyrics, 200);
  });
  app.openapi(routes.lyricsTranslations, async (ctx) => {
    if (!(await isEnabled('synced-lyrics'))) {
      return ctx.json({ error: 'The synced-lyrics plugin is disabled' }, 404);
    }

    const requested = ctx.req.valid('query').videoId;
    const videoId = requested || playerState.song?.videoId || null;
    // Nothing cached is a valid answer, not a reason to withhold the body.
    const entries = videoId
      ? await cacheEntriesForVideo(videoId).catch(() => [])
      : [];

    return ctx.json(
      {
        videoId,
        // The source lines and hashes are large and can be re-requested.
        translations: entries.map((entry) => ({
          language: entry.targetLanguage,
          provider: entry.provider,
          model: entry.model,
          title: entry.title,
          artists: entry.artists,
          createdAt: entry.createdAt,
          lines: entry.lines,
        })),
      },
      200,
    );
  });
  app.openapi(routes.translateLyrics, async (ctx) => {
    if (!(await isEnabled('synced-lyrics'))) {
      return ctx.json({ error: 'The synced-lyrics plugin is disabled' }, 404);
    }

    const { lang, videoId: requestedVideoId } = ctx.req.valid('json');
    const result =
      await callRendererWithTimeout<LanguageTranslationResult | null>(
        window,
        ApiActions.translateLyrics,
        TRANSLATION_TIMEOUT_MS,
        lang,
        requestedVideoId,
      );

    // Null only when the plugin is off; failures come back as data.
    if (!result) {
      return ctx.json({ error: 'The synced-lyrics plugin is disabled' }, 404);
    }

    if (result.reason) {
      // The reason picks the status; the plugin's own message is the body.
      const error =
        result.error ?? `Cannot translate the current lyrics: ${result.reason}`;

      return ctx.json(
        { error },
        result.reason === 'provider-error' ? 502 : 404,
      );
    }

    // Built field by field, so the body is exactly what the schema documents.
    return ctx.json(
      {
        videoId: requestedVideoId ?? playerState.song?.videoId ?? null,
        language: result.language,
        provider: result.provider,
        lines: result.lines,
        ...(result.fromCache !== undefined && { fromCache: result.fromCache }),
        ...(result.sameLanguage !== undefined && {
          sameLanguage: result.sameLanguage,
        }),
      },
      200,
    );
  });

  // Playback
  app.openapi(routes.playing, async (ctx) => {
    const isPlaying = await callRenderer<boolean | undefined>(
      window,
      ApiActions.getPlaying,
    );

    return ctx.json({ state: !!isPlaying }, 200);
  });
  app.openapi(routes.play, (ctx) => {
    sendToRenderer(window, ApiActions.play);
    return noContent(ctx);
  });
  app.openapi(routes.pause, (ctx) => {
    sendToRenderer(window, ApiActions.pause);
    return noContent(ctx);
  });
  app.openapi(routes.togglePlay, (ctx) => {
    sendToRenderer(window, ApiActions.togglePlay);
    return noContent(ctx);
  });
  app.openapi(routes.playbackSpeed, async (ctx) => {
    const speed = await callRenderer<number>(
      window,
      ApiActions.getPlaybackSpeed,
    );

    return ctx.json({ speed }, 200);
  });
  app.openapi(routes.setPlaybackSpeed, (ctx) => {
    sendToRenderer(
      window,
      ApiActions.setPlaybackSpeed,
      ctx.req.valid('json').speed,
    );
    return noContent(ctx);
  });
  app.openapi(routes.setPlaybackSpeedPatch, (ctx) => {
    sendToRenderer(
      window,
      ApiActions.setPlaybackSpeed,
      ctx.req.valid('json').speed,
    );
    return noContent(ctx);
  });
  app.openapi(routes.playbackPosition, async (ctx) => {
    const percentage = ctx.req.valid('query').percentage === 'true';
    const position = await callRenderer<number>(
      window,
      ApiActions.getPlaybackPosition,
      percentage,
    );

    return ctx.json({ position }, 200);
  });
  app.openapi(routes.seekTo, (ctx) => {
    sendToRenderer(window, ApiActions.seekTo, ctx.req.valid('json').seconds);
    return noContent(ctx);
  });
  app.openapi(routes.seekToPatch, (ctx) => {
    sendToRenderer(window, ApiActions.seekTo, ctx.req.valid('json').seconds);
    return noContent(ctx);
  });
  app.openapi(routes.seekBy, (ctx) => {
    sendToRenderer(window, ApiActions.seekBy, ctx.req.valid('json').seconds);
    return noContent(ctx);
  });
  app.openapi(routes.shuffleState, async (ctx) => {
    const isShuffled = await callRenderer<boolean | undefined>(
      window,
      ApiActions.getShuffle,
    );

    return ctx.json({ state: !!isShuffled }, 200);
  });
  app.openapi(routes.shuffle, (ctx) => {
    sendToRenderer(window, ApiActions.shuffle);
    return noContent(ctx);
  });
  app.openapi(routes.setShuffle, (ctx) => {
    sendToRenderer(
      window,
      ApiActions.setShuffle,
      ctx.req.valid('json').enabled,
    );
    return noContent(ctx);
  });
  app.openapi(routes.repeatMode, async (ctx) => {
    const mode = await callRenderer<RepeatMode | undefined>(
      window,
      ApiActions.getRepeat,
    );

    return ctx.json({ mode: mode ?? null }, 200);
  });
  app.openapi(routes.setRepeat, (ctx) => {
    sendToRenderer(window, ApiActions.setRepeat, ctx.req.valid('json').mode);
    return noContent(ctx);
  });
  app.openapi(routes.switchRepeat, (ctx) => {
    sendToRenderer(window, ApiActions.switchRepeat);
    return noContent(ctx);
  });

  // Volume
  app.openapi(routes.volume, async (ctx) => {
    const volume = await callRenderer<number>(window, ApiActions.getVolume);

    return ctx.json({ volume }, 200);
  });
  app.openapi(routes.setVolume, (ctx) => {
    sendToRenderer(window, ApiActions.setVolume, ctx.req.valid('json').volume);
    return noContent(ctx);
  });
  app.openapi(routes.setVolumePatch, (ctx) => {
    sendToRenderer(window, ApiActions.setVolume, ctx.req.valid('json').volume);
    return noContent(ctx);
  });
  app.openapi(routes.muteState, async (ctx) => {
    const muted = await callRenderer<boolean | undefined>(
      window,
      ApiActions.getMute,
    );

    return ctx.json({ muted: !!muted }, 200);
  });
  app.openapi(routes.setMute, (ctx) => {
    sendToRenderer(window, ApiActions.setMute, ctx.req.valid('json').muted);
    return noContent(ctx);
  });
  app.openapi(routes.setMutePatch, (ctx) => {
    sendToRenderer(window, ApiActions.setMute, ctx.req.valid('json').muted);
    return noContent(ctx);
  });
  app.openapi(routes.unmute, (ctx) => {
    sendToRenderer(window, ApiActions.setMute, false);
    return noContent(ctx);
  });
  app.openapi(routes.toggleMute, (ctx) => {
    sendToRenderer(window, ApiActions.toggleMute);
    return noContent(ctx);
  });

  // Rating
  app.openapi(routes.likeState, async (ctx) => {
    const state = await callRenderer<LikeType | undefined>(
      window,
      ApiActions.getLikeState,
    );

    return ctx.json({ state: state ?? null }, 200);
  });
  app.openapi(routes.setLikeState, (ctx) => {
    sendToRenderer(
      window,
      ApiActions.setLikeState,
      ctx.req.valid('json').state,
    );
    return noContent(ctx);
  });
  app.openapi(routes.like, (ctx) => {
    sendToRenderer(window, ApiActions.like);
    return noContent(ctx);
  });
  app.openapi(routes.dislike, (ctx) => {
    sendToRenderer(window, ApiActions.dislike);
    return noContent(ctx);
  });
  app.openapi(routes.unlike, (ctx) => {
    sendToRenderer(window, ApiActions.unlike);
    return noContent(ctx);
  });

  // Queue
  app.openapi(routes.autoplay, async (ctx) => {
    const { raw, continuation } = ctx.req.valid('query');
    const response = await callRenderer<ResponseAutoplay | null>(
      window,
      ApiActions.getAutoplay,
      raw === 'true',
      continuation,
    );

    if (!response) {
      return ctx.json(
        { error: 'The next autoplay page could not be fetched' },
        502,
      );
    }

    return ctx.json(response, 200);
  });
  app.openapi(routes.queue, async (ctx) => {
    const raw = ctx.req.valid('query').raw === 'true';
    const info = await callRenderer<ResponseQueue | undefined>(
      window,
      ApiActions.getQueue,
      raw,
    );

    if (!info) {
      return noContent(ctx);
    }

    return ctx.json(info, 200);
  });
  app.openapi(routes.addToQueue, (ctx) => {
    const { videoIds, playlistIds, insertPosition } = ctx.req.valid('json');
    sendToRenderer(
      window,
      ApiActions.addToQueue,
      videoIds ?? [],
      insertPosition ?? 'INSERT_AFTER_CURRENT_VIDEO',
      playlistIds ?? [],
    );
    return noContent(ctx);
  });
  app.openapi(routes.moveInQueue, (ctx) => {
    sendToRenderer(
      window,
      ApiActions.moveInQueue,
      ctx.req.valid('param').index,
      ctx.req.valid('json').toIndex,
    );
    return noContent(ctx);
  });
  app.openapi(routes.removeFromQueue, (ctx) => {
    sendToRenderer(
      window,
      ApiActions.removeFromQueue,
      ctx.req.valid('param').index,
    );
    return noContent(ctx);
  });
  app.openapi(routes.setQueueIndex, (ctx) => {
    sendToRenderer(
      window,
      ApiActions.setQueueIndex,
      ctx.req.valid('json').index,
    );
    return noContent(ctx);
  });
  app.openapi(routes.clearQueue, (ctx) => {
    sendToRenderer(window, ApiActions.clearQueue);
    return noContent(ctx);
  });

  // Config
  const getConfig = (ctx: Context) => ctx.json(config.getAll(), 200);
  app.openapi(routes.config, getConfig);
  app.openapi(routes.settings, getConfig);
  app.openapi(routes.patchConfig, (ctx) => {
    config.patch(ctx.req.valid('json'));
    return noContent(ctx);
  });
  app.openapi(routes.patchSettings, (ctx) => {
    config.patch(ctx.req.valid('json'));
    return noContent(ctx);
  });

  // App
  const overrides = () =>
    (config.get('options.featureFlags') ?? {}) as Record<string, unknown>;

  /** Hands one override to the page, so it applies without a restart. */
  const applyFlag = (name: string, value: unknown) =>
    window.webContents
      .executeJavaScript(
        `window.__peardFeatureFlags?.set(${JSON.stringify(name)}, ${JSON.stringify(value)})`,
      )
      .catch(() => undefined);

  /** Drops a live override, putting the page's own value back. */
  const removeFlag = (name: string) =>
    window.webContents
      .executeJavaScript(
        `window.__peardFeatureFlags?.remove(${JSON.stringify(name)})`,
      )
      .catch(() => undefined);

  /** Every flag the page carries, plus the ones the user overrode. */
  const featureFlags = async () => {
    const saved = overrides();
    const live = (await window.webContents
      .executeJavaScript('window.ytcfg?.data_?.EXPERIMENT_FLAGS ?? {}')
      .catch(() => ({}))) as Record<string, unknown>;
    const names = [
      ...new Set([...Object.keys(live), ...Object.keys(saved)]),
    ].sort();

    return names.map((name) => ({
      name,
      value: Object.hasOwn(saved, name) ? saved[name] : live[name],
      overridden: Object.hasOwn(saved, name),
    }));
  };

  app.openapi(routes.appMeta, async (ctx) => ctx.json(await getAppMeta(), 200));
  app.openapi(routes.featureFlags, async (ctx) =>
    ctx.json({ flags: await featureFlags() }, 200),
  );
  app.openapi(routes.patchFeatureFlags, async (ctx) => {
    const patch = ctx.req.valid('json');
    config.set('options.featureFlags', { ...overrides(), ...patch });
    await Promise.all(
      Object.entries(patch).map(([name, value]) => applyFlag(name, value)),
    );
    return noContent(ctx);
  });
  app.openapi(routes.deleteFeatureFlags, async (ctx) => {
    const { flags } = ctx.req.valid('json');
    const saved = { ...overrides() };
    // Only a flag that was overridden needs the page to put its own value back;
    // removing one that never was would drop it from the page's map instead.
    const hadOverride = flags.filter((name) => Object.hasOwn(saved, name));
    for (const name of flags) delete saved[name];
    config.set('options.featureFlags', saved);
    await Promise.all(hadOverride.map(removeFlag));
    return noContent(ctx);
  });
};

/** Mount point for everything v2 serves. */
const V2_PATH = '/api/v2';

/**
 * The WebSocket endpoint, relative to the version prefix. It authenticates with
 * a `?token=` query param because browsers cannot set headers on a WebSocket
 * handshake.
 */
const WS_PATH = '/ws';

/** v2 as a self-contained router; `app.ts` mounts it at its prefix. */
export const createV2 = (
  ctx: BackendContext<APIServerConfig>,
  playerState: PlayerState,
) => {
  const app = new OpenAPIHono().basePath(V2_PATH);

  // `requireAuth` matches `ctx.req.path`, which is absolute even inside a
  // sub-app, while `createRoute` paths are relative to `basePath`.
  app.use('*', requireAuth(ctx.getConfig, `${V2_PATH}${WS_PATH}`));
  registerRoutes(app, ctx, playerState);

  // v2 keeps v1's player events and adds rating/lyrics/translation pushes plus
  // client commands, so it needs its own socket protocol.
  const stopWebsocket = registerV2Websocket(app, ctx, playerState, WS_PATH, [
    v2Tag('WebSocket'),
  ]);

  return { app, stopWebsocket };
};
