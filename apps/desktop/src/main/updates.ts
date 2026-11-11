// The update check (general.autoUpdates), like pear-desktop's: packaged builds
// ask GitHub for the release on the chosen channel shortly after startup, then
// every six hours, and say so when it is newer. Where the app can install an
// update itself (Windows installs, Linux AppImages) it downloads it in the
// background and offers a restart; elsewhere "View Release" opens the page.

import { type BrowserWindow, dialog, net, shell } from "electron";
import { autoUpdater } from "electron-updater";
import type { Translate, Vars } from "@pear/sdk/i18n";
import { errorMessage } from "@pear/sdk/util";
import { comparePrerelease, compareVersions } from "./version.ts";
import { alive } from "./windows.ts";

export const REPO = "michei69/pear-desktop";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases`;
const LATEST_RELEASE_API = `${API}/latest`;
const LIST_RELEASES_API = `${API}?per_page=20`;
export const CHECK_DELAY_MS = 2000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const RETRY_DELAY_MS = 5000;
export const RETRY_ATTEMPTS = 3;
/** A request that never settles must not latch the single-flight check forever. */
export const CHECK_DEADLINE_MS = 2 * 60 * 1000;
/** A download that stalls this long is reported as failed, and its progress bar cleared. */
export const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
/** GitHub requests give up instead of hanging on a half-open connection. */
const REQUEST_TIMEOUT_MS = 10_000;

/** The update dialog's buttons, in order. */
const OK_BUTTON = 0;
const DOWNLOAD_BUTTON = 1;
const DISABLE_BUTTON = 2;
/** The dev-check dialog offers to open master's commits instead of a release. */
const VIEW_BUTTON = 1;

export type UpdateChannel = "stable" | "beta";

/** Release checks: packaged builds only, when the option is on. Dev builds check their commit instead. */
export function shouldCheck({ packaged, enabled }: { packaged: boolean; enabled: boolean }) {
  return packaged && enabled;
}

/** Whether `latest` (a tag such as "v4.1.0") is newer than `current`; a release beats its own prereleases. */
export function isNewerVersion(latest: string, current: string) {
  const clean = (version: string) => version.trim().replace(/^v/i, "").split("+")[0]!;
  const prerelease = (version: string) => version.split("-").slice(1).join("-");
  const [newer, older] = [clean(latest), clean(current)];
  if (!/^\d+(\.\d+)*(-.+)?$/.test(newer)) return false;
  const release = compareVersions(newer, older);
  if (release !== 0) return release > 0;
  const [newerPre, olderPre] = [prerelease(newer), prerelease(older)];
  // Same release: the release itself is newer than any of its prereleases.
  if (!newerPre || !olderPre) return !newerPre && Boolean(olderPre);
  return comparePrerelease(newerPre, olderPre) > 0;
}

export interface Release {
  version: string;
  url: string;
}

/**
 * Whether this installation can install an update itself: a Windows installer
 * build (not the portable exe, which runs from a temporary copy) and a Linux
 * AppImage (anything package-managed belongs to its package manager). A mac
 * build cannot be updated in place, so it opens the release page instead.
 */
export function supportsInAppInstall(platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  if (platform === "darwin") return false;
  if (platform === "win32") return !env.PORTABLE_EXECUTABLE_DIR && !env.PORTABLE_EXECUTABLE_FILE;
  if (platform === "linux") return Boolean(env.APPIMAGE);
  return false;
}

/** The `.yml` the updater reads: beta builds publish beta.yml, releases latest.yml. */
const feedChannel = (channel: UpdateChannel) => (channel === "beta" ? "beta" : "latest");

/**
 * The updater flags that pin a channel. Both are needed: `allowPrerelease`
 * decides which release the provider considers, `channel` which `.yml` it
 * fetches. Exported so tests check them against electron-updater's provider.
 */
export function channelFlags(channel: UpdateChannel) {
  return { allowPrerelease: channel === "beta", channel: feedChannel(channel) };
}

/** electron-updater's GitHub feed for a channel. */
export function feedOptions(channel: UpdateChannel) {
  const [owner, repo] = REPO.split("/") as [string, string];
  return { provider: "github" as const, owner, repo, channel: feedChannel(channel) };
}

export const COMMITS_URL = `https://github.com/${REPO}/commits/master`;
const COMPARE_URL = `https://api.github.com/repos/${REPO}/compare`;

