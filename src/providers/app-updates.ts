import { app, dialog, shell, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

import { commit, updatesSupported, type UpdateChannel } from '@/app-info';
import * as config from '@/config';
import { t } from '@/i18n';
import {
  CHECK_ATTEMPTS,
  isBetaVersion,
  isCommitBehindMaster,
  withRetry,
  type CommitComparison,
} from '@/providers/app-versions';
import { supportsInAppInstall } from '@/providers/update-install-support';
import { LoggerPrefix } from '@/utils';

const REPO = 'michei69/pear-desktop';
const REPO_URL = `https://github.com/${REPO}`;
const COMMITS_URL = `${REPO_URL}/commits/master`;
/**
 * How often a running app looks again: beta users must hear about the next beta
 * without restarting, and a release only lands on the feed after the publish
 * job. Six hours catches a working day's builds without hammering the feed.
 */
const RECHECK_MS = 6 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
/** Overall bound for one check, so a hung request cannot wedge `checkInFlight`. */
const CHECK_DEADLINE_MS = 2 * 60 * 1000;

const feedChannel = (updateChannel: UpdateChannel) =>
  updateChannel === 'beta' ? 'beta' : 'latest';

let win: BrowserWindow | null = null;
let dialogOpen = false;
let downloading = false;
let downloadReadyHandled = false;
let downloadTimeout: NodeJS.Timeout | undefined;
let repeatCheck: NodeJS.Timeout | undefined;
/** A finished download whose restart prompt waits for the open dialog to close. */
let pendingDownloadedUpdate: string | null = null;
let checkInFlight = false;

const ask = (options: Electron.MessageBoxOptions) =>
  win && !win.isDestroyed()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options);

const setProgress = (
  progress: number,
  options?: Electron.ProgressBarOptions,
) => {
  if (win && !win.isDestroyed()) {
    win.setProgressBar(progress, options);
  }
};

const resetDownloadState = () => {
  downloading = false;
  clearTimeout(downloadTimeout);
  downloadTimeout = undefined;
  setProgress(-1);
};

/**
 * Pins the updater to one channel. Both flags are needed: `allowPrerelease`
 * decides which release the provider considers, `channel` which `.yml` it
 * fetches. The GitHub provider falls back to `latest.yml` when a channel's file
 * is missing, so betas must ship `beta.yml` — hence the `-beta.N` version the
 * beta workflow builds.
 */
const applyChannel = (updateChannel: UpdateChannel) => {
  autoUpdater.allowPrerelease = updateChannel === 'beta';
  autoUpdater.channel = feedChannel(updateChannel);
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: REPO.split('/')[0],
    repo: REPO.split('/')[1],
    channel: feedChannel(updateChannel),
  });
};

const releaseLink = (version: string, updateChannel: UpdateChannel) =>
  updateChannel === 'beta'
    ? `${REPO_URL}/releases/tag/v${version}`
    : `${REPO_URL}/releases/latest`;

const showDownloadFailure = (downloadLink: string) => {
  if (dialogOpen) return;

  dialogOpen = true;
  ask({
    type: 'warning',
    buttons: [
      t('main.dialog.update-download-failed.buttons.ok'),
      t('main.dialog.update-download-failed.buttons.release'),
    ],
    title: t('main.dialog.update-download-failed.title'),
    message: t('main.dialog.update-download-failed.message'),
    detail: t('main.dialog.update-download-failed.detail'),
    defaultId: 0,
    cancelId: 0,
  })
    .then((answer) => {
      if (answer.response === 1) shell.openExternal(downloadLink);
    })
    .catch((err) => {
      console.error(LoggerPrefix, 'Failed to show update download error:', err);
    })
    .finally(() => {
      dialogOpen = false;
      showPendingDownloadedUpdate();
    });
};

const showDownloadedUpdate = (version: string) => {
  if (downloadReadyHandled) return;

  // The download is done either way, so the watchdog and the progress bar can
  // go now; the flag stays clear until the prompt is actually on screen.
  resetDownloadState();

  if (dialogOpen) {
    // Another dialog owns the screen. Offer the restart when it closes instead
    // of latching the prompt off for the rest of the session.
    pendingDownloadedUpdate = version;
    return;
  }

  pendingDownloadedUpdate = null;
  downloadReadyHandled = true;
  dialogOpen = true;
  ask({
    type: 'info',
    buttons: [
      t('main.dialog.update-downloaded.buttons.restart'),
      t('main.dialog.update-downloaded.buttons.later'),
    ],
    title: t('main.dialog.update-downloaded.title'),
    message: t('main.dialog.update-downloaded.message', { version }),
    detail: t('main.dialog.update-downloaded.detail'),
    defaultId: 0,
    cancelId: 1,
  })
    .then((answer) => {
      if (answer.response === 0) autoUpdater.quitAndInstall();
    })
    .catch((err) => {
      console.error(LoggerPrefix, 'Failed to show update ready dialog:', err);
    })
    .finally(() => {
      dialogOpen = false;
      showPendingDownloadedUpdate();
    });
};

