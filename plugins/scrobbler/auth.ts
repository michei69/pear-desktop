// Last.fm authorization: the user signs in and approves in a Last.fm window.

import { BrowserWindow, dialog } from "electron";
import { credentials, netFetch, type Warn } from "./common.ts";
import type { Ctx } from "./schema.ts";
import { lastFm } from "./services.ts";

/** A failed check waits this long for the next one; a navigation usually answers sooner. */
const AUTH_FALLBACK_MS = 5000;
/** Fits Last.fm's sign-in and approval pages. */
const AUTH_WINDOW_SIZE = { width: 520, height: 680 };

interface AuthWindow {
  window: BrowserWindow;
  /** Aborts the session checks, and the token request until the window exists. */
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  /** Abandoned by the plugin: its close is not a decline. */
  cancelled: boolean;
}

export function lastFmAuthorizer(ctx: Ctx, warn: Warn) {
  let auth: AuthWindow | undefined;
  /** The token request in flight, so stop/disable can abort it before a window exists. */
  let pendingToken: AbortController | undefined;
  let authDeclined = false;
  let stopped = false;

  const authorize = async () => {
    if (auth || pendingToken || authDeclined || !ctx.config.lastfmEnabled || ctx.config.lastfmSessionKey) return;
    const controller = new AbortController();
    pendingToken = controller;
    let token: string;
    try {
      token = await lastFm.getToken(netFetch, credentials(ctx), controller.signal);
    } catch (error) {
      // Disabling the plugin aborts the request; that is not a Last.fm failure.
      if (!controller.signal.aborted) warn("Last.fm", error);
      return;
    } finally {
      if (pendingToken === controller) pendingToken = undefined;
    }
    // The plugin may have stopped, Last.fm been disabled or a session supplied while the token was in flight.
    if (stopped || controller.signal.aborted || !ctx.config.lastfmEnabled || ctx.config.lastfmSessionKey) return;

    const window = new BrowserWindow({
      parent: ctx.window,
      modal: true,
      ...AUTH_WINDOW_SIZE,
      title: ctx.t("plugins.scrobbler.auth-window.title", "Authorize Pear Desktop on Last.fm"),
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      webPreferences: { partition: "persist:pear-lastfm", sandbox: true, contextIsolation: true },
    });
    const current: AuthWindow = { window, controller, cancelled: false };
    auth = current;
    let authorized = false;
    let checking = false;
    // Last.fm has no redirect for desktop apps: the token becomes a session once the approval page loads,
    // so every navigation asks once. The timer only covers a page that never navigates.
    const check = async () => {
      if (checking || authorized || stopped || current.cancelled || auth !== current) return;
      checking = true;
      ctx.clearTimeout(current.timer);
      try {
        const session = await lastFm.getSession(netFetch, credentials(ctx), token, controller.signal);
        if (stopped || current.cancelled || auth !== current) return;
        authorized = true;
        ctx.log.info(`authorized on Last.fm as ${session.name}`);
        ctx.setConfig({ lastfmSessionKey: session.key });
        if (!window.isDestroyed()) window.close();
      } catch {
        if (!stopped && !current.cancelled && auth === current) {
          current.timer = ctx.setTimeout(() => void check(), AUTH_FALLBACK_MS);
        }
      } finally {
        checking = false;
      }
    };
    const checkNow = () => {
      if (stopped || current.cancelled || auth !== current) return;
      ctx.clearTimeout(current.timer);
      void check();
    };
    window.webContents.on("did-navigate", checkNow);
    window.webContents.on("did-stop-loading", checkNow);
    window.on("closed", () => {
      ctx.clearTimeout(current.timer);
      if (auth === current) auth = undefined;
      if (authorized || stopped || current.cancelled) return;
      // Don't reopen the window by itself; toggling Last.fm (or clearing the session) asks again.
      authDeclined = true;
      showDeclined(ctx);
    });
    void window.loadURL(lastFm.authUrl(ctx.config.lastfmApiKey, token)).catch((error: unknown) => {
      // A window that never loaded is no answer from the user: drop the latch so a retry can open.
      if (!controller.signal.aborted) warn("Last.fm", error);
      ctx.clearTimeout(current.timer);
      current.cancelled = true;
      if (auth === current) auth = undefined;
      if (!window.isDestroyed()) window.close();
    });
    // The load events check first; this catches a window that stays on one page.
    current.timer = ctx.setTimeout(() => void check(), AUTH_FALLBACK_MS);
  };

  ctx.onCleanup(() => {
    stopped = true;
    pendingToken?.abort();
    pendingToken = undefined;
    const current = auth;
    auth = undefined;
    if (!current) return;
    ctx.clearTimeout(current.timer);
    current.controller.abort();
    if (!current.window.isDestroyed()) current.window.close();
  });

  let wasEnabled = ctx.config.lastfmEnabled;
  let hadSession = !!ctx.config.lastfmSessionKey;
  const reconfigure = () => {
    const { lastfmEnabled, lastfmSessionKey } = ctx.config;
    if (!lastfmEnabled) {
      // Disabling abandons the token request and the window: neither is a decline.
      pendingToken?.abort();
      pendingToken = undefined;
      if (auth) {
        auth.cancelled = true;
        ctx.clearTimeout(auth.timer);
        auth.controller.abort();
        if (!auth.window.isDestroyed()) auth.window.close();
      }
    }
    const askAgain = (lastfmEnabled && !wasEnabled) || (hadSession && !lastfmSessionKey);
    if (askAgain) authDeclined = false;
    wasEnabled = lastfmEnabled;
    hadSession = !!lastfmSessionKey;
    void authorize();
  };

  return { authorize, reconfigure };
}

function showDeclined(ctx: Ctx) {
  void dialog.showMessageBox(ctx.window, {
    type: "warning",
    title: ctx.t("plugins.scrobbler.dialog.lastfm.auth-failed.title", "Authentication Failed"),
    message: ctx.t("plugins.scrobbler.dialog.lastfm.not-authorized.message", "Pear Desktop wasn't authorized on Last.fm"),
    detail: ctx.t(
      "plugins.scrobbler.dialog.lastfm.not-authorized.detail",
      "Scrobbling to Last.fm stays off until you authorize. Turn the Last.fm option off and on to try again.",
    ),
  });
}
