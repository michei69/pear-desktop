import { app } from 'electron';

import {
  registerCallback,
  SongInfoEvent,
  unregisterCallback,
  type SongInfo,
} from '@/providers/song-info';
import {
  SONG_INFO_SETUP_CHANNEL,
  SongInfoEventFlag,
} from '@/types/song-info-events';
import { createBackend } from '@/utils';

import { TIME_UPDATE_DEBOUNCE_MS } from './constants';
import { DiscordService } from './discord-service';

import type { DiscordPluginConfig } from './index';

export let discordService = null as DiscordService | null;

export const backend = createBackend<
  {
    config?: DiscordPluginConfig;
    lastTimeUpdateSent: number;
    songInfoCallback?: (songInfo: SongInfo, event: SongInfoEvent) => void;
  },
  DiscordPluginConfig
>({
  lastTimeUpdateSent: 0,

  async start(ctx) {
    const config = await ctx.getConfig();
    discordService = new DiscordService(ctx.window, config);

    if (config.enabled) {
      ctx.window.once('ready-to-show', () => {
        this.songInfoCallback = (songInfo, event) => {
          if (!discordService?.isConnected()) return;

          if (event !== SongInfoEvent.TimeChanged) {
            discordService?.updateActivity(songInfo);
            this.lastTimeUpdateSent = Date.now();
          } else {
            const now = Date.now();
            if (now - this.lastTimeUpdateSent > TIME_UPDATE_DEBOUNCE_MS) {
              discordService?.updateActivity(songInfo);
              this.lastTimeUpdateSent = now;
            }
          }
        };

        registerCallback(this.songInfoCallback);
        discordService?.connect(!config.autoReconnect);
      });
    }

    ctx.ipc.on('peard:player-api-loaded', () => {
      ctx.ipc.send(SONG_INFO_SETUP_CHANNEL, SongInfoEventFlag.TimeChanged);
    });

    app.on('before-quit', () => {
      discordService?.cleanup();
    });
  },

  stop() {
    if (this.songInfoCallback) {
      unregisterCallback(this.songInfoCallback);
    }
    discordService?.cleanup();
  },

  onConfigChange(newConfig) {
    discordService?.onConfigChange(newConfig);

    const currentlyConnected = discordService?.isConnected() ?? false;
    if (newConfig.enabled && !currentlyConnected) {
      // Enabling after startup skips the ready-to-show registration, so register
      // the callback before connecting
      if (!this.songInfoCallback) {
        this.songInfoCallback = (songInfo, event) => {
          if (!discordService?.isConnected()) return;

          if (event !== SongInfoEvent.TimeChanged) {
            discordService?.updateActivity(songInfo);
            this.lastTimeUpdateSent = Date.now();
          } else {
            const now = Date.now();
            if (now - this.lastTimeUpdateSent > TIME_UPDATE_DEBOUNCE_MS) {
              discordService?.updateActivity(songInfo);
              this.lastTimeUpdateSent = now;
            }
          }
        };
        registerCallback(this.songInfoCallback);
      }
      discordService?.connect(!newConfig.autoReconnect);
    } else if (!newConfig.enabled && currentlyConnected) {
      discordService?.disconnect();
    }
  },
});
