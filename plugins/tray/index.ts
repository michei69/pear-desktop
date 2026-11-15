import { config, definePlugin, type HostContextOf, type NowPlaying } from "@pear/sdk";
import { trayIconBitmap, ytmTrayIconBitmap } from "@pear/sdk/icon";
import { isPlaying, YTM_NAME } from "@pear/sdk/util";
import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";

/** The tray icon's size in px; drawn at twice that for high-DPI screens. */
const ICON_SIZE = 32;
/** macOS menu bar icons are 16 points, as pear-desktop's. */
const MAC_ICON_SIZE = 16;
const isMac = process.platform === "darwin";
const LINUX = process.platform === "linux";

const schema = {
  closeToTray: config.bool(false, {
    label: "Close to tray",
    description: "Closing the window keeps music playing in the background.",
  }),
  clickAction: config.select(
    "toggle",
    [
      { value: "toggle", label: "Toggle the window" },
      { value: "play-pause", label: "Play or pause" },
    ],
    { label: "Click action", description: "What clicking the tray icon does." },
  ),
  // Legacy pair; the host turns it into clickAction once.
  clickToToggle: config.bool(true, { label: "Click toggles the window", hidden: true }),
  clickPlayPause: config.bool(false, { label: "Click plays and pauses", hidden: true }),
  clickActionMigrated: config.bool(false, { label: "Click action migrated", hidden: true }),
  showAtStartup: config.bool(true, {
    label: "Show the window at startup",
    description: "Off: start hidden in the tray (needs the Tray icon plugin; otherwise the window shows as usual).",
  }),
  startupMigrated: config.bool(false, { label: "Startup setting migrated", hidden: true }),
  moveToCurrentDesktop: config.bool(false, { label: "Show the window on the current desktop" }),
  forceWhiteIcons: config.bool(false, { label: "Force white tray icons" }),
};

type Ctx = HostContextOf<typeof schema>;

/** Rebuilds the running tray's artwork; set while the tray is up. */
let rebuildTrayIcons: (() => void) | undefined;
/** Shows the window as a tray click would; set while the tray is up. */
let showMainWindow: (() => void) | undefined;

