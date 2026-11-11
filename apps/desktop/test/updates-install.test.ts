// In-app update install: who may install, the download with taskbar progress,
// the restart prompt and its deferred variant, the failure dialog, and the
// check deadline that keeps one hung request from latching the update check.
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (payload: any) => void>();
  return {
    handlers,
    showMessageBox: vi.fn(),
    openExternal: vi.fn(),
    fetch: vi.fn(),
    autoUpdater: {
      allowPrerelease: false,
      channel: "",
      autoDownload: true,
      autoInstallOnAppQuit: true,
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      on: vi.fn((event: string, handler: (payload: any) => void) => {
        handlers.set(event, handler);
      }),
    },
  };
});

const dialogOptions = (index: number) => {
  // With a parent window `showMessageBox` takes (window, options); without, (options).
  const call = mocks.showMessageBox.mock.calls[index]!;
  return (call.length > 1 ? call[1] : call[0]) as Electron.MessageBoxOptions;
};

vi.mock("electron", () => ({
  dialog: { showMessageBox: mocks.showMessageBox },
  net: { fetch: mocks.fetch },
  shell: { openExternal: mocks.openExternal },
}));
vi.mock("electron-updater", () => ({ autoUpdater: mocks.autoUpdater }));

const realPlatform = process.platform;
const realEnv = {
  APPIMAGE: process.env.APPIMAGE,
  PORTABLE_EXECUTABLE_DIR: process.env.PORTABLE_EXECUTABLE_DIR,
  PORTABLE_EXECUTABLE_FILE: process.env.PORTABLE_EXECUTABLE_FILE,
};

const restoreEnv = (name: keyof typeof realEnv) => {
  const value = realEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

/** The module keeps dialog/download state, so each test gets a fresh instance. */
async function load() {
  vi.resetModules();
  return await import("../src/main/updates.ts");
}

const release = (tag: string) =>
  new Response(JSON.stringify({ tag_name: tag, html_url: `https://github.com/michei69/pear-desktop/releases/tag/${tag}` }), {
    status: 200,
  });

const translate = (_key: string, fallback?: string, vars?: Record<string, unknown>) =>
  (fallback ?? "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) => (vars && name in vars ? String(vars[name]) : match));

const options = (window: () => BrowserWindow | undefined) => ({
  currentVersion: "4.0.0",
  channel: "stable" as const,
  window,
  t: translate,
  disable: vi.fn(),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.handlers.clear();
  mocks.autoUpdater.on.mockImplementation((event: string, handler: (payload: any) => void) => {
    mocks.handlers.set(event, handler);
  });
  mocks.autoUpdater.allowPrerelease = false;
  mocks.autoUpdater.channel = "";
  mocks.autoUpdater.autoDownload = true;
  mocks.autoUpdater.autoInstallOnAppQuit = true;
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  delete process.env.APPIMAGE;
  delete process.env.PORTABLE_EXECUTABLE_DIR;
  delete process.env.PORTABLE_EXECUTABLE_FILE;
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  restoreEnv("APPIMAGE");
  restoreEnv("PORTABLE_EXECUTABLE_DIR");
  restoreEnv("PORTABLE_EXECUTABLE_FILE");
  vi.useRealTimers();
});

describe("supportsInAppInstall", () => {
  test("in-app installation is supported only for compatible installations", async () => {
    const { supportsInAppInstall } = await load();

    expect(supportsInAppInstall("win32", {})).toBe(true);
    expect(supportsInAppInstall("win32", { PORTABLE_EXECUTABLE_DIR: "C:\\Portable" })).toBe(false);
    expect(supportsInAppInstall("win32", { PORTABLE_EXECUTABLE_FILE: "Pear.exe" })).toBe(false);
    expect(supportsInAppInstall("darwin", {})).toBe(false);
    expect(supportsInAppInstall("linux", { APPIMAGE: "/tmp/Pear.AppImage" })).toBe(true);
    expect(supportsInAppInstall("linux", {})).toBe(false);
    expect(supportsInAppInstall("freebsd", {})).toBe(false);
  });
});

describe("the update-available dialog", () => {
  test("an installable build offers the download and installs it", async () => {
    process.env.APPIMAGE = "/tmp/Pear.AppImage";
    const updates = await load();
    const setProgressBar = vi.fn();
    const window = () => ({ isDestroyed: () => false, setProgressBar }) as unknown as BrowserWindow;

    mocks.fetch.mockResolvedValue(release("v4.1.0"));
    const { promise: download, resolve: finishDownload } = Promise.withResolvers<string[]>();
    mocks.autoUpdater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: "4.1.0" } });
    mocks.autoUpdater.downloadUpdate.mockReturnValue(download);
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 });

    await updates.checkForUpdates(options(window));

    const first = dialogOptions(0);
    expect(first.buttons).toEqual(["OK", "Download and Install", "Disable Updates"]);
    expect(mocks.openExternal).not.toHaveBeenCalled();

    // The updater is pinned to the rewrite's channel before it downloads.
    expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledWith(updates.feedOptions("stable"));
    expect(mocks.autoUpdater.allowPrerelease).toBe(false);
    expect(mocks.autoUpdater.channel).toBe("latest");
    // The dialog starts the download; neither the check nor the quit grabs it.
    expect(mocks.autoUpdater.autoDownload).toBe(false);
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false);
    await vi.waitFor(() => expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalled());

    // electron-updater reports progress 0-100; the taskbar takes a fraction.
    expect(setProgressBar).toHaveBeenCalledWith(0, { mode: "indeterminate" });
    mocks.handlers.get("download-progress")!({ percent: 42 });
    expect(setProgressBar.mock.lastCall?.[0]).toBe(0.42);
    // Out-of-range reports are clamped rather than handed to the taskbar.
    mocks.handlers.get("download-progress")!({ percent: 130 });
    expect(setProgressBar.mock.lastCall?.[0]).toBe(1);

    finishDownload([]);
    await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalledTimes(2));
    const restart = dialogOptions(1);
    expect(restart.buttons).toEqual(["Restart Now", "Later"]);
    expect(restart.message).toBe("Version 4.1.0 has been downloaded.");
    await vi.waitFor(() => expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalled());
    expect(setProgressBar.mock.calls.map((call) => call[0])).toContain(-1);
  });

  test("a package-managed build offers the release page instead", async () => {
    const updates = await load();
    mocks.fetch.mockResolvedValue(release("v4.1.0"));
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 });

    await updates.checkForUpdates(options(() => undefined));

    const first = dialogOptions(0);
    expect(first.buttons).toEqual(["OK", "View Release", "Disable Updates"]);
    expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/michei69/pear-desktop/releases/tag/v4.1.0");
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  test("disabling updates writes the option off", async () => {
    const updates = await load();
    mocks.fetch.mockResolvedValue(release("v4.1.0"));
    mocks.showMessageBox.mockResolvedValueOnce({ response: 2 });
    const disable = vi.fn();

    await updates.checkForUpdates({ ...options(() => undefined), disable });

    expect(disable).toHaveBeenCalled();
  });
});

