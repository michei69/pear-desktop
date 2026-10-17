import type { GetPlayerResponse } from '@/types/get-player-response';

/**
 * Everything derivable from a raw player response, with no Electron or config
 * access, so the main process (the song-info provider) and the renderer (the
 * API server's v2 actions) build the exact same object.
 */

export enum MediaType {
  /** Audio uploaded by the original artist */
  Audio = 'AUDIO',
  /** Official music video uploaded by the original artist */
  OriginalMusicVideo = 'ORIGINAL_MUSIC_VIDEO',
  /** Normal video uploaded by a user */
  UserGeneratedContent = 'USER_GENERATED_CONTENT',
  PodcastEpisode = 'PODCAST_EPISODE',
  OtherVideo = 'OTHER_VIDEO',
}

export interface SongInfoData {
  title: string;
  alternativeTitle?: string;
  artist: string;
  artistUrl?: string;
  views: number;
  uploadDate?: string;
  imageSrc?: string | null;
  isPaused?: boolean;
  songDuration: number;
  elapsedSeconds?: number;
  url?: string;
  album?: string | null;
  videoId: string;
  playlistId?: string;
  mediaType: MediaType;
  tags?: string[];
  /** `title` after the scrobbler's alternative-title and regex filters. */
  scrobbleTitle: string;
  /** `artist` after the scrobbler's alternative-artist and regex filters. */
  scrobbleArtist: string;
}

/** Scrobbler settings that change the title and artist it submits. */
export interface ScrobbleOptions {
  alternativeTitles?: boolean;
  alternativeArtist?: boolean;
  customRegexFilters?: string[];
}

export interface BuildSongInfoOptions extends ScrobbleOptions {
  /** Use the podcast's page owner as the artist instead of the video author. */
  usePodcastParticipantAsArtist?: boolean;
}

const suffixesToRemove = [
  // Artist names
  /\s*(- topic)$/gi,
  /\s*vevo$/gi,

  // Video titles — bracket-enclosed tags (combined)
  /\s*[(|[](official(.*?)|(lyrics?|visualizer|audio)\s*(video)?|performance video|clip official|video version)[)|\]]/gi,
  /\s*[(|[]((HD|HQ)\s*?(?:audio)?|live|4K\s*?(?:upgrade)?)[)|\]]$/gim,
];

export function cleanupName(name: string): string {
  if (!name) {
    return name;
  }

  for (const suffix of suffixesToRemove) {
    name = name.replace(suffix, '');
  }

  return name;
}

/**
 * The scrobbler's own default filters, kept here so a caller that only has the
 * stored (unmerged) plugin config still filters the way the scrobbler does.
 */
