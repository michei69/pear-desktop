import { createRoute, type OpenAPIHono, type z } from '@hono/zod-openapi';
import { ipcMain } from 'electron';

import { getSongControls } from '@/providers/song-controls';

import { API_PREFIX } from './api-version';
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

import type { APIServerConfig } from '../config';
import type { PlayerState } from './state';
import type { BackendContext } from '@/types/contexts';
import type { LikeType } from '@/types/datahost-get-state';
import type { QueueResponse } from '@/types/music-player-desktop-internal';
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
) =>
  createRoute({
    method,
    path: `${API_PREFIX}${path}`,
    summary,
    description,
    responses: SUCCESS,
  });

/** A 204 route that also takes a JSON body. */
const actionWithBody = <S extends z.ZodType>(
  method: 'post' | 'patch' | 'delete',
  path: string,
  summary: string,
  description: string,
  schema: S,
) =>
  createRoute({
    method,
    path: `${API_PREFIX}${path}`,
    summary,
    description,
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
  deprecated,
}: {
  path: string;
  summary: string;
  description: string;
  schema: S;
  emptyDescription?: string;
  deprecated?: boolean;
}) =>
  createRoute({
    method: 'get',
    path: `${API_PREFIX}${path}`,
    summary,
    description,
    deprecated,
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema } },
      },
      ...(emptyDescription ? { 204: { description: emptyDescription } } : {}),
    },
  });

