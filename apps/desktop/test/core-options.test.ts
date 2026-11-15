// CoreOptions.set: the settings dialog's write path, which reports a refused
// beta→stable switch instead of dropping it, and applies pear-desktop's
// "restart on config changes" option after every change.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { CoreOptions } from "../src/main/core-options.ts";
import { Settings } from "../src/main/config.ts";
import type { MainWindow } from "../src/main/main-window.ts";

const electron = vi.hoisted(() => ({ version: "4.0.0", dialogResponse: 1 }));

vi.mock("electron", () => ({
  app: { getVersion: () => electron.version, getPath: () => "/tmp/pear-core-options" },
  dialog: { showMessageBox: async () => ({ response: electron.dialogResponse }) },
  nativeImage: {
    createFromBuffer: () => ({ resize: () => ({ toBitmap: () => Buffer.alloc(0) }) }),
    createFromBitmap: () => ({}),
  },
  shell: {},
}));
// The live sections (core-options' apply()) reach the real window module; the refusal and
// restart logic needs none of it.
vi.mock("../src/main/main-window.ts", () => ({ windowTitle: () => "Title" }));

const profiles: { settings: Settings; dir: string }[] = [];
afterAll(() => {
  for (const { settings, dir } of profiles) {
    settings.flush();
    rmSync(dir, { recursive: true, force: true });
  }
});

function environment() {
  const dir = mkdtempSync(join(tmpdir(), "pear-core-options-"));
  const settings = new Settings(dir, [], "4.0.0");
  profiles.push({ settings, dir });
  const send = vi.fn();
  const restart = vi.fn();
  const updates = { channelChanged: vi.fn() };
  const refreshMenu = vi.fn();
  const core = new CoreOptions(
    settings,
    (_key, fallback) => fallback ?? "",
    { send, window: undefined } as unknown as MainWindow,
    () => {},
    { updates, refreshMenu, restart },
  );
  return { settings, core, send, restart, updates, refreshMenu };
}

beforeEach(() => {
  electron.version = "4.0.0";
  electron.dialogResponse = 1;
});

describe("a refused core write", () => {
  test("a declined beta→stable switch reports false and changes nothing", async () => {
    electron.version = "4.0.0-beta.4";
    electron.dialogResponse = 0; // Cancel in the downgrade warning.
    const { settings, core, send } = environment();
    settings.setCore("general", { updateChannel: "beta" });

    await expect(core.set("general", { updateChannel: "stable" })).resolves.toBe(false);
    expect(settings.core("general").updateChannel).toBe("beta");
    // No core-state event: the dialog keeps the value the store really holds.
    expect(send).not.toHaveBeenCalled();
  });

  test("a confirmed switch applies and reports true", async () => {
    electron.version = "4.0.0-beta.4";
    electron.dialogResponse = 1; // Switch to stable (the second button).
    const { settings, core, send } = environment();
    settings.setCore("general", { updateChannel: "beta" });

    await expect(core.set("general", { updateChannel: "stable" })).resolves.toBe(true);
    expect(settings.core("general").updateChannel).toBe("stable");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "core-state", section: "general" }));
  });

  test("only a beta build asks before switching a beta channel back to stable", async () => {
    const { settings, core } = environment();
    settings.setCore("general", { updateChannel: "beta" });

    // A release build has nothing newer to go back from; no dialog.
    await expect(core.set("general", { updateChannel: "stable" })).resolves.toBe(true);
    expect(settings.core("general").updateChannel).toBe("stable");
  });
});

describe("restart on config changes", () => {
  test("changes return true and do not restart while the option is off", async () => {
    const { core, restart, send } = environment();

    await expect(core.set("appearance", { removeUpgradeButton: true })).resolves.toBe(true);
    expect(restart).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  });

  test("every change relaunches the app while the option is on, the one turning it off does not", async () => {
    const { settings, core, restart } = environment();
    settings.setCore("advanced", { restartOnConfigChanges: true });

    await expect(core.set("general", { autoUpdates: false })).resolves.toBe(true);
    expect(restart).toHaveBeenCalledOnce();

    // Read after the write: the change that disables the option applies live instead.
    await expect(core.set("advanced", { restartOnConfigChanges: false })).resolves.toBe(true);
    expect(restart).toHaveBeenCalledOnce();
    expect(settings.core("advanced").restartOnConfigChanges).toBe(false);
  });
});
