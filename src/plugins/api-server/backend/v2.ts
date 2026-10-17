import {
  type OpenAPIHono,
  createRoute,
  type z,
  type RouteConfig,
  type RouteHandler,
} from '@hono/zod-openapi';

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
} from './schemas-v2';
import { v2Tag } from './tags';
import { createVersion } from './version';
import { registerV2Websocket } from './websocket-v2';

import type { APIServerConfig } from '../config';
import type { Operations } from './operations';
import type { PlayerState } from './state';
import type { BackendContext } from '@/types/contexts';

/** A non-2xx JSON response, so a client can parse failures like successes. */
const errorResponse = (description: string) => ({
  description,
  content: { [JSON_CONTENT]: { schema: ErrorSchema } },
});

/** POST and PATCH twins for a setter: clients use either, both stay documented. */
const setters = (
  path: string,
  summary: string,
  description: string,
  schema: Parameters<typeof actionWithBody>[4],
  tags: string[],
) =>
  (['post', 'patch'] as const).map((method) =>
    actionWithBody(method, path, summary, description, schema, tags),
  );

const searchText = {
  summary: 'search for a song',
  description:
    'Search for a song and return its parsed results. GET takes the query string, POST and QUERY a JSON body.',
};

const browseText = {
  summary: 'browse a YouTube Music page',
  description:
    'Get curated info about a browse id page (album, playlist, artist, ...), or the raw response with `raw`; pass `continuation` for the next page. GET takes the query string, POST and QUERY a JSON body.',
};

export const createV2 = (
  ctx: BackendContext<APIServerConfig>,
  playerState: PlayerState,
  operations: Operations,
) =>
  createVersion('/api/v2', ctx, (app, wsPath) => {
    registerRoutes(app, operations);
    return registerV2Websocket(app, ctx, playerState, operations, wsPath, [
      v2Tag('WebSocket'),
    ]);
  });

/**
 * The route input, typed from the schema it is validated with. Only the type
 * comes from here: the zod-openapi version reviewdog installs infers the route
 * input differently, while the framework has already validated the value.
 */
const input = <T>(value: unknown) => value as T;

