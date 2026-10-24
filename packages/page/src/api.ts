// The page half of the core API server: what only YTM's own elements can
// answer (queue, search, browse, likes, fullscreen, playback speed, song
// details, loading a video or playlist). Registered once; costs nothing while
// the server is off.

import { type LikeStatus, queueRenderer } from "@pear/sdk";
import { selectors, type SelectorName } from "@pear/sdk/selectors";
import { readSongDetails } from "@pear/sdk/song-details";
import { YTM_NAME } from "@pear/sdk/util";
import { browseContent, type BrowseReply } from "./browse.ts";
import type { Player } from "./player.ts";
import type { PluginRunner } from "./plugins.ts";
import { continuationToken, queueItems, type AutoplayReply, type QueueReply, type QueueRenderer } from "./queue.ts";
import { searchResults, type SearchResult } from "./search.ts";

interface QueueStoreState {
  queue: { items: QueueItem[]; queueContextParams: unknown; nextQueueItemId: unknown };
}
interface QueueItem {
  playlistPanelVideoRenderer?: { selected?: boolean; videoId?: string };
  playlistPanelVideoWrapperRenderer?: { primaryRenderer?: { playlistPanelVideoRenderer?: { selected?: boolean; videoId?: string } } };
  [key: string]: unknown;
}
type QueueAction = { type: string; payload?: unknown };
interface QueueElement extends HTMLElement {
  dispatch(action: QueueAction): void;
  queue?: {
    getItems(): QueueItem[];
    autoPlaying?: boolean;
    continuation?: string;
    store: { store: { dispatch(action: QueueAction): void; getState(): QueueStoreState } };
  };
}
interface ReduxQueue {
  items?: QueueItem[];
  automixItems?: QueueItem[];
  selectedItemIndex?: number;
  nextQueueItemId?: unknown;
  playbackContentMode?: string;
  repeatMode?: string;
  shuffleEnabled?: boolean;
  autoplay?: boolean;
  isInfinite?: boolean;
}
interface NetworkManagerApp extends HTMLElement {
  networkManager: {
    fetch<T = unknown>(path: string, body?: unknown): Promise<T>;
  };
}
interface AppElement extends HTMLElement {
  queue?: { continuation?: string };
  dispatch(action: QueueAction): void;
  ytmusicReduxBehavior?: { store: { store: { getState(): { queue?: ReduxQueue } } } };
  networkManager?: NetworkManagerApp["networkManager"];
}
interface LikeButtons extends HTMLElement {
  updateLikeStatus?(status: string): void;
}
interface SearchBox extends HTMLElement {
  getSearchboxStats?(): unknown;
}
interface NextData {
  queueContextParams?: unknown;
  playerOverlays?: unknown;
  contents?: {
    singleColumnMusicWatchNextResultsRenderer?: {
      tabbedRenderer?: {
        watchNextTabbedResultsRenderer?: {
          tabs?: unknown[];
        };
      };
    };
  };
}

type Handle = (event: string, handler: (payload: unknown) => unknown) => void;

const $ = <E extends Element = HTMLElement>(name: SelectorName) => document.querySelector<E>(selectors[name]);
const queueElement = () => $<QueueElement>("queue");
const appElement = () => $<AppElement>("app");

// Answers go over IPC: drop anything that isn't plain JSON.
const plain = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

export function registerApiHandlers(runner: PluginRunner, player: Player) {
  const handle: Handle = (event, handler) => runner.handleCore(event, handler);
  handle("details", () => (player.api ? readSongDetails(player.api) : null));
  handle("like", (status) => setLikeStatus(player, status as string));
  registerFullscreen(handle);
  registerQueue(handle);
  handle("search", search);
  handle("search:parsed", searchParsed);
  handle("browse", browse);
  handle("speed", () => player.api?.getPlaybackRate() ?? 1);
  handle("speed:set", (speed) => player.api?.setPlaybackRate(Number(speed)));
  handle("repeat:set", (mode) => {
    appElement()?.dispatch({ type: "SET_REPEAT", payload: String(mode) });
  });
  handle("shuffle:set", (enabled) => {
    const current = reduxQueue()?.shuffleEnabled;
    if (enabled !== current) $("player_bar.shuffle")?.click();
  });
  handle("video:play", (videoId) => playVideo(typeof videoId === "string" ? videoId : undefined));
  handle("video:playlist", (playlistId) => playPlaylist(typeof playlistId === "string" ? playlistId : undefined));
  handle("flags:set", (payload) => setFlag(payload as { name: string; value: unknown }));
  handle("flags:remove", (name) => removeFlag(String(name)));
  handle("flags:list", (names) => listFlags(Array.isArray(names) ? names.map(String) : []));
}

