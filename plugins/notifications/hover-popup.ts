// Windows tray hover mini-player: while the cursor is on the tray icon, a
// small always-on-top strip shows the artwork, title and artist and offers
// previous / play-pause / next. It never takes focus (showInactive and a
// non-focusable window), and it goes when the cursor leaves both the icon and
// the strip. While it is up, notifications are suppressed (see index.ts), as
// pear-desktop does: the two draw in the same corner.
//
// The tray plugin owns the icon, so it forwards its mouse events and the
// icon's bounds on the app emitter ("pear:tray-hover", "pear:tray-leave").

import type { HostContext } from "@pear/sdk";
import { embed } from "@pear/sdk/macros" with { type: "macro" };
import { isPlaying } from "@pear/sdk/util";
import { BrowserWindow, type Rectangle, screen } from "electron";
import { type FlyoutRect, watchTrayFlyout } from "./tray-flyout.ts";

const POPUP_WIDTH = 380;
const POPUP_HEIGHT = 85;
/** Invisible margin the page uses for its drop shadow. */
const SHADOW_PAD = 8;
const GAP = 4;
/** The flyout window draws its card a little below its top edge. */
const FLYOUT_CARD_INSET = 8;
const CURSOR_POLL_MS = 150;
/** The page's fade-out, before the window hides. */
const FADE_OUT_MS = 250;
/** A moment always-on-top is enough to pass the shell's flyout band. */
const RAISE_MS = 200;

/** The page, embedded at build time (base64) so nothing depends on asset paths. */
const PAGE = Buffer.from(embed("hover-popup.html"), "base64").toString("utf8");

interface HoverConfig {
  hoverControls: boolean;
}

