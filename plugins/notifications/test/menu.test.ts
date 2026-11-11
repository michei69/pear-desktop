import { describe, expect, test, vi } from "vitest";
import { menuTemplate } from "../menu.ts";
import { schema, type Ctx } from "../schema.ts";

vi.mock("electron", () => ({ Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) } }));

const defaults = Object.fromEntries(Object.entries(schema).map(([key, field]) => [key, field.default]));

function fakeContext(overrides: Partial<typeof defaults> = {}) {
  const ctx = {
    config: { ...defaults, ...overrides },
    setConfig: vi.fn(),
    t: (_key: string, fallback?: string) => fallback ?? _key,
  };
  return ctx as unknown as Ctx;
}

type Item = ReturnType<typeof menuTemplate>[number];
const labels = (items: Item[]) => items.map((item) => item.label);
const item = (items: Item[], label: string) => {
  const found = items.find((entry) => entry.label === label);
  if (!found) throw new Error(`no menu item labelled ${label}`);
  return found;
};
const click = (entry: Item, checked?: boolean) => (entry.click as (item: { checked: boolean }) => void)({ checked: checked ?? true });

describe("pear-desktop's Notifications menu", () => {
  test("Linux: the priority radios set the urgency", () => {
    const ctx = fakeContext();
    const items = menuTemplate(ctx, "linux");
    const priority = item(items, "Notification Priority");
    const radios = priority.submenu as Item[];
    expect(radios.map((entry) => entry.type)).toEqual(["radio", "radio", "radio"]);
    expect(item(radios, "Normal").checked).toBe(true);
    click(item(radios, "High"));
    expect(vi.mocked(ctx.setConfig)).toHaveBeenCalledWith({ urgency: "critical" });
    expect(labels(items)).toEqual(["Notification Priority", "Show notification on unpause"]);
  });

  test("Windows: the interactive switches, toast styles and resume switch", () => {
    const ctx = fakeContext();
    const items = menuTemplate(ctx, "win32");
    expect(labels(items)).toEqual(["Interactive Notifications", "Interactive Settings", "Toast style", "Show notification on unpause"]);
    expect(item(items, "Interactive Notifications").checked).toBe(true);

    const switches = item(items, "Interactive Settings").submenu as Item[];
    expect(labels(switches)).toEqual([
      "Hide button text",
      "Refresh on Play/Pause",
      "Open/Close on tray click",
      "Show mini-player on tray hover",
    ]);
    expect(switches.every((entry) => entry.type === "checkbox")).toBe(true);
    expect(item(switches, "Open/Close on tray click").checked).toBe(false);
    click(item(switches, "Hide button text"));
    expect(vi.mocked(ctx.setConfig)).toHaveBeenCalledWith({ hideButtonText: true });

    const styles = item(items, "Toast style").submenu as Item[];
    expect(styles.map((entry) => entry.type)).toEqual(Array.from({ length: 7 }, () => "radio"));
    expect(item(styles, "Logo").checked).toBe(true);
    click(item(styles, "Hero"));
    expect(vi.mocked(ctx.setConfig)).toHaveBeenCalledWith({ toastStyle: "hero" });

    expect(item(items, "Show notification on unpause").checked).toBe(false);
    click(item(items, "Show notification on unpause"));
    expect(vi.mocked(ctx.setConfig)).toHaveBeenCalledWith({ unpauseNotification: true });
  });

  test("macOS only gets the shared resume switch, as pear-desktop's menu did", () => {
    expect(labels(menuTemplate(fakeContext(), "darwin"))).toEqual(["Show notification on unpause"]);
  });
});
