import { describe, expect, test, vi } from "vitest";
import plugin from "../index.ts";

interface TestConfig {
  opacity: number;
  type: "none" | "mica" | "window";
}

function fakeWindow() {
  const calls: string[] = [];
  return {
    calls,
    isDestroyed: () => false,
    setBackgroundMaterial: vi.fn((material: string) => void calls.push(`material:${material}`)),
    setVibrancy: vi.fn((vibrancy: string | null) => void calls.push(`vibrancy:${vibrancy}`)),
    setBackgroundColor: vi.fn((color: string) => void calls.push(`background:${color}`)),
  };
}

function makeContext(config: TestConfig) {
  const cleanups: (() => void)[] = [];
  const menuItems: { label: string; click(): void }[] = [];
  const openSettings = vi.fn();
  const window = fakeWindow();
  const ctx = {
    config,
    window,
    addMenuItem: (item: { label: string; click(): void }) => void menuItems.push(item),
    openSettings,
    t: (_key: string, fallback?: string) => fallback ?? _key,
    onCleanup: (fn: () => void) => void cleanups.push(fn),
  };
  return { ctx, window, cleanups, menuItems, openSettings };
}

describe("Transparent player plugin", () => {
  test("is only offered where transparent windows are supported", () => {
    expect(plugin.platforms).toEqual(["win32", "darwin"]);
    // No constructor transparency and no pre-ready compositing switches: the
    // material and the tint are applied live.
    expect(plugin.host?.windowOptions).toBeUndefined();
    expect(plugin.host?.beforeReady).toBeUndefined();
  });

  test("the opacity slider cannot hide the page completely", () => {
    expect(plugin.config?.opacity).toMatchObject({
      default: 50,
      min: 10,
      max: 100,
      step: 5,
      description: "How much of the desktop shows through the window",
    });
  });

  test("applies the tint at start, on config change and resets on stop", () => {
    const { ctx, window, cleanups } = makeContext({ opacity: 50, type: "none" });
    plugin.host!.start!(ctx as never);
    expect(window.calls).toEqual(["background:rgba(0, 0, 0, 0.5)"]);

    plugin.host!.onConfigChange!({ opacity: 80, type: "none" }, ctx as never);
    expect(window.calls.at(-1)).toBe("background:rgba(0, 0, 0, 0.8)");

    for (const cleanup of cleanups) cleanup();
    expect(window.calls.at(-1)).toBe("background:#030303");
  });

  test("offers a settings item in the app menu", () => {
    const { ctx, menuItems, openSettings } = makeContext({ opacity: 50, type: "none" });
    plugin.host!.start!(ctx as never);
    expect(menuItems).toHaveLength(1);
    expect(menuItems[0]!.label).toBe("Transparent player settings…");
    menuItems[0]!.click();
    expect(openSettings).toHaveBeenCalledOnce();
  });

  test("the page slider updates its stylesheet instead of restarting", () => {
    const updates: string[] = [];
    let listener: ((config: TestConfig) => void) | undefined;
    const ctx = {
      config: { opacity: 50, type: "none" },
      addStyle: (css: string) => {
        updates.push(css);
        return { update: (next: string) => updates.push(next), remove: vi.fn() };
      },
      onConfigChange: (fn: (config: TestConfig) => void) => (listener = fn),
    };
    const page = plugin.page as { start(ctx: never): void };
    page.start(ctx as never);
    expect(updates[0]).toBe(":root{--pear-transparent-opacity:0.5}");
    listener!({ opacity: 80, type: "none" });
    expect(updates.at(-1)).toBe(":root{--pear-transparent-opacity:0.8}");
  });
});
