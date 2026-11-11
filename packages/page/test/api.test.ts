// The page's API handlers the main process relies on: the queue projection
// `/queue/next` answers with, the queue mapping cache, and the playback-rate
// fallback to the media element.

import { selectors } from "@pear/sdk/selectors";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { registerApiHandlers } from "../src/api.ts";
import type { Player } from "../src/player.ts";
import type { PluginRunner } from "../src/plugins.ts";

type Handler = (payload?: unknown) => unknown;

/** The registered core handlers, callable by event name. */
function handlers(player: Player) {
  const registered = new Map<string, Handler>();
  const runner = { handleCore: (event: string, handler: Handler) => registered.set(event, handler) } as unknown as PluginRunner;
  registerApiHandlers(runner, player);
  return (event: string, payload?: unknown) => {
    const handler = registered.get(event);
    if (!handler) throw new Error(`no handler for ${event}`);
    return handler(payload);
  };
}

const panel = (videoId: string, selected = false) => ({
  playlistPanelVideoRenderer: { videoId, selected, title: { runs: [{ text: videoId.toUpperCase() }] } },
});

const fakePlayer = (overrides: Record<string, unknown> = {}) =>
  ({ api: undefined, video: () => undefined, state: { like: "none" }, ...overrides }) as unknown as Player;

/** The queue element and redux state the queue handlers read from. */
function stubQueue() {
  let items = [panel("a", true), panel("b")];
  let selectedItemIndex: number | undefined = 0;
  const element = { queue: { getItems: () => items, continuation: "token" } };
  const app = {
    queue: { continuation: "token" },
    ytmusicReduxBehavior: { store: { store: { getState: () => ({ queue: { selectedItemIndex } }) } } },
  };
  vi.stubGlobal("document", {
    querySelector: (selector: string) => (selector === selectors.queue ? element : selector === selectors.app ? app : null),
  });
  return {
    setItems(next: unknown[]) {
      items = next as typeof items;
    },
    getItems: () => items,
    setSelectedIndex(index: number | undefined) {
      selectedItemIndex = index;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queue:next", () => {
  test("answers nothing while no item is selected, not the first entry", () => {
    stubQueue().setItems([panel("a"), panel("b")]);
    expect(handlers(fakePlayer())("queue:next")).toBeNull();
  });

  test("projects the five fields of the entry after the selected one", () => {
    stubQueue().setItems([panel("a", true), panel("b")]);
    expect(handlers(fakePlayer())("queue:next")).toEqual({ title: "B", videoId: "b" });
  });

  test("answers nothing after the last entry", () => {
    stubQueue().setItems([panel("a"), panel("b", true)]);
    expect(handlers(fakePlayer())("queue:next")).toBeNull();
  });
});

describe("queue:parsed", () => {
  test("maps a queue version once and re-maps when the queue changes", () => {
    const queue = stubQueue();
    const h = handlers(fakePlayer());

    const first = h("queue:parsed", { raw: false }) as { items: { title?: string }[] };
    expect(first.items[1]?.title).toBe("B");

    // A selection flip does not wait for a re-map; the same array is cached.
    queue.getItems()[1]!.playlistPanelVideoRenderer.title.runs[0]!.text = "changed";
    queue.setSelectedIndex(0);
    expect((h("queue:parsed", { raw: false }) as { items: { title?: string }[] }).items[1]?.title).toBe("B");

    // A new items array is a new queue version.
    queue.setItems([...queue.getItems()]);
    queue.setSelectedIndex(1);
    expect((h("queue:parsed", { raw: false }) as { items: { title?: string }[] }).items[1]?.title).toBe("changed");
  });

  test("keeps the raw and parsed mappings apart", () => {
    stubQueue();
    const h = handlers(fakePlayer());
    expect((h("queue:parsed", { raw: false }) as { items: { renderer?: unknown }[] }).items[0]?.renderer).toBeUndefined();
    expect((h("queue:parsed", { raw: true }) as { items: { renderer?: unknown }[] }).items[0]?.renderer).toBeDefined();
  });
});

describe("playback speed", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { querySelector: () => null });
  });

  test("falls back to the media element when the player API is not attached", () => {
    const video = { playbackRate: 1, preservesPitch: false };
    const api = {
      getPlaybackRate: () => video.playbackRate,
      setPlaybackRate: () => {
        throw new Error("not attached yet");
      },
    };
    const h = handlers(fakePlayer({ api, video: () => video }));

    h("speed:set", 1.5);
    expect(video).toEqual({ playbackRate: 1.5, preservesPitch: true });
    expect(h("speed")).toBe(1.5);
  });

  test("forces the rate on the element when the player API did not take it", () => {
    const video = { playbackRate: 1, preservesPitch: false };
    let apiRate = 1;
    const api = {
      getPlaybackRate: () => apiRate,
      setPlaybackRate: (value: number) => {
        apiRate = value;
      },
    };
    const h = handlers(fakePlayer({ api, video: () => video }));

    h("speed:set", 2);
    expect(apiRate).toBe(2);
    expect(video).toEqual({ playbackRate: 2, preservesPitch: true });
  });

  test("ignores a non-finite rate", () => {
    const video = { playbackRate: 1, preservesPitch: false };
    const h = handlers(fakePlayer({ video: () => video }));
    h("speed:set", Number.NaN);
    expect(video.playbackRate).toBe(1);
  });
});
