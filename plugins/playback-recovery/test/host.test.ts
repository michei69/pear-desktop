import { describe, expect, test, vi } from "vitest";
import plugin from "../index.ts";

function makeContext(logToConsole = true) {
  const menuItems: { label: string; click(): void }[] = [];
  const setConfig = vi.fn();
  const ctx = {
    config: { stallTimeoutMs: 8000, maxRetries: 5, logToConsole },
    setConfig,
    addMenuItem: (item: { label: string; click(): void }) => void menuItems.push(item),
    t: (_key: string, fallback?: string) => fallback ?? _key,
  };
  return { ctx, menuItems, setConfig };
}

describe("the Playback recovery menu", () => {
  test("the Options item toggles console logging", async () => {
    const { ctx, menuItems, setConfig } = makeContext();

    await plugin.host!.start!(ctx as never);

    expect(menuItems.map((item) => item.label)).toEqual(["Log recovery events to console"]);
    menuItems[0]!.click();
    expect(setConfig).toHaveBeenCalledWith({ logToConsole: false });
  });
});
