import type { QueueItem } from "@pear/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../index.ts";

const EXPLICIT = { icon: { iconType: "MUSIC_EXPLICIT_BADGE" } };
const BADGE_SELECTOR = "ytmusic-inline-badge-renderer";
const ROW_SELECTOR =
  "ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-player-queue-item, ytmusic-card-shelf-renderer";
const CONTROL_SELECTOR = "a, button, ytmusic-menu-renderer, yt-icon-button, tp-yt-paper-icon-button";
const PLAYBACK_SELECTOR = 'ytmusic-play-button-renderer, a[href*="watch?"]';

const ATTRIBUTE = /^([\w-]+)\[href\*="([^"]+)"\]$/;

/** The little of YTM's DOM the plugin touches: tags, attributes, closest() and nested queries. */
class FakeElement {
  readonly tagName: string;
  parent: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  href?: string;
  data?: { icon?: { iconType?: string } };
  ytmusicReduxBehavior?: { store: { store: FakeStore } };
  queue?: { getItems(): QueueItem[]; store?: { store: FakeStore } };
  dispatch?: (action: { type: string; payload?: unknown }) => void;

  constructor(tagName: string, properties: { href?: string; data?: { icon?: { iconType?: string } } } = {}) {
    this.tagName = tagName;
    Object.assign(this, properties);
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
    return this;
  }

  /** Element.closest: this element and its ancestors, matching any comma-separated part. */
  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    return this.parent?.closest(selector) ?? null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.descendants().find((node) => node.matches(selector)) ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter((node) => node.matches(selector));
  }

  matches(selector: string): boolean {
    return selector
      .split(",")
      .map((part) => part.trim())
      .some((part) => {
        const attribute = ATTRIBUTE.exec(part);
        if (attribute) return this.tagName === attribute[1] && (this.href ?? "").includes(attribute[2]!);
        return this.tagName === part;
      });
  }

  private descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

type FakeStore = {
  getState(): { queue: { items: QueueItem[]; selectedItemIndex: number; repeatMode: string } };
  subscribe(listener: () => void): () => void;
};

type PlayerStatus = "playing" | "paused";

type Listener = (event: FakeEvent) => void;

type FakeEvent = {
  target: FakeElement | null;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
};

const startPage = plugin.page as unknown as (ctx: unknown) => void;

const explicitIcon = (): { icon: { iconType: string } } => ({ ...EXPLICIT });
const song = (videoId: string, explicit = true): QueueItem => ({
  playlistPanelVideoRenderer: { videoId, ...(explicit ? { badges: [{ musicInlineBadgeRenderer: explicitIcon() }] } : {}) },
});
const wrapper = (primary: string, counterpart: string): QueueItem => ({
  playlistPanelVideoWrapperRenderer: {
    primaryRenderer: song(primary, false),
    counterpart: [{ counterpartRenderer: song(counterpart) }],
  },
});

