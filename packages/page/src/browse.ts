// Flattens YTM's raw browse response into the API's curated page shape.

import { continuationToken, thumbnailSizes, thumbnailUrl, type Thumbnail } from "./queue.ts";
import {
  cardResult,
  rowResult,
  subtitleResult,
  type BrowseText,
  type BylineRun,
  type MusicCardShelfRenderer,
  type MusicResponsiveListItemRenderer,
  type SearchResult,
} from "./search.ts";

interface BrowseHeaderRenderer {
  title?: BrowseText;
  subtitle?: BrowseText;
  description?: BrowseText;
  straplineTextOne?: BrowseText;
  thumbnail?: {
    musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Thumbnail[] } };
    croppedSquareThumbnailRenderer?: { thumbnail?: { thumbnails?: Thumbnail[] } };
  };
}

interface MusicTwoRowItemRenderer {
  title?: BrowseText;
  subtitle?: { runs?: BylineRun[] };
  thumbnailRenderer?: { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Thumbnail[] } } };
  navigationEndpoint?: {
    watchEndpoint?: { videoId?: string };
    browseEndpoint?: { browseId?: string };
  };
}

type JsonObject = Record<string, unknown>;

export interface BrowseReply {
  browseId: string | null;
  title?: string;
  subtitle?: string;
  description?: string;
  thumbnail?: string;
  thumbnails?: Thumbnail[];
  results: SearchResult[];
  continuation?: string;
}

const browseText = (node?: BrowseText) => node?.simpleText ?? node?.runs?.map((run) => run.text ?? "").join("") ?? undefined;

/** A browse header, flattened to the fields a client needs. */
function browseHeader(node: JsonObject): Pick<BrowseReply, "title" | "subtitle" | "description" | "thumbnail" | "thumbnails"> | undefined {
  const header = (node.musicResponsiveHeaderRenderer ??
    node.musicDetailHeaderRenderer ??
    node.musicImmersiveHeaderRenderer ??
    node.musicVisualHeaderRenderer) as BrowseHeaderRenderer | undefined;
  if (!header?.title) return undefined;

  const thumbnails = thumbnailSizes(
    header.thumbnail?.musicThumbnailRenderer?.thumbnail ?? header.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail,
  );
  const title = browseText(header.title);
  const subtitle = browseText(header.subtitle) ?? browseText(header.straplineTextOne);
  const description = browseText(header.description);
  const thumbnail = thumbnailUrl(thumbnails);
  return {
    ...(title ? { title } : {}),
    ...(subtitle ? { subtitle } : {}),
    ...(description ? { description } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(thumbnails ? { thumbnails } : {}),
  };
}

/** A two-row item (album, playlist or artist card) as one search-shaped result. */
function twoRowResult(item: MusicTwoRowItemRenderer): SearchResult {
  return subtitleResult(
    browseText(item.title),
    item.subtitle?.runs ?? [],
    thumbnailSizes(item.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail),
    item.navigationEndpoint?.watchEndpoint?.videoId,
    item.navigationEndpoint?.browseEndpoint?.browseId,
  );
}

/** Visits every object in a JSON tree, depth first, in response order. */
function walkJson(node: unknown, visit: (object: JsonObject) => void) {
  if (Array.isArray(node)) {
    for (const entry of node) walkJson(entry, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const object = node as JsonObject;
  visit(object);
  for (const value of Object.values(object)) walkJson(value, visit);
}

/** A browsed page: its header, every item renderer it carries and its continuation token. */
export function browseContent(response: unknown, browseId: string | null): BrowseReply {
  const results: SearchResult[] = [];
  let header: ReturnType<typeof browseHeader>;
  let continuation: string | undefined;

  walkJson(response, (node) => {
    const row = node.musicResponsiveListItemRenderer as MusicResponsiveListItemRenderer | undefined;
    if (row) results.push(rowResult(row));

    const card = node.musicCardShelfRenderer as MusicCardShelfRenderer | undefined;
    if (card) results.push(cardResult(card));

    const twoRow = node.musicTwoRowItemRenderer as MusicTwoRowItemRenderer | undefined;
    if (twoRow) results.push(twoRowResult(twoRow));

    header ??= browseHeader(node);
    continuation ??= continuationToken([node]);
  });

  return {
    browseId,
    ...(header ?? {}),
    results,
    ...(continuation ? { continuation } : {}),
  };
}