/** YTM's live experiment flags (the page's own config). */
function experimentFlags(): Record<string, unknown> | undefined {
  const page = window as unknown as { yt?: { config_?: { EXPERIMENT_FLAGS?: Record<string, unknown> } } };
  return page.yt?.config_?.EXPERIMENT_FLAGS;
}

function setFlag({ name, value }: { name: string; value: unknown }) {
  const flags = experimentFlags();
  if (flags) flags[name] = value;
}

function removeFlag(name: string) {
  const flags = experimentFlags();
  if (flags) delete flags[name];
}

function listFlags(names: string[]): Record<string, unknown> {
  const flags = experimentFlags() ?? {};
  return Object.fromEntries(names.filter((name) => name in flags).map((name) => [name, flags[name]]));
}

/** "LIKE", "DISLIKE" or "INDIFFERENT": sets it, like the buttons do (pressing an active one again would clear it). */
function setLikeStatus(player: Player, status: string) {
  const classic = $<LikeButtons>("player_bar.like_buttons");
  if (classic?.updateLikeStatus) return classic.updateLikeStatus(status);
  if (status === "INDIFFERENT") {
    const current = player.state.like;
    if (current === "like") $("player_bar.like")?.click();
    else if (current === "dislike") $("player_bar.dislike")?.click();
    return;
  }
  const wanted = LIKE_BUTTONS[status];
  if (wanted && player.state.like !== wanted.status) $(wanted.button)?.click();
}

const LIKE_BUTTONS: Record<string, { status: LikeStatus; button: SelectorName }> = {
  LIKE: { status: "like", button: "player_bar.like" },
  DISLIKE: { status: "dislike", button: "player_bar.dislike" },
};

function registerFullscreen(handle: Handle) {
  const isFullscreen = () => !!$("integrations.fullscreen");
  handle("fullscreen", isFullscreen);
  handle("fullscreen:set", (fullscreen) => {
    if (isFullscreen() === fullscreen) return;
    if (fullscreen) return $("integrations.fullscreen_button")?.click();
    // The new player bar's layout has no exit button; Escape (exitFullscreen) is how it leaves.
    const exit = $("integrations.exit_fullscreen_button");
    if (exit) exit.click();
    else void document.exitFullscreen().catch(() => {});
  });
}

/** The queue's redux state, where autoplay entries and the modes live. */
function reduxQueue(): ReduxQueue | undefined {
  return appElement()?.ytmusicReduxBehavior?.store.store.getState().queue;
}

function registerQueue(handle: Handle) {
  // v1's raw reply: the same object it has always answered with.
  handle("queue", () => {
    const api = queueElement()?.queue;
    if (!api) return null;
    return plain({ items: api.getItems(), autoPlaying: api.autoPlaying, continuation: api.continuation });
  });

  handle("queue:parsed", (payload) => {
    const api = queueElement()?.queue;
    if (!api) return null;
    const raw = (payload as { raw?: boolean } | undefined)?.raw === true;
    const data = reduxQueue();
    const items = queueItems(api.getItems(), raw);
    const continuation = api.continuation ?? appElement()?.queue?.continuation;
    const reply: QueueReply = {
      ...(data?.autoplay !== undefined ? { autoplay: data.autoplay } : {}),
      ...(data?.isInfinite !== undefined ? { isInfinite: data.isInfinite } : {}),
      ...(items ? { items } : {}),
      ...(data?.nextQueueItemId !== undefined ? { nextQueueItemId: String(data.nextQueueItemId) } : {}),
      ...(data?.playbackContentMode ? { playbackContentMode: data.playbackContentMode } : {}),
      ...(data?.repeatMode ? { repeatMode: data.repeatMode } : {}),
      ...(data?.selectedItemIndex !== undefined ? { currentPlayingItemId: data.selectedItemIndex } : {}),
      ...(data?.shuffleEnabled !== undefined ? { shuffleEnabled: data.shuffleEnabled } : {}),
      ...(continuation ? { continuation } : {}),
    };
    return plain(reply);
  });

  handle("queue:next", () => {
    const items = queueElement()?.queue?.getItems() ?? [];
    const currentIndex = items.findIndex((item) => queueRenderer(item)?.selected === true);
    const renderer = queueRenderer(items[currentIndex + 1]) as QueueRenderer | undefined;
    if (!renderer) return null;
    return plain({
      title: renderer.title?.runs?.[0]?.text,
      videoId: renderer.videoId,
      thumbnail: renderer.thumbnail,
      lengthText: renderer.lengthText,
      shortBylineText: renderer.shortBylineText,
    });
  });

  handle("queue:autoplay", (payload) => getAutoplay(payload as { raw?: boolean; continuation?: string } | undefined));
  handle("queue:add-items", (payload) => addItems(payload as { videoIds: string[]; playlistIds: string[]; insertPosition: string }));
  // v1's single-video add, unchanged.
  handle("queue:add", (payload) => addToQueue(payload as { videoId: string; insertPosition: string }));
  handle("queue:move", (payload) => queueElement()?.dispatch({ type: "MOVE_ITEM", payload }));
  handle("queue:remove", (index) => queueElement()?.dispatch({ type: "REMOVE_ITEM", payload: index }));
  handle("queue:set-index", (index) => queueElement()?.dispatch({ type: "SET_INDEX", payload: index }));
  handle("queue:clear", () => {
    const element = queueElement();
    element?.queue?.store.store.dispatch({ type: "SET_PLAYER_PAGE_INFO", payload: { open: false } });
    element?.dispatch({ type: "CLEAR" });
  });
}

