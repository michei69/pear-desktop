// The standalone settings window: the same settings UI as the in-page overlay,
// served from pear://settings, so settings stay reachable when YTM
// doesn't load (a broken plugin, no network…). Also the restart sessions the
// settings surfaces report through, whose deferred restart prompt is shown here.

import { BrowserWindow, dialog, protocol } from "electron";
import { interpolate, type Translate, type Vars } from "@pear/sdk/i18n";
import { type RestartRequirement, SETTINGS_ORIGIN } from "@pear/sdk/protocol";
import settingsApp from "virtual:pear/settings-app";
import { isSettingsUrl } from "../shared/user-agent.ts";
import { errorPage } from "./load-failure.ts";
import { alive, appIcon, focusWindow, secureWebPreferences } from "./windows.ts";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:">
<title>Pear Desktop settings</title>
<style>html, body { margin: 0; height: 100%; background: #1d1b20; }</style>
</head>
<body><script src="app.js"></script></body>
</html>`;

/** pear-desktop's privileges for the web: CSP bypassed, CORS, fetch, service workers and streaming. */
const WEB_PRIVILEGES = {
  standard: true,
  bypassCSP: true,
  allowServiceWorkers: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true,
  codeCache: true,
};

/** Must run before `app.whenReady()`, once (a second call replaces the first): the settings' scheme and the web's. */
export function registerSettingsScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: "pear", privileges: { standard: true, secure: true } },
    { scheme: "http", privileges: WEB_PRIVILEGES },
    { scheme: "https", privileges: WEB_PRIVILEGES },
  ]);
}

/** Must run after `app.whenReady()`. */
export function serveSettings() {
  protocol.handle("pear", (request) => {
    const url = new URL(request.url);
    if (!isSettingsUrl(request.url)) return new Response("Not found", { status: 404 });
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/app.js") {
      return new Response(settingsApp, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  });
}

/** `--settings` opens the standalone settings window (also in an already running instance). */
export const SETTINGS_FLAG = "--settings";

/** How long the settings window waits for its first paint before showing anyway. */
const SHOW_FALLBACK_DELAY_MS = 500;

let settingsWindow: BrowserWindow | undefined;

/** The app's translator; set once the language loads, for the window's own error messages. */
let translate: Translate | undefined;

export function setSettingsTranslate(t: Translate) {
  translate = t;
}

const text = (key: string, fallback: string, vars?: Vars) => (translate ? translate(key, fallback, vars) : interpolate(fallback, vars));

/** A readable page instead of an empty window when pear://settings fails to load. */
function settingsErrorPage(detail: string) {
  return errorPage(`${SETTINGS_ORIGIN}/`, {
    title: text("settings-ui.boot-failed.title", "Settings failed to load"),
    message: text("settings-ui.boot-failed.message", "The settings window could not start: {{error}}", { error: detail }),
    retry: text("settings-ui.boot-failed.reload", "Reload"),
  });
}

export function openSettingsWindow(useYtmIcons: boolean) {
  const open = alive(settingsWindow);
  if (open) {
    focusWindow(open);
    return open;
  }
  const window = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#1d1b20",
    title: "Pear Desktop settings",
    icon: appIcon(useYtmIcons),
    autoHideMenuBar: true,
    show: false,
    webPreferences: secureWebPreferences(),
  });
  settingsWindow = window;
  // The window paints its own background; show it once the page has painted or
  // after a short timer, whichever comes first (the main window's rule).
  const show = () => {
    if (window.isDestroyed() || window.isVisible()) return;
    window.show();
  };
  const fallback = setTimeout(show, SHOW_FALLBACK_DELAY_MS);
  window.once("show", () => clearTimeout(fallback));
  window.once("ready-to-show", show);
  window.on("closed", () => {
    clearTimeout(fallback);
    if (settingsWindow === window) settingsWindow = undefined;
  });
  window.webContents.on("did-fail-load", (_event, errorCode, description, url, isMainFrame) => {
    // ERR_ABORTED: a navigation replaced by another one, not a failure.
    if (!isMainFrame || errorCode === -3) return;
    // The error page is a data: URL; a failure loading it must not recurse.
    if (url.startsWith("data:")) return;
    console.error(`[pear] settings window failed to load ${url}: ${description} (${errorCode})`);
    show();
    void window.loadURL(settingsErrorPage(`${description} (${errorCode}), ${url}`));
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[pear] settings window renderer gone:", details);
    show();
  });
  // Links (none today) open nowhere inside this window; its own error page may retry.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isSettingsUrl(url)) event.preventDefault();
  });
  void window.loadURL(`${SETTINGS_ORIGIN}/`);
  return window;
}

export function settingsWindowContents() {
  return alive(settingsWindow)?.webContents;
}

/** What the restart prompt needs from the app. */
export interface RestartEnvironment {
  t: Translate;
  /** The main window, for the modal. */
  window(): BrowserWindow | undefined;
  /** Restarts the app (relaunch and quit). */
  restart(): void;
}

/**
 * The settings surfaces' restart sessions. Each opened surface (the in-page
 * overlay, the standalone window) reports what it changed that waits for a
 * restart; when the last one closes, one prompt lists everything. Sessions are
 * keyed by the sender's WebContents id, so a window destroyed before closing
 * still ends its session.
 */
export class RestartSessions {
  #environment: RestartEnvironment;
  #pending = new Map<string, RestartRequirement>();
  #sessions = new Set<number>();

  constructor(environment: RestartEnvironment) {
    this.#environment = environment;
  }

  /** Opens (or joins) the batch; the first session starts a fresh one. */
  open(session: number) {
    if (this.#sessions.size === 0) this.#pending.clear();
    this.#sessions.add(session);
  }

  /** Notes requirements as they are flagged; sessions that already closed are ignored. */
  add(session: number, requirements: readonly RestartRequirement[]) {
    if (!this.#sessions.has(session)) return;
    this.#collect(requirements);
  }

  close(session: number, requirements: readonly RestartRequirement[] = []) {
    if (!this.#sessions.delete(session)) return;
    this.#collect(requirements);
    // Keep batching while another settings surface is still open.
    if (this.#sessions.size > 0) return;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    if (pending.length > 0) void this.#prompt(pending);
  }

  #collect(requirements: readonly RestartRequirement[]) {
    for (const requirement of requirements) {
      // The page runtime sends this: keep only well-formed entries.
      if (typeof requirement?.key === "string" && requirement.key && typeof requirement.label === "string") {
        this.#pending.set(requirement.key, requirement);
      }
    }
  }

  async #prompt(pending: readonly RestartRequirement[]) {
    const { t } = this.#environment;
    const changes = [...new Set(pending.map((requirement) => requirement.label))].join(", ");
    const options: Electron.MessageBoxOptions = {
      type: "info",
      buttons: [
        t("main.dialog.need-to-restart.buttons.restart-now", "Restart Now"),
        t("main.dialog.need-to-restart.buttons.later", "Later"),
      ],
      title: t("main.dialog.restart-summary.title", "Restart Required"),
      message: t("main.dialog.restart-summary.message", "Some changes require a restart"),
      detail: t("main.dialog.restart-summary.detail", "Restart the app to apply: {{changes}}", { changes }),
      defaultId: 0,
      cancelId: 1,
    };
    try {
      const window = alive(this.#environment.window());
      const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
      if (response === 0) this.#environment.restart();
    } catch (error) {
      console.error("[pear] the restart prompt failed:", error);
    }
  }
}