/**
 * A dev build is stale only when its commit sits on master's history behind the
 * tip. The compare is `commit...master`, so `status: "ahead"` means master is
 * ahead of the build; a branch with its own commits reads "behind" or
 * "diverged" and is purposely off master, so it must not nag (pear-desktop #68).
 */
export function isCommitBehindMaster(comparison: { status?: unknown } | null | undefined) {
  return comparison?.status === "ahead";
}

/** Whether GitHub reports master ahead of `commit`; throws on a failed request. */
export async function devCommitBehind(commit: string, fetch: (url: string, init?: RequestInit) => Promise<Response>) {
  const response = await fetch(`${COMPARE_URL}/${encodeURIComponent(commit)}...master`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return isCommitBehindMaster((await response.json()) as { status?: unknown } | null);
}

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

const releaseUrl = (release: GitHubRelease) =>
  typeof release.html_url === "string" && release.html_url.startsWith(`https://github.com/${REPO}/`) ? release.html_url : RELEASES_URL;

function asRelease(release: GitHubRelease): Release | undefined {
  if (typeof release.tag_name !== "string" || release.draft === true) return undefined;
  return { version: release.tag_name.replace(/^v/i, ""), url: releaseUrl(release) };
}

/**
 * The newest release on the channel if it is newer than `current`; undefined
 * otherwise or when GitHub can't be reached. The beta channel accepts
 * prereleases too, since its builds are published as one rolling prerelease.
 */
export async function newerRelease(
  current: string,
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  channel: UpdateChannel = "stable",
): Promise<Release | undefined> {
  const headers = { Accept: "application/vnd.github+json" };
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (channel === "stable") {
    const response = await fetch(LATEST_RELEASE_API, { headers, signal });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = (await response.json()) as GitHubRelease;
    if (release.prerelease === true) return undefined;
    const found = asRelease(release);
    return found && isNewerVersion(found.version, current) ? found : undefined;
  }

  const response = await fetch(LIST_RELEASES_API, { headers, signal });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const releases = (await response.json()) as GitHubRelease[];
  if (!Array.isArray(releases)) return undefined;
  let newest: Release | undefined;
  for (const release of releases) {
    const found = asRelease(release);
    if (found && (!newest || isNewerVersion(found.version, newest.version))) newest = found;
  }
  return newest && isNewerVersion(newest.version, current) ? newest : undefined;
}

/** Calls `fn` until it succeeds, up to `attempts` tries, for transient GitHub/network failures. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = RETRY_ATTEMPTS): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts) throw error;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, RETRY_DELAY_MS);
      await promise;
    }
  }
}

/** What the download and restart dialogs need; the check that found the update sets it. */
interface UpdateDialogs {
  window: () => BrowserWindow | undefined;
  t: Translate;
}

let dialogs: UpdateDialogs | undefined;
let dialogOpen = false;
let downloading = false;
let downloadReadyHandled = false;
let downloadTimeout: ReturnType<typeof setTimeout> | undefined;
let pendingDownloadedVersion: string | undefined;
let updaterReady = false;

/**
 * English fallbacks live here, as literal `t(...)` calls with a fallback string,
 * which the i18n generator copies into en.json (`nub run i18n`).
 */
const t = (key: string, fallback: string, vars?: Vars) => dialogs?.t(key, fallback, vars) ?? fallback;

const ask = (options: Electron.MessageBoxOptions) => {
  const parent = alive(dialogs?.window());
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
};

const setProgress = (progress: number, options?: Electron.ProgressBarOptions) => {
  const window = alive(dialogs?.window());
  if (window) window.setProgressBar(progress, options);
};

const resetDownloadState = () => {
  downloading = false;
  clearTimeout(downloadTimeout);
  downloadTimeout = undefined;
  setProgress(-1);
};

/** Pins the updater to a channel, the way pear-desktop did before checking or downloading. */
function applyChannel(channel: UpdateChannel) {
  const flags = channelFlags(channel);
  autoUpdater.allowPrerelease = flags.allowPrerelease;
  autoUpdater.channel = flags.channel;
  autoUpdater.setFeedURL(feedOptions(channel));
}

/** Wires the updater's events once: progress in the taskbar, completion and failures. */
function setupUpdater() {
  if (updaterReady) return;
  updaterReady = true;
  // The dialog offers the install; the updater never downloads on its own.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("error", (error) => {
    if (downloading) resetDownloadState();
    console.debug("[pear] updater error:", errorMessage(error));
  });
  autoUpdater.on("download-progress", (progress) => {
    if (!downloading) return;
    const percent = Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, progress.percent)) : 0;
    setProgress(percent / 100);
  });
  autoUpdater.on("update-downloaded", (update) => showDownloadedUpdate(update.version));
}