describe("download failures", () => {
  test("a rejected download offers the release page", async () => {
    process.env.APPIMAGE = "/tmp/Pear.AppImage";
    const updates = await load();
    mocks.fetch.mockResolvedValue(release("v4.1.0"));
    mocks.autoUpdater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: "4.1.0" } });
    mocks.autoUpdater.downloadUpdate.mockRejectedValue(new Error("offline"));
    // Install, then "View Release" in the failure dialog.
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 1 });

    await updates.checkForUpdates(options(() => undefined));

    await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalledTimes(2));
    const failure = dialogOptions(1);
    expect(failure.type).toBe("warning");
    expect(failure.title).toBe("Update Download Failed");
    expect(failure.buttons).toEqual(["OK", "View Release"]);
    await vi.waitFor(() => expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/michei69/pear-desktop/releases/tag/v4.1.0"));
  });

  test("a stalled download is reported as failed at the timeout", async () => {
    vi.useFakeTimers();
    process.env.APPIMAGE = "/tmp/Pear.AppImage";
    const updates = await load();
    mocks.fetch.mockResolvedValue(release("v4.1.0"));
    mocks.autoUpdater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: "4.1.0" } });
    mocks.autoUpdater.downloadUpdate.mockReturnValue(new Promise(() => {}));
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 });

    await updates.checkForUpdates(options(() => undefined));
    await vi.advanceTimersByTimeAsync(updates.DOWNLOAD_TIMEOUT_MS);

    expect(dialogOptions(1).title).toBe("Update Download Failed");
  });

  test("a feed without the release is reported as a failure, not a silent no-op", async () => {
    process.env.APPIMAGE = "/tmp/Pear.AppImage";
    const updates = await load();
    mocks.fetch.mockResolvedValue(release("v4.1.0"));
    mocks.autoUpdater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false });
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 });

    await updates.checkForUpdates(options(() => undefined));

    await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalledTimes(2));
    expect(dialogOptions(1).title).toBe("Update Download Failed");
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });
});

describe("the restart prompt", () => {
  test("waits for the open dialog to close instead of latching", async () => {
    const updates = await load();
    mocks.fetch.mockResolvedValue(release("v4.1.0"));
    const { promise: answer, resolve: respond } = Promise.withResolvers<{ response: number }>();
    mocks.showMessageBox.mockReturnValueOnce(answer).mockResolvedValueOnce({ response: 1 });

    const checking = updates.checkForUpdates(options(() => undefined));
    await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalledTimes(1));

    // The download finished while the update dialog is still open.
    mocks.handlers.get("update-downloaded")!({ version: "4.1.0" });
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(1);

    respond({ response: 0 });
    await checking;
    await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalledTimes(2));
    const restart = dialogOptions(1);
    expect(restart.buttons).toEqual(["Restart Now", "Later"]);
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe("the check deadline", () => {
  test("a hung check clears the single-flight latch", async () => {
    vi.useFakeTimers();
    const updates = await load();
    mocks.fetch.mockReturnValue(new Promise(() => {}));

    const manager = new updates.UpdateManager({
      currentVersion: "4.0.0",
      packaged: true,
      channel: () => "stable",
      enabled: () => true,
      window: () => undefined,
      t: translate,
      disable: vi.fn(),
    });

    void manager.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    // Without the deadline the latch would stay set, and this second check would return.
    await vi.advanceTimersByTimeAsync(updates.CHECK_DEADLINE_MS);
    manager.channelChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