/** The autoplay entries, which the queue store keeps in `automixItems` rather than `items`. */
async function getAutoplay({ raw = false, continuation }: { raw?: boolean; continuation?: string } = {}): Promise<AutoplayReply | null> {
  const app = appElement();
  if (!app?.networkManager) return null;

  if (continuation) {
    try {
      const data = await app.networkManager.fetch<{
        continuationContents?: {
          playlistPanelContinuation?: { contents?: QueueItem[]; continuations?: unknown };
        };
      }>("/next?prettyPrint=false", { continuation });
      const panel = data?.continuationContents?.playlistPanelContinuation;
      const token = continuationToken(panel?.continuations);
      return plain({
        items: queueItems(panel?.contents, raw) ?? [],
        ...(token ? { continuation: token } : {}),
      });
    } catch (error) {
      console.error("[pear:api] autoplay continuation failed", error);
      return null;
    }
  }

  const nextContinuation = app.queue?.continuation;
  return plain({
    items: queueItems(reduxQueue()?.automixItems, raw) ?? [],
    ...(nextContinuation ? { continuation: nextContinuation } : {}),
  });
}

/** Right after the playing item; the end when none is playing. */
function indexAfterSelected(items: QueueItem[]) {
  const selected = items.findIndex((item) => queueRenderer(item)?.selected);
  return selected === -1 ? items.length : selected + 1;
}

/** Dispatches fetched queue items at `insertPosition`. */
function addQueueContents(element: QueueElement, contents: unknown[], insertPosition: string, shuffleEnabled: boolean) {
  const state = element.queue?.store.store.getState();
  if (!state) return;
  const { items, nextQueueItemId } = state.queue;
  const afterCurrent = insertPosition === "INSERT_AFTER_CURRENT_VIDEO";
  element.dispatch({
    type: "ADD_ITEMS",
    payload: {
      nextQueueItemId,
      index: afterCurrent ? indexAfterSelected(items) : items.length,
      items: contents,
      shuffleEnabled,
      shouldAssignIds: true,
    },
  });
}

async function addToQueue({ videoId, insertPosition }: { videoId: string; insertPosition: string }) {
  const element = queueElement();
  const store = element?.queue?.store.store;
  const app = $<NetworkManagerApp>("app");
  if (!element || !store || !app) throw new Error("queue unavailable");
  const result = await app.networkManager.fetch<{ queueDatas?: { content?: unknown }[] }>("/music/get_queue", {
    queueContextParams: store.getState().queue.queueContextParams,
    queueInsertPosition: insertPosition,
    videoIds: [videoId],
  });
  if (!Array.isArray(result?.queueDatas)) throw new Error(`${YTM_NAME} returned no queue items`);
  addQueueContents(element, result.queueDatas.map((data) => data?.content).filter(Boolean), insertPosition, false);
}

/** v2's batch add: videos and/or playlists, in the same dispatch shape the app uses. */
async function addItems({
  videoIds = [],
  playlistIds = [],
  insertPosition,
}: {
  videoIds: string[];
  playlistIds: string[];
  insertPosition: string;
}) {
  const element = queueElement();
  const state = element?.queue?.store.store.getState();
  const app = appElement();
  if (!element || !state || !app?.networkManager) throw new Error("queue unavailable");
  if (!videoIds.length && !playlistIds.length) return;

  const result = await app.networkManager.fetch<{ queueDatas?: { content?: unknown }[] }>("/music/get_queue", {
    queueContextParams: state.queue.queueContextParams,
    queueInsertPosition: insertPosition,
    ...(videoIds.length ? { videoIds } : {}),
    ...(playlistIds.length ? { playlistIds } : {}),
  });
  if (!Array.isArray(result?.queueDatas)) throw new Error(`${YTM_NAME} returned no queue items`);
  addQueueContents(
    element,
    result.queueDatas.map((data) => data?.content).filter(Boolean),
    insertPosition,
    reduxQueue()?.shuffleEnabled === true,
  );
}

