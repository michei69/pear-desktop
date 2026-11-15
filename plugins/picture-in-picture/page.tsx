/** @jsxImportSource @pear/sdk */
// The page side: YTM's full-screen player while in the small window, the hotkey,
// the player page's mini-player button and the entry in the track's menu.

import type { PageContextOf } from "@pear/sdk";
import { matchesAccelerator } from "@pear/sdk/accelerator";
import { isTypingTarget } from "@pear/sdk/util";
import type { PipCommands, pipConfig } from "./config.ts";
import { trackMenuEntry } from "./menu.ts";

type Ctx = PageContextOf<typeof pipConfig, PipCommands>;

/** YTM's full-screen toggle on the player, as a method of its Polymer controller. */
interface PlayerController {
  onDoubleClick?: (() => void) | undefined;
}

interface PlayerElement extends HTMLElement {
  polymerController?: object;
  /** Older YTM builds kept the handler on the player element itself. */
  onDoubleClick_?: (() => void) | undefined;
}

/**
 * Stops the player's double-click from leaving YTM's full screen. The handler
 * is the Polymer controller prototype's method (replacing the element's own
 * `onDoubleClick`, a proxy wrapper, does nothing); older builds had it on the
 * element. Returns the undo.
 */
export function takeDoubleClick(player: PlayerElement | null | undefined) {
  if (!player) return;
  const prototype = player.polymerController ? Object.getPrototypeOf(player.polymerController) : undefined;
  const target = (prototype ?? player) as PlayerElement & PlayerController;
  const key = typeof target.onDoubleClick === "function" ? "onDoubleClick" : "onDoubleClick_";
  const handler = target[key];
  if (typeof handler !== "function") return;
  target[key] = () => {};
  return () => {
    target[key] = handler;
  };
}

// YTM's own clean-up after its full screen happens within this.
const SETTLE_MS = 500;

export function startPage(ctx: Ctx) {
  const mode = fullScreenMode(ctx);
  ctx.host.on("pip", (active) => mode.set(active === true));
  void ctx.host.invoke("active").then((active) => mode.set(active === true));
  // Leaving YTM's full screen (its button, or Escape) leaves the small window too.
  ctx.listen(document, "fullscreenchange", () => {
    if (mode.active && !document.fullscreenElement) void ctx.host.invoke("exit");
  });

  const toggle = () => togglePip(ctx);
  handleKeys(ctx, mode, toggle);
  minimizeButton(ctx, mode, toggle);
  trackMenuEntry(ctx, toggle);
}

/**
 * As pear-desktop: the player page's mini-player button opens picture-in-picture
 * instead. In the small window, leaving YTM's full screen (its exit button)
 * leaves it, see `startPage`.
 */
function minimizeButton(ctx: Ctx, mode: { readonly active: boolean }, toggle: () => void) {
  const onClick = (event: MouseEvent) => {
    if (mode.active) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(ctx.sel("player.minimize_button"))) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };
  ctx.listen(document, "click", onClick, { capture: true });
}

/** The browser's picture-in-picture when wanted and possible, else the small window. */
async function togglePip(ctx: Ctx) {
  if (ctx.config.useNativePiP) {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await ctx.player.video()?.requestPictureInPicture();
      return;
    } catch (error) {
      ctx.log.warn("native picture-in-picture failed; shrinking the window instead", error);
    }
  }
  await ctx.host.invoke("toggle");
}

/**
 * The small window shows YTM's own full-screen player; the window is not
 * full-screenable meanwhile, so it fills just the small window.
 */
function fullScreenMode(ctx: Ctx) {
  const root = document.documentElement;
  const dragStrip = <div class="pear-pip-drag" />;
  // As pear-desktop: double-clicking the video doesn't leave full screen (and so the small
  // window), and the expanding menu closes once the pointer leaves it.
  let restoreDoubleClick: (() => void) | undefined;
  const closeMenu = () => ctx.$("player_bar.middle_controls")?.click();

  const enter = () => {
    const fullscreen = ctx.$("player.container")?.getAttribute("player-ui-state") === "FULLSCREEN";
    // YTM's full-screen player lives on the player page.
    if (!ctx.$("player.page_open")) ctx.$("player_bar.toggle_player_page")?.click();
    if (!fullscreen) ctx.$("player.fullscreen_button")?.click();
    document.body.append(dragStrip);
    restoreDoubleClick ??= takeDoubleClick(ctx.$<PlayerElement>("player.container"));
    ctx.$("player_bar.expanding_menu")?.addEventListener("mouseleave", closeMenu);
  };
  const leave = () => {
    dragStrip.remove();
    restoreDoubleClick?.();
    restoreDoubleClick = undefined;
    ctx.$("player_bar.expanding_menu")?.removeEventListener("mouseleave", closeMenu);
    if (document.fullscreenElement) void document.exitFullscreen();
    ctx.setTimeout(revealBars, SETTLE_MS);
  };
  // The new player bar's layout hides the nav bar and the player bar (inline
  // visibility) in full screen; left in the small window, it doesn't show them again.
  const revealBars = () => {
    if (document.fullscreenElement) return;
    for (const name of ["nav_bar", "player_bar"] as const) {
      const bar = ctx.$(name);
      if (bar?.style.visibility === "hidden") bar.style.removeProperty("visibility");
    }
  };

  const mode = {
    active: false,
    set(active: boolean) {
      mode.active = active;
      root.classList.toggle("pear-pip", active);
      if (active) enter();
      else leave();
    },
  };
  ctx.onCleanup(() => {
    if (mode.active) mode.set(false);
    root.classList.remove("pear-pip");
  });
  return mode;
}

function handleKeys(ctx: Ctx, mode: { readonly active: boolean }, toggle: () => void) {
  const isMac = navigator.platform.startsWith("Mac");
  const onKeydown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return;
    if (mode.active && event.key === "Escape") {
      // Not YTM's own Escape too: it would leave its full screen while the window is still
      // small, which breaks the new player bar's layout. The host leaves it after resizing.
      event.preventDefault();
      event.stopPropagation();
      void ctx.host.invoke("exit");
      return;
    }
    // YTM's "f" would leave full screen and break the small window.
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
    if (mode.active && event.key.toLowerCase() === "f" && !hasModifier) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!matchesAccelerator(event, ctx.config.hotkey, isMac)) return;
    event.preventDefault();
    toggle();
  };
  ctx.listen(window, "keydown", onKeydown, { capture: true });
}
