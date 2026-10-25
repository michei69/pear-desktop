// Same identity as pear-desktop, so existing installs keep their data folder,
// window class and taskbar entry.

import { app } from "electron";
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
