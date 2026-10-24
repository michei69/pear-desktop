// YTM's page data has no published shape; these readers follow only the fields
// the matched card and queue renderers document. Pure: nothing here touches the
// DOM or the network.

export type Renderer = Record<string, unknown>;

/** A renderer node at `key` of some page data, when it really is one. */
export const rendererAt = (node: unknown, key: string): Renderer | undefined => {
  const found = (node as Renderer | undefined)?.[key];
  return found && typeof found === "object" && !Array.isArray(found) ? (found as Renderer) : undefined;
};

/** The `runs` of a text renderer (`{ runs: [{ text }] }`), when it has any. */
export const runsOf = (node: unknown): Renderer[] | undefined => {
  const runs = (node as Renderer | undefined)?.runs;
  return Array.isArray(runs) ? (runs as Renderer[]) : undefined;
};

/** Follows a chain of renderer keys, stopping as soon as one is not a node. */
export const rendererPath = (node: unknown, ...keys: string[]): Renderer | undefined =>
  keys.reduce<Renderer | undefined>((current, key) => rendererAt(current, key), node as Renderer | undefined);

/** A string field of a renderer node, or "" when it is not a string. */
export const stringField = (node: Renderer | undefined, key: string): string => {
  const value = node?.[key];
  return typeof value === "string" ? value : "";
};

/** The `browseId` a run's navigation endpoint points at, when it has one. */
export const browseIdOf = (run: unknown): unknown => rendererAt(rendererAt(run, "navigationEndpoint"), "browseEndpoint")?.browseId;

export const textOf = (runs: unknown): string =>
  Array.isArray(runs) ? (runs as Renderer[]).map((run) => (typeof run?.text === "string" ? run.text : "")).join("") : "";

const channelRuns = (runs: unknown): Renderer[] =>
  (Array.isArray(runs) ? (runs as Renderer[]) : []).filter((run) => {
    const id = browseIdOf(run);
    return typeof id === "string" && id.startsWith("UC");
  });

/** Adds the ids a run's navigation endpoint documents. */
const addRunIds = (runs: unknown, videoIds: Set<string>, channelIds: Set<string>) => {
  for (const run of Array.isArray(runs) ? (runs as Renderer[]) : []) {
    const videoId = rendererPath(run, "navigationEndpoint", "watchEndpoint")?.videoId;
    if (typeof videoId === "string") videoIds.add(videoId);
    const browseId = browseIdOf(run);
    if (typeof browseId === "string" && browseId.startsWith("UC")) channelIds.add(browseId);
  }
};

/** Adds the id a row or card itself opens (`navigationEndpoint` / `onTap`). */
const addEndpointIds = (node: Renderer, videoIds: Set<string>, channelIds: Set<string>) => {
  const endpoint = rendererAt(node, "navigationEndpoint") ?? rendererAt(node, "onTap");
  const videoId = rendererPath(endpoint, "watchEndpoint")?.videoId;
  if (typeof videoId === "string") videoIds.add(videoId);
  const browseId = rendererPath(endpoint, "browseEndpoint")?.browseId;
  if (typeof browseId === "string" && browseId.startsWith("UC")) channelIds.add(browseId);
};

/** A responsive row: `playlistItemData`, its own endpoint and its columns. */
const addRowIds = (row: Renderer, videoIds: Set<string>, channelIds: Set<string>) => {
  const videoId = rendererAt(row, "playlistItemData")?.videoId;
  if (typeof videoId === "string") videoIds.add(videoId);
  addEndpointIds(row, videoIds, channelIds);
  const columns = row.flexColumns;
  if (!Array.isArray(columns)) return;
  for (const column of columns) {
    addRunIds(rendererPath(column, "musicResponsiveListItemFlexColumnRenderer", "text")?.runs, videoIds, channelIds);
  }
};

export interface SearchInfo {
  videoIds: string[];
  channelIds: string[];
  title: string;
  author: string;
  /** The "don't recommend" feedback token, when the card's menu has one. */
  token: string | null;
}

