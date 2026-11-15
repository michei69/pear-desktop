import { defaultsOf, type HostContextOf } from "@pear/sdk";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { schema } from "../config.ts";
import { startHost } from "../host.ts";

const electron = vi.hoisted(() => ({
  register: vi.fn((_accelerator: string, _callback: () => void): boolean => true),
  unregister: vi.fn((_accelerator: string): void => {}),
}));

vi.mock("electron", () => ({ globalShortcut: { register: electron.register, unregister: electron.unregister } }));

type Ctx = HostContextOf<typeof schema>;
type Config = Ctx["config"];

/** The parts of a host context the plugin uses, recording what it registers. */
function makeContext(patch: Partial<Config> = {}) {
  const cleanups: (() => void)[] = [];
  const configChanges: ((config: Readonly<Config>) => void | "restart")[] = [];
  const menuItems: { label: string; click(): void }[] = [];
  const emit = vi.fn();
  const setConfig = vi.fn();
  const openSettings = vi.fn();
  const ctx = {
    config: { ...defaultsOf(schema), ...patch },
    emit,
    setConfig,
    openSettings,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    t: (_key: string, fallback = "") => fallback,
    onCleanup: (cleanup: () => void) => void cleanups.push(cleanup),
    onConfigChange: (listener: (config: Readonly<Config>) => void | "restart") => void configChanges.push(listener),
    addMenuItem: (item: { label: string; click(): void }) => void menuItems.push(item),
  } as unknown as Ctx;
  return { ctx, cleanups, configChanges, menuItems, emit, setConfig, openSettings };
}

beforeEach(() => {
  vi.clearAllMocks();
  electron.register.mockImplementation(() => true);
});

describe("global volume shortcuts", () => {
  test("registers both accelerators and releases them on stop", () => {
    const { ctx, cleanups } = makeContext({ volumeUp: "Ctrl+Up", volumeDown: "Ctrl+Down" });
    startHost(ctx);
    expect(electron.register.mock.calls.map(([accelerator]) => accelerator)).toEqual(["Ctrl+Up", "Ctrl+Down"]);
    for (const cleanup of cleanups) cleanup();
    expect(electron.unregister.mock.calls.map(([accelerator]) => accelerator)).toEqual(["Ctrl+Up", "Ctrl+Down"]);
  });

  test("the accelerators ask the page part for a step", () => {
    const { ctx, emit } = makeContext({ volumeUp: "Ctrl+Up", volumeDown: "Ctrl+Down" });
    startHost(ctx);
    electron.register.mock.calls[0]![1]();
    electron.register.mock.calls[1]![1]();
    expect(emit.mock.calls).toEqual([
      ["step", 1],
      ["step", -1],
    ]);
  });

  test("an unusable accelerator still fails the host part", () => {
    electron.register.mockImplementation((accelerator) => accelerator !== "Ctrl+Up");
    const { ctx, cleanups } = makeContext({ volumeUp: "Ctrl+Up" });
    expect(() => startHost(ctx)).toThrow(/couldn't register Ctrl\+Up/);
    expect(cleanups).toHaveLength(0);
  });
});

describe("config changes", () => {
  test("a saved-volume write is absorbed instead of restarting the host part", () => {
    const { ctx, configChanges } = makeContext({ volumeUp: "Ctrl+Up" });
    startHost(ctx);
    const change = configChanges[0]!;
    expect(change({ ...ctx.config, savedVolume: 42 })).toBeUndefined();
  });

  test("a changed or cleared shortcut restarts it, to register the new one", () => {
    const { ctx, configChanges } = makeContext({ volumeUp: "Ctrl+Up", volumeDown: "Ctrl+Down" });
    startHost(ctx);
    const change = configChanges[0]!;
    expect(change({ ...ctx.config, volumeUp: "Ctrl+Alt+Up" })).toBe("restart");
    expect(change({ ...ctx.config, volumeDown: "" })).toBe("restart");
  });
});

describe("app menu", () => {
  test("toggles the arrow-key option and opens the settings card", () => {
    const { ctx, menuItems, setConfig, openSettings } = makeContext();
    startHost(ctx);
    expect(menuItems.map((item) => item.label)).toEqual(["Arrow keys change volume", "Volume settings…"]);
    menuItems[0]!.click();
    expect(setConfig).toHaveBeenCalledWith({ arrowsShortcut: false });
    menuItems[1]!.click();
    expect(openSettings).toHaveBeenCalledOnce();
  });
});
