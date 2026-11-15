import type { Menu, MenuItem } from "electron";
import { describe, expect, test } from "vitest";
import { clickableItem, itemByCommandId, serialize } from "../app-menu.ts";

interface FakeItem {
  commandId: number;
  label: string;
  type?: MenuItem["type"];
  visible?: boolean;
  enabled?: boolean;
  checked?: boolean;
  sublabel?: string;
  toolTip?: string;
  accelerator?: string;
  submenu?: { items: FakeItem[] };
}

/** What the host walks: the parts of an Electron Menu the serializer reads. */
const menu = (...items: FakeItem[]) => ({ items }) as unknown as Menu;

const item = (commandId: number, overrides: Partial<FakeItem> = {}): FakeItem => ({
  commandId,
  label: `item ${commandId}`,
  visible: true,
  enabled: true,
  checked: false,
  ...overrides,
});

describe("the menu the page draws", () => {
  test("carries each item's command id, kind and mark", () => {
    const nodes = serialize(
      menu(
        item(1, { label: "Play" }),
        item(2, { type: "checkbox", label: "Always on top", checked: true }),
        item(3, { type: "radio", label: "Theme A" }),
        item(4, { type: "separator", label: "" }),
        item(5, { label: "Plugins", submenu: { items: [item(6, { label: "Downloader" })] } }),
      ),
      false,
    );

    expect(nodes.map((node) => [node.commandId, node.kind, node.label, node.checked])).toEqual([
      [1, "normal", "Play", false],
      [2, "checkbox", "Always on top", true],
      [3, "radio", "Theme A", false],
      [4, "separator", "", false],
      [5, "submenu", "Plugins", false],
    ]);
    expect(nodes[4]?.children?.map((node) => [node.commandId, node.label])).toEqual([[6, "Downloader"]]);
  });

  test("skips the items Electron keeps hidden", () => {
    const nodes = serialize(menu(item(1, { label: "Shown" }), item(2, { label: "Hidden", visible: false })), false);
    expect(nodes.map((node) => node.label)).toEqual(["Shown"]);
  });

  test("drops the ampersand mnemonics and shows accelerators per platform", () => {
    const source = menu(item(1, { label: "&Plugins", accelerator: "CmdOrCtrl+Shift+I" }));
    expect(serialize(source, false)[0]).toMatchObject({ label: "Plugins", accelerator: "Ctrl+Shift+I" });
    expect(serialize(source, true)[0]).toMatchObject({ label: "Plugins", accelerator: "⌘⇧I" });
  });
});

describe("resolving a click", () => {
  test("finds an item by command id, submenus included", () => {
    const tree = menu(item(1), item(2, { submenu: { items: [item(3, { label: "Nested" })] } }));
    expect(itemByCommandId(tree, 3)?.label).toBe("Nested");
    expect(clickableItem(tree, 3)?.label).toBe("Nested");
  });

  test("a command id kept from an older menu clicks nothing", () => {
    // A rebuilt menu numbers its items afresh; the page's ids are the old ones.
    const rebuilt = menu(item(10, { label: "Zoom In" }), item(11, { label: "Zoom Out" }));
    expect(clickableItem(rebuilt, 3)).toBeUndefined();
  });

  test("submenus and disabled items are not commands", () => {
    const tree = menu(item(1, { submenu: { items: [item(2)] } }), item(3, { enabled: false }));
    expect(clickableItem(tree, 1)).toBeUndefined();
    expect(clickableItem(tree, 3)).toBeUndefined();
  });
});
