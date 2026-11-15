import { EventEmitter } from "node:events";
import type { Emitter, NowPlaying, Track } from "@pear/sdk";
import { describe, expect, test, vi } from "vitest";
import { setupTrayControls, type TrayControlsHost, type TrayNotifier } from "../tray-controls.ts";

const track = (videoId = "a") => ({ videoId, title: "Title", artist: "Artist" }) as unknown as Track;

function fakeHost(
  options: { trayControls?: boolean; interactive?: boolean; visible?: boolean; current?: Track | null; paused?: boolean } = {},
) {
  const app = new EventEmitter();
  let visible = options.visible ?? false;
  const window = {
    isVisible: () => visible,
    show: vi.fn(() => {
      visible = true;
    }),
    hide: vi.fn(() => {
      visible = false;
    }),
  };
  const state = {
    status: options.paused ? "paused" : "playing",
    track: options.current === undefined ? track() : options.current,
  } as unknown as NowPlaying;
  const host: TrayControlsHost = {
    app: app as unknown as Emitter,
    window,
    player: { state },
    config: { trayControls: options.trayControls ?? true, interactive: options.interactive ?? true },
    listen: (target, event, listener) => void target.on(event, listener),
  };
  return { host, app, window };
}

function fakeNotifier(showing = false) {
  const notifier = {
    showing,
    show: vi.fn(() => {
      notifier.showing = true;
      return true;
    }),
    close: vi.fn(() => {
      notifier.showing = false;
    }),
  };
  return notifier satisfies TrayNotifier;
}

const click = (app: EventEmitter) => {
  const claim = { claimed: false };
  app.emit("pear:tray-click", claim);
  return claim.claimed;
};

const doubleClick = (app: EventEmitter) => {
  const claim = { claimed: false };
  app.emit("pear:tray-double-click", claim);
  return claim.claimed;
};

describe("notifications' Windows tray controls", () => {
  test("the option is off by default, so the tray's own click toggle runs", () => {
    const { host, app } = fakeHost({ trayControls: false });
    const notifier = fakeNotifier();
    setupTrayControls(host, notifier);
    expect(click(app)).toBe(false);
    expect(notifier.show).not.toHaveBeenCalled();
  });

  test("a click opens and closes the notification once enabled", () => {
    const { host, app } = fakeHost();
    const notifier = fakeNotifier();
    setupTrayControls(host, notifier);
    expect(click(app)).toBe(true);
    expect(notifier.show).toHaveBeenCalledWith(expect.objectContaining({ videoId: "a" }), false);
    expect(click(app)).toBe(true);
    expect(notifier.close).toHaveBeenCalledOnce();
  });

  test("a paused track is announced as paused, as the toast's play button expects", () => {
    const { host, app } = fakeHost({ paused: true });
    const notifier = fakeNotifier();
    setupTrayControls(host, notifier);
    expect(click(app)).toBe(true);
    expect(notifier.show).toHaveBeenCalledWith(expect.anything(), true);
  });

  test("with nothing to show the click is left to the tray plugin", () => {
    const { host, app } = fakeHost({ current: null });
    setupTrayControls(host, fakeNotifier());
    expect(click(app)).toBe(false);
  });

  test("a visible notification is closed even when no track remains", () => {
    const { host, app } = fakeHost({ current: null });
    const notifier = fakeNotifier(true);
    setupTrayControls(host, notifier);
    expect(click(app)).toBe(true);
    expect(notifier.close).toHaveBeenCalledOnce();
  });

  test("without playback buttons the tray controls stay out of the way", () => {
    const { host, app } = fakeHost({ interactive: false });
    setupTrayControls(host, fakeNotifier());
    expect(click(app)).toBe(false);
  });

  test("a double click shows or hides the window", () => {
    const { host, app, window } = fakeHost({ visible: false });
    setupTrayControls(host, fakeNotifier());
    expect(doubleClick(app)).toBe(true);
    expect(window.show).toHaveBeenCalledOnce();
    expect(doubleClick(app)).toBe(true);
    expect(window.hide).toHaveBeenCalledOnce();
  });
});
