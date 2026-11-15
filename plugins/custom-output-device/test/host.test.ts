import type { PluginMenuItem } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import plugin from "../index.ts";

/** The parts of a host context the menu item and the settings action touch. */
function host() {
  const items: PluginMenuItem[] = [];
  const emitted: string[] = [];
  const ctx = {
    addMenuItem(item: PluginMenuItem) {
      items.push(item);
    },
    emit(event: string) {
      emitted.push(event);
    },
    t(_key: string, fallback?: string) {
      return fallback ?? _key;
    },
  };
  return { ctx, items, emitted };
}

interface HostParts {
  start(ctx: unknown): unknown;
  commands: { chooseDevice(this: unknown): void };
}

const parts = plugin.host as unknown as HostParts;

describe("the app-menu device selector", () => {
  it("appears under Options and asks the page to open the picker", () => {
    const app = host();
    parts.start(app.ctx);
    expect(app.items).toHaveLength(1);
    expect(app.items[0]?.label).toBe("Select Device");
    app.items[0]?.click();
    expect(app.emitted).toEqual(["open-output-picker"]);
  });

  it("exposes the settings action as a host command", () => {
    const app = host();
    parts.commands.chooseDevice.call(app.ctx);
    expect(app.emitted).toEqual(["open-output-picker"]);
  });

  it("declares the settings button that runs the command", () => {
    expect(plugin.actions?.chooseDevice?.label).toBe("Choose output device…");
  });
});
