// The parts of the album-release rewrite that do not touch the network or the
// page: finding the studio song behind a music video and the metadata that goes
// with it. Kept free of globals so the decisions can be read and tested on their
// own.

export interface TextRuns {
  runs: { text: string }[];
}

export interface QueueItem {
  videoId?: string;
  playlistSetVideoId?: string;
  title?: TextRuns;
  longBylineText?: TextRuns;
  shortBylineText?: TextRuns;
  lengthText?: TextRuns;
  thumbnail?: { thumbnails: { url: string }[] };
}

export interface ReleaseRow {
  playlistItemData?: { playlistSetVideoId?: string };
}

export interface ReleaseRequest {
  playlistId: string;
  setId: string;
}

/** Every value stored at `key` in a page-data tree, in traversal order. */
export const collect = <T>(data: unknown, key: string): T[] => {
  const found: T[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record[key]) found.push(record[key] as T);
    for (const child of Object.values(record)) walk(child);
  };
  walk(data);
  return found;
};

/**
 * The song's video id, from the `MPTC` credits browse id an album release row
 * links to. A music video is credited to its song this way.
 */
export const creditsVideoId = (row: unknown): string | undefined =>
  collect<string>(row, "browseId")
    .find((id) => typeof id === "string" && id.startsWith("MPTC"))
    ?.slice(4);

/** An album release's playlist id (`OLAK5uy_…`), or null for anything else. */
export const releasePlaylistId = (value: unknown): string | null =>
  typeof value === "string" && value.startsWith("OLAK5uy_") ? value : null;

/** The `playlistSetVideoId` a player request's opaque `params` encodes. */
export const playerSetVideoId = (params: unknown): string | null => {
  if (typeof params !== "string") return null;
  try {
    return /[0-9A-F]{16}/.exec(atob(decodeURIComponent(params)))?.[0] ?? null;
  } catch {
    // Not a base64 params blob: no set id, so nothing to look up.
    return null;
  }
};

/** The release playlist and queue row a player request belongs to, when it is part of one. */
export const releaseRequestOf = (body: Record<string, unknown>): ReleaseRequest | null => {
  const playlistId = releasePlaylistId(body.playlistId);
  const setId = playerSetVideoId(body.params);
  return playlistId && setId ? { playlistId, setId } : null;
};

/** The studio song for a release row, unless the row already is that song. */
export const studioIdFor = (studioIdBySetId: ReadonlyMap<string, string>, setId: string, videoId: string): string | null => {
  const studioId = studioIdBySetId.get(setId);
  return studioId && studioId !== videoId ? studioId : null;
};

/**
 * The queue row with its video id and type swapped to the song's. The row
 * documents the id in several nested places, so the whole row is rewritten in
 * one go rather than field by field.
 */
export const swappedQueueRow = (item: QueueItem, studioId: string): QueueItem => {
  const rowId = item.videoId;
  if (!rowId) return item;
  return JSON.parse(
    JSON.stringify(item).split(rowId).join(studioId).split("MUSIC_VIDEO_TYPE_OMV").join("MUSIC_VIDEO_TYPE_ATV"),
  ) as QueueItem;
};

/** The studio row's display metadata, leaving out the fields it does not have. */
export const studioMetadata = (studio: QueueItem): Partial<QueueItem> => {
  const metadata: Partial<QueueItem> = {};
  if (studio.title) metadata.title = studio.title;
  if (studio.longBylineText) metadata.longBylineText = studio.longBylineText;
  if (studio.shortBylineText) metadata.shortBylineText = studio.shortBylineText;
  if (studio.lengthText) metadata.lengthText = studio.lengthText;
  if (studio.thumbnail) metadata.thumbnail = studio.thumbnail;
  return metadata;
};
