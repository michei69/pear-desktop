// Native notifications when a track starts (and optionally on resume), with
// playback buttons where the OS supports notification actions. On Windows,
// pear-desktop's toast layouts (custom toast XML) and tray controls.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { definePlugin, livePosition, type NowPlaying, type Track } from "@pear/sdk";
import { pearIconBitmap } from "@pear/sdk/icon";
import { embed } from "@pear/sdk/macros" with { type: "macro" };
import { isPlaying } from "@pear/sdk/util";
import { type NativeImage, nativeImage, Notification } from "electron";
import { artwork, ICON_SIZE } from "./artwork.ts";
import { showMenu } from "./menu.ts";
import { schema, type Ctx } from "./schema.ts";
import { toastXml, usesLogo } from "./toast.ts";
import { setupTrayControls } from "./tray-controls.ts";
import { setupHoverPopup } from "./hover-popup.ts";

// pear-desktop's Windows workaround: toasts otherwise linger in the corner.
const TOAST_CLOSE_MS = 5000;
/** pear-desktop's app protocol (see the core's protocol.ts). */
const APP_PROTOCOL = "\u0079\u006f\u0075\u0074\u0075\u0062\u0065music";
// pear-desktop's button icons for toasts.
const BUTTON_ICONS = {
  previous: embed("media-icons-black/previous.png"),
  play: embed("media-icons-black/play.png"),
  pause: embed("media-icons-black/pause.png"),
  next: embed("media-icons-black/next.png"),
};

const isPaused = (state: NowPlaying) => !isPlaying(state);
const WINDOWS = process.platform === "win32";
const SUPPORTS_ACTIONS = WINDOWS || process.platform === "darwin";
// The native notification's buttons, by action index.
const PREVIOUS_ACTION = 0;
const NEXT_ACTION = 2;

type ButtonIcon = keyof typeof BUTTON_ICONS;

/** The app's icon, shown instead of missing artwork as pear-desktop did. */
const appIcon = () => nativeImage.createFromBitmap(pearIconBitmap(ICON_SIZE), { width: ICON_SIZE, height: ICON_SIZE });

interface Notifier {
  /** Whether a notification was actually started (false while the mini player suppresses it). */
  show(track: Track, paused: boolean): boolean;
  close(): void;
  readonly showing: boolean;
  dispose(): void;
}

export default definePlugin({
  id: "notifications",
  name: "Notifications",
  description: "Show a desktop notification when a new song starts.",
  config: schema,
  host: {
    start(ctx) {
      if (!Notification.isSupported()) throw new Error("this system doesn't support notifications");
      const hover = WINDOWS ? setupHoverPopup(ctx) : undefined;
      const notifier = createNotifier(ctx, () => hover?.visible === true);
      ctx.onConfigChange((next) => hover?.setEnabled(next.hoverControls));
      // pear-desktop's Notifications menu, as one popup: the app/tray menus are flat.
      ctx.addMenuItem({
        label: ctx.t("plugins.notifications.menu.title", "Notifications…"),
        click: () => showMenu(ctx),
      });

      // The toast's buttons arrive through the app protocol (the core already acted on them).
      ctx.onProtocol((command) => {
        const track = ctx.player.state.track;
        if (!WINDOWS || !track || !ctx.config.interactive || !ctx.config.refreshOnPlayPause) return;
        if (command === "pause" || (command === "play" && !ctx.config.unpauseNotification)) notifier.show(track, command === "pause");
      });

      if (WINDOWS) setupTrayControls(ctx, notifier);

      let lastVideoId: string | undefined;
      let wasPaused = true;
      ctx.player.on("change", (state) => {
        // Ads come and go mid-track; they're neither a new song nor a resume.
        if (state.ad) return;
        const paused = isPaused(state);
        const track = state.track;
        if (track && !paused) {
          const newTrack = track.videoId !== lastVideoId;
          const resumed = wasPaused && ctx.config.unpauseNotification;
          // The dedupe key only advances when a notification is actually shown:
          // a suppressed one would otherwise count the track as announced with
          // nothing ever displayed for it.
          if ((newTrack || resumed) && notifier.show(track, false)) lastVideoId = track.videoId;
        }
        wasPaused = paused;
      });

      return () => {
        hover?.dispose();
        notifier.dispose();
      };
    },
    // Options are read when a notification is shown.
    onConfigChange() {},
  },
});