/** Offers the restart once the download is ready, or defers it until the open dialog closes. */
function showDownloadedUpdate(version: string) {
  if (downloadReadyHandled) return;

  resetDownloadState();
  if (dialogOpen) {
    // Another dialog owns the screen; offer the restart when it closes instead of latching.
    pendingDownloadedVersion = version;
    return;
  }

  pendingDownloadedVersion = undefined;
  downloadReadyHandled = true;
  dialogOpen = true;
  void ask({
    type: "info",
    buttons: [t("main.dialog.update-downloaded.buttons.restart", "Restart Now"), t("main.dialog.update-downloaded.buttons.later", "Later")],
    title: t("main.dialog.update-downloaded.title", "Update Downloaded"),
    message: t("main.dialog.update-downloaded.message", "Version {{version}} has been downloaded.", { version }),
    detail: t("main.dialog.update-downloaded.detail", "Restart the application to install the update."),
    defaultId: 0,
    cancelId: 1,
  })
    .then(({ response }) => {
      // Portable Windows builds are excluded from in-app installs, so the
      // installer's own relaunch needs no extra relaunch options here.
      if (response === 0) autoUpdater.quitAndInstall();
    })
    .catch((error) => console.warn("[pear] couldn't offer the update restart:", errorMessage(error)))
    .finally(() => {
      dialogOpen = false;
      showPendingDownloadedUpdate();
    });
}

function showPendingDownloadedUpdate() {
  const version = pendingDownloadedVersion;
  if (version === undefined || dialogOpen) return;

  pendingDownloadedVersion = undefined;
  showDownloadedUpdate(version);
}

/** The download failed or timed out: offer the release page instead of leaving the user stuck. */
function showDownloadFailure(releaseUrl: string) {
  if (dialogOpen) return;

  dialogOpen = true;
  void ask({
    type: "warning",
    buttons: [
      t("main.dialog.update-download-failed.buttons.ok", "OK"),
      t("main.dialog.update-download-failed.buttons.release", "View Release"),
    ],
    title: t("main.dialog.update-download-failed.title", "Update Download Failed"),
    message: t("main.dialog.update-download-failed.message", "The update could not be downloaded."),
    detail: t("main.dialog.update-download-failed.detail", "You can download the update manually from the GitHub release page."),
    defaultId: 0,
    cancelId: 0,
  })
    .then(({ response }) => {
      if (response === 1) void shell.openExternal(releaseUrl);
    })
    .catch((error) => console.warn("[pear] couldn't show the update download failure:", errorMessage(error)))
    .finally(() => {
      dialogOpen = false;
      showPendingDownloadedUpdate();
    });
}