/** v1's raw innertube search response. */
async function search(payload: unknown) {
  const { query, params, continuation } = payload as { query: string; params?: string; continuation?: string };
  const app = $<NetworkManagerApp>("app");
  const searchBox = $<SearchBox>("nav_bar.search_box");
  if (!app) throw new Error(`${YTM_NAME} isn't ready`);
  const suggestStats = searchBox?.getSearchboxStats?.();
  return plain(await app.networkManager.fetch("/search", { query, params, continuation, suggestStats }));
}

/** v2's parsed results, or the raw response with `raw`. */
async function searchParsed(payload: unknown) {
  const {
    query,
    params,
    continuation,
    raw = false,
  } = payload as {
    query: string;
    params?: string;
    continuation?: string;
    raw?: boolean;
  };
  const app = $<NetworkManagerApp>("app");
  const searchBox = $<SearchBox>("nav_bar.search_box");
  if (!app) throw new Error(`${YTM_NAME} isn't ready`);
  const result = await app.networkManager.fetch<unknown>("/search", {
    query,
    params,
    continuation,
    suggestStats: searchBox?.getSearchboxStats?.(),
  });
  const parsed: { query: string; results: SearchResult[] } | unknown = raw ? result : { query, results: searchResults(result) };
  return plain(parsed);
}

/** Curated info for a browse page, or its raw response with `raw`. */
async function browse(payload: unknown): Promise<BrowseReply | unknown | null> {
  const {
    browseId,
    continuation,
    raw = false,
  } = payload as {
    browseId?: string;
    continuation?: string;
    raw?: boolean;
  };
  const app = appElement();
  if (!app?.networkManager) return null;
  try {
    const data = await app.networkManager.fetch<unknown>("/browse?prettyPrint=false", continuation ? { continuation } : { browseId });
    return plain(raw ? data : browseContent(data, browseId ?? null));
  } catch (error) {
    console.error("[pear:api] browse failed", error);
    return null;
  }
}

/** Hydrates the queue from a `/next` response, like the app's own navigation does. */
function hydrateQueue(element: QueueElement, data: NextData, items: unknown[]) {
  element.dispatch({ type: "CLEAR" });
  element.dispatch({ type: "SET_QUEUE_CONTEXT_PARAMS", payload: data.queueContextParams });
  element.dispatch({ type: "SET_PLAYER_PAGE_WATCH_NEXT_RESPONSE", payload: data });
  element.dispatch({ type: "SET_PLAYER_OVERLAY", payload: data.playerOverlays });
  element.dispatch({
    type: "SET_PLAYER_PAGE_TABS",
    payload: data.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs,
  });
  element.dispatch({ type: "SET_PLAYER_PAGE_TABS_CONTENT", payload: {} });
  element.dispatch({
    type: "ADD_ITEMS",
    payload: { index: 0, items, nextQueueItemId: 0, shouldAssignIds: true },
  });
}

async function playVideo(videoId?: string) {
  const api = playerApi();
  const app = appElement();
  const element = queueElement();
  if (!videoId || !api || !app?.networkManager || !element) return;
  api.stopVideo?.();
  const data = await app.networkManager.fetch<NextData>("/next?prettyPrint=false", { videoId });
  const contents = queueContents(data);
  hydrateQueue(
    element,
    data,
    contents.filter((item) => item.playlistPanelVideoRenderer),
  );
}

async function playPlaylist(playlistId?: string) {
  const api = playerApi();
  const app = appElement();
  const element = queueElement();
  if (!playlistId || !api || !app?.networkManager || !element) return;
  api.stopVideo?.();
  const data = await app.networkManager.fetch<NextData>("/next?prettyPrint=false", { playlistId });
  hydrateQueue(element, data, queueContents(data));
}

/** The playlist panel contents of a `/next` response. */
function queueContents(data: NextData): { playlistPanelVideoRenderer?: unknown }[] {
  const tabs = data.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
  const tab = (
    tabs as
      | { tabRenderer?: { content?: { musicQueueRenderer?: { content?: { playlistPanelRenderer?: { contents?: unknown } } } } } }[]
      | undefined
  )?.[0];
  const contents = tab?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents;
  return Array.isArray(contents) ? (contents as { playlistPanelVideoRenderer?: unknown }[]) : [];
}

/** The movie player, with the optional calls this module needs. */
function playerApi() {
  return (document.querySelector(selectors["player.api"]) ?? null) as (HTMLElement & { stopVideo?(): void }) | null;
}
