import { describe, expect, it } from "vitest";
import plugin from "../index.ts";
import { isPlayerPageOpen, isShuffleControl } from "../detect.ts";

interface FakeOptions {
  icon?: string;
  classes?: string[];
  attributes?: Record<string, string>;
  parent?: FakeElement | null;
  data?: unknown;
}

/** Just enough of an element for the selectors these decisions read. */
class FakeElement {
  readonly tag: string;
  readonly children: FakeElement[] = [];
  readonly attributes: Record<string, string>;
  readonly classes: Set<string>;
  readonly data: unknown;
  icon: string | undefined;
  parent: FakeElement | null;

  constructor(tag: string, options: FakeOptions = {}) {
    this.tag = tag;
    this.icon = options.icon;
    this.data = options.data;
    this.attributes = options.attributes ?? {};
    this.classes = new Set(options.classes ?? []);
    this.parent = options.parent ?? null;
    this.parent?.children.push(this);
  }

  get classList() {
    const classes = this.classes;
    return { contains: (name: string) => classes.has(name) };
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string) {
    return name in this.attributes;
  }

  closest(selector: string): FakeElement | null {
    if (matchesTag(selector, this)) return this;
    return this.parent?.closest(selector) ?? null;
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.tag === selector.trim()) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

const matchesTag = (selector: string, node: FakeElement) =>
  selector
    .split(",")
    .map((part) => part.trim())
    .some((tag) => !tag.startsWith(".") && !tag.includes("[") && node.tag === tag);

const element = (tag: string, options: FakeOptions = {}) => new FakeElement(tag, options);
const asElement = (node: FakeElement) => node as unknown as Element;

describe("isShuffleControl", () => {
  it("matches the header's shuffle icon button through its classes", () => {
    const button = element("yt-icon-button", { classes: ["shuffle"] });
    expect(isShuffleControl(asElement(element("div", { parent: button })))).toBe(true);
  });

  it("matches a button that only names its shuffle icon", () => {
    const icon = element("yt-icon", { icon: "shuffle" });
    element("button", { parent: element("yt-icon-button", { classes: ["expand-shuffle"] }) });
    expect(isShuffleControl(asElement(icon))).toBe(true);
  });

  it("matches the 'Shuffle play' menu entry through the renderer's icon data", () => {
    const item = element("ytmusic-menu-navigation-item-renderer", {
      data: { icon: { iconType: "MUSIC_SHUFFLE" } },
    });
    expect(isShuffleControl(asElement(element("span", { parent: item })))).toBe(true);
  });

  it("matches a menu entry through its rendered icon", () => {
    const item = element("ytmusic-menu-service-item-renderer");
    element("yt-icon", { icon: "shuffle", parent: item });
    expect(isShuffleControl(asElement(element("span", { parent: item })))).toBe(true);
  });

  it("leaves play buttons and plain links alone", () => {
    expect(isShuffleControl(asElement(element("ytmusic-play-button-renderer")))).toBe(false);
    expect(isShuffleControl(asElement(element("a", { attributes: { href: "/watch?v=abc" } })))).toBe(false);
    expect(isShuffleControl(asElement(element("yt-icon-button", { classes: ["play"] })))).toBe(false);
  });
});

describe("isPlayerPageOpen", () => {
  it("reads the layout's player-ui-state when the layout reports one", () => {
    expect(
      isPlayerPageOpen(asElement(element("ytmusic-app-layout", { attributes: { "player-ui-state": "PLAYER_PAGE_OPEN" } })), null),
    ).toBe(true);
    expect(
      isPlayerPageOpen(asElement(element("ytmusic-app-layout", { attributes: { "player-ui-state": "PLAYER_PAGE_CLOSED" } })), null),
    ).toBe(false);
  });

  it("falls back to the plain player-page-open attribute", () => {
    expect(isPlayerPageOpen(asElement(element("ytmusic-app-layout", { attributes: { "player-page-open": "" } })), null)).toBe(true);
    expect(isPlayerPageOpen(asElement(element("ytmusic-app-layout")), null)).toBe(false);
  });

  it("falls back to the page element's own flag when the layout is not there yet", () => {
    const page = Object.assign(element("ytmusic-player-page"), { playerPageOpen_: true });
    expect(isPlayerPageOpen(null, asElement(page))).toBe(true);
    expect(isPlayerPageOpen(null, asElement(element("ytmusic-player-page")))).toBe(false);
    expect(isPlayerPageOpen(null, null)).toBe(false);
  });
});

describe("the latch stylesheet", () => {
  const style = () => plugin.style as string;

  it("keeps the browse page visible and scrollable while the latch hides the player page", () => {
    expect(style()).toMatch(/ytmusic-player-page[^{]*\{visibility:hidden!important\}/);
    expect(style()).toContain("overflow:visible!important");
    expect(style()).toMatch(/ytmusic-app-layout>#content\{visibility:visible!important\}/);
  });

  it("keeps YTM's nav bar backgrounds out of the way while the content is scrolled", () => {
    expect(style()).toContain("#nav-bar-background");
    expect(style()).toContain("#nav-bar-divider");
    expect(style()).toContain("#mini-guide-background");
  });

  it("no longer forces body overflow outside the latch", () => {
    expect(style()).not.toMatch(/^body\{/);
  });
});
