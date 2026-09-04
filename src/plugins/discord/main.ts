import { app } from 'electron';

import {
  registerCallback,
  SongInfoEvent,
  unregisterCallback,
  type SongInfo,
} from '@/providers/song-info';
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
    // Get initial configuration from the context
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
      ctx.ipc.send('peard:setup-time-changed-listener');
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
      // The song-info callback may not be registered yet if the plugin was
      // enabled after startup — register it before connecting so activity
      // updates flow once the RPC client is ready.
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
