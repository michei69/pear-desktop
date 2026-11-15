import { beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../index.ts";

type KeyEvent = {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
  composedPath(): unknown[];
  preventDefault(): void;
  stopPropagation(): void;
};

type Registration = {
  target: unknown;
  type: string;
  listener: (event: KeyEvent) => void;
  options?: AddEventListenerOptions | undefined;
};

const page = plugin.page as unknown as { start(ctx: unknown): void };
const registrations: Registration[] = [];

class FakeElement {
  isContentEditable = false;
  tagName = "";
}

beforeEach(() => {
  registrations.length = 0;
  // The page runtime's globals, without a real DOM.
  Object.assign(globalThis, { window: new EventTarget(), HTMLElement: FakeElement });
});

function start(options: { player?: boolean; searchBoxOpen?: boolean; lyricsHost?: boolean } = {}) {
  const controls: { type: string; seconds?: number }[] = [];
  const searchBox = { opened: options.searchBoxOpen ?? false };
  const lyricsHost = options.lyricsHost === false ? null : new FakeElement();
  const ctx = {
    // The lyrics view's host while synced-lyrics runs.
    $: (name: string) => (name === "lyrics.view" ? lyricsHost : name === "nav_bar.search_box" ? searchBox : null),
    player: {
      api: options.player === false ? null : {},
      control: (action: { type: string; seconds?: number }) => controls.push(action),
    },
    observe: vi.fn(),
    waitFor: (name: string) => (name === "player.page" ? Promise.resolve(lyricsHost) : Promise.reject(new Error("unexpected selector"))),
    listen: (target: unknown, type: string, listener: Registration["listener"], listenerOptions?: AddEventListenerOptions) =>
      registrations.push({ target, type, listener, options: listenerOptions }),
  };
  page.start(ctx);
  return { controls, lyricsHost };
}

// The start's waitFor(…).then(attach) runs as a microtask.
const settle = () => Promise.resolve();

function keydown(patch: Partial<KeyEvent> = {}): KeyEvent {
  const event = {
    code: "ArrowRight",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: null,
    composedPath: () => [],
    preventDefault: vi.fn(() => {
      event.defaultPrevented = true;
    }),
    stopPropagation: vi.fn(),
    ...patch,
  };
  return event;
}

/** The listener the plugins registered on `target`, if any. */
const listenerOn = (target: unknown) => {
  const registration = registrations.find((entry) => entry.target === target && entry.type === "keydown");
  expect(registration, "no keydown listener on the target").toBeDefined();
  return registration!.listener;
};

describe("seek-shortcuts", () => {
  it("listens on window in the bubble phase and leaves the key for other handlers", () => {
    const { controls } = start();
    const registration = registrations.find((entry) => entry.target === globalThis.window);
    expect(registration?.type).toBe("keydown");
    expect(registration?.options).toBeUndefined();

    const event = keydown({ code: "ArrowRight" });
    registration!.listener(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(controls).toEqual([{ type: "seekBy", seconds: 5 }]);
  });

  it("seeks five seconds back with the left arrow", () => {
    const { controls } = start();
    listenerOn(globalThis.window)(keydown({ code: "ArrowLeft" }));
    expect(controls).toEqual([{ type: "seekBy", seconds: -5 }]);
  });

  it("also listens on the lyrics view's host, where synced-lyrics isolates keys", async () => {
    const { controls, lyricsHost } = start();
    await settle();

    const event = keydown({ code: "ArrowLeft" });
    listenerOn(lyricsHost)(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(controls).toEqual([{ type: "seekBy", seconds: -5 }]);
  });

  it("leaves a key the lyrics UI already handled alone", async () => {
    const { controls, lyricsHost } = start();
    await settle();
    const event = keydown({ code: "ArrowRight", defaultPrevented: true });
    listenerOn(lyricsHost)(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(controls).toEqual([]);
  });

  it("leaves the arrows to a text field inside the shadow root", async () => {
    const { controls, lyricsHost } = start();
    await settle();
    const input = Object.assign(new FakeElement(), { tagName: "INPUT" });
    const event = keydown({ composedPath: () => [input, lyricsHost] });
    listenerOn(lyricsHost)(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(controls).toEqual([]);
  });

  it("skips the host listener when synced-lyrics is not running", () => {
    start({ lyricsHost: false });
    expect(registrations.filter((entry) => entry.type === "keydown")).toHaveLength(1);
  });

  it("leaves modified and non-arrow keys alone", () => {
    const { controls } = start();
    for (const event of [keydown({ shiftKey: true }), keydown({ ctrlKey: true }), keydown({ code: "ArrowUp" })]) {
      listenerOn(globalThis.window)(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(controls).toEqual([]);
  });

  it("leaves the arrows to a text field", () => {
    const { controls } = start();
    const input = Object.assign(new FakeElement(), { tagName: "INPUT" });
    const event = keydown({ composedPath: () => [input] });
    listenerOn(globalThis.window)(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(controls).toEqual([]);
  });

  it("leaves the arrows to the open search box", () => {
    const { controls } = start({ searchBoxOpen: true });
    listenerOn(globalThis.window)(keydown());
    expect(controls).toEqual([]);
  });

  it("does nothing before the player API exists", () => {
    const { controls } = start({ player: false });
    listenerOn(globalThis.window)(keydown());
    expect(controls).toEqual([]);
  });
});
