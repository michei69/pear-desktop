import { OpenAPIHono, createRoute } from '@hono/zod-openapi';

import { getSongControls } from '@/providers/song-controls';

import { requireAuth } from './auth';
import { waitForIpcResponse } from './ipc';
import {
  action,
  actionWithBody,
  body,
  JSON_CONTENT,
  noContent,
  readable,
  SUCCESS,
} from './route-helpers';
import {
  AddSongToQueueSchema,
  FullscreenStateSchema,
  GoBackSchema,
  GoForwardSchema,
  LikeStateSchema,
  LoadPlaylistSchema,
  LoadVideoSchema,
  MoveSongInQueueSchema,
  NextSongSchema,
  QueueIndexParamSchema,
  QueueSchema,
  RepeatModeSchema,
  SearchResultSchema,
  SearchSchema,
  SeekSchema,
  SetFullscreenSchema,
  SetQueueIndexSchema,
  SetVolumeSchema,
  ShuffleStateSchema,
  SongInfoSchema,
  SwitchRepeatSchema,
  VolumeStateSchema,
  type ResponseSongInfo,
} from './schemas';
import { v1Tag } from './tags';
import { registerWebsocket } from './websocket';

import type { APIServerConfig } from '../config';
import type { PlayerState } from './state';
import type { BackendContext } from '@/types/contexts';
import type { LikeType } from '@/types/datahost-get-state';
import type { QueueResponse } from '@/types/music-player-desktop-internal';
import type { Context } from 'hono';