export default definePlugin({
  id: "tray",
  name: "Tray icon",
  description: "Playback controls and the current track in the system tray.",
  enabledByDefault: true,
  config: schema,
  host: {
    start(ctx) {
      // pear-desktop's icons: a paused variant while a track is paused.
      let iconStyle = trayIconStyle(ctx);
      const icons = { playing: trayImage(false, iconStyle), paused: trayImage(true, iconStyle) };
      const tray = new Tray(icons.playing);
      // Windows reports a rapid second click inside the system double-click time
      // as 'double-click', so macOS keeps every click separate and Windows gets
      // the same action from both events (pear-desktop routed both to one handler).
      if (isMac) tray.setIgnoreDoubleClickEvents(true);
      let shownIcon: keyof typeof icons = "playing";
      const { window, app } = ctx;
      // Starting hidden leaves only the menu bar; pear-desktop hid the Dock too,
      // and the tray plugin being up is the guard that there is a way back.
      const showAtStartup = ctx.config.showAtStartup ?? ctx.core("window").appVisible;
      if (isMac && !showAtStartup && !window.isVisible()) app.dock?.hide();
      // The artwork follows the icon options: the app calls `refreshIcons` after
      // an appearance change, the plugin rebuilds it on a config change. Other
      // tray options leave it alone, so the PNGs are only decoded when it changes.
      const showIcons = () => {
        const style = trayIconStyle(ctx);
        if (style === iconStyle) return;
        iconStyle = style;
        icons.playing = trayImage(false, style);
        icons.paused = trayImage(true, style);
        tray.setImage(icons[shownIcon]);
      };
      // The app doubles as the cross-plugin event bus (Electron's App is an
      // EventEmitter, but its public type lists only its own events).
      const bus = app as unknown as NodeJS.EventEmitter;
      const showWindow = () => {
        if (ctx.config.moveToCurrentDesktop) showOnCurrentDesktop(window);
        else ctx.focusWindow();
        app.dock?.show();
      };
      // As pear-desktop: on macOS a window hidden to the tray leaves the Dock too.
      const hideWindow = () => {
        window.hide();
        app.dock?.hide();
      };
      const toggleWindow = () => {
        if (window.isVisible() && window.isFocused()) hideWindow();
        else showWindow();
      };

      // The hover mini-player draws where the shell pops the tooltip up: blank it
      // while it is visible instead of leaving it over the strip (pear-desktop's
      // setTrayTooltipSuppressed). The latest text is kept for when it hides.
      let tooltipText = "";
      let tooltipSuppressed = false;
      const applyTooltip = () => tray.setToolTip(tooltipSuppressed ? "" : tooltipText);

      const update = (state: NowPlaying) => {
        const icon = state.track && state.status === "paused" ? "paused" : "playing";
        if (icon !== shownIcon) {
          tray.setImage(icons[icon]);
          shownIcon = icon;
        }
        tooltipText = tooltip(ctx, state);
        applyTooltip();
        tray.setContextMenu(Menu.buildFromTemplate(menu(ctx, state, toggleWindow)));
      };
      update(ctx.player.state);
      rebuildTrayIcons = showIcons;
      const showNow = () => {
        if (!window.isDestroyed()) showWindow();
      };
      showMainWindow = showNow;
      ctx.onCleanup(() => {
        if (rebuildTrayIcons === showIcons) rebuildTrayIcons = undefined;
        if (showMainWindow === showNow) showMainWindow = undefined;
      });
      ctx.onConfigChange(showIcons);
      // The core's second-instance handler and another plugin's mini-player ask
      // for a tray-style show, so moveToCurrentDesktop applies on those paths too.
      ctx.listen(bus, "pear:show-window", showNow);
      ctx.listen(bus, "pear:tray-tooltip", (suppressed: boolean | { suppressed?: boolean }) => {
        tooltipSuppressed = (typeof suppressed === "boolean" ? suppressed : suppressed?.suppressed) === true;
        applyTooltip();
      });
      // Rebuild the menu only when something it shows changes.
      ctx.player.on("change", (state, previous) => {
        if (state.track !== previous.track || state.status !== previous.status || state.like !== previous.like) update(state);
      });
      const refresh = () => update(ctx.player.state);
      ctx.listen(window, "show", refresh);
      ctx.listen(window, "hide", refresh);
      ctx.onMenuItemsChange(refresh);

      // Another plugin may claim clicks (notifications' tray controls on Windows, as in pear-desktop).
      const claimed = (event: string) => {
        const claim = { claimed: false };
        bus.emit(event, claim);
        return claim.claimed;
      };
      const trayAction = () => {
        if (ctx.config.clickAction === "play-pause") ctx.player.control({ type: "toggle" });
        else toggleWindow();
      };
      tray.on("click", () => {
        if (!claimed("pear:tray-click")) trayAction();
      });
      tray.on("double-click", () => {
        if (!claimed("pear:tray-double-click")) trayAction();
      });

      // Where the icon is, for plugins that draw next to it (notifications'
      // hover mini-player). Bounds are in DIP screen coordinates; emitted as a
      // snapshot because another plugin cannot reach this Tray instance.
      // `mouse-move` and `mouse-leave` exist on macOS and Windows only.
      if (!LINUX) {
        ctx.listen(tray, "mouse-move", () => {
          bus.emit("pear:tray-hover", { bounds: tray.getBounds() });
        });
        ctx.listen(tray, "mouse-leave", () => {
          bus.emit("pear:tray-leave");
        });
      }

      const quitting = watchQuit(ctx);
      closeToTray(ctx, hideWindow, quitting);
      return () => {
        // Turned off with the window hidden in it, which then could never come back.
        // Shown first: showing updates the tray (its "show" listener), so it must still exist.
        if (!quitting() && !window.isDestroyed() && !window.isVisible()) showWindow();
        tray.destroy();
      };
    },
    // The options are read when used; no restart needed.
    onConfigChange() {},
    commands: {
      /** Rebuilds the tray artwork from the current core and plugin settings. */
      refreshIcons() {
        rebuildTrayIcons?.();
      },
      /** Shows the main window as a tray click would (the second-instance handler calls this). */
      showWindow() {
        showMainWindow?.();
      },
    },
  },
});

type TrayIconStyle = "default" | "white" | "ytm";

/** pear-desktop's order: YT Music's logo when asked for, white on macOS or when forced, otherwise pear's colors. */
function trayIconStyle(ctx: Ctx): TrayIconStyle {
  if (ctx.core("appearance").useYtmIcons) return "ytm";
  return isMac || ctx.config.forceWhiteIcons ? "white" : "default";
}

