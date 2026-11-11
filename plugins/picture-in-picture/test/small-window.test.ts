import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rectangle } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmallWindow } from "../small-window.ts";

type Ctx = ConstructorParameters<typeof SmallWindow>[0];

/** The parts of BrowserWindow the small-window mode uses. */
class FakeWindow {
  bounds: Rectangle = { x: 100, y: 100, width: 1200, height: 800 };
  alwaysOnTop = false;
  maximized = false;
  fullscreen = false;
  readonly setAlwaysOnTop = vi.fn((on: boolean) => {
    this.alwaysOnTop = on;
  });
  readonly setVisibleOnAllWorkspaces = vi.fn();
  readonly setFullScreen = vi.fn((on: boolean) => {
    this.fullscreen = on;
  });
  readonly unmaximize = vi.fn(() => {
    this.maximized = false;
  });
  readonly setMaximizable = vi.fn();
  readonly setFullScreenable = vi.fn();
  readonly setMinimumSize = vi.fn();
  readonly setBounds = vi.fn((bounds: Rectangle) => {
    this.bounds = bounds;
  });
  readonly setWindowButtonVisibility = vi.fn();
  readonly on = vi.fn();
  readonly off = vi.fn();
  readonly isDestroyed = vi.fn(() => false);
  readonly getNormalBounds = () => this.bounds;
  readonly isMaximized = () => this.maximized;
  readonly isFullScreen = () => this.fullscreen;
  readonly isAlwaysOnTop = () => this.alwaysOnTop;
}

const config = {
  hotkey: "P",
  useNativePiP: false,
  alwaysOnTop: true,
  savePosition: false,
  saveSize: false,
};

let dir = "";
let window: FakeWindow;
let dock: { hide: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> };
let ctx: Ctx;
let small: SmallWindow;

const platform = process.platform;
const setPlatform = (value: string) => Object.defineProperty(process, "platform", { value, configurable: true });

beforeEach(() => {
  vi.useFakeTimers();
  config.alwaysOnTop = true;
  dir = mkdtempSync(join(tmpdir(), "pear-pip-"));
  window = new FakeWindow();
  dock = { hide: vi.fn(), show: vi.fn() };
  ctx = {
    app: { getPath: () => dir, dock },
    window,
    config,
    emit: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as Ctx;
  small = new SmallWindow(ctx);
});

afterEach(() => {
  vi.useRealTimers();
  setPlatform(platform);
  rmSync(dir, { recursive: true, force: true });
});

/** Leaves the small window and runs the full-screen restore's fallback timer. */
function dispose() {
  small.dispose();
  vi.advanceTimersByTime(1_000);
}

describe("the small window's settings", () => {
  it("applies always-on-top while the window is small, and nothing while it is not", () => {
    small.applyConfig();
    expect(window.setAlwaysOnTop).not.toHaveBeenCalled();

    small.enter();
    expect(window.setAlwaysOnTop).toHaveBeenLastCalledWith(true, "screen-saver", 1);

    config.alwaysOnTop = false;
    small.applyConfig();
    expect(window.setAlwaysOnTop).toHaveBeenLastCalledWith(false);

    config.alwaysOnTop = true;
    small.applyConfig();
    expect(window.setAlwaysOnTop).toHaveBeenLastCalledWith(true, "screen-saver", 1);

    dispose();
  });

  it("keeps the core Always-on-top option when leaving the small window", () => {
    window.alwaysOnTop = true;
    small.enter();
    config.alwaysOnTop = false;
    small.applyConfig();
    expect(window.alwaysOnTop).toBe(false);

    dispose();
    expect(window.alwaysOnTop).toBe(true);
  });
});

describe("the macOS full-screen Spaces workaround", () => {
  it("hides and shows the dock around joining every Space", () => {
    setPlatform("darwin");
    small.enter();

    expect(dock.hide).toHaveBeenCalledOnce();
    expect(dock.show).toHaveBeenCalledOnce();
    const visible = window.setVisibleOnAllWorkspaces.mock.invocationCallOrder[0]!;
    expect(dock.hide.mock.invocationCallOrder[0]!).toBeLessThan(visible);
    expect(dock.show.mock.invocationCallOrder[0]!).toBeGreaterThan(visible);

    dispose();
  });

  it("leaves the dock alone elsewhere", () => {
    setPlatform("linux");
    small.enter();

    expect(dock.hide).not.toHaveBeenCalled();
    expect(dock.show).not.toHaveBeenCalled();
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true });

    dispose();
  });
});
