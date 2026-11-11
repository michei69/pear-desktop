// Same identity as pear-desktop, so existing installs keep their data folder,
// window class and taskbar entry.

import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, shell } from "electron";
import { embed } from "@pear/sdk/macros" with { type: "macro" };
import { buildLabel, copyright } from "./app-info.ts";
export const APP_ID = "com.github.th-ch.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063";
export const APP_NAME = "\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063";

/** Must run first, before anything reads userData. */
export function setAppIdentity() {
  // Separate profile (and single-instance lock) for tests and parallel dev runs.
  if (process.env.PEAR_USER_DATA) app.setPath("userData", process.env.PEAR_USER_DATA);
  // The data folder follows productName, so pin it before renaming the app to its
  // id, which X11/Wayland use as the window class and Windows as the AppUserModelId.
  app.setPath("userData", app.getPath("userData"));
  app.setName(APP_ID);
  app.commandLine.appendSwitch("class", APP_ID);
  // Wayland when the session has it (pear-desktop's hint); X11 otherwise.
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  // Without this the About panel shows the raw app id; the channel and commit
  // ride along in the version line, since GTK prints only that field.
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: `v${app.getVersion()} ${buildLabel()}`,
    copyright,
  });
}

/**
 * Restarts the app. A portable Windows build runs from a temporary copy it
 * extracts; relaunching that copy would lose the portable exe (and its folder).
 */
export function relaunchOptions(): Electron.RelaunchOptions {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  return portable ? { execPath: portable } : {};
}

/**
 * Windows: a Start Menu shortcut with the app's id, created or repaired at each
 * start, as pear-desktop did. Windows shows notifications (toasts) only for apps
 * with one, and groups the taskbar by its id. Not in development, nor for a
 * portable build, which runs from a temporary folder.
 */
export function registerStartMenuShortcut() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const target = process.execPath;
  const appData = app.getPath("appData");
  if (process.env.PORTABLE_EXECUTABLE_FILE || target.startsWith(join(appData, "..", "Local", "Temp"))) return;
  const shortcut = join(appData, "Microsoft", "Windows", "Start Menu", "Programs", `${APP_NAME}.lnk`);
  const details = {
    target,
    cwd: dirname(target),
    description: `${APP_NAME} Desktop App - including custom plugins`,
    appUserModelId: APP_ID,
  };
  let operation: "create" | "update" = "create";
  try {
    const current = shell.readShortcutLink(shortcut);
    if (current.target === target && current.appUserModelId === APP_ID) return;
    operation = "update";
  } catch {
    // No shortcut yet.
  }
  if (!shell.writeShortcutLink(shortcut, operation, details)) console.warn(`[pear] couldn't ${operation} the Start Menu shortcut`);
}

/** The multi-size .ico that shortcuts point at when the "Use Music's icons" option is on. */
const YTM_SHORTCUT_ICON = embed("generated/icons/win/icon-ytm.ico");

/** Where the .ico is written for shortcuts to point at; a .lnk stores a file path. */
let shortcutIcon: string | undefined;

export function shortcutIconPath() {
  if (shortcutIcon) return shortcutIcon;
  shortcutIcon = join(app.getPath("userData"), "icon-ytm.ico");
  writeFileSync(shortcutIcon, Buffer.from(YTM_SHORTCUT_ICON, "base64"));
  return shortcutIcon;
}

/** The folders Windows keeps shortcuts in for the current user (taskbar pins included). */
function shortcutRoots() {
  const appData = app.getPath("appData");
  return [
    app.getPath("desktop"),
    process.env.PUBLIC ? join(process.env.PUBLIC, "Desktop") : undefined,
    join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    join(appData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
  ].filter((root): root is string => root !== undefined);
}

/** Every .lnk below `root`; a missing folder has none. */
function shortcutFiles(root: string) {
  try {
    return readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((file) => file.toLowerCase().endsWith(".lnk"))
      .map((file) => join(root, file));
  } catch {
    return [];
  }
}

/**
 * The icon a matching shortcut should get, or null when the shortcut is not
 * ours to change. Off, only shortcuts still pointing at our icon are reset to
 * the exe's baked one; on, only shortcuts on the exe or our icon are touched.
 */
export function nextShortcutIcon(current: string, target: string, ours: string, useYtmIcons: boolean) {
  const currentPath = current.split(",")[0] ?? "";
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const isDefault = currentPath === "" || same(currentPath, target);
  const isOurs = same(currentPath, ours);
  if (!useYtmIcons) return isOurs ? target : null;
  return isDefault || isOurs ? `${ours},0` : null;
}

/**
 * Keeps the app's own Windows shortcuts on the icon matching the "Use Music's
 * icons" option, as pear-desktop's shortcut-icons provider did: the exe's icon
 * is baked at build time, so a .lnk's own icon is the only way the option
 * reaches outside the app.
 */
export async function syncShortcutIcons(useYtmIcons: boolean) {
  // A portable build runs from a temporary copy; its shortcuts are not stable.
  if (process.platform !== "win32" || !app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return;
  const target = process.execPath;
  const ours = shortcutIconPath();
  let changed = 0;
  for (const root of shortcutRoots()) {
    for (const file of shortcutFiles(root)) {
      try {
        const current = shell.readShortcutLink(file);
        if (current.target.toLowerCase() !== target.toLowerCase()) continue;
        const icon = nextShortcutIcon(current.icon ?? "", target, ours, useYtmIcons);
        if (icon === null) continue;
        shell.writeShortcutLink(file, "update", { ...current, icon, iconIndex: 0 });
        changed++;
      } catch (error) {
        // One unreadable shortcut must not stop the rest.
        console.warn(`[pear] couldn't sync the shortcut icon of ${file}:`, error);
      }
    }
  }
  if (changed > 0) console.info(`[pear] shortcut icons updated (${changed})`);
}
