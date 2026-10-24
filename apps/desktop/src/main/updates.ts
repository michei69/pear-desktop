// The update check (general.autoUpdates), like pear-desktop's: packaged builds
// ask GitHub for the release on the chosen channel shortly after startup, then
// every six hours, and say so when it is newer. Nothing is downloaded;
// "Download" opens the release page.

import { type BrowserWindow, dialog, net, shell } from "electron";
import type { Translate } from "@pear/sdk/i18n";
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

/** The update dialog's buttons, in order. */
const OK_BUTTON = 0;
const DOWNLOAD_BUTTON = 1;
const DISABLE_BUTTON = 2;

export type UpdateChannel = "stable" | "beta";

/** Dev runs and tests (`electron .`) never check. */
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
  if (channel === "stable") {
    const response = await fetch(LATEST_RELEASE_API, { headers });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = (await response.json()) as GitHubRelease;
    if (release.prerelease === true) return undefined;
    const found = asRelease(release);
    return found && isNewerVersion(found.version, current) ? found : undefined;
  }

  const response = await fetch(LIST_RELEASES_API, { headers });
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

export interface UpdateCheckOptions {
  currentVersion: string;
  channel: UpdateChannel;
  window: () => BrowserWindow | undefined;
  t: Translate;
  /** "Disable updates" was chosen. */
  disable(): void;
}

/** Checks once and shows pear-desktop's dialog when a newer release is out. */
export async function checkForUpdates({ currentVersion, channel, window, t, disable }: UpdateCheckOptions) {
  let release: Release | undefined;
  try {
    release = await withRetry(() => newerRelease(currentVersion, net.fetch, channel));
  } catch (error) {
    console.warn("[pear] update check failed:", errorMessage(error));
    return;
  }
  if (!release) return;
  console.info(`[pear] update available: ${release.version}`);
  const options: Electron.MessageBoxOptions = {
    type: "info",
    buttons: [
      t("main.dialog.update-available.buttons.ok", "OK"),
      t("main.dialog.update-available.buttons.download", "Download"),
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
  const parent = alive(window());
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (response === DOWNLOAD_BUTTON) void shell.openExternal(release.url);
  else if (response === DISABLE_BUTTON) disable();
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
    if (!this.#options.packaged && !this.#options.commit) return;
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
    try {
      await checkForUpdates({
        currentVersion: this.#options.currentVersion,
        channel: this.#options.channel(),
        window: this.#options.window,
        t: this.#options.t,
        disable: this.#options.disable,
      });
    } finally {
      this.#checking = false;
    }
  }
}
