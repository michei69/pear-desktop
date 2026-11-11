// A HostContext good enough for the tray plugin's host part, plus the fakes
// its window and app calls need.

import { EventEmitter } from "node:events";
import type { NowPlaying, Track } from "@pear/sdk";
import { vi } from "vitest";
import { FakeTray } from "./fake-electron.ts";

export const defaultConfig = {
  closeToTray: false,
  clickToToggle: true,
  clickPlayPause: false,
  moveToCurrentDesktop: false,
  forceWhiteIcons: false,
};

export type TrayConfig = typeof defaultConfig;

export class FakeWindow extends EventEmitter {
  visible: boolean;
  focused = true;
  destroyed = false;
  show = vi.fn(() => {
    this.visible = true;
  });
  hide = vi.fn(() => {
    this.visible = false;
  });
  focus = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();

  constructor(visible = true) {
    super();
    this.visible = visible;
  }

  isVisible() {
    return this.visible;
  }

  isFocused() {
    return this.focused;
  }

  isDestroyed() {
    return this.destroyed;
  }
}

export class FakeApp extends EventEmitter {
  dock = { show: vi.fn(), hide: vi.fn() };
  relaunch = vi.fn();
  quit = vi.fn();
}

export interface ContextOptions {
  state?: NowPlaying;
  config?: Partial<TrayConfig>;
  core?: { appVisible?: boolean; useYtmIcons?: boolean };
  window?: FakeWindow;
  app?: FakeApp;
  pluginItems?: { label: string; click(): void }[];
}

export function nowPlaying(overrides: Partial<NowPlaying> = {}): NowPlaying {
  return {
    track: track(),
    status: "paused",
    positionSeconds: 0,
    volume: 100,
    muted: false,
    repeat: "none",
    shuffle: false,
    like: "none",
    ad: false,
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function track(overrides: Partial<Track> = {}): Track {
  return {
    videoId: "vid1",
    title: "Song",
    artist: "Artist",
    durationSeconds: 200,
    url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=vid1",
    mediaType: "audio",
    ...overrides,
  };
}

/** A running tray's test harness: the fake context plus a way to stop it. */
export function fakeContext(options: ContextOptions = {}) {
  const window = options.window ?? new FakeWindow();
  const app = options.app ?? new FakeApp();
  const config: TrayConfig = { ...defaultConfig, ...options.config };
  const core = {
    appearance: { useYtmIcons: options.core?.useYtmIcons ?? false },
    window: { appVisible: options.core?.appVisible ?? true },
  };
  const cleanups: (() => void)[] = [];
  const configListeners: ((config: TrayConfig) => void)[] = [];
  const playerListeners: ((state: NowPlaying, previous: NowPlaying) => void)[] = [];
  const listened: { target: EventEmitter; event: string; handler: (...args: any[]) => void }[] = [];
  const player = {
    state: options.state ?? nowPlaying(),
    control: vi.fn(),
    details: vi.fn(),
    on: (_event: string, listener: (state: NowPlaying, previous: NowPlaying) => void) => {
      playerListeners.push(listener);
      return () => {};
    },
  };
  const ctx = {
    id: "tray",
    config,
    player,
    app,
    window,
    core: (section: "appearance" | "window") => core[section],
    t: (key: string) => key,
    openSettings: vi.fn(),
    focusWindow: vi.fn(() => {
      window.show();
      window.focus();
    }),
    onCleanup: (fn: () => void) => cleanups.push(fn),
    onConfigChange: (fn: (config: TrayConfig) => void) => configListeners.push(fn),
    listen: (target: EventEmitter, event: string, handler: (...args: any[]) => void) => {
      target.on(event, handler);
      listened.push({ target, event, handler });
    },
    onMenuItemsChange: vi.fn(),
    pluginMenuItems: () => options.pluginItems ?? [],
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    setConfig: vi.fn(),
  };

  /** Emulates the host stopping the plugin: its cleanup, then the listeners. */
  const stop = () => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    for (const { target, event, handler } of listened.splice(0)) target.removeListener(event, handler);
  };

  return { ctx, window, app, config, core, player, playerListeners, configListeners, stop };
}

/** The running tray's fake instance. */
export function runningTray(): FakeTray {
  const tray = FakeTray.last();
  if (!tray) throw new Error("the tray plugin did not create a Tray");
  return tray;
}