export const routes = {
  // Playback
  previous: action(
    'post',
    '/previous',
    'play previous song',
    'Plays the previous song in the queue',
    [v1Tag('Playback')],
  ),
  next: action(
    'post',
    '/next',
    'play next song',
    'Plays the next song in the queue',
    [v1Tag('Playback')],
  ),
  play: action(
    'post',
    '/play',
    'Play',
    'Change the state of the player to play',
    [v1Tag('Playback')],
  ),
  pause: action(
    'post',
    '/pause',
    'Pause',
    'Change the state of the player to pause',
    [v1Tag('Playback')],
  ),
  togglePlay: action(
    'post',
    '/toggle-play',
    'Toggle play/pause',
    'Change the state of the player to play if paused, or pause if playing',
    [v1Tag('Playback')],
  ),
  seekTo: actionWithBody(
    'post',
    '/seek-to',
    'seek',
    'Seek to a specific time in the current song',
    SeekSchema,
    [v1Tag('Playback')],
  ),
  goBack: actionWithBody(
    'post',
    '/go-back',
    'go back',
    'Move the current song back by a number of seconds',
    GoBackSchema,
    [v1Tag('Playback')],
  ),
  goForward: actionWithBody(
    'post',
    '/go-forward',
    'go forward',
    'Move the current song forward by a number of seconds',
    GoForwardSchema,
    [v1Tag('Playback')],
  ),

  // Rating
  likeState: readable({
    path: '/like-state',
    summary: 'get like state',
    description: 'Get the current like state',
    schema: LikeStateSchema,
    tags: [v1Tag('Rating')],
  }),
  like: action('post', '/like', 'like song', 'Set the current song as liked', [
    v1Tag('Rating'),
  ]),
  dislike: action(
    'post',
    '/dislike',
    'dislike song',
    'Set the current song as disliked',
    [v1Tag('Rating')],
  ),

  // Shuffle / repeat
  shuffleState: readable({
    path: '/shuffle',
    summary: 'get shuffle state',
    description: 'Get the current shuffle state',
    schema: ShuffleStateSchema,
    tags: [v1Tag('Shuffle & repeat')],
  }),
  shuffle: action('post', '/shuffle', 'shuffle', 'Shuffle the queue', [
    v1Tag('Shuffle & repeat'),
  ]),
  repeatMode: readable({
    path: '/repeat-mode',
    summary: 'get current repeat mode',
    description: 'Get the current repeat mode (NONE, ALL, ONE)',
    schema: RepeatModeSchema,
    tags: [v1Tag('Shuffle & repeat')],
  }),
  switchRepeat: actionWithBody(
    'post',
    '/switch-repeat',
    'switch repeat',
    'Switch the repeat mode',
    SwitchRepeatSchema,
    [v1Tag('Shuffle & repeat')],
  ),

  // Volume / fullscreen
  setVolume: actionWithBody(
    'post',
    '/volume',
    'set volume',
    'Set the volume of the player',
    SetVolumeSchema,
    [v1Tag('Volume & fullscreen')],
  ),
  volumeState: readable({
    path: '/volume',
    summary: 'get volume state',
    description: 'Get the current volume state of the player',
    schema: VolumeStateSchema,
    tags: [v1Tag('Volume & fullscreen')],
  }),
  setFullscreen: actionWithBody(
    'post',
    '/fullscreen',
    'set fullscreen',
    'Set the fullscreen state of the player',
    SetFullscreenSchema,
    [v1Tag('Volume & fullscreen')],
  ),
  fullscreenState: readable({
    path: '/fullscreen',
    summary: 'get fullscreen state',
    description: 'Get the current fullscreen state',
    schema: FullscreenStateSchema,
    tags: [v1Tag('Volume & fullscreen')],
  }),
  toggleMute: action(
    'post',
    '/toggle-mute',
    'toggle mute',
    'Toggle the mute state of the player',
    [v1Tag('Volume & fullscreen')],
  ),

  // Song
  song: readable({
    path: '/song',
    summary: 'get current song info',
    description: 'Get the current song info',
    schema: SongInfoSchema,
    emptyDescription: 'No song info',
    tags: [v1Tag('Song')],
  }),
  legacySong: readable({
    path: '/song-info',
    summary: 'get current song info',
    description: 'Get the current song info',
    schema: SongInfoSchema,
    emptyDescription: 'No song info',
    deprecated: true,
    tags: [v1Tag('Song')],
  }),

  // Queue
  queue: readable({
    path: '/queue',
    summary: 'get current queue info',
    description: 'Get the current queue info',
    schema: QueueSchema,
    emptyDescription: 'No queue info',
    tags: [v1Tag('Queue')],
  }),
  legacyQueue: readable({
    path: '/queue-info',
    summary: 'get current queue info',
    description: 'Get the current queue info',
    schema: QueueSchema,
    emptyDescription: 'No queue info',
    deprecated: true,
    tags: [v1Tag('Queue')],
  }),
  nextSong: readable({
    path: '/queue/next',
    summary: 'get next song info',
    description:
      'Get information about the next song in the queue (relative index +1)',
    schema: NextSongSchema,
    emptyDescription: 'No next song in queue',
    tags: [v1Tag('Queue')],
  }),
  addToQueue: actionWithBody(
    'post',
    '/queue',
    'add song to queue',
    'Add a song to the queue',
    AddSongToQueueSchema,
    [v1Tag('Queue')],
  ),
  moveInQueue: createRoute({
    method: 'patch',
    path: '/queue/{index}',
    summary: 'move song in queue',
    description: 'Move a song in the queue',
    tags: [v1Tag('Queue')],
    request: {
      params: QueueIndexParamSchema,
      body: body(MoveSongInQueueSchema),
    },
    responses: SUCCESS,
  }),
  removeFromQueue: createRoute({
    method: 'delete',
    path: '/queue/{index}',
    summary: 'remove song from queue',
    description: 'Remove a song from the queue',
    tags: [v1Tag('Queue')],
    request: { params: QueueIndexParamSchema },
    responses: SUCCESS,
  }),
  setQueueIndex: actionWithBody(
    'patch',
    '/queue',
    'set queue index',
    'Set the current index of the queue',
    SetQueueIndexSchema,
    [v1Tag('Queue')],
  ),
  clearQueue: action('delete', '/queue', 'clear queue', 'Clear the queue', [
    v1Tag('Queue'),
  ]),

  // Search / navigation
  search: createRoute({
    method: 'post',
    path: '/search',
    summary: 'search for a song',
    description: 'search for a song',
    tags: [v1Tag('Search & navigation')],
    request: { body: body(SearchSchema) },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema: SearchResultSchema } },
      },
    },
  }),
  loadVideo: createRoute({
    method: 'post',
    path: '/loadVideo',
    summary: 'load video',
    description: 'Loads a video given its ID',
    tags: [v1Tag('Search & navigation')],
    request: { body: body(LoadVideoSchema) },
    responses: SUCCESS,
  }),
  loadPlaylist: createRoute({
    method: 'post',
    path: '/loadPlaylist',
    summary: 'play playlist',
    description: 'Plays a playlist given its ID',
    tags: [v1Tag('Search & navigation')],
    request: { body: body(LoadPlaylistSchema) },
    responses: SUCCESS,
  }),
} as const;

