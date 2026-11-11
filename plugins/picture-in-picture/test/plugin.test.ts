import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostContextOf, PageContext, PagePartObject } from "@pear/sdk";
import type { Rectangle } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { pipConfig } from "../config.ts";
import plugin from "../index.ts";

type Ctx = HostContextOf<typeof pipConfig>;
type ConfigListener = (config: Ctx["config"]) => void | "restart";

const defaults: Ctx["config"] = { hotkey: "P", useNativePiP: true, alwaysOnTop: true, savePosition: true, saveSize: false };

/** The parts of BrowserWindow the host part uses. */
function fakeWindow() {
  const state = { bounds: { x: 100, y: 100, width: 1200, height: 800 } as Rectangle, alwaysOnTop: false };
  return {
    state,
    setAlwaysOnTop: vi.fn((on: boolean) => {
      state.alwaysOnTop = on;
    }),
    setVisibleOnAllWorkspaces: vi.fn(),
    setFullScreen: vi.fn(),
    unmaximize: vi.fn(),
    setMaximizable: vi.fn(),
    setFullScreenable: vi.fn(),
    setMinimumSize: vi.fn(),
    setBounds: vi.fn((bounds: Rectangle) => {
      state.bounds = bounds;
    }),
    setWindowButtonVisibility: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    isDestroyed: () => false,
    getNormalBounds: () => state.bounds,
    isMaximized: () => false,
    isFullScreen: () => false,
    isAlwaysOnTop: () => state.alwaysOnTop,
  };
}

let dir = "";

function start() {
  dir = mkdtempSync(join(tmpdir(), "pear-pip-plugin-"));
  const window = fakeWindow();
  const config = { ...defaults };
  const cleanups: (() => void)[] = [];
  const configListeners: ConfigListener[] = [];
  const items: { label: string; click(): void }[] = [];
  const setConfig = vi.fn((patch: Partial<Ctx["config"]>) => Object.assign(config, patch));
  const ctx = {
    app: { getPath: () => dir },
    window,
    config,
    setConfig,
    addMenuItem: (item: (typeof items)[number]) => items.push(item),
    onConfigChange: (listener: ConfigListener) => configListeners.push(listener),
    onCleanup: (fn: () => void) => cleanups.push(fn),
    t: (_key: string, fallback?: string) => fallback ?? _key,
    emit: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as Ctx;
  const page = plugin.page as PagePartObject<Ctx["config"], object>;
  plugin.host!.start!(ctx);
  return { ctx, config, window, setConfig, items, configListeners, page, stop: () => cleanups.forEach((fn) => fn()) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("the plugin's flat menu items", () => {
  it("toggles the small window, and flips the save-position setting", () => {
    const run = start();
    expect(run.items.map((item) => item.label)).toEqual(["Picture-in-picture", "Save window position"]);

    run.items[0]!.click();
    expect(run.window.setBounds).toHaveBeenCalledWith({ x: 10, y: 10, width: 450, height: 275 });
    expect(run.window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true });

    run.items[0]!.click();
    expect(run.window.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 100, width: 1200, height: 800 });

    run.items[1]!.click();
    expect(run.setConfig).toHaveBeenCalledWith({ savePosition: false });
    expect(run.config.savePosition).toBe(false);

    run.stop();
    vi.advanceTimersByTime(1_000);
  });

  it("applies always-on-top immediately while the small window is open", () => {
    const run = start();
    run.items[0]!.click();
    run.window.setAlwaysOnTop.mockClear();

    Object.assign(run.config, { alwaysOnTop: false });
    for (const listener of run.configListeners) listener(run.ctx.config);
    expect(run.window.setAlwaysOnTop).toHaveBeenLastCalledWith(false);

    Object.assign(run.config, { alwaysOnTop: true });
    for (const listener of run.configListeners) listener(run.ctx.config);
    expect(run.window.setAlwaysOnTop).toHaveBeenLastCalledWith(true, "screen-saver", 1);

    run.stop();
    vi.advanceTimersByTime(1_000);
  });
});

describe("the page part", () => {
  it("takes a settings change without restarting", () => {
    const run = start();
    expect(typeof run.page).toBe("object");
    expect(run.page.onConfigChange).toBeTypeOf("function");
    expect(run.page.onConfigChange!(run.ctx.config, {} as PageContext<Ctx["config"], object>)).toBeUndefined();
    run.stop();
  });
});
