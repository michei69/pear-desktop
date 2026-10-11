import { Client as DiscordClient } from '@xhayper/discord-rpc';
import { ActivityType } from 'discord-api-types/v10';
import is from 'electron-is';

import { t } from '@/i18n';
import { LoggerPrefix } from '@/utils';

import { clientId, PROGRESS_THROTTLE_MS, TimerKey } from './constants';
import { TimerManager } from './timer-manager';
import {
  buildDiscordButtons,
  padHangulFields,
  sanitizeActivityText,
  isSeek,
} from './utils';

import type { DiscordPluginConfig } from './index';
import type { SongInfo } from '@/providers/song-info';
import type { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser';

export class DiscordService {
  rpc!: DiscordClient;
  ready = false;
  autoReconnect = true;
  lastSongInfo?: SongInfo;
  lastProgressUpdate = 0;
  config?: DiscordPluginConfig;
  refreshCallbacks: (() => void)[] = [];
  timerManager = new TimerManager();

  mainWindow: Electron.BrowserWindow;

  constructor(
    mainWindow: Electron.BrowserWindow,
    config?: DiscordPluginConfig,
  ) {
    this.config = config;
    this.mainWindow = mainWindow;
    this.autoReconnect = config?.autoReconnect ?? true;

    this.initializeRpc();
  }

  private initializeRpc() {
    if (this.rpc) {
      try {
        this.rpc.destroy();
      } catch {
        // ignored
      }
      this.rpc.removeAllListeners();
    }

    this.rpc = new DiscordClient({ clientId });

    this.rpc.on('connected', () => {
      if (is.dev()) {
        console.log(LoggerPrefix, t('plugins.discord.backend.connected'));
      }
      this.refreshCallbacks.forEach((cb) => cb());
    });

    this.rpc.on('ready', () => {
      this.ready = true;
      if (this.lastSongInfo && this.config) {
        this.updateActivity(this.lastSongInfo);
      }
    });

    this.rpc.on('disconnected', () => {
      this.resetInfo();
      if (this.autoReconnect) {
        this.connectRecursive();
      }
    });
  }

  private buildActivityInfo(
    songInfo: SongInfo,
    config: DiscordPluginConfig,
  ): SetActivity {
    padHangulFields(songInfo);

    const activityInfo: SetActivity = {
      type: ActivityType.Listening,
      statusDisplayType: config.statusDisplayType,
      details: sanitizeActivityText(
        songInfo.alternativeTitle ?? songInfo.title,
      ),
      detailsUrl: songInfo.url ?? undefined,
      state: sanitizeActivityText(songInfo.tags?.at(0) ?? songInfo.artist),
      stateUrl: songInfo.artistUrl,
      largeImageKey: songInfo.imageSrc ?? undefined,
      largeImageText: songInfo.album
        ? sanitizeActivityText(songInfo.album)
        : undefined,
      buttons: buildDiscordButtons(config, songInfo),
    };

    if (songInfo.isPaused) {
      activityInfo.largeImageText = '⏸︎';
    } else if (
      !config.hideDurationLeft &&
      songInfo.songDuration > 0 &&
      typeof songInfo.elapsedSeconds === 'number'
    ) {
      const songStartTime = Date.now() - songInfo.elapsedSeconds * 1000;
      activityInfo.startTimestamp = Math.floor(songStartTime / 1000);
      activityInfo.endTimestamp = Math.floor(
        (songStartTime + songInfo.songDuration * 1000) / 1000,
      );
    }

    return activityInfo;
  }

  private setActivityTimeout() {
    this.timerManager.clear(TimerKey.ClearActivity);

    if (
      this.lastSongInfo?.isPaused === true &&
      this.config?.activityTimeoutEnabled &&
      this.config?.activityTimeoutTime &&
      this.config.activityTimeoutTime > 0
    ) {
      this.timerManager.set(
        TimerKey.ClearActivity,
        () => {
          this.clearActivity();
        },
        this.config.activityTimeoutTime,
      );
    }
  }

  private resetInfo() {
    this.ready = false;
    this.lastSongInfo = undefined;
    this.lastProgressUpdate = 0;
    this.timerManager.clearAll();
    if (is.dev()) {
      console.log(LoggerPrefix, t('plugins.discord.backend.disconnected'));
    }
  }

  private connectWithRetry(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.timerManager.set(
        TimerKey.DiscordConnectRetry,
        () => {
          if (!this.autoReconnect || this.rpc.isConnected) {
            this.timerManager.clear(TimerKey.DiscordConnectRetry);
            if (this.rpc.isConnected) resolve();
            else
              reject(
                new Error('Auto-reconnect disabled or already connected.'),
              );
            return;
          }

          this.rpc
            .login()
            .then(() => {
              this.timerManager.clear(TimerKey.DiscordConnectRetry);
              resolve();
            })
            .catch(() => {
              this.initializeRpc();
              this.connectRecursive();
            });
        },
        5000,
      );
    });
  }

  private connectRecursive = () => {
    if (!this.autoReconnect || this.rpc.isConnected) {
      this.timerManager.clear(TimerKey.DiscordConnectRetry);
      return;
    }
    this.connectWithRetry();
  };

  connect(showErrorDialog = false): void {
    if (this.rpc.isConnected) {
      if (is.dev()) {
        console.log(
          LoggerPrefix,
          t('plugins.discord.backend.already-connected'),
        );
      }
      return;
    }
    if (!this.config) {
      return;
    }

    this.ready = false;
    this.timerManager.clear(TimerKey.DiscordConnectRetry);

    this.rpc.login().catch(() => {
      this.resetInfo();

      if (this.autoReconnect) {
        // HACK: @xhayper/discord-rpc leaves a dangling listener on connection failure,
        // so recreate the client before reconnecting
        this.initializeRpc();
        this.connectRecursive();
      } else if (showErrorDialog && this.mainWindow) {
        // connection failed
      }
    });
  }

  disconnect(): void {
    this.autoReconnect = false;
    this.timerManager.clear(TimerKey.DiscordConnectRetry);
    this.timerManager.clear(TimerKey.ClearActivity);
    try {
      this.rpc.removeAllListeners();
      this.rpc.destroy();
    } catch {
      // ignored
    }
    this.resetInfo();
  }

  /**
   * Song, pause or seek changes update immediately; plain progress is throttled
   * to PROGRESS_THROTTLE_MS, with a deferred update scheduled in between.
   */
  updateActivity(songInfo: SongInfo): void {
    if (!this.config) return;

    if (!songInfo.title && !songInfo.artist) {
      if (this.lastSongInfo?.videoId) {
        this.clearActivity();
        this.lastSongInfo = undefined;
      }
      return;
    }

    this.timerManager.clear(TimerKey.ClearActivity);

    if (!this.rpc || !this.ready) {
      return;
    }

    const now = Date.now();
    const elapsedSeconds = songInfo.elapsedSeconds ?? 0;

    const songChanged = songInfo.videoId !== this.lastSongInfo?.videoId;
    const pauseChanged = songInfo.isPaused !== this.lastSongInfo?.isPaused;
    const seeked =
      !songChanged &&
      isSeek(this.lastSongInfo?.elapsedSeconds ?? 0, elapsedSeconds);

    if (
      (songChanged || pauseChanged || seeked) &&
      this.lastSongInfo !== undefined
    ) {
      this.timerManager.clear(TimerKey.UpdateTimeout);

      const activityInfo = this.buildActivityInfo(songInfo, this.config);
      this.rpc.user
        ?.setActivity(activityInfo)
        .catch((err) =>
          console.error(LoggerPrefix, 'Failed to set activity:', err),
        );

      this.lastSongInfo.videoId = songInfo.videoId;
      this.lastSongInfo.isPaused = songInfo.isPaused ?? false;
      this.lastSongInfo.elapsedSeconds = elapsedSeconds;
      this.lastProgressUpdate = now;

      this.setActivityTimeout();
    } else if (now - this.lastProgressUpdate > PROGRESS_THROTTLE_MS) {
      this.timerManager.clear(TimerKey.UpdateTimeout);

      const activityInfo = this.buildActivityInfo(songInfo, this.config);
      this.rpc.user
        ?.setActivity(activityInfo)
        .catch((err) =>
          console.error(LoggerPrefix, 'Failed to set throttled activity:', err),
        );

      this.lastProgressUpdate = now;
      this.setActivityTimeout();
    } else {
      const remainingThrottle =
        PROGRESS_THROTTLE_MS - (now - this.lastProgressUpdate);
      const songInfoSnapshot = { ...songInfo };

      this.timerManager.set(
        TimerKey.UpdateTimeout,
        () => {
          if (
            this.lastSongInfo?.videoId === songInfoSnapshot.videoId &&
            this.lastSongInfo?.isPaused === songInfoSnapshot.isPaused &&
            this.config
          ) {
            const activityInfo = this.buildActivityInfo(
              songInfoSnapshot,
              this.config,
            );
            this.rpc.user?.setActivity(activityInfo);
            this.lastProgressUpdate = Date.now();
            this.lastSongInfo.elapsedSeconds =
              songInfoSnapshot.elapsedSeconds ?? 0;
            this.setActivityTimeout();
          }
        },
        remainingThrottle,
      );
    }
    this.lastSongInfo = { ...songInfo };
  }

  clearActivity(): void {
    if (this.rpc.isConnected && this.ready) {
      this.rpc.user?.clearActivity();
    }
    this.lastProgressUpdate = 0;
    this.lastSongInfo = undefined;
    this.timerManager.clear(TimerKey.ClearActivity);
    this.timerManager.clear(TimerKey.UpdateTimeout);
  }

  onConfigChange(newConfig: DiscordPluginConfig): void {
    this.config = newConfig;
    this.autoReconnect = newConfig.autoReconnect ?? true;

    if (this.lastSongInfo && this.ready && this.rpc.isConnected) {
      this.updateActivity(this.lastSongInfo);
    }

    this.setActivityTimeout();
  }

  registerRefreshCallback(cb: () => void): void {
    this.refreshCallbacks.push(cb);
  }

  isConnected(): boolean {
    return this.rpc.isConnected && this.ready;
  }

  cleanup(): void {
    this.disconnect();
    this.refreshCallbacks = [];
  }
}
