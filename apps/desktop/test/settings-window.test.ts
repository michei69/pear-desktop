// RestartSessions: the settings surfaces' restart-pending changes, batched
// across the overlay and the standalone window, and turned into one prompt.

import { translator } from "@pear/sdk/i18n";
import type { RestartRequirement } from "@pear/sdk/protocol";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { dialog } from "electron";
import { RestartSessions } from "../src/main/settings-window.ts";

const electron = vi.hoisted(() => ({ response: 1 }));

vi.mock("electron", () => ({
  dialog: { showMessageBox: vi.fn(async () => ({ response: electron.response })) },
  protocol: {},
}));

const showMessageBox = () => vi.mocked(dialog.showMessageBox);

function environment() {
  const restart = vi.fn();
  const sessions = new RestartSessions({ t: translator({}), window: () => undefined, restart });
  return { sessions, restart };
}

const requirement = (key: string, label: string): RestartRequirement => ({ key, label });

/** The options of the last prompt shown (the window is absent in these tests). */
function shownOptions(): Electron.MessageBoxOptions {
  const calls = showMessageBox().mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls.at(-1)![0] as Electron.MessageBoxOptions;
}

beforeEach(() => {
  electron.response = 1;
  showMessageBox().mockClear();
});

describe("RestartSessions", () => {
  test("batches every open surface and asks once the last one closes", async () => {
    const { sessions, restart } = environment();
    sessions.open(1);
    sessions.open(2);
    sessions.add(1, [requirement("core:advanced.proxy", "Proxy")]);
    sessions.add(2, [requirement("plugin:tray", "Tray icon")]);

    sessions.close(1);
    expect(showMessageBox()).not.toHaveBeenCalled();
    sessions.close(2);
    await vi.waitFor(() => expect(showMessageBox()).toHaveBeenCalledOnce());

    const options = shownOptions();
    expect(options.title).toBe("Restart Required");
    expect(options.detail).toContain("Proxy, Tray icon");
    // "Later": nothing restarts.
    expect(restart).not.toHaveBeenCalled();
  });

  test("restarts when the user picks Restart Now", async () => {
    electron.response = 0;
    const { sessions, restart } = environment();
    sessions.open(1);
    sessions.add(1, [requirement("core:advanced.autoResetAppCache", "Clear the cache at startup")]);
    sessions.close(1);

    await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
  });

  test("a requirement added and replaced under the same key is listed once", async () => {
    const { sessions } = environment();
    sessions.open(1);
    sessions.add(1, [requirement("plugin:clock", "Clock")]);
    sessions.add(1, [requirement("plugin:clock", "Clock (renamed)")]);
    sessions.close(1);

    await vi.waitFor(() => expect(showMessageBox()).toHaveBeenCalledOnce());
    expect(shownOptions().detail).toBe("Restart the app to apply: Clock (renamed)");
  });

  test("requirements survive a window that closes its session without them", async () => {
    const { sessions } = environment();
    sessions.open(1);
    sessions.add(1, [requirement("core:advanced.disableHardwareAcceleration", "Disable hardware acceleration")]);
    // A crash or app quit: the session ends with no final list; what was added still counts.
    sessions.close(1);

    await vi.waitFor(() => expect(showMessageBox()).toHaveBeenCalledOnce());
    expect(shownOptions().detail).toContain("Disable hardware acceleration");
  });

  test("a late report from a closed session and malformed entries are ignored", async () => {
    const { sessions } = environment();
    sessions.open(1);
    sessions.close(1);
    sessions.add(1, [requirement("plugin:tray", "Tray icon")]);
    // The page runtime sends this list: entries without a key are dropped, not rendered.
    sessions.open(2);
    sessions.add(2, [{ key: "", label: "Broken" } as RestartRequirement]);
    sessions.close(2);

    // Nothing well-formed was flagged, so there is nothing to ask about.
    await Promise.resolve();
    expect(showMessageBox()).not.toHaveBeenCalled();
  });

  test("a new session starts a fresh batch", async () => {
    const { sessions } = environment();
    sessions.open(1);
    sessions.add(1, [requirement("plugin:tray", "Tray icon")]);
    sessions.close(1);
    await vi.waitFor(() => expect(showMessageBox()).toHaveBeenCalledOnce());

    sessions.open(3);
    sessions.add(3, [requirement("plugin:clock", "Clock")]);
    sessions.close(3);
    await vi.waitFor(() => expect(showMessageBox()).toHaveBeenCalledTimes(2));
    expect(shownOptions().detail).toBe("Restart the app to apply: Clock");
  });
});
