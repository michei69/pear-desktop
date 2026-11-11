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

function start(options: { player?: boolean; searchBoxOpen?: boolean } = {}) {
  const controls: { type: string; seconds?: number }[] = [];
  const searchBox = { opened: options.searchBoxOpen ?? false };
  const ctx = {
    $: (name: string) => (name === "nav_bar.search_box" ? searchBox : null),
    player: {
      api: options.player === false ? null : {},
      control: (action: { type: string; seconds?: number }) => controls.push(action),
    },
    listen: (target: unknown, type: string, listener: Registration["listener"], listenerOptions?: AddEventListenerOptions) =>
      registrations.push({ target, type, listener, options: listenerOptions }),
  };
  page.start(ctx);
  return { controls };
}

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

const send = (event: KeyEvent) => {
  const registration = registrations[0];
  expect(registration?.type).toBe("keydown");
  registration!.listener(event);
};

describe("seek-shortcuts", () => {
  it("listens in the bubble phase and leaves the key for other handlers", () => {
    const { controls } = start();
    expect(registrations[0]?.target).toBe(globalThis.window);
    expect(registrations[0]?.options).toBeUndefined();

    const event = keydown({ code: "ArrowRight" });
    send(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(controls).toEqual([{ type: "seekBy", seconds: 5 }]);
  });

  it("seeks five seconds back with the left arrow", () => {
    const { controls } = start();
    send(keydown({ code: "ArrowLeft" }));
    expect(controls).toEqual([{ type: "seekBy", seconds: -5 }]);
  });

  it("leaves modified and non-arrow keys alone", () => {
    const { controls } = start();
    for (const event of [keydown({ shiftKey: true }), keydown({ ctrlKey: true }), keydown({ code: "ArrowUp" })]) {
      send(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(controls).toEqual([]);
  });

  it("leaves the arrows to a text field", () => {
    const { controls } = start();
    const input = Object.assign(new FakeElement(), { tagName: "INPUT" });
    const event = keydown({ composedPath: () => [input] });
    send(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(controls).toEqual([]);
  });

  it("leaves the arrows to the open search box", () => {
    const { controls } = start({ searchBoxOpen: true });
    const event = keydown();
    send(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(controls).toEqual([]);
  });

  it("does nothing before the player API exists", () => {
    const { controls } = start({ player: false });
    const event = keydown();
    send(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(controls).toEqual([]);
  });

  it("respects a key a deeper handler already consumed", () => {
    const { controls } = start();
    const event = keydown({ defaultPrevented: true });
    send(event);
    expect(controls).toEqual([]);
  });
});