/** Shows a restart prompt that had to wait while another dialog was open. */
const showPendingDownloadedUpdate = () => {
  const version = pendingDownloadedUpdate;
  if (version === null || dialogOpen) return;

  pendingDownloadedUpdate = null;
  showDownloadedUpdate(version);
};

const startDownload = (version: string, downloadLink: string) => {
  if (downloading) return;

  downloading = true;
  downloadReadyHandled = false;
  // A new download supersedes any prompt still waiting for a dialog to close.
  pendingDownloadedUpdate = null;
  setProgress(0, { mode: 'indeterminate' });

  downloadTimeout = setTimeout(() => {
    if (!downloading) return;

    resetDownloadState();
    showDownloadFailure(downloadLink);
  }, DOWNLOAD_TIMEOUT_MS);

  autoUpdater
    .downloadUpdate()
    .then(() => {
      showDownloadedUpdate(version);
    })
    .catch((err) => {
      resetDownloadState();
      console.error(LoggerPrefix, 'Failed to download update:', err);
      showDownloadFailure(downloadLink);
    });
};

const showUpdateAvailable = (version: string, updateChannel: UpdateChannel) => {
  if (dialogOpen || downloading) return;

  const downloadLink = releaseLink(version, updateChannel);
  const canInstall = supportsInAppInstall(process.platform, process.env);

  dialogOpen = true;
  ask({
    type: 'info',
    buttons: [
      t('main.dialog.update-available.buttons.ok'),
      t(
        canInstall
          ? 'main.dialog.update-available.buttons.install'
          : 'main.dialog.update-available.buttons.release',
      ),
      t('main.dialog.update-available.buttons.disable'),
    ],
    title: t('main.dialog.update-available.title'),
    message: t('main.dialog.update-available.message'),
    detail: t('main.dialog.update-available.detail', { downloadLink }),
    defaultId: 1,
    cancelId: 0,
  })
    .then((answer) => {
      if (answer.response === 1) {
        if (canInstall) startDownload(version, downloadLink);
        else shell.openExternal(downloadLink);
      }
      if (answer.response === 2) config.set('options.autoUpdates', false);
    })
    .catch((err) => {
      console.error(LoggerPrefix, 'Failed to show update dialog:', err);
    })
    .finally(() => {
      dialogOpen = false;
      showPendingDownloadedUpdate();
    });
};

const checkDevCommit = async () => {
  if (!commit) return;

  const response = await fetch(
    `https://api.github.com/repos/${REPO}/compare/${commit}...master`,
    {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    },
  ).catch((err) => {
    console.debug(LoggerPrefix, 'Dev update check failed:', err);
    return null;
  });
  if (!response?.ok) return;

  const comparison = (await response.json()) as CommitComparison;
  if (!isCommitBehindMaster(comparison)) return;

  ask({
    type: 'info',
    buttons: [
      t('main.dialog.update-available-dev.buttons.ok'),
      t('main.dialog.update-available-dev.buttons.view'),
    ],
    title: t('main.dialog.update-available-dev.title'),
    message: t('main.dialog.update-available-dev.message'),
    detail: t('main.dialog.update-available-dev.detail', {
      commit,
      commitsLink: COMMITS_URL,
    }),
    defaultId: 1,
    cancelId: 0,
  })
    .then((answer) => {
      if (answer.response === 1) shell.openExternal(COMMITS_URL);
    })
    .catch((err) => {
      console.error(LoggerPrefix, 'Failed to show dev update dialog:', err);
    });
};

/**
 * Warns before switching to stable when this run is a beta: the store already
 * ran this beta's migrations and a downgrade runs none of them back, which can
 * reset settings.
 */
const confirmDowngrade = async (): Promise<boolean> => {
  const answer = await ask({
    type: 'warning',
    buttons: [
      t('main.dialog.downgrade-warning.cancel'),
      t('main.dialog.downgrade-warning.confirm'),
    ],
    title: t('main.dialog.downgrade-warning.title'),
    message: t('main.dialog.downgrade-warning.message'),
    detail: t('main.dialog.downgrade-warning.detail'),
    defaultId: 0,
    cancelId: 0,
  });

  return answer.response === 1;
};

/**
 * Changes the channel the menu and the settings share. Returns false when the
 * user backs out, so callers can re-read the store.
 */
export const setUpdateChannel = async (value: string): Promise<boolean> => {
  if (value !== 'stable' && value !== 'beta') return false;
  if (config.updateChannel() === value) return true;

  if (isBetaVersion(app.getVersion()) && value === 'stable') {
    if (!(await confirmDowngrade())) return false;
  }

  config.set('options.updateChannel', value);
  // A check right after the switch must read the new channel.
  applyChannel(value);
  return true;
};