export const defaultScrobbleFilters = [
  // (Explicit) or [Explicit] or Clean
  '\\s[([]Explicit[)\\]]',
  '\\s[([]Clean[)\\]]',
  // Features
  '\\s[([]feat\\. [^)\\]]+[)\\]]',
  '\\s[([]ft\\. [^)\\]]+[)\\]]',
  // Live
  '\\s-\\sLive(\\s.+)?$',
  '\\s[([]Live[)\\]]$',
  // Parodies and adaptations
  '\\s\\(Parody of ".*" by .*\\)$',
  '\\s\\(Lyrical Adaption of ".*"\\)$',
  // Re-issue
  '\\sRe-?issue$',
  '\\s\\[.*?Re-?issue.*?\\]',
  '\\s\\(.*?Re-?issue.*?\\)',
  // Remastered
  'Live\\s\\/\\sRemastered',
  '\\s[([][^)\\]]*Re-?[Mm]aster(ed)?[^)\\]]*[)\\]]$',
  '\\s-\\s\\d{4}(\\s-)?\\s.*Re-?[Mm]aster(ed)?.*$',
  '\\s-\\sRe-?[Mm]aster(ed)?.*$',
  '\\s\\[Remastered\\]\\s\\(Remastered\\sVersion\\)$',
  // Versions
  '\\s[([]Album Version[)\\]]$',
  '\\s[([]Re-?recorded[)\\]]$',
  '\\s[([]Single Version[)\\]]$',
  '\\s[([]Edit[)\\]]$',
  '\\s-\\sMono Version$',
  '\\s-\\sStereo Version$',
  '\\s\\(Deluxe Edition\\)$',
  '\\s[([]Expanded.*[)\\]]$',
  '\\s-\\sExpanded Edition$',
  '\\s[([]Explicit Version[)\\]]',
  '\\s[([]Bonus Track Edition[)\\]]',
  '\\s[([]\\d+th\\sAnniversary.*[)\\]]',
  '\\s-\\sOriginal$',
  '\\s-\\sOriginal.*Version(\\s\\d{4})?$',
  // YouTube specific
  '\\*+\\s?\\S+\\s?\\*+$',
  '\\[[^\\]]+\\]',
  '【[^】]+】',
  '（[^）]+）',
  '\\([^)]*version\\)$',
  '\\.(avi|wmv|mpg|mpeg|flv)$',
  '\\(.*lyrics?\\s*(video)?\\)',
  '\\((of+icial\\s*)?(track\\s*)?stream\\)',
  '\\((of+icial\\s*)?((music|hd)\\s*)?(video|audio)\\)',
  '-\\s(of+icial\\s*)?(music\\s*)?(video|audio)$',
  '\\(.*Album\\sTrack\\)',
  '\\(\\s*of+icial\\s*\\)',
  '\\(\\s*[0-9]{4}\\s*\\)',
  '\\(\\s*(HD|HQ)\\s*\\)$',
  '(HD|HQ)\\s?$',
  '(vid[\u00E9e]o)?\\s?clip\\sof+ici[ae]l',
  'of+iziel+es\\s*video',
  'vid[\u00E9e]o\\s?clip',
  '\\sclip',
  'full\\s*album',
  '\\(live.*?\\)$',
  '\\|.*$',
  '\\(.*[0-9]{1,2}\\/[0-9]{1,2}\\/[0-9]{2,4}.*\\)',
  'sub\\s*español',
  '\\s\\(Letra\\)',
  '\\s\\(En\\svivo\\)',
];

/**
 * The title and artist the scrobbler submits: its alternative-title and
 * alternative-artist switches, then its custom regex filters. MusicBrainz
 * correction stays in the scrobbler, which is the only thing that can await it.
 */
export const getScrobbleMetadata = (
  {
    title,
    alternativeTitle,
    artist,
    tags,
  }: Pick<SongInfoData, 'title' | 'alternativeTitle' | 'artist' | 'tags'>,
  {
    alternativeTitles = true,
    alternativeArtist = true,
    customRegexFilters = defaultScrobbleFilters,
  }: ScrobbleOptions = {},
) => {
  let scrobbleTitle =
    alternativeTitles && alternativeTitle ? alternativeTitle : title;
  let scrobbleArtist = alternativeArtist && tags?.[0] ? tags[0] : artist;

  for (const filter of customRegexFilters) {
    try {
      const regex = new RegExp(filter, 'gi');
      if (scrobbleTitle.length <= 256) {
        scrobbleTitle = scrobbleTitle.replace(regex, '').trim();
      }
      if (scrobbleArtist.length <= 256) {
        scrobbleArtist = scrobbleArtist.replace(regex, '').trim();
      }
    } catch {
      // A user-supplied regex that doesn't compile is skipped, as before.
    }
  }

  return { scrobbleTitle, scrobbleArtist };
};

/**
 * The stored scrobbler config only holds what the user changed, so its filter
 * list extends the defaults rather than replacing them. The plugin loader's
 * `deepmerge` used to concatenate the two for the scrobbler; callers that read
 * the raw config have to do it here or a user's short list would drop every
 * default filter.
 */
