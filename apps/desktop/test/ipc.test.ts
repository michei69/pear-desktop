// The invoke channel: core writes answer with the core's outcome (the settings
// UI resets a refused control), plugin toggles follow restart-on-config-changes,
// and the settings surfaces' restart sessions are routed to the host's batch.

import { describe, expect, test, vi } from "vitest";
import { setupIpc, type IpcEnvironment } from "../src/main/ipc.ts";
import type { PageRequests } from "../src/main/page-requests.ts";
import type { PlayerMirror } from "../src/main/player.ts";
import type { PluginHost } from "../src/main/plugins.ts";
import type { RestartSessions } from "../src/main/settings-window.ts";
import type { Themes } from "../src/main/themes.ts";

const captured = vi.hoisted(() => ({
  invoke: undefined as ((event: unknown, name: unknown, args: unknown) => unknown) | undefined,
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0" },
  ipcMain: { handle: vi.fn((_channel, handler) => void (captured.invoke = handler)), on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { showItemInFolder: vi.fn(), openPath: async () => "", openExternal: async () => {} },
  net: {},
}));

interface Harness {
  env: IpcEnvironment;
  invoke: NonNullable<typeof captured.invoke>;
}

function setup(overrides: Partial<IpcEnvironment> = {}): Harness {
  const env = {
    plugins: { setEnabled: vi.fn(async () => {}) } as unknown as PluginHost,
    player: {} as PlayerMirror,
    requests: { respond: vi.fn() } as unknown as PageRequests,
    settingsPath: "/tmp/pear/config.json",
    onRuntimeBootstrap: vi.fn(),
    windowVisible: () => true,
    window: () => undefined,
    openSettingsWindow: vi.fn(),
    restarts: { open: vi.fn(), add: vi.fn(), close: vi.fn() } as unknown as RestartSessions,
    themes: {} as Themes,
    language: { fromYtm: async () => null, toYtm: async () => {} },
    core: { states: () => ({}) as never, setConfig: vi.fn(() => false) },
    restartOnConfigChanges: () => false,
    restart: vi.fn(),
    ...overrides,
  } satisfies IpcEnvironment;
  setupIpc(env);
  return { env, invoke: captured.invoke! };
}

/** A trusted YTM page frame, with a window WebContents that can go away. */
function event() {
  return {
    senderFrame: { url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/", parent: null },
    sender: { id: 7, once: vi.fn(), off: vi.fn() },
  };
}

describe("the invoke channel", () => {
  test("core:set-config answers with the core's outcome, so a refused write is visible", async () => {
    const setConfig = vi.fn(() => false);
    const { invoke } = setup({ core: { states: () => ({}) as never, setConfig } });

    await expect(invoke(event(), "core:set-config", ["advanced", { restartOnConfigChanges: true }])).resolves.toBe(false);
    expect(setConfig).toHaveBeenCalledWith("advanced", { restartOnConfigChanges: true });
  });

  test("enabling a plugin restarts only while restart-on-config-changes is on", async () => {
    const setEnabled = vi.fn(async () => {});
    const restart = vi.fn();
    const plugins = { setEnabled } as unknown as PluginHost;
    const off = setup({ plugins, restart });
    await off.invoke(event(), "plugin:set-enabled", ["clock", true]);
    expect(setEnabled).toHaveBeenCalledWith("clock", true);
    expect(restart).not.toHaveBeenCalled();

    const on = setup({ plugins, restart, restartOnConfigChanges: () => true });
    await on.invoke(event(), "plugin:set-enabled", ["clock", false]);
    expect(setEnabled).toHaveBeenCalledWith("clock", false);
    expect(restart).toHaveBeenCalledOnce();
  });

  test("the restart sessions are keyed by the sender window and end with it", () => {
    const restarts = { open: vi.fn(), add: vi.fn(), close: vi.fn() };
    const { invoke } = setup({ restarts: restarts as unknown as RestartSessions });
    const sender = event();
    const requirements = [{ key: "core:advanced.proxy", label: "Proxy" }];

    invoke(sender, "settings:restart-open", []);
    expect(restarts.open).toHaveBeenCalledWith(7);
    // A window can be destroyed before it closes its session.
    const destroyed = sender.sender.once.mock.calls[0]![1] as () => void;
    expect(sender.sender.once).toHaveBeenCalledWith("destroyed", destroyed);

    invoke(sender, "settings:restart-add", [requirements]);
    expect(restarts.add).toHaveBeenCalledWith(7, requirements);
    invoke(sender, "settings:restart-close", [requirements]);
    expect(restarts.close).toHaveBeenCalledWith(7, requirements);
    // The normal close removes the crash cleanup instead of leaving it behind.
    expect(sender.sender.off).toHaveBeenCalledWith("destroyed", destroyed);

    destroyed();
    expect(restarts.close).toHaveBeenLastCalledWith(7);
  });

  test("the standalone settings window may open a session too; other frames may not", () => {
    const restarts = { open: vi.fn(), add: vi.fn(), close: vi.fn() };
    const { invoke } = setup({ restarts: restarts as unknown as RestartSessions });

    invoke({ senderFrame: { url: "pear://settings/", parent: null }, sender: { id: 9, once: vi.fn() } }, "settings:restart-open", []);
    expect(restarts.open).toHaveBeenCalledWith(9);

    expect(() =>
      invoke({ senderFrame: { url: "https://example.com/", parent: null }, sender: { id: 9, once: vi.fn() } }, "settings:restart-open", []),
    ).toThrow(/untrusted frame/);
    expect(restarts.open).toHaveBeenCalledTimes(1);
  });
});