export const routes = {
  // Playback
  previous: action(
    'post',
    '/previous',
    'play previous song',
    'Plays the previous song in the queue',
  ),
  next: action(
    'post',
    '/next',
    'play next song',
    'Plays the next song in the queue',
  ),
  play: action(
    'post',
    '/play',
    'Play',
    'Change the state of the player to play',
  ),
  pause: action(
    'post',
    '/pause',
    'Pause',
    'Change the state of the player to pause',
  ),
  togglePlay: action(
    'post',
    '/toggle-play',
    'Toggle play/pause',
    'Change the state of the player to play if paused, or pause if playing',
  ),
  seekTo: actionWithBody(
    'post',
    '/seek-to',
    'seek',
    'Seek to a specific time in the current song',
    SeekSchema,
  ),
  goBack: actionWithBody(
    'post',
    '/go-back',
    'go back',
    'Move the current song back by a number of seconds',
    GoBackSchema,
  ),
  goForward: actionWithBody(
    'post',
    '/go-forward',
    'go forward',
    'Move the current song forward by a number of seconds',
    GoForwardSchema,
  ),

  // Rating
  likeState: readable({
    path: '/like-state',
    summary: 'get like state',
    description: 'Get the current like state',
    schema: LikeStateSchema,
  }),
  like: action('post', '/like', 'like song', 'Set the current song as liked'),
  dislike: action(
    'post',
    '/dislike',
    'dislike song',
    'Set the current song as disliked',
  ),

  // Shuffle / repeat
  shuffleState: readable({
    path: '/shuffle',
    summary: 'get shuffle state',
    description: 'Get the current shuffle state',
    schema: ShuffleStateSchema,
  }),
  shuffle: action('post', '/shuffle', 'shuffle', 'Shuffle the queue'),
  repeatMode: readable({
    path: '/repeat-mode',
    summary: 'get current repeat mode',
    description: 'Get the current repeat mode (NONE, ALL, ONE)',
    schema: RepeatModeSchema,
  }),
  switchRepeat: actionWithBody(
    'post',
    '/switch-repeat',
    'switch repeat',
    'Switch the repeat mode',
    SwitchRepeatSchema,
  ),

  // Volume / fullscreen
  setVolume: actionWithBody(
    'post',
    '/volume',
    'set volume',
    'Set the volume of the player',
    SetVolumeSchema,
  ),
  volumeState: readable({
    path: '/volume',
    summary: 'get volume state',
    description: 'Get the current volume state of the player',
    schema: VolumeStateSchema,
  }),
  setFullscreen: actionWithBody(
    'post',
    '/fullscreen',
    'set fullscreen',
    'Set the fullscreen state of the player',
    SetFullscreenSchema,
  ),
  fullscreenState: readable({
    path: '/fullscreen',
    summary: 'get fullscreen state',
    description: 'Get the current fullscreen state',
    schema: FullscreenStateSchema,
  }),
  toggleMute: action(
    'post',
    '/toggle-mute',
    'toggle mute',
    'Toggle the mute state of the player',
  ),

  // Song
  song: readable({
    path: '/song',
    summary: 'get current song info',
    description: 'Get the current song info',
    schema: SongInfoSchema,
    emptyDescription: 'No song info',
  }),
  legacySong: readable({
    path: '/song-info',
    summary: 'get current song info',
    description: 'Get the current song info',
    schema: SongInfoSchema,
    emptyDescription: 'No song info',
    deprecated: true,
  }),

  // Queue
  queue: readable({
    path: '/queue',
    summary: 'get current queue info',
    description: 'Get the current queue info',
    schema: QueueSchema,
    emptyDescription: 'No queue info',
  }),
  legacyQueue: readable({
    path: '/queue-info',
    summary: 'get current queue info',
    description: 'Get the current queue info',
    schema: QueueSchema,
    emptyDescription: 'No queue info',
    deprecated: true,
  }),
  nextSong: readable({
    path: '/queue/next',
    summary: 'get next song info',
    description:
      'Get information about the next song in the queue (relative index +1)',
    schema: NextSongSchema,
    emptyDescription: 'No next song in queue',
  }),
  addToQueue: actionWithBody(
    'post',
    '/queue',
    'add song to queue',
    'Add a song to the queue',
    AddSongToQueueSchema,
  ),
  moveInQueue: createRoute({
    method: 'patch',
    path: `${API_PREFIX}/queue/{index}`,
    summary: 'move song in queue',
    description: 'Move a song in the queue',
    request: {
      params: QueueIndexParamSchema,
      body: body(MoveSongInQueueSchema),
    },
    responses: SUCCESS,
  }),
  removeFromQueue: createRoute({
    method: 'delete',
    path: `${API_PREFIX}/queue/{index}`,
    summary: 'remove song from queue',
    description: 'Remove a song from the queue',
    request: { params: QueueIndexParamSchema },
    responses: SUCCESS,
  }),
  setQueueIndex: actionWithBody(
    'patch',
    '/queue',
    'set queue index',
    'Set the current index of the queue',
    SetQueueIndexSchema,
  ),
  clearQueue: action('delete', '/queue', 'clear queue', 'Clear the queue'),

  // Search / navigation
  search: createRoute({
    method: 'post',
    path: `${API_PREFIX}/search`,
    summary: 'search for a song',
    description: 'search for a song',
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
    path: `${API_PREFIX}/loadVideo`,
    summary: 'load video',
    description: 'Loads a video given its ID',
    request: { body: body(LoadVideoSchema) },
    responses: SUCCESS,
  }),
  loadPlaylist: createRoute({
    method: 'post',
    path: `${API_PREFIX}/loadPlaylist`,
    summary: 'play playlist',
    description: 'Plays a playlist given its ID',
    request: { body: body(LoadPlaylistSchema) },
    responses: SUCCESS,
  }),
} as const;

/**
 * Waits for a single renderer IPC reply, rejecting after 5s so routes don't
 * hang. Removes only its own listener — removeAllListeners would kill other
 * plugins' pending listeners.
 */
const waitForIpcResponse = <T>(channel: string, request: () => void) =>
  new Promise<T>((resolve, reject) => {
    const listener = (_: unknown, payload: T) => {
      clearTimeout(timeout);
      ipcMain.removeListener(channel, listener);
      resolve(payload);
    };
    const timeout = setTimeout(() => {
      ipcMain.removeListener(channel, listener);
      reject(new Error(`Timed out waiting for IPC response on ${channel}`));
    }, 5_000);

    ipcMain.on(channel, listener);
    request();
  });

export const registerRoutes = (
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