export const resolveScrobbleOptions = (
  stored: ScrobbleOptions | undefined,
): ScrobbleOptions => ({
  ...stored,
  customRegexFilters: [
    ...defaultScrobbleFilters,
    ...(stored?.customRegexFilters ?? []),
  ],
});

/** Builds the unified song info from a player response. Pure. */ export const buildSongInfo =
  (
    data: GetPlayerResponse | undefined,
    options: BuildSongInfoOptions = {},
  ): SongInfoData | null => {
    if (!data) {
      return null;
    }

    const microformat = data.microformat?.microformatDataRenderer;
    const { videoDetails } = data;

    const songInfo: SongInfoData = {
      title: '',
      alternativeTitle: '',
      artist: '',
      artistUrl: '',
      views: 0,
      uploadDate: '',
      imageSrc: '',
      isPaused: undefined,
      songDuration: 0,
      elapsedSeconds: 0,
      url: '',
      album: undefined,
      videoId: '',
      playlistId: '',
      mediaType: MediaType.Audio,
      tags: [],
      scrobbleTitle: '',
      scrobbleArtist: '',
    };

    if (microformat) {
      songInfo.uploadDate = microformat.uploadDate;
      songInfo.url = microformat.urlCanonical?.split('&')[0];
      songInfo.playlistId =
        URL.parse(microformat.urlCanonical)?.searchParams?.get('list') ?? '';
      if (microformat.pageOwnerDetails?.externalChannelId) {
        songInfo.artistUrl = `https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/channel/${microformat.pageOwnerDetails.externalChannelId}`;
      }
      songInfo.alternativeTitle = microformat.linkAlternates?.find(
        (link) => link.title,
      )?.title;
      songInfo.tags = Array.isArray(microformat.tags) ? microformat.tags : [];
    }

    if (videoDetails) {
      songInfo.title = cleanupName(videoDetails.title);
      songInfo.artist = cleanupName(videoDetails.author);
      songInfo.views = Number(videoDetails.viewCount);
      songInfo.songDuration = Number(videoDetails.lengthSeconds);
      songInfo.elapsedSeconds = videoDetails.elapsedSeconds;
      songInfo.isPaused = videoDetails.isPaused;
      songInfo.videoId = videoDetails.videoId;
      songInfo.album = videoDetails.album; // undefined for videos

      switch (videoDetails.musicVideoType) {
        case 'MUSIC_VIDEO_TYPE_ATV':
          songInfo.mediaType = MediaType.Audio;
          break;
        case 'MUSIC_VIDEO_TYPE_OMV':
          songInfo.mediaType = MediaType.OriginalMusicVideo;
          break;
        case 'MUSIC_VIDEO_TYPE_UGC':
          songInfo.mediaType = MediaType.UserGeneratedContent;
          break;
        case 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE':
          songInfo.mediaType = MediaType.PodcastEpisode;
          // HACK: Podcast's participant is not the artist
          if (!options.usePodcastParticipantAsArtist) {
            songInfo.artist = cleanupName(
              microformat?.pageOwnerDetails?.name ?? songInfo.artist,
            );
          }
          break;
        default:
          songInfo.mediaType = MediaType.OtherVideo;
          // HACK: workaround for "podcast" types where "musicVideoType" doesn't exist
          if (
            !options.usePodcastParticipantAsArtist &&
            (data.responseContext?.serviceTrackingParams
              ?.at(0)
              ?.params?.find((it) => it.key === 'ipcc')?.value ?? '1') != '0'
          ) {
            songInfo.artist = cleanupName(
              microformat?.pageOwnerDetails?.name ?? songInfo.artist,
            );
          }
          break;
      }

      songInfo.imageSrc = videoDetails.thumbnail?.thumbnails
        ?.at(-1)
        ?.url?.split('?')[0];
    }

    Object.assign(songInfo, getScrobbleMetadata(songInfo, options));

    return songInfo;
  };
