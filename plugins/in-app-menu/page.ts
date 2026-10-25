// The page side: the title-bar styling, the menu and the window buttons in YTM's top bar.

import type { PageContextOf } from "@pear/sdk";
import type { inAppMenuConfig } from "./config.ts";
import { AppMenu } from "./menu.tsx";
import { pageStyles } from "./styles.ts";
import type { MenuCommands, WindowState } from "./types.ts";
import { windowControls } from "./window-controls.tsx";

export type Ctx = PageContextOf<typeof inAppMenuConfig, MenuCommands>;

/** Room for the native window buttons drawn over the top bar, by platform. */
const NATIVE_BUTTONS_CLASS: Partial<Record<string, string>> = {
  darwin: "pear-traffic-lights",
  win32: "pear-caption-buttons",
};

export async function startPage(ctx: Ctx) {
  ctx.addStyle(pageStyles);
  const state = await ctx.host.invoke("state");
  markTitleBar(ctx, state);
  markScrolling(ctx);

  const menu = new AppMenu(ctx);
  const showControls = state.frameless && state.platform === "linux" && ctx.config.windowControls;
  const controls = showControls ? windowControls(ctx) : undefined;
  controls?.showMaximized(state.maximized);
  ctx.host.on("state", (next) => controls?.showMaximized((next as WindowState).maximized));

  // YTM re-renders the nav bar on some navigations, and appends to it after us:
  // keep the menu first and the window buttons last.
  const place = () => {
    const left = ctx.$("nav_bar.left");
    const right = ctx.$("nav_bar.right");
    if (left && left.firstElementChild !== menu.host) left.prepend(menu.host);
    if (controls && right && right.lastElementChild !== controls.host) right.append(controls.host);
  };
  await ctx.waitFor("nav_bar.right");
  place();
  ctx.observe("nav_bar", { childList: true, subtree: true }, place);
}

/** Layouts that hide their top bar once content scrolls (unobtrusive-player and friends) read this. */
const SCROLLED_AFTER_PX = 20;

/**
 * `content-scrolled` on YTM's scroll container, updated at most once a frame:
 * a raw scroll listener would read scrollTop (a synchronous layout) for every
 * event on a long playlist. The class is only written when it changes.
 */
function markScrolling(ctx: Ctx) {
  const layout = ctx.$("app.layout");
  if (!layout) return;
  let frame: number | undefined;
  let scrolled = layout.scrollTop > SCROLLED_AFTER_PX;
  layout.classList.toggle("content-scrolled", scrolled);

  const update = () => {
    frame = undefined;
    const next = layout.scrollTop > SCROLLED_AFTER_PX;
    if (next === scrolled) return;
    scrolled = next;
    layout.classList.toggle("content-scrolled", next);
  };
  ctx.listen(
    layout,
    "scroll",
    () => {
      if (frame === undefined) frame = requestAnimationFrame(update);
    },
    { passive: true },
  );
  ctx.onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    layout.classList.remove("content-scrolled");
  });
}

/** Until a restart after enabling, the system title bar is still there: just the menu then. */
function markTitleBar(ctx: Ctx, state: WindowState) {
  const root = document.documentElement;
  const nativeButtons = NATIVE_BUTTONS_CLASS[state.platform];
  root.classList.toggle("pear-frameless", state.frameless);
  if (state.frameless && nativeButtons) root.classList.add(nativeButtons);
  ctx.onCleanup(() => root.classList.remove("pear-frameless", "pear-traffic-lights", "pear-caption-buttons"));
}
