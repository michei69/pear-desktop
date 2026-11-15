// Host side: the application menu, serialized for the page to draw.

import type { Menu, MenuItem } from "electron";
import type { MenuNode } from "./types.ts";

const ITEM_KINDS: Partial<Record<MenuItem["type"], MenuNode["kind"]>> = { checkbox: "checkbox", radio: "radio" };

const SEPARATOR: Omit<MenuNode, "commandId"> = {
  kind: "separator",
  label: "",
  sublabel: "",
  toolTip: "",
  accelerator: "",
  enabled: true,
  checked: false,
};

export function serialize(menu: Menu, isMac: boolean): MenuNode[] {
  return menu.items.flatMap((item): MenuNode[] => {
    if (!item.visible) return [];
    if (item.type === "separator") return [{ commandId: item.commandId, ...SEPARATOR }];
    return [serializeItem(item, isMac)];
  });
}

function serializeItem(item: MenuItem, isMac: boolean): MenuNode {
  const node: MenuNode = {
    commandId: item.commandId,
    kind: ITEM_KINDS[item.type] ?? "normal",
    label: item.label.replace(/&(?=\S)/g, ""),
    sublabel: item.sublabel ?? "",
    toolTip: item.toolTip ?? "",
    accelerator: item.accelerator ? displayAccelerator(String(item.accelerator), isMac) : "",
    enabled: item.enabled,
    checked: item.checked,
  };
  if (item.submenu) {
    node.kind = "submenu";
    node.children = serialize(item.submenu, isMac);
  }
  return node;
}

const MAC_KEYS: Partial<Record<string, string>> = {
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  ctrl: "⌃",
  control: "⌃",
  cmd: "⌘",
  command: "⌘",
};

/** "CmdOrCtrl+Shift+I" as shown in menus. */
function displayAccelerator(accelerator: string, isMac: boolean) {
  const parts = accelerator.split(/\+(?!$)/).map((part) => {
    const lower = part.toLowerCase();
    if (lower === "cmdorctrl" || lower === "commandorcontrol") return isMac ? "⌘" : "Ctrl";
    if (lower === "plus") return "+";
    if (isMac) return MAC_KEYS[lower] ?? part;
    return part;
  });
  return parts.join(isMac ? "" : "+");
}

/**
 * The item with `commandId`, submenus included. Electron gives every item a new
 * id when the menu is rebuilt, so an id the page kept from an older menu (a click
 * landing after a plugin toggled its items) resolves to nothing instead of to
 * whichever item now sits at the old index.
 */
export function itemByCommandId(menu: Menu | null, commandId: number) {
  const items = [...(menu?.items ?? [])];
  for (let item = items.pop(); item; item = items.pop()) {
    if (item.commandId === commandId) return item;
    if (item.submenu) items.push(...item.submenu.items);
  }
  return undefined;
}

/** The item with `commandId`, if it can be clicked (an enabled command rather than a submenu). */
export function clickableItem(menu: Menu | null, commandId: number) {
  const item = itemByCommandId(menu, commandId);
  if (!item || !item.enabled || item.submenu) return;
  return item;
}