const sleep = async (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

type Fixture = ReturnType<typeof setup>;

/** A fake player, queue, app store and page context. */
function setup() {
  const app = new FakeElement("ytmusic-app");
  const queueElement = new FakeElement("ytmusic-player-queue");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, "Element");

  let items: QueueItem[] = [song("explicit")];
  let selectedItemIndex = 0;
  let repeatMode = "NONE";
  let videoId = "explicit";
  let status: PlayerStatus = "playing";
  let pauses = 0;
  let skips = 0;
  const queueSelections: number[] = [];
  const playerListeners = new Map<string, Set<() => void>>();
  const queueSubscribers = new Set<() => void>();
  const listens: { type: string; listener: Listener }[] = [];
  const cleanups: (() => void)[] = [];
  const observe = vi.fn();

  const store: FakeStore = {
    getState: () => ({ queue: { items, selectedItemIndex, repeatMode } }),
    subscribe(listener) {
      queueSubscribers.add(listener);
      return () => queueSubscribers.delete(listener);
    },
  };
  app.ytmusicReduxBehavior = { store: { store } };
  queueElement.queue = { getItems: () => items, store: { store } };
  queueElement.dispatch = (action) => {
    if (action.type !== "SET_INDEX") return;
    const payload = Number(action.payload);
    queueSelections.push(payload);
    skips += 1;
    selectedItemIndex = payload;
    const next = items[payload]?.playlistPanelVideoRenderer?.videoId;
    videoId = next ?? videoId;
  };

  const notifyQueue = () => {
    for (const listener of [...queueSubscribers]) listener();
  };
  const notifyPlayer = () => {
    for (const listeners of playerListeners.values()) for (const listener of [...listeners]) listener();
  };

  const api = { getVideoData: () => ({ video_id: videoId }) };
  const player = {
    get api() {
      return api;
    },
    get state() {
      return { status };
    },
    on(event: string, listener: () => void) {
      const listeners = playerListeners.get(event) ?? new Set();
      listeners.add(listener);
      playerListeners.set(event, listeners);
      return () => listeners.delete(listener);
    },
    control(action: { type: string }) {
      if (action.type === "pause") {
        pauses += 1;
        status = "paused";
      } else if (action.type === "next") {
        skips += 1;
      }
    },
  };

  const ctx = {
    player,
    sel: () => BADGE_SELECTOR,
    $: () => null,
    observe,
    listen: (_target: unknown, type: string, listener: Listener) => listens.push({ type, listener }),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
    onCleanup: (fn: () => void) => cleanups.push(fn),
  };

  // The plugin's check() and the SDK's queue helpers read the page globals.
  const fakeDocument = {
    querySelector: (selector: string) => (selector === "#queue" ? queueElement : selector === "ytmusic-app" ? app : null),
  };
  Object.assign(globalThis, { document: fakeDocument, Element: FakeElement });

  return {
    observe,
    start: () => startPage(ctx),
    stop: () => {
      for (const cleanup of [...cleanups]) cleanup();
    },
    play: async (id: string, index = 0) => {
      videoId = id;
      selectedItemIndex = index;
      notifyPlayer();
      await sleep();
    },
    resume: async () => {
      status = "playing";
      notifyPlayer();
      await sleep();
    },
    setItems: (next: QueueItem[]) => {
      items = next;
      notifyQueue();
    },
    select: (index: number) => {
      selectedItemIndex = index;
    },
    repeatAll: () => {
      repeatMode = "ALL";
    },
    removeQueueStore: () => {
      delete queueElement.queue;
    },
    queueSubscribers: () => queueSubscribers.size,
    listener: (type: string) => {
      const entry = listens.find((listen) => listen.type === type);
      if (!entry) throw new Error(`no ${type} listener`);
      return entry.listener;
    },
    click: (target: FakeElement) => {
      const event: FakeEvent = {
        target,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault: () => {
          event.defaultPrevented = true;
        },
        stopImmediatePropagation: () => {
          event.propagationStopped = true;
        },
      };
      return event;
    },
    row: (tagName: string, children: FakeElement[] = []) =>
      new FakeElement(tagName).append(...children, new FakeElement(BADGE_SELECTOR, { data: explicitIcon() })),
    restore: () => {
      for (const cleanup of [...cleanups]) cleanup();
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else delete (globalThis as { document?: unknown }).document;
      if (previousElement) Object.defineProperty(globalThis, "Element", previousElement);
      else delete (globalThis as { Element?: unknown }).Element;
    },
    get pauses() {
      return pauses;
    },
    get skips() {
      return skips;
    },
    get status() {
      return status;
    },
    get queueSelections() {
      return queueSelections;
    },
  };
}

let fixture: Fixture;

beforeEach(() => {
  fixture = setup();
});

// The global document/Element stay for the test body; restore them afterwards.
afterEach(() => fixture.restore());