function trayImage(paused: boolean, style: TrayIconStyle) {
  const pixels = (isMac ? MAC_ICON_SIZE : ICON_SIZE) * 2;
  const data = style === "ytm" ? ytmTrayIconBitmap(pixels, paused) : trayIconBitmap(pixels, paused, style === "white");
  const image = nativeImage.createFromBitmap(data, { width: pixels, height: pixels, scaleFactor: 2 });
  // A template image: macOS draws it in the menu bar's own color, so it shows on
  // light and dark bars. YT Music's logo keeps its own colors.
  if (isMac && style !== "ytm") image.setTemplateImage(true);
  return image;
}

/**
 * Shows the window on the current virtual desktop instead of switching to the
 * one it was created on: pin it to all workspaces, show and focus, then unpin.
 */
function showOnCurrentDesktop(window: Electron.BrowserWindow) {
  window.setVisibleOnAllWorkspaces(true);
  window.show();
  window.focus();
  window.setVisibleOnAllWorkspaces(false);
}

// pear-desktop's tray texts and translations (main.tray.*).
function tooltip(ctx: Ctx, { track }: NowPlaying) {
  if (!track) return ctx.t("main.tray.tooltip.default", "{{applicationName}}", { applicationName: YTM_NAME });
  return ctx.t("main.tray.tooltip.with-song-info", "{{applicationName}}: {{artist}} - {{title}}", {
    applicationName: YTM_NAME,
    artist: track.artist,
    title: track.title,
  });
}

function menu(ctx: Ctx, state: NowPlaying, toggleWindow: () => void): MenuItemConstructorOptions[] {
  const { track } = state;
  const { app, window } = ctx;
  const trackInfo: MenuItemConstructorOptions[] = track
    ? [{ label: track.title, enabled: false }, { label: track.artist, enabled: false }, { type: "separator" }]
    : [];
  const playPause = isPlaying(state) ? "Pause" : "Play";
  return [
    ...trackInfo,
    { label: ctx.t("main.tray.play-pause", playPause), click: () => ctx.player.control({ type: "toggle" }) },
    { label: ctx.t("main.tray.next", "Next"), click: () => ctx.player.control({ type: "next" }) },
    { label: ctx.t("main.tray.previous", "Previous"), click: () => ctx.player.control({ type: "previous" }) },
    // The labels follow the current rating; unlike/undislike clear it.
    {
      label: state.like === "like" ? ctx.t("main.tray.unlike", "Unlike") : ctx.t("main.tray.like", "Like"),
      click: () => ctx.player.control({ type: "unlike" }),
    },
    {
      label: state.like === "dislike" ? ctx.t("main.tray.undislike", "Undislike") : ctx.t("main.tray.dislike", "Dislike"),
      click: () => ctx.player.control({ type: "undislike" }),
    },
    { type: "separator" },
    {
      label: window.isVisible() ? ctx.t("main.tray.hide", "Hide window") : ctx.t("main.tray.show", "Show window"),
      click: toggleWindow,
    },
    // Other plugins' items (`ctx.addMenuItem`), e.g. the downloader's Downloads.
    ...ctx.pluginMenuItems().map(({ label, click }): MenuItemConstructorOptions => ({ label, click: () => click() })),
    // pear-desktop used the settings dialog's title for this entry, translated everywhere.
    { label: ctx.t("settings-ui.title", "Settings"), click: () => ctx.openSettings() },
    { type: "separator" },
    {
      label: ctx.t("main.tray.restart", "Restart App"),
      click: () => {
        // A portable Windows build relaunches its exe, not the temporary copy it runs from.
        const portable = process.env.PORTABLE_EXECUTABLE_FILE;
        app.relaunch(portable ? { execPath: portable } : {});
        app.quit();
      },
    },
    { label: ctx.t("main.tray.quit", "Quit"), click: () => app.quit() },
  ];
}

/** Whether the app is quitting; known before plugins stop, since quitting stops them. */
function watchQuit(ctx: Ctx) {
  let quitting = false;
  const onQuit = () => {
    quitting = true;
  };
  ctx.app.prependListener("before-quit", onQuit);
  ctx.onCleanup(() => ctx.app.removeListener("before-quit", onQuit));
  return () => quitting;
}

/** With closeToTray, closing the window hides it instead (quitting still closes it). */
function closeToTray(ctx: Ctx, hideWindow: () => void, quitting: () => boolean) {
  ctx.listen(ctx.window, "close", (event: Electron.Event) => {
    if (!ctx.config.closeToTray || quitting()) return;
    event.preventDefault();
    hideWindow();
  });
}
