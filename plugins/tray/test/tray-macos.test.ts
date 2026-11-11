// macOS-only tray behaviour: the hidden start leaves no Dock icon, and the
// double-click events are ignored in favour of individual clicks.

import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { FakeTray, images, menuTemplates, trays } from "./fake-electron.ts";
import { fakeContext, FakeWindow } from "./harness.ts";

vi.mock("electron", () => import("./fake-electron.ts"));
vi.mock("@pear/sdk/icon", () => import("./fake-icons.ts"));

// Read at import time by the plugin, so it must be set before the import.
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
afterAll(() => Object.defineProperty(process, "platform", platform));

const trayPlugin = (await import("../index.ts")).default;

function start(options: Parameters<typeof fakeContext>[0] = {}) {
  const harness = fakeContext(options);
  const returned = trayPlugin.host!.start!(harness.ctx as never);
  const cleanup = returned as unknown as () => void;
  return {
    ...harness,
    tray: FakeTray.last()!,
    stop: () => {
      cleanup();
      harness.stop();
    },
  };
}

beforeEach(() => {
  trays.length = 0;
  menuTemplates.length = 0;
  images.length = 0;
});

describe("macOS", () => {
  test("a hidden start leaves no Dock icon", () => {
    const { app, tray, stop } = start({ core: { appVisible: false }, window: new FakeWindow(false) });
    expect(app.dock.hide).toHaveBeenCalledOnce();
    expect(tray.ignoresDoubleClickEvents).toBe(true);
    stop();
  });

  test("a visible start keeps the Dock icon", () => {
    const { app, stop } = start({ core: { appVisible: true } });
    expect(app.dock.hide).not.toHaveBeenCalled();
    stop();
  });

  test("tray icons are template images unless Music's logo is used", () => {
    const { core, stop } = start();
    expect(images.length).toBe(2);
    expect(images.every((image) => image.templateImage)).toBe(true);

    core.appearance.useYtmIcons = true;
    trayPlugin.host!.commands!.refreshIcons();
    expect(images.slice(2).every((image) => !image.templateImage)).toBe(true);
    stop();
  });
});
