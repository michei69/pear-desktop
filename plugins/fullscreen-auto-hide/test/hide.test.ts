import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../index.ts";

const ACTIVE_CLASS = "pear-fullscreen-active";
const IDLE_CLASS = "pear-fullscreen-idle";
const IDLE_MS = 2_500;
const RECHECK_MS = 100;

type Listener = (event: unknown) => void;

class FakeStyle {
  readonly values = new Map<string, string>();

  setProperty(name: string, value: string) {
    this.values.set(name, value);
  }

  removeProperty(name: string) {
    this.values.delete(name);
  }
}

class FakeElement {
  readonly attributes = new Set<string>();
  readonly style = new FakeStyle();

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  getAttribute(name: string) {
    return this.attributes.has(name) ? "" : null;
  }
}

/** A page body whose classes the tests read. */
function fakeBody() {
  const names = new Set<string>();
  const add = vi.fn((...next: string[]) => next.forEach((name) => names.add(name)));
  const remove = vi.fn((...next: string[]) => next.forEach((name) => names.delete(name)));
  return {
    classList: {
      add,
      remove,
      toggle(name: string, force?: boolean) {
        if (force ?? !names.has(name)) names.add(name);
        else names.delete(name);
      },
      contains: (name: string) => names.has(name),
    },
    add,
    remove,
    names,
  };
}

interface PageState {
  layoutFullscreen: boolean;
  bar: FakeElement;
  body: ReturnType<typeof fakeBody>;
  document: {
    body: { classList: ReturnType<typeof fakeBody>["classList"] };
    fullscreenElement: Element | null;
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  listeners: Map<string, Set<Listener>>;
  cleanups: (() => void)[];
}

/** Installs a fake document and the parts of a page context the plugin uses. */
function harness(options: { layoutFullscreen?: boolean; barFullscreen?: boolean } = {}) {
  const state: PageState = {
    layoutFullscreen: options.layoutFullscreen ?? false,
    bar: new FakeElement(),
    body: fakeBody(),
    document: { body: {} as PageState["document"]["body"], fullscreenElement: null },
    listeners: new Map(),
    cleanups: [],
  };
  if (options.barFullscreen) state.bar.attributes.add("player-fullscreened");
  state.document.body = { classList: state.body.classList };
  vi.stubGlobal("document", state.document);

  const bar = state.bar;
  const ctx = {
    $: (name: string) => {
      if (name === "integrations.fullscreen") return state.layoutFullscreen ? new FakeElement() : null;
      if (name === "player_bar") return bar;
      return null;
    },
    waitFor: async () => new FakeElement(),
    listen: (_target: unknown, type: string, listener: Listener) => {
      const set = state.listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      state.listeners.set(type, set);
    },
    observe: () => {},
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    onCleanup: (fn: () => void) => state.cleanups.push(fn),
  };

  const startPage = (plugin.page as unknown as { start(ctx: unknown): void }).start;
  startPage(ctx);

  return {
    state,
    body: state.body,
    bar,
    /** Runs a listener the way the real document would. */
    emit(type: string) {
      for (const listener of state.listeners.get(type) ?? []) listener({ type });
    },
    cleanup() {
      for (const fn of state.cleanups) fn();
    },
  };
}

const flush = async () => {
  for (let index = 0; index < 5; index++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("detecting full screen", () => {
  it("follows the layout's fullscreen attribute", async () => {
    const app = harness({ layoutFullscreen: true });
    await flush();
    expect(app.body.names.has(ACTIVE_CLASS)).toBe(true);

    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(app.body.names.has(IDLE_CLASS)).toBe(true);
    expect(app.bar.style.values.get("opacity")).toBe("0");
    expect(app.bar.style.values.get("pointer-events")).toBe("none");
  });

  it("follows the player bar's own fullscreen attribute", async () => {
    const app = harness({ barFullscreen: true });
    await flush();
    expect(app.body.names.has(ACTIVE_CLASS)).toBe(true);
  });

  it.each(["fullscreenElement", "webkitFullscreenElement", "mozFullScreenElement", "msFullscreenElement"] as const)(
    "follows the native API's %s",
    async (property) => {
      const app = harness();
      app.state.document[property] = new FakeElement() as unknown as Element;
      app.emit("fullscreenchange");
      await flush();
      expect(app.body.names.has(ACTIVE_CLASS)).toBe(true);
    },
  );

  it("wakes from the idle hide on activity", async () => {
    const app = harness({ layoutFullscreen: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(app.body.names.has(IDLE_CLASS)).toBe(true);

    app.emit("mousemove");
    expect(app.body.names.has(IDLE_CLASS)).toBe(false);
    expect(app.bar.style.values.has("opacity")).toBe(false);
  });

  it("stops hiding once full screen ends", async () => {
    const app = harness({ layoutFullscreen: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);

    app.state.layoutFullscreen = false;
    app.emit("fullscreenchange");

    expect(app.body.names.has(ACTIVE_CLASS)).toBe(false);
    expect(app.body.names.has(IDLE_CLASS)).toBe(false);
    expect(app.bar.style.values.size).toBe(0);

    // The idle timer must be gone too, or the bar would hide after leaving.
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(app.bar.style.values.size).toBe(0);
  });
});

describe("fullscreen signals", () => {
  it("coalesces YTM's burst into one 100 ms re-check", async () => {
    const app = harness();
    // Let the plugin's initial (not fullscreen) apply settle first.
    await flush();
    app.state.document.fullscreenElement = new FakeElement() as unknown as Element;

    app.emit("ytm-player-fullscreen");
    app.emit("ytm-player-fullscreen");
    app.emit("ytm-player-fullscreen");
    await flush();
    expect(app.body.names.has(ACTIVE_CLASS)).toBe(false);

    await vi.advanceTimersByTimeAsync(RECHECK_MS - 1);
    expect(app.body.names.has(ACTIVE_CLASS)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(app.body.names.has(ACTIVE_CLASS)).toBe(true);
    // One apply ran, not one per event.
    expect(app.body.add.mock.calls.filter(([name]) => name === ACTIVE_CLASS)).toHaveLength(1);
  });

  it("restores the bar and classes when the plugin stops", async () => {
    const app = harness({ layoutFullscreen: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);

    app.cleanup();

    expect(app.body.names.size).toBe(0);
    expect(app.bar.style.values.size).toBe(0);
  });
});

describe("the stylesheet", () => {
  const style = () => plugin.style as string;

  it("keeps the bar's transition for the plugin's lifetime, so leaving full screen fades", () => {
    expect(style()).toMatch(/transition:opacity/);
    expect(style()).not.toContain("pear-fullscreen-active");
  });

  it("hides the cursor only while idle", () => {
    expect(style()).toMatch(/body\.pear-fullscreen-idle\{cursor:none\}/);
  });
});
