import { z } from '@hono/zod-openapi';

import {
  QueryFlagSchema,
  RepeatModeEnum,
  ShuffleStateSchema,
  SongInfoBaseSchema,
  VideoIdQuerySchema,
} from './schemas-common';

export {
  LikeStateSchema,
  QueueIndexParamSchema,
  RepeatModeSchema,
  SeekSchema,
  SetLikeStateSchema,
  SetQueueIndexSchema,
  SetVolumeSchema,
  ShuffleStateSchema,
} from './schemas-common';

/** Body of every non-2xx JSON response, so clients can parse failures too. */
export const ErrorSchema = z.object({
  error: z.string().describe('What went wrong'),
});

// Request bodies
export const SetPlaybackSpeedSchema = z.object({
  speed: z.number().describe('Playback speed, where 1 is normal'),
});

export const SetShuffleSchema = z.object({
  enabled: z.boolean(),
});

export const SetRepeatSchema = z.object({
  mode: RepeatModeEnum,
});

export const SetMuteSchema = z.object({
  muted: z.boolean(),
});

export const AddToQueueSchema = z
  .object({
    videoIds: z
      .array(z.string())
      .optional()
      .describe('Video IDs to add to the queue'),
    playlistIds: z
      .array(z.string())
      .optional()
      .describe('Playlist IDs whose tracks are added to the queue'),
    insertPosition: z
      .enum(['INSERT_AFTER_CURRENT_VIDEO', 'INSERT_AT_END'])
      .optional()
      .describe('Defaults to INSERT_AFTER_CURRENT_VIDEO'),
  })
  .refine(
    (body) => Boolean(body.videoIds?.length || body.playlistIds?.length),
    {
      message: 'Provide videoIds or playlistIds',
    },
  );

export const PlayVideoSchema = z.object({
  videoId: z.string().describe('Video ID to play'),
});

export const DownloadVideoSchema = z.object({
  videoId: z
    .string()
    .optional()
    .describe('Video to download; defaults to the current song'),
});

/** The app config as stored; `PATCH` takes the same shape and deep-merges it. */
export const ConfigSchema = z.record(z.string(), z.unknown());

/** Body of `PATCH /pear/feature-flags`: flag name to override, per entry. */
export const FeatureFlagOverridesSchema = z.record(z.string(), z.unknown());

/** Body of `DELETE /pear/feature-flags`. */
export const FeatureFlagDeleteSchema = z.object({
  flags: z.array(z.string()).describe('Flags whose override is removed'),
});

/** Body of `POST|QUERY /browse`. */
export const BrowseRequestSchema = z
  .object({
    browseId: z.string().optional().describe('The page to browse'),
    continuation: z
      .string()
      .optional()
      .describe('Fetch the next page from this token'),
    raw: z
      .boolean()
      .optional()
      .describe(
        'Return the raw YouTube Music response instead of curated info',
      ),
  })
  .refine((body) => Boolean(body.browseId || body.continuation), {
    message: 'Provide browseId or continuation',
  });

export const MoveInQueueSchema = z.object({
  toIndex: z.number().describe('Index to move the song to'),
});

export const SearchSchema = z.object({
  query: z.string(),
  params: z.string().optional(),
  continuation: z.string().optional(),
  raw: z
    .boolean()
    .optional()
    .describe(
      'Return the raw YouTube Music response instead of parsed results',
    ),
});

// Query strings
export const SearchQuerySchema = z.object({
  query: z.string(),
  params: z.string().optional(),
  continuation: z.string().optional(),
  raw: QueryFlagSchema.optional().describe(
    'Return the raw YouTube Music response instead of parsed results',
  ),
});

export const QueueQuerySchema = z.object({
  raw: QueryFlagSchema.optional().describe(
    "Include each item's raw YouTube Music renderer",
  ),
});

export const PlaybackPositionQuerySchema = z.object({
  percentage: QueryFlagSchema.optional().describe(
    'Report a 0..1 fraction of the song instead of seconds',
  ),
});

export const LyricsTranslationsQuerySchema = VideoIdQuerySchema;

export const LyricsQuerySchema = VideoIdQuerySchema;

export const AutoplayQuerySchema = z.object({
  raw: QueryFlagSchema.optional().describe(
    "Include each item's raw YouTube Music renderer",
  ),
  continuation: z
    .string()
    .optional()
    .describe('Fetch the next page from this token'),
});

export const BrowseQuerySchema = z
  .object({
    browseId: z.string().optional().describe('The page to browse'),
    continuation: z
      .string()
      .optional()
      .describe('Fetch the next page from this token'),
    raw: QueryFlagSchema.optional().describe(
      'Return the raw YouTube Music response instead of curated info',
    ),
  })
  .refine((query) => Boolean(query.browseId || query.continuation), {
    message: 'Provide browseId or continuation',
  });

