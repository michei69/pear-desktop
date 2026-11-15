import { definePlugin } from "@pear/sdk";
import { type BrowserWindow, type BrowserWindowConstructorOptions, Menu, type WebContents } from "electron";
import { clickableItem, serialize } from "./app-menu.ts";
import { inAppMenuConfig } from "./config.ts";
import { startPage } from "./page.ts";
import type { MenuNode, WindowAction, WindowState } from "./types.ts";

// The native caption buttons Windows draws over the top bar match YTM's nav bar.
const NAV_BAR_HEIGHT = 64;

const CAPTION_COLORS = { color: "#00000000", symbolColor: "#ffffff" };

/** The window without the system title bar, by platform (Linux and the rest: no frame). */
const FRAMELESS_OPTIONS: Partial<Record<string, BrowserWindowConstructorOptions>> = {
  darwin: { titleBarStyle: "hiddenInset" },
  win32: { titleBarStyle: "hidden", titleBarOverlay: { ...CAPTION_COLORS, height: NAV_BAR_HEIGHT } },
};

const STATE_EVENTS = ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "always-on-top-changed"];

export default definePlugin({
  id: "in-app-menu",
  name: "In-app menu",
  description: "Replaces the system title bar: the top bar moves the window and holds the app menu.",
  // As in pear-desktop.
  enabledByDefault: ["win32"],
  config: inAppMenuConfig,
  host: {
    windowOptions() {
      frameless = true;
      return FRAMELESS_OPTIONS[process.platform] ?? { frame: false };
    },
    start(ctx) {
      const sendState = () => ctx.emit("state", windowState(ctx.window));
      for (const event of STATE_EVENTS) ctx.listen(ctx.window, event, sendState);
      // The page can't see the core rebuild the menu; it redraws an open panel then.
      ctx.onMenuItemsChange(() => ctx.emit("menu-changed"));

      // The caption buttons are sized in DIPs while the bar is 64 CSS px: after a
      // page zoom (the menu's Zoom items included) the two no longer line up.
      const syncCaptionButtons = () => resizeCaptionButtons(ctx.window);
      ctx.listen(ctx.window.webContents, "dom-ready", syncCaptionButtons);
      ctx.listen(ctx.window, "resize", syncCaptionButtons);
    },
    commands: {
      state() {
        return windowState(this.window);
      },
      /** The application menu (pear-desktop drew the whole of it in the page). */
      menu(): MenuNode[] {
        return menuTree();
      },
      clickMenu(commandId: number) {
        const item = clickableItem(Menu.getApplicationMenu(), commandId);
        if (!item) return;
        // Electron flips checkboxes itself; roles act on the window they're given.
        (item.click as (event?: unknown, window?: BrowserWindow, contents?: WebContents) => void)(
          undefined,
          this.window,
          this.window.webContents,
        );
        // The click may have flipped a checkbox or rebuilt the menu in place; serialize afresh next time.
        invalidateMenu();
        // Zoom In/Out and Actual Size change the caption buttons' size too.
        resizeCaptionButtons(this.window);
      },
      run(action: WindowAction) {
        const { window } = this;
        switch (action) {
          case "minimize":
            return window.minimize();
          case "toggleMaximize":
            return window.isMaximized() ? window.unmaximize() : window.maximize();
          case "close":
            return window.close();
        }
      },
    },
  },
  page: startPage,
});

// Set when the main window is created with this plugin's options.
let frameless = false;

/** The overlay height last applied, in DIPs (the window's own is at 100%; see CAPTION_COLORS). */
let captionButtonsHeight = NAV_BAR_HEIGHT;

/** Windows draws its caption buttons in DIPs: keep their height the bar's 64 CSS px at any zoom factor. */
function resizeCaptionButtons(window: BrowserWindow) {
  if (!frameless || process.platform !== "win32") return;
  const height = Math.floor(NAV_BAR_HEIGHT * window.webContents.getZoomFactor());
  if (height === captionButtonsHeight) return;
  captionButtonsHeight = height;
  window.setTitleBarOverlay({ ...CAPTION_COLORS, height });
}

// The menu tree, serialized once per menu build: the core makes a new Menu on every rebuild.
let cachedMenu: Menu | null | undefined;
let cachedNodes: MenuNode[] = [];

function menuTree() {
  const menu = Menu.getApplicationMenu();
  if (menu !== cachedMenu) {
    cachedMenu = menu;
    cachedNodes = menu ? serialize(menu, process.platform === "darwin") : [];
  }
  return cachedNodes;
}

/** A click changes some items in place (a checkbox's mark), without a rebuild to notice. */
function invalidateMenu() {
  cachedMenu = undefined;
}

function windowState(window: BrowserWindow): WindowState {
  return {
    platform: process.platform,
    frameless,
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen(),
    alwaysOnTop: window.isAlwaysOnTop(),
  };
}
