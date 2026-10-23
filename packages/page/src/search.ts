// Parses YTM's raw search response into the API's result shape. The response
// is runtime data, so it is read through the interfaces below rather than
// trusted field by field.

import { YTM_ORIGIN } from "@pear/sdk/util";
import { thumbnailSizes, thumbnailUrl, type Thumbnail } from "./queue.ts";

export interface SearchResult {
  title?: string;
  artist?: string;
  type?: string;
  thumbnail?: string;
  thumbnails?: Thumbnail[];
  videoId?: string;
  browseId?: string;
  url?: string;
}

interface BrowseText {
  runs?: { text?: string }[];
  simpleText?: string;
}

interface TextRuns {
  runs?: BylineRun[];
}

interface BylineRun {
  text: string;
  navigationEndpoint?: {
    browseEndpoint?: {
      browseId?: string;
      browseEndpointContextSupportedConfigs?: {
        browseEndpointContextMusicConfig?: { pageType?: string };
      };
    };
    watchEndpoint?: { videoId?: string };
  };
}

interface RowColumn {
  musicResponsiveListItemFlexColumnRenderer?: { text?: TextRuns };
}

export interface MusicResponsiveListItemRenderer {
  flexColumns?: RowColumn[];
  playlistItemData?: { videoId?: string };
  thumbnail?: { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Thumbnail[] } } };
  navigationEndpoint?: BylineRun["navigationEndpoint"];
}

export interface MusicCardShelfRenderer {
  title?: BrowseText;
  subtitle?: TextRuns;
  thumbnail?: { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Thumbnail[] } } };
  onTap?: BylineRun["navigationEndpoint"];
  contents?: SectionContent[];
}

export interface SectionContent {
  musicResponsiveListItemRenderer?: MusicResponsiveListItemRenderer;
  musicCardShelfRenderer?: MusicCardShelfRenderer;
  musicTwoRowItemRenderer?: unknown;
}

export interface SectionListRendererContent {
  musicCardShelfRenderer?: MusicCardShelfRenderer;
  musicShelfRenderer?: { contents?: SectionContent[] };
  itemSectionRenderer?: { contents?: SectionContent[] };
}

interface SearchTab {
  tabRenderer?: {
    tabIdentifier?: string;
    content?: { sectionListRenderer?: { contents?: SectionListRendererContent[] } };
  };
}

interface SearchResponse {
  contents?: { tabbedSearchResultsRenderer?: { tabs?: SearchTab[] } };
}

/** A run made only of separators (` • `, `, `, ` & `) names nothing. */
const BYLINE_SEPARATOR = /^[^\p{L}\p{N}]+$/u;

/** Byline runs that read as metadata rather than a name. */
const BYLINE_METADATA = [
  /^@/,
  /\p{N}+:\p{N}/u,
  /\b\d{4}\b/,
  /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \p{N}{1,2}$/iu,
  /^\p{N}+\s*(?:s|m|h|d|w|mo|y)\s+ago\b/iu,
  /\b(views|plays|subscribers|audience|songs|episodes)\b/i,
];

/** Page types that make a linked byline run the credited artist, channel or show. */
const CREDITED_PAGE_TYPES: readonly string[] = [
  "MUSIC_PAGE_TYPE_ARTIST",
  "MUSIC_PAGE_TYPE_USER_CHANNEL",
  "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE",
];

/** Episode rows carry a `MPED<videoId>` browse id instead of a video id. */
const EPISODE_BROWSE_PREFIX = "MPED";

/** Every browse result id opens either a playlist page or a browse page. */
export function searchResultUrl(browseId: string) {
  return browseId.startsWith("VL") ? `${YTM_ORIGIN}/playlist?list=${browseId.slice(2)}` : `${YTM_ORIGIN}/browse/${browseId}`;
}

export function searchResultIds(videoId?: string, browseId?: string) {
  if (videoId) return { videoId, url: `${YTM_ORIGIN}/watch?v=${videoId}` };
  if (browseId) return { browseId, url: searchResultUrl(browseId) };
  return {};
}

/**
 * The credited entities in the runs a byline has left after its type label. A
 * linked run credits whoever it opens, but a filtered search also links the
 * album, so the page type decides. An unlinked run is a name unless it reads as
 * metadata.
 */