const registerRoutes = (app: OpenAPIHono, operations: Operations) => {
  const openapi = <R extends RouteConfig>(
    route: R,
    handler: RouteHandler<R>,
  ): void => {
    app.openapi(route, handler);
  };

  // Video
  openapi(
    readable({
      path: '/video',
      summary: 'get current video info',
      description: 'Get the current video as the unified song info object',
      schema: SongInfoSchema,
      emptyDescription: 'No video playing',
      tags: [v2Tag('Video')],
    }),
    async (ctx) => {
      const result = await operations.video();
      if (!result.ok) return ctx.json({ error: result.error }, result.status);
      return result.value ? ctx.json(result.value, 200) : noContent(ctx);
    },
  );
  openapi(
    action(
      'post',
      '/video/next',
      'play next song',
      'Plays the next song in the queue',
      [v2Tag('Video')],
    ),
    (ctx) => {
      operations.nextVideo();
      return noContent(ctx);
    },
  );
  // `/video/previous` is the documented alias; both paths share the handler.
  for (const path of ['/video/prev', '/video/previous']) {
    openapi(
      action(
        'post',
        path,
        'play previous song',
        `Plays the previous song in the queue${path.endsWith('previous') ? ' (alias of `/video/prev`)' : ''}`,
        [v2Tag('Video')],
      ),
      (ctx) => {
        operations.previousVideo();
        return noContent(ctx);
      },
    );
  }
  openapi(
    createRoute({
      method: 'post',
      path: '/video/play',
      summary: 'play a video',
      description: 'Replace the queue with the given video and play it',
      request: { body: body(PlayVideoSchema) },
      responses: SUCCESS,
      tags: [v2Tag('Video')],
    }),
    (ctx) => {
      operations.playVideo(ctx.req.valid('json').videoId);
      return noContent(ctx);
    },
  );
  openapi(
    createRoute({
      method: 'post',
      path: '/video/download',
      summary: 'download a video',
      description:
        'Download the current song, or `videoId`, with the downloader plugin. The plugin has to be enabled.',
      // Optional body: no `videoId` means the current song.
      request: { body: { ...body(DownloadVideoSchema), required: false } },
      responses: {
        204: { description: 'Success' },
        400: errorResponse('No video is playing and no videoId was given'),
        404: errorResponse('The downloader plugin is disabled'),
      },
      tags: [v2Tag('Video')],
    }),
    async (ctx) => {
      const result = await operations.downloadVideo(
        ctx.req.valid('json')?.videoId,
      );
      if (!result.ok) return ctx.json({ error: result.error }, result.status);
      return noContent(ctx);
    },
  );

  // `/video/search`: GET reads the query string, POST and QUERY a JSON body.
  openapi(
    readable({
      path: '/video/search',
      ...searchText,
      schema: SearchResponseSchema,
      query: SearchQuerySchema,
      tags: [v2Tag('Video')],
    }),
    async (ctx) => {
      const query = input<z.infer<typeof SearchQuerySchema>>(
        ctx.req.valid('query'),
      );
      const result = await operations.search({
        query: query.query,
        params: query.params,
        continuation: query.continuation,
        raw: query.raw === 'true',
      });
      if (!result.ok) return ctx.json({ error: result.error }, result.status);
      return ctx.json(result.value, 200);
    },
  );
  for (const method of ['post', 'query'] as const) {
    openapi(
      createRoute({
        method,
        path: '/video/search',
        ...searchText,
        request: { body: body(SearchSchema) },
        responses: {
          200: {
            description: 'Success',
            content: { [JSON_CONTENT]: { schema: SearchResponseSchema } },
          },
          502: errorResponse('The player did not answer'),
        },
        tags: [v2Tag('Video')],
      }),
      async (ctx) => {
        const request = input<z.infer<typeof SearchSchema>>(
          ctx.req.valid('json'),
        );
        const result = await operations.search({
          query: request.query,
          params: request.params,
          continuation: request.continuation,
          raw: request.raw === true,
        });
        if (!result.ok) {
          return ctx.json({ error: result.error }, result.status);
        }
        return ctx.json(result.value, 200);
      },
    );
  }

  // `/browse`: same three shapes as search.
  openapi(
    readable({
      path: '/browse',
      ...browseText,
      schema: BrowseResponseSchema,
      query: BrowseQuerySchema,
      tags: [v2Tag('Video')],
    }),
    async (ctx) => {
      const query = input<z.infer<typeof BrowseQuerySchema>>(
        ctx.req.valid('query'),
      );
      const result = await operations.browse({
        browseId: query.browseId,
        continuation: query.continuation,
        raw: query.raw === 'true',
      });
      if (!result.ok) return ctx.json({ error: result.error }, result.status);
      return ctx.json(result.value, 200);
    },
  );
  for (const method of ['post', 'query'] as const) {
    openapi(
      createRoute({
        method,
        path: '/browse',
        ...browseText,
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
      async (ctx) => {
        const request = input<z.infer<typeof BrowseRequestSchema>>(
          ctx.req.valid('json'),
        );
        const result = await operations.browse({
          browseId: request.browseId,
          continuation: request.continuation,
          raw: request.raw === true,
        });
        if (!result.ok) {
          return ctx.json({ error: result.error }, result.status);
        }
        return ctx.json(result.value, 200);
      },
    );
  }

  openapi(
    createRoute({
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
        502: errorResponse('The player did not answer'),
      },
    }),
    async (ctx) => {
      const result = await operations.lyrics(ctx.req.valid('query').videoId);
      if (!result.ok) return ctx.json({ error: result.error }, result.status);
      return result.value ? ctx.json(result.value, 200) : noContent(ctx);
    },
  );
  openapi(
    createRoute({
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
    async (ctx) => {
      const result = await operations.lyricsTranslations(
        ctx.req.valid('query').videoId,
      );
      if (!result.ok) return ctx.json({ error: result.error }, result.status);
      return ctx.json(result.value, 200);
    },
  );
  openapi(
    createRoute({
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
    async (ctx) => {
      const { lang, videoId } = ctx.req.valid('json');
      const result = await operations.translateLyrics(lang, videoId);
      if (!result.ok) return ctx.json({ error: result.error }, result.status);
      return ctx.json(result.value, 200);
    },
  );

  // Playback
  openapi(
    readable({
      path: '/playback',
      summary: 'get playing state',
      description: 'Get whether the player is currently playing',
      schema: PlayingStateSchema,
      tags: [v2Tag('Playback')],
    }),
    (ctx) => ctx.json({ state: operations.playing() }, 200),
  );
  for (const [path, command, summary, description] of [
    [
      '/playback/play',
      'play',
      'Play',
      'Change the state of the player to play',
    ],
    [
      '/playback/pause',
      'pause',
      'Pause',
      'Change the state of the player to pause',
    ],
    [
      '/playback/toggle',
      'togglePlay',
      'Toggle play/pause',
      'Change the state of the player to play if paused, or pause if playing',
    ],
  ] as const) {
    openapi(
      action('post', path, summary, description, [v2Tag('Playback')]),
      (ctx) => {
        operations[command]();
        return noContent(ctx);
      },
    );
  }
  openapi(
    readable({
      path: '/playback/speed',
      summary: 'get playback speed',
      description: 'Get the current playback speed',
      schema: PlaybackSpeedSchema,
      tags: [v2Tag('Playback')],
    }),
    (ctx) => ctx.json({ speed: operations.playbackSpeed() }, 200),
  );
  for (const route of setters(
    '/playback/speed',
    'set playback speed',
    'Set the playback speed',
    SetPlaybackSpeedSchema,
    [v2Tag('Playback')],
  )) {
    openapi(route, (ctx) => {
      const { speed } = ctx.req.valid('json') as z.infer<
        typeof SetPlaybackSpeedSchema
      >;
      operations.setPlaybackSpeed(speed);
      return noContent(ctx);
    });
  }
  openapi(
    readable({
      path: '/playback/position',
      summary: 'get playback position',
      description:
        'Get the current playback position: a 0..1 fraction of the song when `percentage=true`, seconds otherwise',
      schema: PlaybackPositionSchema,
      query: PlaybackPositionQuerySchema,
      tags: [v2Tag('Playback')],
    }),
    async (ctx) => {
      const result = await operations.playbackPosition(
        ctx.req.valid('query').percentage === 'true',
      );
      if (!result.ok) return ctx.json({ error: result.error }, result.status);
      return ctx.json({ position: result.value }, 200);
    },
  );
  for (const route of setters(
    '/playback/position',
    'seek',
    'Seek to a specific time in the current song',
    SeekSchema,
    [v2Tag('Playback')],
  )) {
    openapi(route, (ctx) => {
      const { seconds } = ctx.req.valid('json') as z.infer<typeof SeekSchema>;
      operations.seekTo(seconds);
      return noContent(ctx);
    });
  }
  openapi(
    actionWithBody(
      'post',
      '/playback/position/seek-by',
      'seek by',
      'Move the current song forward or backward by a number of seconds',
      SeekSchema,
      [v2Tag('Playback')],
    ),
    (ctx) => {
      operations.seekBy(ctx.req.valid('json').seconds);
      return noContent(ctx);
    },
  );
  openapi(
    readable({
      path: '/playback/shuffle',
      summary: 'get shuffle state',
      description: 'Get the current shuffle state',
      schema: ShuffleStateSchema,
      tags: [v2Tag('Playback')],
    }),
    (ctx) => ctx.json({ state: operations.shuffleState() }, 200),
  );
  openapi(
    action('post', '/playback/shuffle', 'shuffle', 'Shuffle the queue', [
      v2Tag('Playback'),
    ]),
    (ctx) => {
      operations.shuffleQueue();
      return noContent(ctx);
    },
  );
  for (const route of setters(
    '/playback/shuffle',
    'set shuffle',
    'Enable or disable shuffle',
    SetShuffleSchema,
    [v2Tag('Playback')],
  )) {
    openapi(route, (ctx) => {
      const { enabled } = ctx.req.valid('json') as z.infer<
        typeof SetShuffleSchema
      >;
      operations.setShuffle(enabled);
      return noContent(ctx);
    });
  }
  openapi(
    readable({
      path: '/playback/repeat',
      summary: 'get current repeat mode',
      description: 'Get the current repeat mode (NONE, ALL, ONE)',
      schema: RepeatModeSchema,
      tags: [v2Tag('Playback')],
    }),
    (ctx) => ctx.json({ mode: operations.repeatMode() }, 200),
  );
  for (const route of setters(
    '/playback/repeat',
    'set repeat mode',
    'Set the repeat mode',
    SetRepeatSchema,
    [v2Tag('Playback')],
  )) {
    openapi(route, (ctx) => {
      const { mode } = ctx.req.valid('json') as z.infer<typeof SetRepeatSchema>;
      operations.setRepeat(mode);
      return noContent(ctx);
    });
  }
  openapi(
    action(
      'post',
      '/playback/repeat/next',
      'switch repeat',
      'Switch to the next repeat mode',
      [v2Tag('Playback')],
    ),
    (ctx) => {
      operations.switchRepeat();
      return noContent(ctx);
    },
  );

  // Volume
  openapi(
    readable({
      path: '/volume',
      summary: 'get volume',
      description: 'Get the current volume of the player',
      schema: VolumeSchema,
      tags: [v2Tag('Volume')],
    }),
    (ctx) => ctx.json({ volume: operations.volume() }, 200),
  );
  for (const route of setters(
    '/volume',
    'set volume',
    'Set the volume of the player',
    SetVolumeSchema,
    [v2Tag('Volume')],
  )) {
    openapi(route, (ctx) => {
      const { volume } = ctx.req.valid('json') as z.infer<
        typeof SetVolumeSchema
      >;
      operations.setVolume(volume);
      return noContent(ctx);
    });
  }
  openapi(
    readable({
      path: '/volume/mute',
      summary: 'get mute state',
      description: 'Get whether the player is muted',
      schema: MuteStateSchema,
      tags: [v2Tag('Volume')],
    }),
    (ctx) => ctx.json({ muted: operations.muteState() }, 200),
  );
  for (const route of setters(
    '/volume/mute',
    'set mute',
    'Mute or unmute the player',
    SetMuteSchema,
    [v2Tag('Volume')],
  )) {
    openapi(route, (ctx) => {
      const { muted } = ctx.req.valid('json') as z.infer<typeof SetMuteSchema>;
      operations.setMute(muted);
      return noContent(ctx);
    });
  }
  openapi(
    action('post', '/volume/unmute', 'unmute', 'Unmute the player', [
      v2Tag('Volume'),
    ]),
    (ctx) => {
      operations.setMute(false);
      return noContent(ctx);
    },
  );
  openapi(
    action(
      'post',
      '/volume/toggle-mute',
      'toggle mute',
      'Toggle the mute state of the player',
      [v2Tag('Volume')],
    ),
    (ctx) => {
      operations.toggleMute();
      return noContent(ctx);
    },
  );

  // Rating
  openapi(
    readable({
      path: '/rating',
      summary: 'get like state',
      description: 'Get the current like state',
      schema: LikeStateSchema,
      tags: [v2Tag('Rating')],
    }),
    (ctx) => ctx.json({ state: operations.likeState() }, 200),
  );
  openapi(
    actionWithBody(
      'post',
      '/rating',
      'set like state',
      'Set the like state of the current song',
      SetLikeStateSchema,
      [v2Tag('Rating')],
    ),
    (ctx) => {
      operations.setLikeState(ctx.req.valid('json').state);
      return noContent(ctx);
    },
  );
  for (const [path, command, summary, description] of [
    ['/rating/like', 'like', 'like song', 'Set the current song as liked'],
    [
      '/rating/dislike',
      'dislike',
      'dislike song',
      'Set the current song as disliked',
    ],
    [
      '/rating/unlike',
      'unlike',
      'unlike song',
      'Clear the like state of the current song',
    ],
  ] as const) {
    openapi(
      action('post', path, summary, description, [v2Tag('Rating')]),
      (ctx) => {
        operations[command]();
        return noContent(ctx);
      },
    );
  }

  // Queue
  openapi(
    readable({
      path: '/queue',
      summary: 'get current queue info',
      description:
        "Get the current queue info. Add `raw=true` to include each item's raw YouTube Music renderer.",
      schema: QueueSchema,
      query: QueueQuerySchema,
      emptyDescription: 'No queue info',
      tags: [v2Tag('Queue')],
    }),
    async (ctx) => {
      const result = await operations.queue(
        ctx.req.valid('query').raw === 'true',
      );
      if (!result.ok) return ctx.json({ error: result.error }, result.status);
      return result.value ? ctx.json(result.value, 200) : noContent(ctx);
    },
  );
  openapi(
    actionWithBody(
      'post',
      '/queue',
      'add songs to queue',
      'Add songs to the queue',
      AddToQueueSchema,
      [v2Tag('Queue')],
    ),
    (ctx) => {
      const { videoIds, playlistIds, insertPosition } = ctx.req.valid('json');
      operations.addToQueue(
        videoIds ?? [],
        playlistIds ?? [],
        insertPosition ?? 'INSERT_AFTER_CURRENT_VIDEO',
      );
      return noContent(ctx);
    },
  );
  openapi(
    createRoute({
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
    (ctx) => {
      operations.moveInQueue(
        ctx.req.valid('param').index,
        ctx.req.valid('json').toIndex,
      );
      return noContent(ctx);
    },
  );
  openapi(
    createRoute({
      method: 'delete',
      path: '/queue/{index}',
      summary: 'remove song from queue',
      description: 'Remove the song at `index` from the queue',
      request: { params: QueueIndexParamSchema },
      responses: SUCCESS,
      tags: [v2Tag('Queue')],
    }),
    (ctx) => {
      operations.removeFromQueue(ctx.req.valid('param').index);
      return noContent(ctx);
    },
  );
  openapi(
    actionWithBody(
      'post',
      '/queue/index',
      'set queue index',
      'Set the current index of the queue',
      SetQueueIndexSchema,
      [v2Tag('Queue')],
    ),
    (ctx) => {
      operations.setQueueIndex(ctx.req.valid('json').index);
      return noContent(ctx);
    },
  );
  openapi(
    createRoute({
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
    async (ctx) => {
      const query = ctx.req.valid('query');
      const result = await operations.autoplay(
        query.raw === 'true',
        query.continuation,
      );
      if (!result.ok) return ctx.json({ error: result.error }, result.status);
      return ctx.json(result.value, 200);
    },
  );
  openapi(
    action('delete', '/queue', 'clear queue', 'Clear the queue', [
      v2Tag('Queue'),
    ]),
    (ctx) => {
      operations.clearQueue();
      return noContent(ctx);
    },
  );

  // Config: `/pear/settings` is the documented alias of `/pear/config`.
  for (const path of ['/pear/config', '/pear/settings']) {
    const alias = path.endsWith('settings');
    openapi(
      readable({
        path,
        summary: 'get the app config',
        description: alias
          ? 'Alias of `GET /pear/config`'
          : 'Get the app config as stored on disk',
        schema: ConfigSchema,
        tags: [v2Tag('Config')],
      }),
      (ctx) => ctx.json(operations.getConfig(), 200),
    );
    openapi(
      actionWithBody(
        'patch',
        path,
        'change the app config',
        alias
          ? 'Alias of `PATCH /pear/config`'
          : 'Deep-merge a partial config into the stored one',
        ConfigSchema,
        [v2Tag('Config')],
      ),
      (ctx) => {
        operations.patchConfig(ctx.req.valid('json'));
        return noContent(ctx);
      },
    );
  }

  // App
  openapi(
    readable({
      path: '/pear',
      summary: 'get app metadata',
      description:
        'The app version, build, platform, CPU, GPU and memory info, as the settings window shows it',
      schema: AppMetaSchema,
      tags: [v2Tag('Config')],
    }),
    async (ctx) => ctx.json(await operations.appMeta(), 200),
  );
  openapi(
    readable({
      path: '/pear/feature-flags',
      summary: 'get feature flags',
      description:
        'Every feature flag the page carries or the user overrode, with its effective value',
      schema: FeatureFlagsSchema,
      tags: [v2Tag('Config')],
    }),
    async (ctx) => ctx.json({ flags: await operations.featureFlags() }, 200),
  );
  openapi(
    actionWithBody(
      'patch',
      '/pear/feature-flags',
      'set feature flag overrides',
      'Apply the given flags as overrides, live where the page allows it',
      FeatureFlagOverridesSchema,
      [v2Tag('Config')],
    ),
    async (ctx) => {
      await operations.patchFeatureFlags(ctx.req.valid('json'));
      return noContent(ctx);
    },
  );
  openapi(
    actionWithBody(
      'delete',
      '/pear/feature-flags',
      'remove feature flag overrides',
      'Drop the overrides for the given flags',
      FeatureFlagDeleteSchema,
      [v2Tag('Config')],
    ),
    async (ctx) => {
      await operations.deleteFeatureFlags(ctx.req.valid('json').flags);
      return noContent(ctx);
    },
  );
};