export const searchInfo = (data: Renderer): SearchInfo => {
  const videoIds = new Set<string>();
  const channelIds = new Set<string>();

  // The four card shapes the selectors match document their ids on known
  // fields: `playlistItemData` / `navigationEndpoint` on rows, `onTap` on
  // cards, and the navigation endpoints of their title and byline runs.
  addRowIds(data, videoIds, channelIds);
  addEndpointIds(data, videoIds, channelIds);
  addRunIds(rendererAt(data, "title")?.runs, videoIds, channelIds);
  addRunIds(rendererAt(data, "subtitle")?.runs, videoIds, channelIds);
  addRunIds(rendererAt(data, "secondSubtitle")?.runs, videoIds, channelIds);
  const contents = data.contents;
  if (Array.isArray(contents)) {
    for (const content of contents) {
      const row = rendererAt(content, "musicResponsiveListItemRenderer");
      if (row) addRowIds(row, videoIds, channelIds);
    }
  }

  let title: string;
  let author: string;
  const columns = data.flexColumns;
  if (Array.isArray(columns)) {
    const columnRuns = (index: number) => rendererPath(columns[index], "musicResponsiveListItemFlexColumnRenderer", "text")?.runs;
    title = textOf(columnRuns(0));
    author = channelRuns(columnRuns(1))
      .map((run) => (typeof run.text === "string" ? run.text : ""))
      .join(" ");
  } else {
    // Top-result card, home/explore cards (two-row), multi-row items.
    title =
      textOf(rendererPath(rendererPath(data, "header"), "musicCardShelfHeaderBasicRenderer", "title")?.runs) ||
      textOf(rendererAt(data, "title")?.runs);
    author = channelRuns(rendererAt(data, "subtitle")?.runs)
      .map((run) => (typeof run.text === "string" ? run.text : ""))
      .join(" ");
  }

  return {
    videoIds: [...videoIds],
    channelIds: [...channelIds],
    title,
    author,
    token: findNotInterestedToken(data),
  };
};

// ---- queue -----------------------------------------------------------------

export interface ParsedQueueItem {
  item: object;
  renderer: Renderer;
  videoId: string;
  title: string;
  author: string;
  channelIds: string[];
}

/** Automix items may be wrapped differently; when the known shapes miss, find the first video node. */
const findRenderer = (node: unknown, depth = 0): Renderer | null => {
  if (!node || typeof node !== "object" || depth > 6) return null;
  const candidate = node as Renderer;
  if (typeof candidate.videoId === "string" && candidate.title) return candidate;
  for (const value of Object.values(candidate)) {
    const found = findRenderer(value, depth + 1);
    if (found) return found;
  }
  return null;
};

export const parseQueueItem = (item: unknown): ParsedQueueItem | null => {
  const renderer =
    rendererAt(item, "playlistPanelVideoRenderer") ??
    rendererAt(rendererAt(rendererAt(item, "playlistPanelVideoWrapperRenderer"), "primaryRenderer"), "playlistPanelVideoRenderer") ??
    findRenderer(item);
  if (!renderer) return null;
  const videoId = renderer.videoId;
  if (typeof videoId !== "string" || !videoId) return null;

  const runs = runsOf(renderer.longBylineText) ?? runsOf(renderer.shortBylineText) ?? [];
  const firstText = runs[0]?.text;
  return {
    item: item as object,
    renderer,
    videoId,
    title: (runsOf(renderer.title) ?? []).map((run) => (typeof run.text === "string" ? run.text : "")).join(""),
    author: typeof firstText === "string" ? firstText : "",
    channelIds: runs.map((run) => browseIdOf(run)).filter((id): id is string => typeof id === "string"),
  };
};

// ---- "not interested" feedback --------------------------------------------

const NOT_INTERESTED_RE = /not interested|lgilenmiyorum|don'?t recommend|önerme/i;

/** The feedback token of a recommendation card's own menu, if it offers one. */
export const findNotInterestedToken = (data: Renderer): string | null => {
  const items = rendererPath(data, "menu", "menuRenderer")?.items;
  if (!Array.isArray(items)) return null;

  const itemRenderer = (item: unknown) => rendererAt(item, "menuServiceItemRenderer");
  const feedbackTokenOf = (item: unknown) => rendererPath(itemRenderer(item), "serviceEndpoint", "feedbackEndpoint")?.feedbackToken;

  for (const item of items) {
    const renderer = itemRenderer(item);
    const token = feedbackTokenOf(item);
    if (typeof token !== "string") continue;
    if (
      NOT_INTERESTED_RE.test(textOf(rendererAt(renderer, "text")?.runs)) ||
      /NOT_INTERESTED|DISMISS/i.test(stringField(rendererAt(renderer, "icon"), "iconType"))
    ) {
      return token;
    }
  }
  return null;
};