export interface HoverPopup {
  /** Whether the strip is on screen (toasts are suppressed meanwhile). */
  readonly visible: boolean;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** The mini-player: created once per running host part; the window itself is lazy. */
export function setupHoverPopup<C extends HoverConfig>(ctx: HostContext<C>): HoverPopup {
  let enabled = ctx.config.hoverControls;
  let disposed = false;
  let popup: BrowserWindow | undefined;
  let ready = false;
  let shown = false;
  let trayBounds: Rectangle | undefined;
  let flyoutRect: FlyoutRect | undefined;
  let stopFlyoutWatch: (() => void) | undefined;
  let cursorTimer: ReturnType<typeof setInterval> | undefined;
  let cursorWasOnPopup = false;
  let raiseTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** The last song info sent to the page, to skip identical executions. */
  let lastPushed = "";
  let pageVisible = false;

  const isOver = (bounds: Rectangle | undefined) => {
    if (!bounds) return false;
    const cursor = screen.getCursorScreenPoint();
    return cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height;
  };
  const overPopup = () => (popup && !popup.isDestroyed() ? isOver(popup.getBounds()) : false);
  const overTray = () => isOver(trayBounds);

  const startFlyoutWatch = () => {
    stopFlyoutWatch ??= watchTrayFlyout((rect) => {
      flyoutRect = rect;
      // The first rectangle can land after the strip was placed: re-anchor.
      if (shown) position();
    });
  };
  const stopFlyoutWatching = () => {
    stopFlyoutWatch?.();
    stopFlyoutWatch = undefined;
  };

  const position = () => {
    if (!popup || !trayBounds) return;

    const display = screen.getDisplayNearestPoint({
      x: trayBounds.x + trayBounds.width / 2,
      y: trayBounds.y + trayBounds.height / 2,
    });
    const { workArea } = display;
    const width = POPUP_WIDTH + SHADOW_PAD * 2;
    const height = POPUP_HEIGHT + SHADOW_PAD * 2;
    const taskbarTop = workArea.y + workArea.height;
    // An icon behind the "^" chevron sits above the taskbar's own edge.
    const inOverflow = trayBounds.y + trayBounds.height <= taskbarTop;

    let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
    let y: number;
    if (trayBounds.y < workArea.y + workArea.height / 2) {
      // A taskbar on the top edge: the strip goes below the icon.
      y = trayBounds.y + trayBounds.height + GAP;
    } else if (inOverflow && flyoutRect) {
      // An icon behind the "^" chevron lives in the overflow flyout, which the
      // shell draws in the always-on-top band above the taskbar. Clear the
      // flyout's card instead of fighting it with z-order.
      const cardTop = screen.screenToDipPoint({ x: flyoutRect.left, y: flyoutRect.top }).y + FLYOUT_CARD_INSET;
      y = cardTop - height - GAP;
    } else {
      y = trayBounds.y - height - GAP;
    }

    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
    y = Math.max(workArea.y, y);
    popup.setPosition(Math.round(x), Math.round(y));
  };

  const pushSongInfo = () => {
    if (!popup || !ready) return;
    const state = ctx.player.state;
    const track = state.track;
    if (!track) return;
    const data = JSON.stringify({
      title: track.title,
      artist: track.artist,
      imageSrc: track.artworkUrl ?? "",
      isPaused: !isPlaying(state),
    });
    if (data === lastPushed) return;
    lastPushed = data;
    void popup.webContents.executeJavaScript(`window.updateSongInfo(${data})`).catch(() => {});
  };

  const showInPage = () => {
    if (!popup || !ready || pageVisible) return;
    pageVisible = true;
    void popup.webContents.executeJavaScript("window.showPopup()").catch(() => {});
  };
  const hideInPage = () => {
    if (!popup || !ready || !pageVisible) return;
    pageVisible = false;
    void popup.webContents.executeJavaScript("window.hidePopup()").catch(() => {});
  };

  // The tray flyout sits in the always-on-top band with the rest of the shell,
  // which a plain window cannot outrank; stepping into that band for a moment
  // wins. Dropping the flag leaves the strip where it landed.
  const raise = () => {
    if (!popup) return;
    popup.setAlwaysOnTop(true);
    ctx.clearTimeout(raiseTimer);
    raiseTimer = ctx.setTimeout(() => {
      raiseTimer = undefined;
      popup?.setAlwaysOnTop(false);
    }, RAISE_MS);
  };

  const createPopup = () => {
    const window = new BrowserWindow({
      width: POPUP_WIDTH + SHADOW_PAD * 2,
      height: POPUP_HEIGHT + SHADOW_PAD * 2,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      show: false,
      // Clicking a button must not take focus from the app being used.
      focusable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    popup = window;
    lastPushed = "";
    pageVisible = false;

    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);

    window.webContents.on("did-finish-load", () => {
      if (window !== popup) return;
      ready = true;
      if (shown) {
        pushSongInfo();
        showInPage();
      }
    });

    // The page pushes button clicks through the title: "act:<command>:<n>".
    window.on("page-title-updated", (event, title) => {
      if (!title.startsWith("act:")) return;
      event.preventDefault();
      const command = title.split(":")[1];
      switch (command) {
        case "playPause":
          ctx.player.control({ type: "toggle" });
          break;
        case "previous":
          ctx.player.control({ type: "previous" });
          break;
        case "next":
          ctx.player.control({ type: "next" });
          break;
        case "show":
          hide();
          ctx.focusWindow();
          break;
      }
    });

    // A non-focusable strip never gains focus, so a blur right after
    // showInactive() must not hide it; only a real focus loss should.
    let focused = false;
    window.on("focus", () => {
      focused = true;
    });
    window.on("blur", () => {
      if (!focused) return;
      focused = false;
      hide();
    });

    window.on("closed", () => {
      if (window !== popup) return;
      popup = undefined;
      ready = false;
      shown = false;
      stopCursorTracking();
      stopFlyoutWatching();
    });
  };

  const startCursorTracking = () => {
    if (cursorTimer) return;
    cursorTimer = ctx.setInterval(checkCursor, CURSOR_POLL_MS);
  };
  const stopCursorTracking = () => {
    ctx.clearInterval(cursorTimer);
    cursorTimer = undefined;
  };

  /** Hides once the cursor has left both the strip and the tray icon. */
  const checkCursor = () => {
    if (!popup || !shown) {
      stopCursorTracking();
      return;
    }
    const onPopup = overPopup();
    // Re-raise on the transition onto the strip, so hovering brings it back
    // in front of whatever was raised over it while it stayed open.
    if (onPopup && !cursorWasOnPopup) raise();
    cursorWasOnPopup = onPopup;
    if (!onPopup && !overTray()) {
      stopCursorTracking();
      hide();
    }
  };

  const show = () => {
    if (disposed || !enabled) return;
    if (!ctx.player.state.track) return;
    if (!popup) createPopup();
    if (!popup) return;

    startFlyoutWatch();
    if (!shown) {
      position();
      popup.showInactive();
      shown = true;
      startCursorTracking();
    }
    // showInactive() does not raise an already-visible strip by itself.
    raise();
    pushSongInfo();
    showInPage();
  };

  function hide() {
    if (!popup || !shown) return;
    hideInPage();
    ctx.clearTimeout(hideTimer);
    // Wait out the page's fade before hiding the window.
    hideTimer = ctx.setTimeout(() => {
      hideTimer = undefined;
      if (!popup || !shown) return;
      // The cursor may have come back during the fade: re-show if so.
      if (overPopup() || overTray()) {
        showInPage();
        startCursorTracking();
        return;
      }
      popup.hide();
      shown = false;
      stopCursorTracking();
      stopFlyoutWatching();
    }, FADE_OUT_MS);
  }

  ctx.listen(ctx.app, "pear:tray-hover", (payload: { bounds?: Rectangle }) => {
    if (payload?.bounds) trayBounds = payload.bounds;
    if (enabled && !disposed) show();
  });
  ctx.listen(ctx.app, "pear:tray-leave", () => checkCursor());

  ctx.player.on("change", (state) => {
    if (!shown) return;
    if (!state.track) return hide();
    pushSongInfo();
  });

  const closePopup = () => {
    ctx.clearTimeout(hideTimer);
    ctx.clearTimeout(raiseTimer);
    hideTimer = undefined;
    raiseTimer = undefined;
    stopCursorTracking();
    stopFlyoutWatching();
    const window = popup;
    popup = undefined;
    ready = false;
    shown = false;
    if (window && !window.isDestroyed()) window.destroy();
  };

  return {
    get visible() {
      return shown;
    },
    setEnabled(next: boolean) {
      enabled = next;
      if (!next) closePopup();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      closePopup();
    },
  };
}
