// `/play` starts the video in place, the way the app itself starts one: one
// `/next` request and a queue hydrate. Master's `peard:load-video` path did the
// same through the main process, so the current page, its scroll position and
// the history stay untouched.

import { playerQueue, type QueueElement, type QueueItem } from "@pear/sdk";
import { selectors } from "@pear/sdk/selectors";

/** The parts of a `/next` response the queue hydrate consumes. */
interface NextData {
  queueContextParams?: unknown;
  playerOverlays?: unknown;
  contents?: {
    singleColumnMusicWatchNextResultsRenderer?: {
      tabbedRenderer?: { watchNextTabbedResultsRenderer?: { tabs?: unknown[] } };
    };
  };
}

interface AppElement extends HTMLElement {
  networkManager?: { fetch<T = unknown>(path: string, body?: unknown): Promise<T> };
}

/** The movie player, with the one call the app's own handler also makes. */
interface PlayerApi extends HTMLElement {
  stopVideo?(): void;
}

/** Plays `videoId` in place; false when the player page is not ready to take it. */
export async function playInPlace(videoId: string): Promise<boolean> {
  const app = document.querySelector<AppElement>(selectors.app);
  const queue = playerQueue();
  const api = document.querySelector<PlayerApi>(selectors["player.api"]);
  if (!app?.networkManager || !queue || !api) return false;

  const data = await app.networkManager.fetch<NextData>("/next?prettyPrint=false", { videoId });
  const items = queueContents(data).filter((item) => item.playlistPanelVideoRenderer);
  // Nothing playable came back: the caller falls back to a navigation instead.
  if (items.length === 0) return false;

  api.stopVideo?.();
  hydrate(queue, data, items);
  return true;
}

/** The dispatch sequence YTM's own navigation uses to replace the queue. */
function hydrate(queue: QueueElement, data: NextData, items: QueueItem[]) {
  queue.dispatch({ type: "CLEAR" });
  queue.dispatch({ type: "SET_QUEUE_CONTEXT_PARAMS", payload: data.queueContextParams });
  queue.dispatch({ type: "SET_PLAYER_PAGE_WATCH_NEXT_RESPONSE", payload: data });
  queue.dispatch({ type: "SET_PLAYER_OVERLAY", payload: data.playerOverlays });
  queue.dispatch({
    type: "SET_PLAYER_PAGE_TABS",
    payload: data.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs,
  });
  queue.dispatch({ type: "SET_PLAYER_PAGE_TABS_CONTENT", payload: {} });
  queue.dispatch({
    type: "ADD_ITEMS",
    payload: { index: 0, items, nextQueueItemId: 0, shouldAssignIds: true },
  });
}

/** The playlist panel contents of a `/next` response. */
function queueContents(data: NextData): QueueItem[] {
  const tabs = data.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
  const tab = (
    tabs as
      | { tabRenderer?: { content?: { musicQueueRenderer?: { content?: { playlistPanelRenderer?: { contents?: unknown } } } } } }[]
      | undefined
  )?.[0];
  const contents = tab?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents;
  return Array.isArray(contents) ? (contents as QueueItem[]) : [];
}
