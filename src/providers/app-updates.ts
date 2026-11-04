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
const feedChannel = (updateChannel: UpdateChannel) =>
  updateChannel === 'beta' ? 'beta' : 'latest';
const RECHECK_MS = 6 * 60 * 60 * 1000;

let win: BrowserWindow | null = null;
let dialogOpen = false;
let downloading = false;
let repeatCheck: NodeJS.Timeout | undefined;

const ask = (options: Electron.MessageBoxOptions) =>
  win && !win.isDestroyed()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options);

const supportsInAppInstall = () => {
  if (process.platform === 'darwin') return true;
  if (process.platform === 'win32') {
    return !process.env.PORTABLE_EXECUTABLE_DIR && !process.env.PORTABLE_EXECUTABLE_FILE;
  }
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  return false;
};

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
    });
};

const startDownload = (downloadLink: string) => {
  if (downloading) return;
  downloading = true;
  win?.setProgressBar(0, { mode: 'indeterminate' });
  autoUpdater
    .downloadUpdate()
    .catch((err) => {
      downloading = false;
      win?.setProgressBar(-1);
      console.error(LoggerPrefix, 'Failed to download update:', err);
      showDownloadFailure(downloadLink);
    });
};

const showUpdateAvailable = (version: string, updateChannel: UpdateChannel) => {
  const downloadLink = releaseLink(version, updateChannel);
  const canInstall = supportsInAppInstall();
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
        if (canInstall) startDownload(downloadLink);
        else shell.openExternal(downloadLink);
      }
      if (answer.response === 2) config.set('options.autoUpdates', false);
    })
    .catch((err) => {
      console.error(LoggerPrefix, 'Failed to show update dialog:', err);
    })
    .finally(() => {
      dialogOpen = false;
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

export const setUpdateChannel = async (value: string): Promise<boolean> => {
  if (value !== 'stable' && value !== 'beta') return false;
  if (config.updateChannel() === value) return true;

  if (isBetaVersion(app.getVersion()) && value === 'stable') {
    if (!(await confirmDowngrade())) return false;
  }

  config.set('options.updateChannel', value);
  applyChannel(value);
  return true;
};

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
  if (isUpdateAvailable && updateInfo && !dialogOpen && !downloading) {
    showUpdateAvailable(updateInfo.version, config.updateChannel());
  }
};

export const checkForAppUpdates = async (): Promise<void> => {
  if (!updatesSupported()) {
    await checkDevCommit();
    return;
  }

  applyChannel(config.updateChannel());
  await runUpdateCheck();
};

export const setupAutoUpdates = (mainWindow: BrowserWindow) => {
  win = mainWindow;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  if (!updatesSupported()) {
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

  autoUpdater.on('download-progress', (progress) => {
    if (!downloading) return;
    const percent = Number.isFinite(progress.percent)
      ? Math.min(100, Math.max(0, progress.percent))
      : 0;
    win?.setProgressBar(percent / 100);
  });

  autoUpdater.on('update-downloaded', (update) => {
    downloading = false;
    win?.setProgressBar(-1);
    dialogOpen = true;
    ask({
      type: 'info',
      buttons: [
        t('main.dialog.update-downloaded.buttons.restart'),
        t('main.dialog.update-downloaded.buttons.later'),
      ],
      title: t('main.dialog.update-downloaded.title'),
      message: t('main.dialog.update-downloaded.message', {
        version: update.version,
      }),
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
      });
  });

  const startRepeating = () => {
    clearInterval(repeatCheck);
    repeatCheck = setInterval(() => {
      checkForAppUpdates().catch(() => {});
    }, RECHECK_MS);
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
    const before = (oldValue?.options as { updateChannel?: UpdateChannel })
      ?.updateChannel;
    const after = (newValue?.options as { updateChannel?: UpdateChannel })
      ?.updateChannel;
    if (before !== after && (after === 'stable' || after === 'beta')) {
      applyChannel(after);
    }

    if (config.get('options.autoUpdates')) startRepeating();
    else clearInterval(repeatCheck);
  });
};