/** Downloads the release the check found, keeping the taskbar progress in step. */
function startDownload(version: string, releaseUrl: string, channel: UpdateChannel) {
  if (downloading) return;

  downloading = true;
  downloadReadyHandled = false;
  // A new download supersedes a restart prompt still waiting for a dialog to close.
  pendingDownloadedVersion = undefined;
  setProgress(0, { mode: "indeterminate" });

  downloadTimeout = setTimeout(() => {
    if (!downloading) return;
    resetDownloadState();
    showDownloadFailure(releaseUrl);
  }, DOWNLOAD_TIMEOUT_MS);
  // Never hold the app open just for the timer.
  downloadTimeout.unref?.();

  setupUpdater();
  applyChannel(channel);
  // The GitHub check already decided there is an update; the updater finds the
  // release's files on the same channel and downloads them.
  void autoUpdater
    .checkForUpdates()
    .then((result) => {
      if (!result?.isUpdateAvailable) throw new Error("the update feed has no newer release");
      return autoUpdater.downloadUpdate();
    })
    .then(() => showDownloadedUpdate(version))
    .catch((error) => {
      resetDownloadState();
      console.warn("[pear] update download failed:", errorMessage(error));
      showDownloadFailure(releaseUrl);
    });
}

export interface UpdateCheckOptions {
  currentVersion: string;
  channel: UpdateChannel;
  window: () => BrowserWindow | undefined;
  t: Translate;
  /** "Disable updates" was chosen. */
  disable(): void;
}

/** Checks once and shows pear-desktop's dialog when a newer release is out. */
export async function checkForUpdates({ currentVersion, channel, window, t: translate, disable }: UpdateCheckOptions) {
  dialogs = { window, t: translate };
  // One dialog at a time: a check while one is open (or a download runs) would stack dialogs.
  if (dialogOpen || downloading) return;
  // Wires progress/completion events before the dialog that can start a download.
  setupUpdater();
  let release: Release | undefined;
  try {
    release = await withRetry(() => newerRelease(currentVersion, net.fetch, channel));
  } catch (error) {
    console.warn("[pear] update check failed:", errorMessage(error));
    return;
  }
  if (!release) return;
  console.info(`[pear] update available: ${release.version}`);
  const canInstall = supportsInAppInstall(process.platform, process.env);
  const options: Electron.MessageBoxOptions = {
    type: "info",
    buttons: [
      t("main.dialog.update-available.buttons.ok", "OK"),
      canInstall
        ? t("main.dialog.update-available.buttons.install", "Download and Install")
        : t("main.dialog.update-available.buttons.release", "View Release"),
      t("main.dialog.update-available.buttons.disable", "Disable Updates"),
    ],
    title: t("main.dialog.update-available.title", "Update Available"),
    message: t("main.dialog.update-available.message", "A new version is available"),
    detail: t("main.dialog.update-available.detail", "A new version is available and can be downloaded at {{downloadLink}}", {
      downloadLink: release.url,
    }),
    defaultId: DOWNLOAD_BUTTON,
    cancelId: OK_BUTTON,
  };
  dialogOpen = true;
  try {
    const { response } = await ask(options);
    if (response === DOWNLOAD_BUTTON) {
      if (canInstall) startDownload(release.version, release.url, channel);
      else void shell.openExternal(release.url);
    } else if (response === DISABLE_BUTTON) disable();
  } catch (error) {
    console.warn("[pear] couldn't show the update dialog:", errorMessage(error));
  } finally {
    dialogOpen = false;
    showPendingDownloadedUpdate();
  }
}

export interface DevCheckOptions {
  commit: string;
  window: () => BrowserWindow | undefined;
  t: Translate;
}

/**
 * A dev build has no feed, so the only thing to report is whether its commit is
 * still the tip of master. Runs once after startup, like pear-desktop's check.
 */