export function bylineArtists(runs: BylineRun[]) {
  return (
    runs
      .filter((run) => {
        if (BYLINE_SEPARATOR.test(run.text)) return false;
        const pageType =
          run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
        if (pageType) return CREDITED_PAGE_TYPES.includes(pageType);
        return !BYLINE_METADATA.some((pattern) => pattern.test(run.text));
      })
      .map((run) => run.text)
      .join(", ") || undefined
  );
}

/** A row's id: playable rows carry `playlistItemData`, page rows a navigation endpoint. */
export function rowResult(row: MusicResponsiveListItemRenderer): SearchResult {
  const columns = row.flexColumns?.map((column) => column.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []);
  const byline = columns?.[1] ?? [];
  const labelled = !byline[0]?.navigationEndpoint;
  const firstRun = columns?.[0]?.[0]?.navigationEndpoint;
  const browseId = firstRun?.browseEndpoint?.browseId ?? row.navigationEndpoint?.browseEndpoint?.browseId;
  const videoId =
    row.playlistItemData?.videoId ??
    firstRun?.watchEndpoint?.videoId ??
    row.navigationEndpoint?.watchEndpoint?.videoId ??
    (browseId?.startsWith(EPISODE_BROWSE_PREFIX) ? browseId.slice(EPISODE_BROWSE_PREFIX.length) : undefined);

  const thumbnails = thumbnailSizes(row.thumbnail?.musicThumbnailRenderer?.thumbnail);
  const thumbnail = thumbnailUrl(thumbnails);
  const artist = bylineArtists(byline.slice(labelled ? 1 : 0));
  const title = columns?.[0]?.[0]?.text;
  const type = labelled ? byline[0]?.text : undefined;
  return {
    ...(title ? { title } : {}),
    ...(type ? { type } : {}),
    ...(artist ? { artist } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(thumbnails ? { thumbnails } : {}),
    ...searchResultIds(videoId, videoId ? undefined : browseId),
  };
}

/** The top-result card: the same fields, with its id on `onTap`. */
export function cardResult(card: MusicCardShelfRenderer): SearchResult {
  const subtitle = card.subtitle?.runs ?? [];
  const labelled = subtitle.length > 1 && !subtitle[0]?.navigationEndpoint;
  const thumbnails = thumbnailSizes(card.thumbnail?.musicThumbnailRenderer?.thumbnail);
  const thumbnail = thumbnailUrl(thumbnails);
  const artist = bylineArtists(subtitle.slice(labelled ? 1 : 0));
  const title = card.title?.runs?.[0]?.text;
  const type = labelled ? subtitle[0]?.text : undefined;
  return {
    ...(title ? { title } : {}),
    ...(type ? { type } : {}),
    ...(artist ? { artist } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(thumbnails ? { thumbnails } : {}),
    ...searchResultIds(card.onTap?.watchEndpoint?.videoId, card.onTap?.browseEndpoint?.browseId),
  };
}

/** The rows a card's contents, a shelf or an item section carry. */
const sectionRows = (section: SectionListRendererContent): SectionContent[] =>
  section.musicCardShelfRenderer?.contents ?? section.musicShelfRenderer?.contents ?? section.itemSectionRenderer?.contents ?? [];

/** A section's results: the top card itself, then the rows it holds. */
export function sectionResults(section: SectionListRendererContent): SearchResult[] {
  const card = section.musicCardShelfRenderer;
  const rows = sectionRows(section).flatMap((content) =>
    content.musicResponsiveListItemRenderer ? [rowResult(content.musicResponsiveListItemRenderer)] : [],
  );
  return card ? [cardResult(card), ...rows] : rows;
}

/** A search response's results, from its catalog tab only. */
export function searchResults(response: unknown): SearchResult[] {
  const typed = response as SearchResponse;
  const tabs = typed.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
  const catalog = tabs.find((tab) => tab.tabRenderer?.tabIdentifier === "music_search_catalog")?.tabRenderer?.content;
  const sections = catalog?.sectionListRenderer?.contents ?? [];
  // A result with no id would have no URL, so it is not a result.
  return sections.flatMap(sectionResults).filter((item) => item.videoId || item.browseId);
}
