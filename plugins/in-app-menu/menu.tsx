/** @jsxImportSource @pear/sdk */
// The menu: a trigger in the top bar's left corner opening the application menu, its
// submenus cascading from it.

import { Icon, isolateKeys, shadowHost } from "@pear/sdk/dom";
import { handlePanelKey, isMenuKey, opensSubmenu } from "./keyboard.ts";
import { belowTrigger, besideItem, placePanel } from "./position.ts";
import { shadowStyles } from "./styles.ts";
import { ICONS, type MenuNode } from "./types.ts";
import type { Ctx } from "./page.ts";

/** The native tooltip exists only while the item is hovered, so it costs nothing on a closed menu. */
function attachTooltip(item: HTMLButtonElement, text: string) {
  item.addEventListener("pointerenter", () => {
    item.title = text;
  });
  const clear = () => item.removeAttribute("title");
  item.addEventListener("pointerleave", clear);
  item.addEventListener("blur", clear);
}

const ROLES: Record<MenuNode["kind"], string> = {
  normal: "menuitem",
  submenu: "menuitem",
  checkbox: "menuitemcheckbox",
  radio: "menuitemradio",
  separator: "separator",
};

interface Panel {
  element: HTMLElement;
  items: HTMLButtonElement[];
  /** What the panel was drawn from, to tell whether a refreshed menu still has the same panel. */
  nodes: MenuNode[];
  /** Where the panel's nodes sit in the serialized menu (indices from the root), to redraw it in place. */
  trail: number[];
  /** The item that opened this submenu. */
  owner?: HTMLButtonElement;
  /** Moves the panel back to its trigger or item (window resize, a scrolled parent). */
  place(): void;
}

/** The nodes at `trail` in a serialized menu; the empty trail is the menu itself. */
function nodesAt(tree: MenuNode[], trail: number[]): MenuNode[] | undefined {
  let nodes = tree;
  for (const index of trail) {
    const node = nodes[index];
    if (!node?.children) return undefined;
    nodes = node.children;
  }
  return nodes;
}

/** Whether the same items are still in the same places (a rebuilt menu has new ids, so kind and label stand in). */
function sameItems(drawn: MenuNode[], fresh: MenuNode[]) {
  return (
    drawn.length === fresh.length &&
    drawn.every((node, index) => {
      const other = fresh[index];
      return other !== undefined && node.kind === other.kind && node.label === other.label;
    })
  );
}

