// The "Picture in picture" entry in the track menu: only the player bar's own
// menu of the track playing, never a row's, a page's or another popup's.

import type { PageContextOf } from "@pear/sdk";
import { popupMenuItem } from "@pear/sdk/dom";
import type { PipCommands, pipConfig } from "./config.ts";

type Ctx = PageContextOf<typeof pipConfig, PipCommands>;

const PIP_ICON =
  "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z";

/** YTM forwards an open popup's events to the menu renderer that owns it. */
interface MenuOwner extends HTMLElement {
  ytEventForwardingBehavior?: { forwarder_?: { eventSink?: HTMLElement } };
}

/** The menu renderer behind `listbox`, found through YTM's event-forwarding hook. */
export function menuOwner(listbox: HTMLElement) {
  for (let element: HTMLElement | null = listbox; element; element = element.parentElement) {
    const owner = (element as MenuOwner).ytEventForwardingBehavior?.forwarder_?.eventSink;
    if (owner) return owner;
  }
  return undefined;
}

/** Whether the popup belongs to the player bar, in either of YTM's player-bar layouts. */
export function isPlayerBarMenu(ctx: Pick<Ctx, "$">, listbox: HTMLElement) {
  const owner = menuOwner(listbox);
  if (!owner) return false;
  // The classic bar's renderer names it in its own classes; the new bar is its ancestor.
  return owner.matches("ytmusic-menu-renderer.ytmusic-player-bar") || ctx.$("player_bar")?.contains(owner) === true;
}

/** Whether the popup is the player bar's menu of the track that is playing. */
export function isTrackMenu(ctx: Pick<Ctx, "$" | "player">, listbox: HTMLElement) {
  return Boolean(ctx.player.state.track) && isPlayerBarMenu(ctx, listbox);
}

export function trackMenuEntry(ctx: Ctx, toggle: () => void) {
  popupMenuItem(ctx, {
    class: "pear-pip-item",
    icon: PIP_ICON,
    label: ctx.t("plugins.picture-in-picture.templates.button", "Picture-in-picture"),
    when: (listbox) => isTrackMenu(ctx, listbox),
    onClick: toggle,
  });
}