const registerRoutes = (
  app: OpenAPIHono,
  { window }: BackendContext<APIServerConfig>,
  playerState: PlayerState,
) => {
  const controller = getSongControls(window);
  const getLikeType = () =>
    window.webContents.executeJavaScript(
      'document.querySelector("#like-button-renderer")?.likeStatus',
    ) as Promise<LikeType | undefined>;

  // Playback
  app.openapi(routes.previous, (ctx) => {
    controller.previous();
    return noContent(ctx);
  });
  app.openapi(routes.next, (ctx) => {
    controller.next();
    return noContent(ctx);
  });
  app.openapi(routes.play, (ctx) => {
    controller.play();
    return noContent(ctx);
  });
  app.openapi(routes.pause, (ctx) => {
    controller.pause();
    return noContent(ctx);
  });
  app.openapi(routes.togglePlay, (ctx) => {
    controller.playPause();
    return noContent(ctx);
  });
  app.openapi(routes.seekTo, (ctx) => {
    controller.seekTo(ctx.req.valid('json').seconds);
    return noContent(ctx);
  });
  app.openapi(routes.goBack, (ctx) => {
    controller.goBack(ctx.req.valid('json').seconds);
    return noContent(ctx);
  });
  app.openapi(routes.goForward, (ctx) => {
    controller.goForward(ctx.req.valid('json').seconds);
    return noContent(ctx);
  });

  // Rating
  app.openapi(routes.likeState, async (ctx) =>
    ctx.json({ state: (await getLikeType()) ?? null }, 200),
  );
  app.openapi(routes.like, (ctx) => {
    controller.like();
    return noContent(ctx);
  });
  app.openapi(routes.dislike, (ctx) => {
    controller.dislike();
    return noContent(ctx);
  });

  // Shuffle / repeat
  app.openapi(routes.shuffleState, async (ctx) => {
    const isShuffled = await waitForIpcResponse<boolean | undefined>(
      'peard:get-shuffle-response',
      () => controller.requestShuffleInformation(),
    );

    return ctx.json({ state: !!isShuffled }, 200);
  });
  app.openapi(routes.shuffle, (ctx) => {
    controller.shuffle();
    return noContent(ctx);
  });
  app.openapi(routes.repeatMode, (ctx) =>
    ctx.json({ mode: playerState.repeat ?? null }, 200),
  );
  app.openapi(routes.switchRepeat, (ctx) => {
    controller.switchRepeat(ctx.req.valid('json').iteration);
    return noContent(ctx);
  });

  // Volume / fullscreen
  app.openapi(routes.setVolume, (ctx) => {
    controller.setVolume(ctx.req.valid('json').volume);
    return noContent(ctx);
  });
  app.openapi(routes.volumeState, (ctx) =>
    ctx.json(playerState.volume ?? { state: 0, isMuted: false }, 200),
  );
  app.openapi(routes.setFullscreen, (ctx) => {
    controller.setFullscreen(ctx.req.valid('json').state);
    return noContent(ctx);
  });
  app.openapi(routes.fullscreenState, async (ctx) => {
    const fullscreen = await waitForIpcResponse<boolean | undefined>(
      'peard:set-fullscreen',
      () => controller.requestFullscreenInformation(),
    );

    return ctx.json({ state: !!fullscreen }, 200);
  });
  app.openapi(routes.toggleMute, (ctx) => {
    controller.muteUnmute();
    return noContent(ctx);
  });

  // Song
  const songInfo = (ctx: Context) => {
    const info = playerState.song;

    if (!info) {
      return noContent(ctx);
    }

    // `image` is an Electron.NativeImage, which doesn't survive JSON.
    const body = { ...info };
    delete body.image;

    return ctx.json(body satisfies ResponseSongInfo, 200);
  };
  app.openapi(routes.song, songInfo);
  app.openapi(routes.legacySong, songInfo);

  // Queue
  const queueInfo = async (ctx: Context) => {
    const info = await waitForIpcResponse<QueueResponse>(
      'peard:get-queue-response',
      () => controller.requestQueueInformation(),
    );

    if (!info) {
      return noContent(ctx);
    }

    return ctx.json(info, 200);
  };
  app.openapi(routes.queue, queueInfo);
  app.openapi(routes.legacyQueue, queueInfo);

  app.openapi(routes.nextSong, async (ctx) => {
    const queue = await waitForIpcResponse<QueueResponse>(
      'peard:get-queue-response',
      () => controller.requestQueueInformation(),
    );

    const items = queue?.items;
    if (!items || items.length === 0) {
      return noContent(ctx);
    }

    const rendererAt = (index: number) => {
      const item = items[index];
      return (
        item.playlistPanelVideoRenderer ||
        item.playlistPanelVideoWrapperRenderer?.primaryRenderer
          ?.playlistPanelVideoRenderer
      );
    };

    const currentIndex = items.findIndex(
      (_, index) => rendererAt(index)?.selected === true,
    );
    const nextRenderer = rendererAt(currentIndex + 1);

    if (!nextRenderer) {
      return noContent(ctx);
    }

    return ctx.json(
      {
        title: nextRenderer.title?.runs?.[0]?.text,
        videoId: nextRenderer.videoId,
        thumbnail: nextRenderer.thumbnail,
        lengthText: nextRenderer.lengthText,
        shortBylineText: nextRenderer.shortBylineText,
      },
      200,
    );
  });

  app.openapi(routes.addToQueue, (ctx) => {
    const { videoId, insertPosition } = ctx.req.valid('json');
    controller.addSongToQueue(videoId, insertPosition);
    return noContent(ctx);
  });
  app.openapi(routes.moveInQueue, (ctx) => {
    controller.moveSongInQueue(
      ctx.req.valid('param').index,
      ctx.req.valid('json').toIndex,
    );
    return noContent(ctx);
  });
  app.openapi(routes.removeFromQueue, (ctx) => {
    controller.removeSongFromQueue(ctx.req.valid('param').index);
    return noContent(ctx);
  });
  app.openapi(routes.setQueueIndex, (ctx) => {
    controller.setQueueIndex(ctx.req.valid('json').index);
    return noContent(ctx);
  });
  app.openapi(routes.clearQueue, (ctx) => {
    controller.clearQueue();
    return noContent(ctx);
  });

  // Search / navigation
  app.openapi(routes.search, async (ctx) => {
    const { query, params, continuation } = ctx.req.valid('json');
    const response = await controller.search(query, params, continuation);

    return ctx.json(response as unknown as Record<string, unknown>, 200);
  });
  app.openapi(routes.loadVideo, (ctx) => {
    controller.loadVideo(ctx.req.valid('json').videoId);
    return noContent(ctx);
  });
  app.openapi(routes.loadPlaylist, (ctx) => {
    controller.loadPlaylist(ctx.req.valid('json').playlistId);
    return noContent(ctx);
  });
};

/** Mount point for everything v1 serves. A v2 owns its own, in its own module. */
const V1_PATH = '/api/v1';

/**
 * The WebSocket endpoint, relative to the version prefix. It authenticates with
 * a `?token=` query param instead of the `Authorization` header, because
 * browsers cannot set headers on a WebSocket handshake.
 */
const WS_PATH = '/ws';

/**
 * v1 as a self-contained router. `app.ts` mounts it at its prefix, so the
 * prefix, the auth guard and the WebSocket endpoint all stay in one place
 * instead of being threaded through every route definition.
 */
export const createV1 = (
  ctx: BackendContext<APIServerConfig>,
  playerState: PlayerState,
) => {
  const app = new OpenAPIHono().basePath(V1_PATH);

  // `requireAuth` matches `ctx.req.path`, which is absolute even inside a
  // sub-app, while `createRoute` paths are relative to `basePath`.
  app.use('*', requireAuth(ctx.getConfig, `${V1_PATH}${WS_PATH}`));
  registerRoutes(app, ctx, playerState);

  const stopWebsocket = registerWebsocket(app, ctx, playerState, WS_PATH, [
    v1Tag('WebSocket'),
  ]);

  return { app, stopWebsocket };
};