export class AppMenu {
  readonly host: HTMLElement;
  readonly #ctx: Ctx;
  readonly #root: ShadowRoot;
  readonly #trigger: HTMLButtonElement;
  /** Open panels, outermost first. */
  #panels: Panel[] = [];

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    const { host, root } = shadowHost("pear-app-menu", shadowStyles);
    this.host = host;
    this.#root = root;
    const label = ctx.t("plugins.in-app-menu.menu.application-menu", "Application menu");
    this.#trigger = (
      <button
        type="button"
        class="trigger"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded="false"
        onClick={() => this.toggle(false)}
      >
        <Icon path={ICONS.menu} />
      </button>
    ) as HTMLButtonElement;
    root.append(this.#trigger);
    ctx.onCleanup(() => host.remove());
    this.#listen();
  }

  #listen() {
    const ctx = this.#ctx;
    // Keep YTM's own shortcuts (space, j/k…) out of the menu.
    isolateKeys(this.host, ctx.signal);
    ctx.listen(document, "pointerdown", (event: PointerEvent) => {
      if (!event.composedPath().includes(this.host)) this.close();
    });
    ctx.listen(window, "blur", () => this.close());
    // Panels stay anchored to their trigger or item, as floating-ui's autoUpdate did.
    ctx.listen(window, "resize", () => this.#placeAll());
    // The menu can be rebuilt under an open panel (a plugin toggled its items, a language change).
    ctx.host.on("menu-changed", () => void this.#refreshOpen());
    const onKeydown = (event: KeyboardEvent) => {
      if (!isMenuKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggle(true);
    };
    ctx.listen(window, "keydown", onKeydown, { capture: true });
  }

  toggle(focusFirst: boolean) {
    if (this.#panels.length === 0) void this.open(focusFirst);
    else this.close();
  }

  async open(focusFirst: boolean) {
    const nodes = await this.#ctx.host.invoke("menu");
    const { items } = this.#openPanel(nodes, [], 0);
    this.#trigger.setAttribute("aria-expanded", "true");
    if (focusFirst) items.find((item) => !item.disabled)?.focus();
  }

  close() {
    this.#closeFrom(0);
  }

  #placeAll() {
    for (const panel of this.#panels) panel.place();
  }

  /** Closes the panels from `level` in. */
  #closeFrom(level: number) {
    for (const panel of this.#panels.splice(level)) {
      panel.element.remove();
      panel.owner?.setAttribute("aria-expanded", "false");
    }
    if (this.#panels.length === 0) this.#trigger.setAttribute("aria-expanded", "false");
  }

  #openPanel(nodes: MenuNode[], trail: number[], level: number, owner?: HTMLButtonElement): Panel {
    this.#closeFrom(level);
    const panel: Panel = {
      element: (
        <div class="panel" role="menu" aria-label={owner?.dataset.label} onKeydown={(event) => this.#onPanelKey(event, panel, level)} />
      ) as HTMLElement,
      items: [],
      nodes: [],
      trail,
      place: () => {},
    };
    if (owner) panel.owner = owner;
    const anchor = () => (panel.owner ? besideItem(panel.owner) : belowTrigger(this.#trigger));
    panel.place = () => placePanel(panel.element, anchor(), panel.owner);
    // A panel scrolls now that long menus are capped to the window: submenus follow their item.
    panel.element.addEventListener("scroll", () => this.#panels[level + 1]?.place(), { passive: true });
    this.#root.append(panel.element);
    this.#panels[level] = panel;
    this.#fill(panel, nodes, level);
    return panel;
  }

  /** Draws `nodes` into `panel` (same trail), keeping the item that had focus when it is redrawn. */
  #fill(panel: Panel, nodes: MenuNode[], level: number) {
    const focused = this.#root.activeElement;
    const index = focused ? panel.items.indexOf(focused as HTMLButtonElement) : -1;
    const children = nodes.map((node, nodeIndex) => this.#entry(node, [...panel.trail, nodeIndex], level));
    panel.items = children.filter((child): child is HTMLButtonElement => child instanceof HTMLButtonElement);
    panel.nodes = nodes;
    panel.element.replaceChildren(...children);
    panel.place();
    panel.items[index]?.focus();
  }

  #onPanelKey(event: KeyboardEvent, panel: Panel, level: number) {
    const { owner } = panel;
    const back = () => {
      this.#closeFrom(level);
      owner?.focus();
    };
    const handled = handlePanelKey(event.key, {
      items: panel.items,
      active: this.#root.activeElement,
      back: owner ? back : undefined,
      close: () => {
        this.close();
        this.#trigger.focus();
      },
    });
    if (handled) event.preventDefault();
  }

  #entry(node: MenuNode, path: number[], level: number) {
    if (node.kind === "separator") return <div class="separator" role="separator" />;
    const checkable = node.kind === "checkbox" || node.kind === "radio";
    const item = (
      <button
        class="item"
        tabIndex={-1}
        disabled={!node.enabled}
        data-label={node.label}
        role={ROLES[node.kind]}
        aria-checked={checkable ? node.checked : undefined}
      >
        <Icon path={ICONS.check} />
        <span class="label">
          {node.label}
          {node.sublabel ? <small>{node.sublabel}</small> : null}
        </span>
        {node.children ? <Icon path={ICONS.submenu} /> : <kbd>{node.accelerator}</kbd>}
      </button>
    ) as HTMLButtonElement;
    if (node.toolTip) attachTooltip(item, node.toolTip);
    if (node.children) this.#submenuItem(item, node.children, path, level);
    else this.#commandItem(item, node, level);
    return item;
  }

  #submenuItem(item: HTMLButtonElement, children: MenuNode[], path: number[], level: number) {
    item.setAttribute("aria-haspopup", "menu");
    item.setAttribute("aria-expanded", "false");
    const openChild = (focus: boolean) => {
      this.#openPanel(children, path, level + 1, item);
      item.setAttribute("aria-expanded", "true");
      if (focus) this.#panels[level + 1]?.items[0]?.focus();
    };
    item.addEventListener("click", () => openChild(false));
    item.addEventListener("pointerenter", () => {
      if (item.getAttribute("aria-expanded") !== "true") openChild(false);
    });
    item.addEventListener("keydown", (event) => {
      if (!opensSubmenu(event)) return;
      event.preventDefault();
      event.stopPropagation();
      openChild(true);
    });
  }

  #commandItem(item: HTMLButtonElement, node: MenuNode, level: number) {
    item.addEventListener("pointerenter", () => this.#closeFrom(level + 1));
    item.addEventListener("click", () => void this.#activate(node, level));
  }

  /**
   * Runs the item's command. A checkbox or radio stays open with its new mark, as in
   * pear-desktop; a command closes the menu so the page it opened is in front.
   */
  async #activate(node: MenuNode, level: number) {
    const checkable = node.kind === "checkbox" || node.kind === "radio";
    if (!checkable) this.close();
    await this.#ctx.host.invoke("clickMenu", node.commandId);
    if (!checkable || !this.#panels[level]) return;
    // Electron flips the mark on the item itself, without rebuilding the menu.
    this.#refresh(level, await this.#ctx.host.invoke("menu"));
  }

  /** Redraws the panel at `level` from `tree`; closes it when its part of the menu changed shape. */
  #refresh(level: number, tree: MenuNode[]) {
    const panel = this.#panels[level];
    // A submenu opened from this panel meanwhile would be left under replaced items.
    if (!panel || this.#panels.length > level + 1) return;
    const nodes = nodesAt(tree, panel.trail);
    if (!nodes || !sameItems(panel.nodes, nodes)) {
      this.#closeFrom(level);
      return;
    }
    this.#fill(panel, nodes, level);
  }

  /** Redraws the innermost open panel after the menu changed (the outer ones close with it). */
  async #refreshOpen() {
    const level = this.#panels.length - 1;
    if (level < 0) return;
    this.#refresh(level, await this.#ctx.host.invoke("menu"));
  }
}