// Responses
/** `GET /pear`: the debug info the settings window's About section shows. */
export const AppMetaSchema = z.object({
  name: z.string(),
  version: z.string(),
  build: z.string(),
  copyright: z.string(),
  platform: z.string(),
  arch: z.string(),
  osVersion: z.string(),
  versions: z.object({
    electron: z.string(),
    chrome: z.string(),
    node: z.string(),
  }),
  cpu: z.object({ model: z.string(), threads: z.number() }),
  gpu: z.object({
    renderer: z.string().optional(),
    vendor: z.string().optional(),
    driver: z.string().optional(),
    features: z.record(z.string(), z.string()),
  }),
  memory: z.object({
    main: z.number(),
    renderers: z.number(),
    gpu: z.number(),
  }),
});

/** One feature flag: its effective value and whether it is an override. */
const FeatureFlagSchema = z.object({
  name: z.string(),
  value: z.unknown(),
  overridden: z.boolean(),
});

/** `GET /pear/feature-flags`: every flag the page has or the user overrode. */
export const FeatureFlagsSchema = z.object({
  flags: z.array(FeatureFlagSchema),
});

/** The unified song info: the v1 shape plus what only v2 documents. */
export const SongInfoSchema = SongInfoBaseSchema.extend({
  alternativeTitle: z.string().optional(),
  artistUrl: z.string().optional(),
  tags: z.array(z.string()).optional(),
  scrobbleTitle: z.string(),
  scrobbleArtist: z.string(),
});
export type ResponseSongInfo = z.infer<typeof SongInfoSchema>;

/** `/playback` reports the same boolean state `/playback/shuffle` does. */
export const PlayingStateSchema = ShuffleStateSchema;

export const PlaybackSpeedSchema = z.object({
  speed: z.number(),
});

export const PlaybackPositionSchema = z.object({
  position: z.number(),
});

export const VolumeSchema = z.object({
  volume: z.number(),
});

export const MuteStateSchema = z.object({
  muted: z.boolean(),
});

/** One thumbnail size, as YouTube Music reports it. */
const ThumbnailSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

/** One queue entry, mapped from the item's raw playlist panel renderer. */
const QueueItemSchema = z.object({
  videoId: z.string(),
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  year: z
    .string()
    .optional()
    .describe('Set when the byline carries a release year'),
  duration: z.string().optional().describe('As shown, for example "4:21"'),
  thumbnails: z
    .array(ThumbnailSchema)
    .optional()
    .describe('Every size YouTube Music offers'),
  thumbnail: z.string().optional().describe('The largest thumbnail'),
  url: z.string().describe('The watch URL for the item'),
  selected: z.boolean().describe('Whether this is the item being played'),
  index: z
    .number()
    .describe(
      'Position in the queue, for the move, remove and set-index endpoints',
    ),
  playlistSetVideoId: z.string().optional(),
  canReorder: z.boolean(),
  renderer: z
    .unknown()
    .optional()
    .describe('The raw renderer, only with `raw=true`'),
});

/** Queue as produced by the renderer, one entry per playable item. */
export const QueueSchema = z.object({
  autoplay: z.boolean().optional(),
  isInfinite: z.boolean().optional(),
  items: z.array(QueueItemSchema).optional(),
  nextQueueItemId: z.string().optional(),
  playbackContentMode: z.string().optional(),
  repeatMode: RepeatModeEnum.optional(),
  currentPlayingItemId: z.number().optional(),
  shuffleEnabled: z.boolean().optional(),
  continuation: z.string().optional(),
});
export type ResponseQueue = z.infer<typeof QueueSchema>;

/** Autoplay entries, which the queue store keeps outside `items`. */
export const AutoplaySchema = z.object({
  items: z.array(QueueItemSchema),
  continuation: z.string().optional(),
});
export type ResponseAutoplay = z.infer<typeof AutoplaySchema>;

/** One search result; exactly one of `videoId`/`browseId` is set. */
const SearchResultItemSchema = z.object({
  title: z.string().optional(),
  artist: z.string().optional(),
  type: z.string().optional(),
  thumbnail: z.string().optional().describe('The largest thumbnail'),
  thumbnails: z
    .array(ThumbnailSchema)
    .optional()
    .describe('Every size YouTube Music offers'),
  videoId: z.string().optional().describe('Set for songs, videos and episodes'),
  browseId: z
    .string()
    .optional()
    .describe(
      'Set for playlists, albums, artists, podcasts, profiles and singles',
    ),
  url: z.string().optional().describe('The YouTube Music page the id opens'),
});

/** `GET|POST|QUERY /video/search` returns the renderer's parsed results. */
export const SearchResultSchema = z.object({
  query: z.string().describe('The query the results answer'),
  results: z.array(SearchResultItemSchema),
});

/** Search answers with the parsed results, or the raw response with `raw`. */
export const SearchResponseSchema = z.union([
  SearchResultSchema,
  z.record(z.string(), z.unknown()),
]);
export type ResponseSearch = z.infer<typeof SearchResponseSchema>;

