import { defaultsOf } from "@pear/sdk";
import { beforeEach, describe, expect, test, vi } from "vitest";
import plugin from "../index.ts";

const electron = vi.hoisted(() => ({
  register: vi.fn((_accelerator: string, _callback: () => void): boolean => true),
  unregister: vi.fn((_accelerator: string): void => {}),
}));

vi.mock("electron", () => ({ globalShortcut: { register: electron.register, unregister: electron.unregister } }));

type HostStart = NonNullable<NonNullable<typeof plugin.host>["start"]>;
type Ctx = Parameters<HostStart>[0];
type Config = Ctx["config"];

/** The parts of a host context the plugin uses, recording what it registers. */
function makeContext(patch: Partial<Config> = {}) {
  const cleanups: (() => void)[] = [];
  const menuItems: { label: string; click(): void }[] = [];
  const listeners: { type: string; listener: (event: Electron.Event, input: Electron.Input) => void }[] = [];
  const player = { state: { volume: 50 }, control: vi.fn() };
  const setStatus = vi.fn();
  const openSettings = vi.fn();
  const focusWindow = vi.fn();
  const ctx = {
    config: { ...defaultsOf(plugin.config!), ...patch },
    player,
    setStatus,
    openSettings,
    focusWindow,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    t: (_key: string, fallback = "", vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars?.[name] ?? "")),
    onCleanup: (cleanup: () => void) => void cleanups.push(cleanup),
    listen: (_target: unknown, type: string, listener: (event: Electron.Event, input: Electron.Input) => void) =>
      void listeners.push({ type, listener }),
    addMenuItem: (item: { label: string; click(): void }) => void menuItems.push(item),
    window: { webContents: {} },
  } as unknown as Ctx;
  return { ctx, cleanups, menuItems, listeners, player, setStatus, openSettings, focusWindow };
}

/** The action a registered accelerator runs. */
function accelerator(accelerator: string) {
  const call = electron.register.mock.calls.find(([registered]) => registered === accelerator);
  if (!call) throw new Error(`"${accelerator}" was not registered`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  electron.register.mockImplementation(() => true);
});

const start = plugin.host!.start!;

describe("global shortcuts", () => {
  test("the like and dislike keys run the player's rating actions", () => {
    const { ctx, player } = makeContext({ like: "Ctrl+L", dislike: "Ctrl+D" });
    start(ctx);
    accelerator("Ctrl+L")();
    expect(player.control).toHaveBeenLastCalledWith({ type: "like" });
    accelerator("Ctrl+D")();
    expect(player.control).toHaveBeenLastCalledWith({ type: "dislike" });
  });

  test("the volume keys step from the host's volume", () => {
    const { ctx, player } = makeContext({ volumeUp: "Ctrl+Up", volumeDown: "Ctrl+Down" });
    start(ctx);
    accelerator("Ctrl+Up")();
    expect(player.control).toHaveBeenLastCalledWith({ type: "volume", value: 55 });
    accelerator("Ctrl+Down")();
    expect(player.control).toHaveBeenLastCalledWith({ type: "volume", value: 45 });
  });

  test("taking over the media keys registers them", () => {
    const { ctx } = makeContext({ overrideMediaKeys: true });
    start(ctx);
    expect(electron.register.mock.calls.map(([registered]) => registered)).toEqual([
      "MediaPlayPause",
      "MediaNextTrack",
      "MediaPreviousTrack",
    ]);
  });

  test("an accelerator another app owns is reported, and the rest keep working", () => {
    electron.register.mockImplementation((registered) => registered !== "Ctrl+N");
    const { ctx, cleanups, listeners, player, setStatus } = makeContext({ playPause: "Ctrl+P", next: "Ctrl+N" });
    expect(() => start(ctx)).not.toThrow();
    expect(setStatus).toHaveBeenCalledOnce();
    expect(setStatus.mock.calls[0]![0]).toContain("Ctrl+N");
    // The successful one is registered and will be released on stop.
    accelerator("Ctrl+P")();
    expect(player.control).toHaveBeenCalledWith({ type: "toggle" });
    expect(cleanups).toHaveLength(1);
    // In-window shortcuts stay installed either way.
    expect(listeners.filter((entry) => entry.type === "before-input-event")).toHaveLength(1);
  });

  test("when no accelerator can be registered at all, the failure is still reported", () => {
    electron.register.mockImplementation(() => false);
    const { ctx, setStatus } = makeContext({ next: "Ctrl+N" });
    expect(() => start(ctx)).toThrow(/couldn't register Ctrl\+N/);
    expect(setStatus).toHaveBeenCalledOnce();
  });
});

describe("in-window shortcuts", () => {
  test("match only while the window is focused and run the action", () => {
    const { ctx, listeners, player } = makeContext({ localLike: "Ctrl+Alt+L" });
    start(ctx);
    const onInput = listeners.find((entry) => entry.type === "before-input-event")!.listener;
    const event = { preventDefault: vi.fn() } as unknown as Electron.Event;
    onInput(event, {
      type: "keyDown",
      key: "l",
      code: "KeyL",
      control: true,
      alt: true,
      shift: false,
      meta: false,
    } as Electron.Input);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(player.control).toHaveBeenCalledWith({ type: "like" });
  });
});

describe("app menu", () => {
  test("the item opens the settings card that holds the recorders", () => {
    const { ctx, menuItems, openSettings } = makeContext();
    start(ctx);
    expect(menuItems.map((item) => item.label)).toEqual(["Shortcut settings…"]);
    menuItems[0]!.click();
    expect(openSettings).toHaveBeenCalledOnce();
  });
});
