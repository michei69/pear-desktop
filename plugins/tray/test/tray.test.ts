import { beforeEach, describe, expect, test, vi } from "vitest";
import trayPlugin from "../index.ts";
import { FakeTray, menuTemplates, trays } from "./fake-electron.ts";
import { trayIconBitmap, ytmTrayIconBitmap } from "./fake-icons.ts";
import { type ContextOptions, fakeContext, FakeWindow, nowPlaying, track } from "./harness.ts";

vi.mock("electron", () => import("./fake-electron.ts"));
vi.mock("@pear/sdk/icon", () => import("./fake-icons.ts"));

interface MenuItem {
  label?: string;
  type?: string;
  click?: () => void;
}

const menu = () => menuTemplates.at(-1)! as MenuItem[];

function item(label: string) {
  const found = menu().find((entry) => entry.label === label);
  if (!found)
    throw new Error(
      `no menu item labelled ${label}; got ${menu()
        .map((entry) => entry.label)
        .join(", ")}`,
    );
  return found;
}

const hasItem = (label: string) => menu().some((entry) => entry.label === label);

function start(options: ContextOptions = {}) {
  const harness = fakeContext(options);
  const returned = trayPlugin.host!.start!(harness.ctx as never);
  const cleanup = returned as unknown as () => void;
  const tray = FakeTray.last()!;
  return {
    ...harness,
    tray,
    stop: () => {
      cleanup();
      harness.stop();
    },
  };
}

beforeEach(() => {
  trays.length = 0;
  menuTemplates.length = 0;
  trayIconBitmap.mockClear();
  ytmTrayIconBitmap.mockClear();
});

describe("the tray menu", () => {
  test("offers like/dislike labelled from the current state", () => {
    const { player, playerListeners, stop } = start({ state: nowPlaying({ like: "like" }) });
    expect(hasItem("main.tray.unlike")).toBe(true);
    expect(hasItem("main.tray.like")).toBe(false);
    item("main.tray.unlike").click!();
    expect(player.control).toHaveBeenCalledWith({ type: "unlike" });
    item("main.tray.dislike").click!();
    expect(player.control).toHaveBeenCalledWith({ type: "undislike" });

    // The like state is published live, so the labels follow it.
    const previous = player.state;
    const disliked = nowPlaying({ like: "dislike" });
    playerListeners.forEach((listener) => listener(disliked, previous));
    expect(hasItem("main.tray.like")).toBe(true);
    expect(hasItem("main.tray.undislike")).toBe(true);
    expect(hasItem("main.tray.unlike")).toBe(false);
    expect(hasItem("main.tray.dislike")).toBe(false);
    stop();
  });

  test("uses the translated settings title and keeps the hide/show toggle", () => {
    const { window, stop } = start();
    expect(item("settings-ui.title")).toBeTruthy();
    expect(item("main.tray.hide")).toBeTruthy();
    window.visible = false;
    window.emit("hide");
    expect(item("main.tray.show")).toBeTruthy();
    stop();
  });

  test("lists other plugins' menu items", () => {
    const click = vi.fn();
    const { stop } = start({ pluginItems: [{ label: "Downloads", click }] });
    item("Downloads").click!();
    expect(click).toHaveBeenCalledOnce();
    stop();
  });
});