describe("sfw-music", () => {
  it("skips the current explicit song immediately and only once", async () => {
    fixture.start();
    await fixture.play("explicit");
    expect(fixture.skips).toBe(1);
    expect(fixture.pauses).toBe(1);
  });

  it("leaves clean songs alone even when an explicit song is in the queue", async () => {
    fixture.setItems([song("explicit"), song("clean", false)]);
    await fixture.play("clean", 1);
    fixture.start();
    expect(fixture.skips).toBe(0);
    expect(fixture.pauses).toBe(0);
  });

  it("ignores stale metadata belonging to another video", async () => {
    await fixture.play("clean");
    fixture.start();
    expect(fixture.skips).toBe(0);
  });

  it("skips a directly selected explicit song when the queue index points elsewhere", async () => {
    fixture.setItems([song("explicit"), song("clean", false)]);
    await fixture.play("explicit", 1);
    fixture.start();
    expect(fixture.pauses).toBe(1);
    expect(fixture.skips).toBe(1);
    expect(fixture.queueSelections).toEqual([1]);
  });

  it("advances with the player API after a direct one-song selection", async () => {
    await fixture.play("explicit", 1);
    fixture.start();
    expect(fixture.skips).toBe(1);
    expect(fixture.queueSelections).toEqual([]);
  });

  it("recognizes an explicit video counterpart outside the selected queue row", async () => {
    fixture.setItems([wrapper("audio", "explicit"), song("clean", false)]);
    await fixture.play("explicit", 1);
    fixture.start();
    expect(fixture.pauses).toBe(1);
    expect(fixture.queueSelections).toEqual([1]);
  });

  it("wraps to the first song when directly selecting the last explicit song with repeat all", async () => {
    fixture.setItems([song("clean", false), song("explicit")]);
    fixture.repeatAll();
    await fixture.play("explicit", 0);
    fixture.start();
    expect(fixture.queueSelections).toEqual([0]);
  });

  it("detects explicit metadata arriving after the song event", async () => {
    fixture.setItems([]);
    fixture.start();
    fixture.setItems([song("explicit")]);
    await sleep();
    expect(fixture.skips).toBe(1);
  });

  it("stops at a repeated explicit song in an all-explicit queue", async () => {
    fixture.setItems([song("explicit"), song("second")]);
    fixture.start();
    await fixture.play("second", 1);
    await fixture.play("explicit");
    expect(fixture.skips).toBe(2);
    expect(fixture.pauses).toBe(3);
  });

  it("stops when repeat all wraps back to an already skipped song", async () => {
    fixture.setItems([song("first"), song("second")]);
    fixture.repeatAll();
    fixture.start();
    await fixture.play("first", 0);
    // Direct selection leaves the index on "first", so the skip wraps there.
    await fixture.play("second", 0);
    await fixture.resume();
    expect(fixture.queueSelections).toEqual([0]);
    expect(fixture.skips).toBe(2);
    expect(fixture.status).toBe("paused");
  });

  it("skips again when a new queue starts with an already skipped song", async () => {
    fixture.setItems([song("explicit"), song("clean", false)]);
    fixture.start();
    expect(fixture.skips).toBe(1);
    fixture.setItems([song("explicit")]);
    await fixture.play("explicit");
    expect(fixture.skips).toBe(2);
  });

  it("keeps the loop guard when the radio appends songs", async () => {
    fixture.setItems([song("first"), song("second")]);
    fixture.start();
    await fixture.play("first");
    expect(fixture.skips).toBe(1);
    fixture.setItems([song("first"), song("second"), song("third")]);
    await fixture.play("first");
    expect(fixture.skips).toBe(1);
  });

  it("falls back to the app's queue slice when the queue element has no store", async () => {
    fixture.removeQueueStore();
    fixture.start();
    expect(fixture.pauses).toBe(1);
    expect(fixture.skips).toBe(1);
  });

  it("can skip the same song again after a clean song plays", async () => {
    fixture.setItems([song("explicit"), song("clean", false)]);
    fixture.start();
    await fixture.play("clean", 1);
    await fixture.play("explicit");
    expect(fixture.skips).toBe(2);
  });

  it("skips separate copies of a song before reaching a clean song", async () => {
    fixture.setItems([song("explicit"), song("second"), song("explicit"), song("clean", false)]);
    fixture.start();
    await fixture.play("second", 1);
    await fixture.play("explicit", 2);
    await fixture.play("clean", 3);
    expect(fixture.skips).toBe(3);
    expect(fixture.pauses).toBe(3);
  });

  it("skips consecutive copies of an explicit song", async () => {
    fixture.setItems([song("explicit"), song("explicit")]);
    fixture.start();
    await fixture.play("explicit", 1);
    expect(fixture.skips).toBe(2);
  });

  it("blocks playback restarting while an explicit skip is still pending", async () => {
    fixture.start();
    await fixture.resume();
    expect(fixture.status).toBe("paused");
    expect(fixture.skips).toBe(1);
  });

  it("keeps the explicit player paused when the queue has already advanced", async () => {
    fixture.setItems([song("explicit"), song("clean", false)]);
    fixture.start();
    fixture.select(1);
    await fixture.resume();
    expect(fixture.status).toBe("paused");
    expect(fixture.skips).toBe(1);
  });

  it("does not latch on a queue that is still loading", async () => {
    fixture.setItems([song("explicit")]);
    fixture.start();
    // The explicit entry was paused and advanced, not held forever.
    expect(fixture.pauses).toBe(1);
    expect(fixture.skips).toBe(1);

    // The rest of the queue arrives (appended) and the clean entry plays.
    fixture.setItems([song("explicit"), song("clean", false)]);
    await sleep();
    await fixture.play("clean", 1);
    expect(fixture.pauses).toBe(1);
  });

  it("reaches a clean primary inside a wrapper whose counterpart is explicit", async () => {
    fixture.setItems([song("explicit"), wrapper("audio", "explicit")]);
    fixture.start();
    expect(fixture.skips).toBe(1);

    await fixture.play("audio", 1);
    expect(fixture.pauses).toBe(1);
    expect(fixture.skips).toBe(1);
  });

  it("disabling removes the queue subscription and stops delayed checks", async () => {
    fixture.setItems([]);
    fixture.start();
    fixture.stop();
    expect(fixture.queueSubscribers()).toBe(0);

    fixture.setItems([song("explicit")]);
    await fixture.play("explicit");
    await sleep(50);
    expect(fixture.skips).toBe(0);
  });

  it("does not watch every DOM mutation under the app", () => {
    fixture.start();
    expect(fixture.observe).not.toHaveBeenCalled();
  });

  for (const type of ["click", "tap"]) {
    it(`blocks direct explicit selections before YTM handles ${type}`, () => {
      fixture.setItems([]);
      fixture.start();
      const anchor = new FakeElement("a", { href: "watch?v=explicit" });
      const row = fixture.row("ytmusic-responsive-list-item-renderer", [anchor]);
      const event = fixture.click(anchor);
      fixture.listener(type)(event);
      expect(row.querySelector(BADGE_SELECTOR)).not.toBeNull();
      expect(event.defaultPrevented).toBe(true);
      expect(event.propagationStopped).toBe(true);
    });
  }

  it("allows selecting a clean row beside an explicit row", () => {
    fixture.setItems([]);
    fixture.start();
    const anchor = new FakeElement("a", { href: "watch?v=clean" });
    new FakeElement("ytmusic-responsive-list-item-renderer").append(anchor);
    // An explicit row elsewhere on the list must not block the clean row's link.
    fixture.row("ytmusic-responsive-list-item-renderer");
    const event = fixture.click(anchor);
    fixture.listener("click")(event);
    expect(event.defaultPrevented).toBe(false);
  });

  for (const comment of ["menu button", "artist link"]) {
    it(`allows non-playback queue controls: ${comment}`, () => {
      fixture.setItems([]);
      fixture.start();
      const control = comment === "menu button" ? new FakeElement("button") : new FakeElement("a", { href: "browse/artist" });
      const row = fixture.row("ytmusic-player-queue-item", [control]);
      const event = fixture.click(control);
      fixture.listener("click")(event);
      expect(row.matches(ROW_SELECTOR)).toBe(true);
      expect(control.matches(CONTROL_SELECTOR)).toBe(true);
      expect(control.matches(PLAYBACK_SELECTOR)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    });
  }
});