/**
 * Runs one update check, retrying a failure a couple of times (see `withRetry`).
 * The updater resolves with `updateInfo` whether or not anything is newer, so
 * `isUpdateAvailable` decides whether there is an update to announce.
 */
export const runUpdateCheck = async (): Promise<void> => {
  // Overlapping checks (startup timer, menu click, 6 h repeat) would stack
  // dialogs and race the `dialogOpen` guard, so one check at a time.
  if (checkInFlight) return;

  checkInFlight = true;
  let deadline: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      withRetry(
        () => autoUpdater.checkForUpdates(),
        (err, attempt, last) => {
          console.debug(
            LoggerPrefix,
            `Update check attempt ${attempt} of ${CHECK_ATTEMPTS} failed${last ? ' (giving up)' : ', retrying'}:`,
            err,
          );
        },
      ),
      // A request that never settles must not wedge the single-flight latch
      // (and with it every later check) for the rest of the session.
      new Promise<null>((resolve) => {
        deadline = setTimeout(() => resolve(null), CHECK_DEADLINE_MS);
        deadline.unref?.();
      }),
    ]);

    // A timed-out check shows nothing: there is no result to announce.
    if (!outcome?.ok) return;

    const { isUpdateAvailable, updateInfo } = outcome.value ?? {};
    if (isUpdateAvailable && updateInfo && !dialogOpen && !downloading) {
      showUpdateAvailable(updateInfo.version, config.updateChannel());
    }
  } finally {
    clearTimeout(deadline);
    checkInFlight = false;
  }
};

/**
 * Checks the channel the user follows. The dialog comes from the returned
 * update info, so one check pops exactly one dialog.
 */
export const checkForAppUpdates = async (): Promise<void> => {
  if (!updatesSupported()) {
    await checkDevCommit();
    return;
  }

  applyChannel(config.updateChannel());
  await runUpdateCheck();
};

/**
 * Wires the updater once the main window exists. The stored channel is applied
 * even when auto-updates are off, so a manual check uses it too.
 */
export const setupAutoUpdates = (mainWindow: BrowserWindow) => {
  win = mainWindow;
  // The dialog offers the download; the updater does not grab it.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  if (!updatesSupported()) {
    // Dev builds cannot update, but they can still be behind master.
    const timeout = setTimeout(() => {
      checkDevCommit().catch(() => {});
      clearTimeout(timeout);
    }, 2000);
    return;
  }

  applyChannel(config.updateChannel());

  autoUpdater.on('error', (err) => {
    if (downloading) resetDownloadState();
    console.debug(LoggerPrefix, 'Updater error:', err);
  });

  autoUpdater.on('download-progress', (progress) => {
    if (!downloading) return;
    const percent = Number.isFinite(progress.percent)
      ? Math.min(100, Math.max(0, progress.percent))
      : 0;
    setProgress(percent / 100);
  });

  autoUpdater.on('update-downloaded', (update) => {
    showDownloadedUpdate(update.version);
  });

  const startRepeating = () => {
    clearInterval(repeatCheck);
    /** Looks again later, so betas landing mid-session are still noticed. */
    repeatCheck = setInterval(() => {
      checkForAppUpdates().catch(() => {});
    }, RECHECK_MS);
    // Never hold the app open just for a timer.
    repeatCheck.unref?.();
  };

  let autoUpdatesEnabled = config.get('options.autoUpdates');

  if (autoUpdatesEnabled) {
    // Delay the first packaged update check until startup and window creation
    // have settled, avoiding an update dialog during initial UI work.
    const timeout = setTimeout(() => {
      checkForAppUpdates().catch(() => {});
      clearTimeout(timeout);
    }, 2000);
    startRepeating();
  }

  config.watch((newValue, oldValue) => {
    // A channel switched while the window is open must be honoured.
    const before = (oldValue?.options as { updateChannel?: UpdateChannel })
      ?.updateChannel;
    const after = (newValue?.options as { updateChannel?: UpdateChannel })
      ?.updateChannel;
    if (before !== after && (after === 'stable' || after === 'beta')) {
      applyChannel(after);
    }

    // Turning auto-updates off stops the repeating check, turning it back on
    // starts one — no restart either way. Only an actual flip may restart the
    // 6 h clock: restarting it on every config write would postpone the recheck
    // forever for a user who touches settings.
    const nextAutoUpdates = config.get('options.autoUpdates');
    if (nextAutoUpdates !== autoUpdatesEnabled) {
      autoUpdatesEnabled = nextAutoUpdates;
      if (nextAutoUpdates) startRepeating();
      else clearInterval(repeatCheck);
    }
  });
};