describe("the tray icon", () => {
  test("is only rebuilt when an icon option changes", () => {
    const { config, configListeners, core, stop } = start();
    expect(trayIconBitmap).toHaveBeenCalledTimes(2);

    // A non-icon option rebuilds the menu but not the artwork.
    config.closeToTray = true;
    configListeners.forEach((listener) => listener(config));
    expect(trayIconBitmap).toHaveBeenCalledTimes(2);

    config.forceWhiteIcons = true;
    configListeners.forEach((listener) => listener(config));
    expect(trayIconBitmap).toHaveBeenCalledTimes(4);

    // The appearance option comes through the app's refreshIcons command.
    expect(ytmTrayIconBitmap).not.toHaveBeenCalled();
    core.appearance.useYtmIcons = true;
    trayPlugin.host!.commands!.refreshIcons();
    expect(ytmTrayIconBitmap).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe("tray clicks", () => {
  test("double-click runs the click action too (Windows reports rapid clicks as double-click)", () => {
    const { tray, player, stop } = start({ config: { clickPlayPause: true } });
    tray.emit("double-click");
    expect(player.control).toHaveBeenCalledWith({ type: "toggle" });
    tray.emit("click");
    expect(player.control).toHaveBeenCalledTimes(2);
    stop();
  });

  test("a claiming plugin takes the click and the double-click", () => {
    const { app, tray, player, window, stop } = start();
    app.on("pear:tray-click", (claim: { claimed: boolean }) => {
      claim.claimed = true;
    });
    app.on("pear:tray-double-click", (claim: { claimed: boolean }) => {
      claim.claimed = true;
    });
    tray.emit("click");
    tray.emit("double-click");
    expect(player.control).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
    stop();
  });

  test("toggles the window when it is focused and raises it otherwise", () => {
    const { app, ctx, tray, window, stop } = start();
    window.visible = true;
    window.focused = true;
    tray.emit("click");
    expect(window.hide).toHaveBeenCalledOnce();
    expect(app.dock.hide).toHaveBeenCalledOnce();

    // Rewrite-ahead: a visible but unfocused window is raised, not hidden.
    window.visible = true;
    window.focused = false;
    tray.emit("click");
    expect(window.hide).toHaveBeenCalledOnce();
    expect(ctx.focusWindow).toHaveBeenCalledOnce();
    stop();
  });
});

describe("showing the window from elsewhere", () => {
  test("the showWindow command honors moveToCurrentDesktop", () => {
    const { config, ctx, window, stop } = start({ config: { moveToCurrentDesktop: true }, window: new FakeWindow(false) });
    trayPlugin.host!.commands!.showWindow();
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(1, true);
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(2, false);
    expect(ctx.focusWindow).not.toHaveBeenCalled();

    config.moveToCurrentDesktop = false;
    trayPlugin.host!.commands!.showWindow();
    expect(ctx.focusWindow).toHaveBeenCalledOnce();
    stop();
  });

  test("the pear:show-window bus event uses the same path", () => {
    const { app, config, ctx, window, stop } = start({ window: new FakeWindow(false) });
    app.emit("pear:show-window");
    expect(ctx.focusWindow).toHaveBeenCalledOnce();
    config.moveToCurrentDesktop = true;
    app.emit("pear:show-window");
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(1, true);
    stop();
  });
});

describe("the tooltip", () => {
  test("can be suppressed under the hover mini-player and comes back", () => {
    const { app, player, playerListeners, tray, stop } = start();
    expect(tray.tooltip).toBe("main.tray.tooltip.with-song-info");
    app.emit("pear:tray-tooltip", true);
    expect(tray.tooltip).toBe("");

    // A song update while suppressed keeps the tooltip blank.
    const next = nowPlaying({ track: track({ title: "Next" }), status: "playing" });
    playerListeners.forEach((listener) => listener(next, player.state));
    expect(tray.tooltip).toBe("");

    app.emit("pear:tray-tooltip", false);
    expect(tray.tooltip).toBe("main.tray.tooltip.with-song-info");
    stop();
  });
});

describe("close to tray", () => {
  test("closing hides the window unless the app is quitting", () => {
    const { app, config, window, stop } = start({ config: { closeToTray: true } });
    const close = { preventDefault: vi.fn() };
    window.emit("close", close);
    expect(close.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();

    app.emit("before-quit");
    const quitting = { preventDefault: vi.fn() };
    window.emit("close", quitting);
    expect(quitting.preventDefault).not.toHaveBeenCalled();
    config.closeToTray = false;
    stop();
  });

  test("stopping shows a window that was hidden in the tray and destroys the icon", () => {
    const { tray, window, stop } = start({ window: new FakeWindow(false) });
    stop();
    expect(window.show).toHaveBeenCalled();
    expect(tray.destroyed).toBe(true);
  });
});