/** Shows one notification at a time: a newer one replaces it, also while its artwork loads. */
function createNotifier(ctx: Ctx, suppressed: () => boolean): Notifier {
  let current: Notification | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let presentTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const files = notificationFiles(ctx);

  const close = () => {
    ctx.clearTimeout(closeTimer);
    // A shown-again notification still waiting out the Windows delay is stale.
    ctx.clearTimeout(presentTimer);
    presentTimer = undefined;
    current?.close();
    current = undefined;
  };
  const present = (notification: Notification) => {
    notification.on("close", () => {
      if (current === notification) current = undefined;
    });
    current = notification;
    notification.show();
  };

  /** pear-desktop's interactive Windows toast. */
  const showToast = async (track: Track, paused: boolean, id: number) => {
    const style = ctx.config.toastStyle;
    const image = await artwork(track.artworkUrl, usesLogo(style));
    if (id !== generation) return;
    const imagePath = image ? files.saveArtwork(image, usesLogo(style)) : files.appIcon();
    close();
    const title = track.title || ctx.t("plugins.notifications.playing", "Playing");
    const notification = new Notification({
      title,
      body: track.artist,
      silent: true,
      toastXml: toastXml({
        style,
        title,
        artist: track.artist,
        ...(track.album ? { album: track.album } : {}),
        elapsedSeconds: livePosition(ctx.player.state),
        durationSeconds: track.durationSeconds,
        paused,
        image: imagePath,
        icons: files.buttonIcons(),
        protocol: APP_PROTOCOL,
        hideButtonText: ctx.config.hideButtonText,
      }),
    });
    // macOS activates itself when the toast is clicked; Windows does not.
    notification.on("click", () => ctx.focusWindow());
    present(notification);
    closeTimer = ctx.setTimeout(() => {
      if (current === notification) close();
    }, TOAST_CLOSE_MS);
  };

  const showNative = async (track: Track, paused: boolean, id: number) => {
    const icon = await artwork(track.artworkUrl);
    if (id !== generation) return;
    close();
    const interactive = SUPPORTS_ACTIONS && ctx.config.interactive;
    const notification = new Notification({
      title: track.title || ctx.t("plugins.notifications.playing", "Playing"),
      body: track.artist,
      icon: icon ?? appIcon(),
      silent: true,
      urgency: ctx.config.urgency,
      ...(interactive ? { actions: actionButtons(ctx, paused) } : {}),
    });
    notification.on("click", () => ctx.focusWindow());
    notification.on("action", (event) => {
      const index = event.actionIndex;
      if (index === PREVIOUS_ACTION) return ctx.player.control({ type: "previous" });
      if (index === NEXT_ACTION) return ctx.player.control({ type: "next" });
      ctx.player.control({ type: paused ? "play" : "pause" });
      // A resume shows its own notification when that option is on.
      const resumeNotifies = paused && ctx.config.unpauseNotification;
      if (ctx.config.refreshOnPlayPause && !resumeNotifies) show(track, !paused);
    });
    if (!WINDOWS) {
      present(notification);
      return;
    }
    // pear-desktop's 10 ms delay: closing a toast and showing the next one in
    // the same instant makes Windows update the old toast instead of showing
    // the new one.
    presentTimer = ctx.setTimeout(() => {
      presentTimer = undefined;
      if (id === generation) present(notification);
    }, 10);
  };

  const show = (track: Track, paused: boolean) => {
    // The mini-player is already showing this track in the tray corner.
    if (suppressed()) {
      close();
      return false;
    }
    const id = ++generation;
    if (WINDOWS && ctx.config.interactive) void showToast(track, paused, id);
    else void showNative(track, paused, id);
    return true;
  };

  return {
    show,
    close,
    get showing() {
      return current !== undefined;
    },
    dispose() {
      generation++;
      close();
    },
  };
}

function actionButtons(ctx: Ctx, paused: boolean): Electron.NotificationAction[] {
  const playPause = paused ? ctx.t("plugins.notifications.buttons.play", "Play") : ctx.t("plugins.notifications.buttons.pause", "Pause");
  return [
    { type: "button", text: ctx.t("plugins.notifications.buttons.previous", "Previous") },
    { type: "button", text: playPause },
    { type: "button", text: ctx.t("plugins.notifications.buttons.next", "Next") },
  ];
}

/** Toast XML refers to images by path: the artwork and button icons go to userData. */
function notificationFiles(ctx: Ctx) {
  const folder = join(ctx.app.getPath("userData"), "notifications");
  let iconPaths: Record<ButtonIcon, string> | undefined;
  let appIconPath: string | undefined;
  return {
    /** The app icon's file, for toasts of tracks without artwork. */
    appIcon() {
      if (appIconPath) return appIconPath;
      mkdirSync(folder, { recursive: true });
      const path = join(folder, "app-icon.png");
      writeFileSync(path, appIcon().toPNG());
      appIconPath = path;
      return path;
    },
    buttonIcons() {
      if (iconPaths) return iconPaths;
      mkdirSync(folder, { recursive: true });
      const paths = {} as Record<ButtonIcon, string>;
      for (const [name, base64] of Object.entries(BUTTON_ICONS) as [ButtonIcon, string][]) {
        paths[name] = join(folder, `${name}.png`);
        writeFileSync(paths[name], Buffer.from(base64, "base64"));
      }
      iconPaths = paths;
      return paths;
    },
    saveArtwork(image: NativeImage, logo: boolean) {
      mkdirSync(folder, { recursive: true });
      const path = join(folder, logo ? "art-logo.png" : "art-banner.png");
      try {
        writeFileSync(path, image.toPNG());
      } catch (error) {
        // As pear-desktop: the app icon instead.
        ctx.log.warn("couldn't save the artwork", error);
        return this.appIcon();
      }
      return path;
    },
  };
}
