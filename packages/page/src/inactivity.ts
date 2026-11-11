// Keeps YTM's inactivity detection quiet while the user is listening.
//
// YTM pauses playback when its "Are you still there?" prompt goes unanswered:
// it compares Date.now() with `window._lact` and pauses when that stamp is
// stale. A live getter makes every read current without any timer, which also
// covers a minimized/background window where Chromium throttles timers.

import { selectors } from "@pear/sdk/selectors";
import { waitForSelector } from "./dom.ts";
import type { Player } from "./player.ts";

/** The renderer YTM mounts inside its "you there" paper dialog. */
const YOU_THERE = selectors["dialog.you_there"];
const PAPER_DIALOG = selectors["dialog.paper"];
const CONFIRM = "[dialog-confirm], yt-button-renderer, tp-yt-paper-button, button";
/** Only resume when the prompt interrupted recent playback (master's window). */
const RESUME_WINDOW_MS = 60_000;
/** At most one prompt handled per this many milliseconds. */
const HANDLE_COOLDOWN_MS = 10_000;
/** YTM's player state for "paused". */
const PAUSED = 2;

interface PaperDialog extends HTMLElement {
  close?(): void;
}

let started = false;

/** Starts the keep-alive once for the page's lifetime; independent of any plugin. */
export function installInactivityKeepAlive(player: Player) {
  if (started) return;
  started = true;
  installActivityStamp();

  let lastActivityAt = 0;
  let lastHandledAt = 0;
  const handled = new WeakSet<Element>();

  const noteActivity = () => {
    lastActivityAt = Date.now();
  };
  player.on("statusChange", (status) => {
    if (status === "playing") noteActivity();
  });
  player.on("timeUpdate", noteActivity);

  const dismiss = () => {
    const now = Date.now();
    if (now - lastActivityAt >= RESUME_WINDOW_MS) return;
    if (now - lastHandledAt < HANDLE_COOLDOWN_MS) return;
    const api = player.api;
    if (!api) return;
    for (const element of document.querySelectorAll(YOU_THERE)) {
      const dialog = element.closest<PaperDialog>(PAPER_DIALOG);
      if (!dialog || handled.has(dialog)) continue;
      handled.add(dialog);
      lastHandledAt = now;
      const confirm = dialog.querySelector<HTMLElement>(CONFIRM);
      if (confirm) confirm.click();
      else dialog.close?.();
      if (api.getPlayerState() === PAUSED) api.playVideo();
    }
  };

  // Event-driven: the prompt mounting is what triggers the dismissal.
  void waitForSelector<HTMLElement>("body").then((body) => {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && (node.matches(YOU_THERE) || node.querySelector(YOU_THERE))) return dismiss();
        }
      }
    }).observe(body, { childList: true, subtree: true });
    // A prompt may already be up when the runtime starts.
    dismiss();
  });
}

/** YTM's stamp is read whenever it checks; a live getter is never stale. */
function installActivityStamp() {
  const existing = Object.getOwnPropertyDescriptor(window, "_lact");
  if (existing?.get || (existing && !existing.configurable)) return;
  Object.defineProperty(window, "_lact", {
    configurable: true,
    get: () => Date.now(),
    // YTM writes its own stamp on activity; the getter already keeps it fresh.
    set: () => {},
  });
}