export async function checkForDevCommit({ commit, window, t }: DevCheckOptions) {
  if (!commit) return;
  let behind: boolean;
  try {
    behind = await devCommitBehind(commit, net.fetch);
  } catch (error) {
    console.warn("[pear] dev update check failed:", errorMessage(error));
    return;
  }
  if (!behind) return;
  console.info(`[pear] dev build is behind master at ${commit}`);
  const options: Electron.MessageBoxOptions = {
    type: "info",
    buttons: [t("main.dialog.update-available-dev.buttons.ok", "OK"), t("main.dialog.update-available-dev.buttons.view", "View commits")],
    title: t("main.dialog.update-available-dev.title", "Update Available"),
    message: t("main.dialog.update-available-dev.message", "This dev build is behind the master branch"),
    detail: t(
      "main.dialog.update-available-dev.detail",
      "The commit this build runs on ({{commit}}) is older than the latest commit on master. Newer commits can be viewed at {{commitsLink}}",
      { commit, commitsLink: COMMITS_URL },
    ),
    defaultId: VIEW_BUTTON,
    cancelId: OK_BUTTON,
  };
  const parent = alive(window());
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (response === VIEW_BUTTON) void shell.openExternal(COMMITS_URL);
}

export interface UpdateManagerOptions {
  currentVersion: string;
  /** The commit this build was made from; empty for release builds. */
  commit?: string;
  packaged: boolean;
  channel(): UpdateChannel;
  enabled(): boolean;
  window: () => BrowserWindow | undefined;
  t: Translate;
  /** "Disable updates" was chosen. */
  disable(): void;
}

/** The startup check, its six-hour repeat, and the channel changes in between. */
export class UpdateManager {
  #options: UpdateManagerOptions;
  #timer: ReturnType<typeof setInterval> | undefined;
  #startTimer: ReturnType<typeof setTimeout> | undefined;
  #checking = false;
  #checked = false;

  constructor(options: UpdateManagerOptions) {
    this.#options = options;
  }

  start() {
    this.stop();
    // A dev build has no feed to poll: it only asks once whether its commit is
    // still master's tip, even with the auto-update option off (as the fork did).
    if (!this.#options.packaged) {
      const commit = this.#options.commit;
      if (!commit) return;
      this.#startTimer = setTimeout(
        () => void checkForDevCommit({ commit, window: this.#options.window, t: this.#options.t }),
        CHECK_DELAY_MS,
      );
      return;
    }
    this.#startTimer = setTimeout(() => this.#schedule(), CHECK_DELAY_MS);
    // `.unref()` so a pending check never keeps the app alive on quit.
    this.#timer = setInterval(() => this.#schedule(), CHECK_INTERVAL_MS);
    this.#timer.unref?.();
  }

  stop() {
    clearTimeout(this.#startTimer);
    clearInterval(this.#timer);
    this.#startTimer = undefined;
    this.#timer = undefined;
  }

  #schedule() {
    this.#checked = false;
    void this.check();
  }

  /** A channel (or auto-updates) change: check now instead of waiting for the next cycle. */
  channelChanged() {
    if (!this.#options.enabled()) return;
    this.#schedule();
  }

  async check() {
    if (this.#checking || this.#checked) return;
    if (!shouldCheck({ packaged: this.#options.packaged, enabled: this.#options.enabled() })) return;
    this.#checking = true;
    this.#checked = true;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        checkForUpdates({
          currentVersion: this.#options.currentVersion,
          channel: this.#options.channel(),
          window: this.#options.window,
          t: this.#options.t,
          disable: this.#options.disable,
        }),
        // A request that never settles must not wedge the single-flight latch forever.
        new Promise<null>((resolve) => {
          deadline = setTimeout(() => resolve(null), CHECK_DEADLINE_MS);
          deadline.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(deadline);
      this.#checking = false;
    }
  }
}
