import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Menu, type MenuItemConstructorOptions, shell } from "electron";
import { afterAll, describe, expect, test, vi } from "vitest";
import { showLocalLists, showMenu } from "../menu.ts";

vi.mock("electron", () => {
  const popup = vi.fn();
  return { Menu: { buildFromTemplate: vi.fn(() => ({ popup })) }, shell: { openPath: vi.fn() } };
});

const root = mkdtempSync(join(tmpdir(), "pear-dnt-menu-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const lists = join(root, "blocklists");
mkdirSync(lists);
writeFileSync(join(lists, "a.txt"), "||a.example^");
writeFileSync(join(lists, "b.txt"), "||b.example^");

function fakeContext(disabled: string[] = [], blocker = "Balanced") {
  const config = { blocker, customEnabled: true, disabledLocalBlockLists: disabled };
  const setConfig = vi.fn();
  const ctx = {
    app: { getPath: () => root },
    window: { isDestroyed: () => false, isVisible: () => true },
    config,
    setConfig,
    t: (_key: string, fallback?: string) => fallback ?? _key,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { ctx, setConfig };
}

/** The template handed to Menu.buildFromTemplate by the latest popup. */
async function template(context: unknown, show: (ctx: never) => void) {
  vi.mocked(Menu.buildFromTemplate).mockClear();
  show(context as never);
  await vi.waitFor(() => expect(Menu.buildFromTemplate).toHaveBeenCalledOnce());
  return vi.mocked(Menu.buildFromTemplate).mock.calls[0]![0] as MenuItemConstructorOptions[];
}

const item = (items: MenuItemConstructorOptions[], label: string) => {
  const found = items.find((entry) => entry.label === label);
  if (!found) throw new Error(`no menu item labelled ${label}`);
  return found;
};

describe("the Do Not Track menu", () => {
  test("offers the profiles, checked at the current one", async () => {
    const { ctx, setConfig } = fakeContext();
    const items = await template(ctx, showMenu);
    expect(items.filter((entry) => entry.type === "radio").map((entry) => entry.label)).toEqual(["Lite", "Balanced", "Strict"]);
    expect(item(items, "Balanced").checked).toBe(true);
    item(items, "Lite").click!({} as never, undefined, {} as never);
    expect(setConfig).toHaveBeenCalledWith({ blocker: "Lite" });
  });

  test("lists the blocklist files and toggles them", async () => {
    const { ctx, setConfig } = fakeContext(["b.txt"]);
    const items = await template(ctx, showLocalLists);
    expect(item(items, "a.txt")).toMatchObject({ type: "checkbox", checked: true });
    expect(item(items, "b.txt")).toMatchObject({ type: "checkbox", checked: false });
    item(items, "a.txt").click!({} as never, undefined, {} as never);
    expect(setConfig).toHaveBeenCalledWith({ disabledLocalBlockLists: ["b.txt", "a.txt"] });
    expect(item(items, "Use custom lists and rules").checked).toBe(true);
  });

  test("opens the blocklists folder", async () => {
    const { ctx } = fakeContext();
    const items = await template(ctx, showLocalLists);
    item(items, "Open the blocklists folder").click!({} as never, undefined, {} as never);
    expect(shell.openPath).toHaveBeenCalledWith(join(root, "blocklists"));
  });
});