/** `GET|POST|QUERY /browse` returns curated page info. */
export const BrowseResultSchema = z.object({
  browseId: z.string().nullable().describe('The page that was browsed'),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  thumbnail: z.string().optional().describe('The largest thumbnail'),
  thumbnails: z
    .array(ThumbnailSchema)
    .optional()
    .describe('Every size YouTube Music offers'),
  results: z
    .array(SearchResultItemSchema)
    .describe('Parsed items, in page order'),
  continuation: z.string().optional(),
});

/** Browse answers with the curated page, or the raw response with `raw`. */
export const BrowseResponseSchema = z.union([
  BrowseResultSchema,
  z.record(z.string(), z.unknown()),
]);
export type ResponseBrowseRaw = z.infer<typeof BrowseResponseSchema>;

/** One line of synced lyrics; the UI-only `status` field is not reported. */
const LyricsLineSchema = z.object({
  time: z.string().describe('As shown, for example "00:12:00"'),
  timeInMs: z.number().describe('When the line starts, in milliseconds'),
  duration: z.number().describe('Milliseconds the line is shown for'),
  text: z.string(),
});

/** One provider's lyrics for the current song. */
export const LyricsProviderSchema = z.object({
  provider: z.string().describe('The lyrics provider that found these'),
  state: z
    .enum(['fetching', 'done', 'error'])
    .describe('Whether that provider has finished, and how'),
  title: z.string(),
  artists: z.array(z.string()),
  lyrics: z.string().optional().describe('Plain, unsynced lyrics'),
  lines: z.array(LyricsLineSchema).optional().describe('Time-synced lyrics'),
  translation: z
    .object({
      lyrics: z.string().optional(),
      lines: z.array(LyricsLineSchema).optional(),
      language: z.string().optional(),
      provider: z.string().optional(),
    })
    .optional()
    .describe('An official translation the provider ships with the lyrics'),
});

/** `GET /video/lyrics` reports every provider that found lyrics. */
export const LyricsSchema = z.object({
  videoId: z.string().nullable().describe('The song the lyrics belong to'),
  activeProvider: z
    .string()
    .nullable()
    .describe('The provider the lyrics tab is showing, null with no song'),
  providers: z
    .array(LyricsProviderSchema)
    .describe('Every provider with lyrics, in priority order'),
});
export type ResponseLyrics = z.infer<typeof LyricsSchema>;

/** One cached translation of the current song. */
const CachedTranslationSchema = z.object({
  language: z.string().describe('The language it was translated into'),
  provider: z.string().describe('The translation provider that produced it'),
  model: z.string().describe('The model the provider used'),
  title: z.string(),
  artists: z.array(z.string()),
  createdAt: z.number().describe('Unix milliseconds'),
  lines: z
    .array(z.string())
    .describe('The translated lines, in the source lyrics order'),
});

/**
 * `GET /video/lyrics/translations` lists the cached translations of the current
 * song. Entries written under an older `TRANSLATION_STRATEGY_VERSION` are not
 * listed, so this can be empty while translation files exist on disk.
 */
export const LyricsTranslationsSchema = z.object({
  videoId: z
    .string()
    .nullable()
    .describe('The song the translations belong to, null with no song playing'),
  translations: z.array(CachedTranslationSchema),
});
export type ResponseLyricsTranslations = z.infer<
  typeof LyricsTranslationsSchema
>;

/** Body of `POST /video/lyrics/translations`. */
export const LyricsTranslationRequestSchema = z.object({
  // Trimmed, so a whitespace-only `lang` is rejected here as a 400 instead of
  // reaching the renderer, whose reply cannot tell "blank" apart from "the
  // plugin is off" — the backend would then answer with the wrong message.
  lang: z
    .string()
    .trim()
    .min(1)
    .describe('Language to translate the current lyrics into'),
  videoId: z
    .string()
    .optional()
    .describe('Translate this video instead of the current song'),
});

/** `POST /video/lyrics/translations` runs a translation for one language. */
export const LyricsTranslationSchema = z.object({
  videoId: z.string().nullable().describe('The song that was translated'),
  language: z.string().describe('The language it was translated into'),
  provider: z
    .string()
    .nullable()
    .describe(
      'The translation provider, null when translation is unconfigured',
    ),
  lines: z
    .array(z.string())
    .describe(
      'The translated lines, or the original ones when `sameLanguage`, in the source lyrics order',
    ),
  fromCache: z
    .boolean()
    .optional()
    .describe('Whether the on-disk translation cache answered'),
  sameLanguage: z
    .boolean()
    .optional()
    .describe(
      'Set when the lyrics were already in the requested language, so the original lines are returned',
    ),
});
export type ResponseLyricsTranslation = z.infer<typeof LyricsTranslationSchema>;
