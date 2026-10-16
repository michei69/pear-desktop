import { OpenAPIHono, createRoute, type z } from '@hono/zod-openapi';

import { requireAuth } from './auth';
import { callRenderer, sendToRenderer } from './ipc';
import {
  AddToQueueSchema,
  LikeStateSchema,
  MoveInQueueSchema,
  MuteStateSchema,
  PlaybackPositionQuerySchema,
  PlaybackPositionSchema,
  PlaybackSpeedSchema,
  PlayingStateSchema,
  QueueIndexParamSchema,
  QueueSchema,
  RepeatModeSchema,
  SearchQuerySchema,
  SearchResultSchema,
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
  type ResponseQueue,
  type ResponseSongInfo,
} from './schemas-v2';
import { v2Tag } from './tags';
import { registerWebsocket } from './websocket';

import { ApiActions } from '../channels';

import type { APIServerConfig } from '../config';
import type { PlayerState } from './state';
import type { BackendContext } from '@/types/contexts';
import type { LikeType, RepeatMode } from '@/types/datahost-get-state';
import type { Context } from 'hono';

const SUCCESS = { 204: { description: 'Success' } };
const JSON_CONTENT = 'application/json';

const noContent = (ctx: Context) => ctx.body(null, 204);

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
  tags,
}: {
  path: string;
  summary: string;
  description: string;
  schema: S;
  query: Q;
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
  searchQuery: readableWithQuery({
    path: '/video/search',
    summary: 'search for a song',
    description: "Search for a song and return the renderer's raw response",
    schema: SearchResultSchema,
    query: SearchQuerySchema,
    tags: [v2Tag('Video')],
  }),
  search: createRoute({
    method: 'post',
    path: '/video/search',
    summary: 'search for a song',
    description: "Search for a song and return the renderer's raw response",
    request: { body: body(SearchSchema) },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: SearchResultSchema } },
      },
    },
    tags: [v2Tag('Video')],
  }),
  // QUERY (draft-ietf-httpbis-safe-method-w-body): a safe method that still
  // takes a body, which is what a search actually is. Same body and handler as
  // the POST above, minus the implication that it changes anything.
  searchByQueryMethod: createRoute({
    method: 'query',
    path: '/video/search',
    summary: 'search for a song',
    description:
      "Search for a song and return the renderer's raw response. Safe: the same request as POST /video/search, without the side-effect semantics.",
    request: { body: body(SearchSchema) },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: SearchResultSchema } },
      },
    },
    tags: [v2Tag('Video')],
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
  queue: readable({
    path: '/queue',
    summary: 'get current queue info',
    description: 'Get the current queue info',
    schema: QueueSchema,
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
  clearQueue: action('delete', '/queue', 'clear queue', 'Clear the queue', [
    v2Tag('Queue'),
  ]),
} as const;

const registerRoutes = (
  app: OpenAPIHono,
  { window }: BackendContext<APIServerConfig>,
) => {
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
  // GET, POST and QUERY all reach the same renderer action; only the way the
  // arguments arrive differs.
  const runSearch = async (
    ctx: Context,
    { query, params, continuation }: z.infer<typeof SearchSchema>,
  ) => {
    const response = await callRenderer<Record<string, unknown>>(
      window,
      ApiActions.search,
      query,
      params,
      continuation,
    );

    return ctx.json(response, 200);
  };
  app.openapi(routes.searchQuery, (ctx) =>
    runSearch(ctx, ctx.req.valid('query')),
  );
  app.openapi(routes.search, (ctx) => runSearch(ctx, ctx.req.valid('json')));
  app.openapi(routes.searchByQueryMethod, (ctx) =>
    runSearch(ctx, ctx.req.valid('json')),
  );

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
  app.openapi(routes.queue, async (ctx) => {
    const info = await callRenderer<ResponseQueue | undefined>(
      window,
      ApiActions.getQueue,
    );

    if (!info) {
      return noContent(ctx);
    }

    return ctx.json(info, 200);
  });
  app.openapi(routes.addToQueue, (ctx) => {
    const { videoIds, insertPosition } = ctx.req.valid('json');
    sendToRenderer(
      window,
      ApiActions.addToQueue,
      videoIds,
      insertPosition ?? 'INSERT_AFTER_CURRENT_VIDEO',
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
};

/** Mount point for everything v2 serves. */
const V2_PATH = '/api/v2';

/**
 * The WebSocket endpoint, relative to the version prefix. It authenticates with
 * a `?token=` query param instead of the `Authorization` header, because
 * browsers cannot set headers on a WebSocket handshake.
 */
const WS_PATH = '/ws';

/**
 * v2 as a self-contained router. `app.ts` mounts it at its prefix, so the
 * prefix, the auth guard and the WebSocket endpoint all stay in one place
 * instead of being threaded through every route definition.
 */
export const createV2 = (
  ctx: BackendContext<APIServerConfig>,
  playerState: PlayerState,
) => {
  const app = new OpenAPIHono().basePath(V2_PATH);

  // `requireAuth` matches `ctx.req.path`, which is absolute even inside a
  // sub-app, while `createRoute` paths are relative to `basePath`.
  app.use('*', requireAuth(ctx.getConfig, `${V2_PATH}${WS_PATH}`));
  registerRoutes(app, ctx);

  // TODO(ponytail): v2 will carry its own event set. For now it reuses v1's
  // shared player state events, so both versions broadcast the same messages.
  const stopWebsocket = registerWebsocket(app, ctx, playerState, WS_PATH, [
    v2Tag('WebSocket'),
  ]);

  return { app, stopWebsocket };
};
