// `/play` starts the video in place, the way the app itself starts one: one
// `/next` request and a queue hydrate, so the current page, its scroll position
// and the history stay untouched.

import { hydrateQueue, nextQueueItems, playerQueue, type NextQueueData } from "@pear/sdk";
import { selectors } from "@pear/sdk/selectors";

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

  const data = await app.networkManager.fetch<NextQueueData>("/next?prettyPrint=false", { videoId });
  const items = nextQueueItems(data).filter((item) => item.playlistPanelVideoRenderer);
  // Nothing playable came back: the caller falls back to a navigation instead.
  if (items.length === 0) return false;

  api.stopVideo?.();
  hydrateQueue(queue, data, items);
  return true;
}
