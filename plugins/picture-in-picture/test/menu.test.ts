import { describe, expect, it } from "vitest";
import { isPlayerBarMenu, isTrackMenu, menuOwner } from "../menu.ts";

/** The parts of an element the menu-identity checks read. */
interface FakeElement {
  parentElement: FakeElement | null;
  ytEventForwardingBehavior?: { forwarder_?: { eventSink: HTMLElement } };
  contains(node: unknown): boolean;
  matches(selector: string): boolean;
}

const fake = (overrides: Partial<FakeElement> = {}): FakeElement => ({
  parentElement: null,
  contains: () => false,
  matches: () => false,
  ...overrides,
});
const asElement = (element: FakeElement) => element as unknown as HTMLElement;

/** A popup listbox, with `chain` as its ancestors (closest first). */
function listbox(chain: FakeElement[]) {
  const [first, ...rest] = chain;
  if (first) first.parentElement = rest[0] ?? null;
  for (let index = 0; index < rest.length - 1; index += 1) rest[index]!.parentElement = rest[index + 1]!;
  return asElement(first ?? fake());
}

const forwarding = (sink: HTMLElement) => ({ ytEventForwardingBehavior: { forwarder_: { eventSink: sink } } });

/** The checks' context: the player bar, and the page player's current track. */
const ctxFor = (bar: FakeElement | null, track: unknown = null) =>
  ({
    $: () => (bar ? asElement(bar) : null),
    player: { state: { track } },
  }) as unknown as Parameters<typeof isTrackMenu>[0] & Parameters<typeof isPlayerBarMenu>[0];

const track = { videoId: "abc" };

describe("menuOwner", () => {
  it("finds the menu renderer YTM forwards the popup's events to", () => {
    const owner = asElement(fake());
    const list = listbox([fake(), fake(forwarding(owner))]);
    expect(menuOwner(list)).toBe(owner);
  });

  it("returns nothing without the forwarding hook", () => {
    expect(menuOwner(listbox([fake(), fake()]))).toBeUndefined();
    expect(menuOwner(asElement(fake()))).toBeUndefined();
  });
});

describe("isPlayerBarMenu", () => {
  it("accepts the player bar's own menu", () => {
    const owner = asElement(fake());
    const bar = fake({ contains: (node) => node === owner });
    const list = listbox([fake(), fake(forwarding(owner))]);
    expect(isPlayerBarMenu(ctxFor(bar), list)).toBe(true);
  });

  it("recognises the classic bar's menu renderer by its class", () => {
    const owner = asElement(fake({ matches: (selector: string) => selector === "ytmusic-menu-renderer.ytmusic-player-bar" }));
    const list = listbox([fake(), fake(forwarding(owner))]);
    expect(isPlayerBarMenu(ctxFor(null), list)).toBe(true);
  });

  it("rejects a row's menu, and a popup with no owner", () => {
    const owner = asElement(fake());
    const list = listbox([fake(), fake(forwarding(owner))]);
    expect(isPlayerBarMenu(ctxFor(fake({ contains: () => false })), list)).toBe(false);
    expect(isPlayerBarMenu(ctxFor(fake()), listbox([fake(), fake()]))).toBe(false);
    expect(isPlayerBarMenu(ctxFor(null), list)).toBe(false);
  });
});

describe("isTrackMenu", () => {
  it("needs the player bar's menu of a playing track", () => {
    const owner = asElement(fake());
    const bar = fake({ contains: (node) => node === owner });
    const list = listbox([fake(), fake(forwarding(owner))]);
    expect(isTrackMenu(ctxFor(bar, track), list)).toBe(true);
    // A row's menu of the playing track is not the track menu.
    expect(isTrackMenu(ctxFor(fake({ contains: () => false }), track), list)).toBe(false);
    // The player bar's menu of nothing (the app's own menu) is not a track menu.
    expect(isTrackMenu(ctxFor(bar, null), list)).toBe(false);
  });
});
