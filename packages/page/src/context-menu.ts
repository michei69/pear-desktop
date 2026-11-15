// Appearance -> Context menu: leave entries out of Music's three-dot
// menus. The menus are server-driven, and every entry's kind, endpoints and
// icon say what it does (see @pear/sdk/context-menu); the switches are the
// appearance section's `contextMenu<Entry>` options.
//
// All menu renderers share one popup element, and replacing its `data.items`
// through the element's own accessor re-stamps the list before it is shown:
// no DOM patching, no flicker, and the listbox never sees the hidden entries.
// Re-filtering on mutation handles the popup being reused for the next menu.

import { CONTEXT_MENU_ENTRIES, hideMenuEntries, type MenuItemData } from "@pear/sdk/context-menu";

type MenuPopupElement = HTMLElement & {
  data?: { items?: MenuItemData[] };
};

/** The popup's own data accessor, which re-renders the items. */
const replacePopupData = (popup: MenuPopupElement, data: { items: MenuItemData[] }): boolean => {
  let prototype = Object.getPrototypeOf(popup) as object | null;
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "data");
    if (descriptor?.set) {
      descriptor.set.call(popup, data);
      return true;
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return false;
};

export class ContextMenuCustomizer {
  /** The entry keys the appearance options hide. */
  #hidden: string[] = [];
  #observer: MutationObserver | undefined;
  #popups = new Map<MenuPopupElement, MutationObserver>();

  constructor() {
    this.#watchForPopups();
  }

  /** The entry keys `config` hides: one `contextMenu<Entry>` switch per entry. */
  apply(config: Record<string, unknown>) {
    this.#hidden = CONTEXT_MENU_ENTRIES.filter((entry) => config[entry.configKey] === true).map((entry) => entry.key);
  }

  /** Popup elements are created once, so they are watched as they appear. */
  #watchForPopups() {
    for (const popup of document.querySelectorAll<MenuPopupElement>("ytmusic-menu-popup-renderer")) this.#watchPopup(popup);
    this.#observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const element = node as Element;
          if (element.matches("ytmusic-menu-popup-renderer")) this.#watchPopup(element as MenuPopupElement);
          for (const popup of element.querySelectorAll<MenuPopupElement>("ytmusic-menu-popup-renderer")) this.#watchPopup(popup);
        }
      }
    });
    // The Document node: the runtime may run before its documentElement exists.
    this.#observer.observe(document, { childList: true, subtree: true });
  }

  #watchPopup(popup: MenuPopupElement) {
    if (this.#popups.has(popup)) return;
    const observer = new MutationObserver(() => this.#filter(popup));
    observer.observe(popup, { childList: true, subtree: true });
    this.#popups.set(popup, observer);
    this.#filter(popup);
  }

  #filter(popup: MenuPopupElement) {
    const data = popup.data;
    const items = data?.items;
    if (!this.#hidden.length || !Array.isArray(items) || items.length === 0) return;
    const kept = hideMenuEntries(items, this.#hidden);
    // Only rewrite the data when something is hidden; otherwise leave the popup untouched.
    if (kept.length === items.length) return;
    replacePopupData(popup, { ...data, items: kept });
  }
}
