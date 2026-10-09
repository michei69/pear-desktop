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
import { LoggerPrefix } from '@/utils';

const REPO = 'michei69/pear-desktop';
const REPO_URL = `https://github.com/${REPO}`;
const COMMITS_URL = `${REPO_URL}/commits/master`;

/** `latest` for stable, `beta` for betas: the feed and the `.yml` it reads. */
const feedChannel = (updateChannel: UpdateChannel) =>
  updateChannel === 'beta' ? 'beta' : 'latest';

let win: BrowserWindow | null = null;
/** Latched while a dialog is open, so one check pops one dialog. */
let dialogOpen = false;
let repeatCheck: NodeJS.Timeout | undefined;

/**
 * How often a running app looks again. Beta users need to hear about the next
 * beta without restarting, and a release only lands on the feed once the
 * publish job has finished; six hours is frequent enough to catch a working
 * day's builds without hammering the feed.
 */
const RECHECK_MS = 6 * 60 * 60 * 1000;

const ask = (options: Electron.MessageBoxOptions) =>
  win && !win.isDestroyed()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options);

/**
 * Pins the updater to one channel. Both flags are needed: `allowPrerelease`
 * decides which release the provider considers, `channel` which `.yml` it
 * fetches. The GitHub provider still falls back to `latest.yml` when a
 * channel's file is missing, which is why beta releases must ship `beta.yml`
 * (the beta workflow builds a `-beta.N` version for exactly that reason).
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

const showUpdateAvailable = (version: string, updateChannel: UpdateChannel) => {
  const downloadLink =
    updateChannel === 'beta'
      ? `${REPO_URL}/releases/tag/v${version}`
      : `${REPO_URL}/releases/latest`;

  dialogOpen = true;
  ask({
    type: 'info',
    buttons: [
      t('main.dialog.update-available.buttons.ok'),
      t('main.dialog.update-available.buttons.download'),
      t('main.dialog.update-available.buttons.disable'),
    ],
    title: t('main.dialog.update-available.title'),
    message: t('main.dialog.update-available.message'),
    detail: t('main.dialog.update-available.detail', { downloadLink }),
    defaultId: 1,
    cancelId: 0,
  })
    .then((answer) => {
      if (answer.response === 1) shell.openExternal(downloadLink);
      if (answer.response === 2) config.set('options.autoUpdates', false);
    })
    .catch((err) => {
      console.error(LoggerPrefix, 'Failed to show update dialog:', err);
    })
    .finally(() => {
      dialogOpen = false;
    });
};

/**
 * A dev build has no feed to update along, so all it can report is whether the
 * commit it was baked from still is the tip of master.
 */
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
 * Warns before switching to stable when this run is a beta: the store has been
 * through this beta's migrations already, and a downgrade runs none of them
 * back, which is what can reset settings.
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
 * user backs out, so callers can re-read the store instead of keeping an
 * optimistic value.
 */
export const setUpdateChannel = async (value: string): Promise<boolean> => {
  if (value !== 'stable' && value !== 'beta') return false;
  if (config.updateChannel() === value) return true;

  if (isBetaVersion(app.getVersion()) && value === 'stable') {
    if (!(await confirmDowngrade())) return false;
  }

  config.set('options.updateChannel', value);
  // A check right after the switch has to read the new channel, not the old one.
  applyChannel(value);
  return true;
};

/**
 * Runs one update check, retrying a failure a couple of times (see `withRetry`).
 * The updater resolves with `updateInfo` whether or not anything is newer, so
 * the flag is what decides whether there is an update to announce.
 */
export const runUpdateCheck = async (): Promise<void> => {
  const outcome = await withRetry(
    () => autoUpdater.checkForUpdates(),
    (err, attempt, last) => {
      console.debug(
        LoggerPrefix,
        `Update check attempt ${attempt} of ${CHECK_ATTEMPTS} failed${last ? ' (giving up)' : ', retrying'}:`,
        err,
      );
    },
  );

  if (!outcome.ok) return;

  const { isUpdateAvailable, updateInfo } = outcome.value ?? {};
  if (isUpdateAvailable && updateInfo && !dialogOpen) {
    showUpdateAvailable(updateInfo.version, config.updateChannel());
  }
};

/**
 * Checks the channel the user follows and reports what it finds. The dialog is
 * raised from the returned update info, so one check pops exactly one dialog.
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
  // The dialog offers the download instead of letting the updater grab it.
  autoUpdater.autoDownload = false;

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
    console.debug(LoggerPrefix, 'Updater error:', err);
  });

  /** Looks again later, so betas landing mid-session are still noticed. */
  const startRepeating = () => {
    clearInterval(repeatCheck);
    repeatCheck = setInterval(() => {
      checkForAppUpdates().catch(() => {});
    }, RECHECK_MS);
    // Never hold the app open just for a timer.
    repeatCheck.unref?.();
  };

  if (config.get('options.autoUpdates')) {
    const timeout = setTimeout(() => {
      checkForAppUpdates().catch(() => {});
      clearTimeout(timeout);
    }, 2000);
    startRepeating();
  }

  config.watch((newValue, oldValue) => {
    // A channel switched while the window is open has to be honoured.
    const before = (oldValue?.options as { updateChannel?: UpdateChannel })
      ?.updateChannel;
    const after = (newValue?.options as { updateChannel?: UpdateChannel })
      ?.updateChannel;
    if (before !== after && (after === 'stable' || after === 'beta')) {
      applyChannel(after);
    }

    // Turning auto-updates off stops the repeating check, turning it back on
    // starts one, both without a restart.
    if (config.get('options.autoUpdates')) startRepeating();
    else clearInterval(repeatCheck);
  });
};
