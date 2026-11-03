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

const createSongInfoCallback = (state: { lastTimeUpdateSent: number }) => {
  return (songInfo: SongInfo, event: SongInfoEvent) => {
    if (!discordService?.isConnected()) {
      return;
    }

    if (event !== SongInfoEvent.TimeChanged) {
      discordService.updateActivity(songInfo);
      state.lastTimeUpdateSent = Date.now();
      return;
    }

    const now = Date.now();
    if (now - state.lastTimeUpdateSent > TIME_UPDATE_DEBOUNCE_MS) {
      discordService.updateActivity(songInfo);
      state.lastTimeUpdateSent = now;
    }
  };
};

export const backend = createBackend<
  {
    config?: DiscordPluginConfig;
    lastTimeUpdateSent: number;
    songInfoCallback?: (songInfo: SongInfo, event: SongInfoEvent) => void;
    playerApiLoadedHandler?: () => void;
    beforeQuitHandler?: () => void;
    readyToShowHandler?: () => void;
    generation: number;
    startService(): void;
  },
  DiscordPluginConfig
>({
  lastTimeUpdateSent: 0,
  generation: 0,

  async start(ctx) {
    const currentGeneration = ++this.generation;
    const config = await ctx.getConfig();
    if (currentGeneration !== this.generation) return;
    discordService = new DiscordService(config);

    // HACK: 'ready-to-show' is emitted once per window, so a plugin enabled
    // mid-session would wait for it forever; only defer while the page is
    // still unloaded.
    if (ctx.window.isVisible() || ctx.window.webContents.getURL()) {
      this.startService();
    } else {
      this.readyToShowHandler = () => this.startService();
      ctx.window.once('ready-to-show', this.readyToShowHandler);
    }

    this.playerApiLoadedHandler = () => {
      ctx.ipc.send(SONG_INFO_SETUP_CHANNEL, SongInfoEventFlag.TimeChanged);
    };
    ctx.ipc.on('peard:player-api-loaded', this.playerApiLoadedHandler);

    this.beforeQuitHandler = () => discordService?.cleanup();
    app.on('before-quit', this.beforeQuitHandler);
  },

  startService() {
    this.readyToShowHandler = undefined;

    if (!this.songInfoCallback) {
      this.songInfoCallback = createSongInfoCallback(this);
      registerCallback(this.songInfoCallback);
    }

    discordService?.connect();
  },

  stop(ctx) {
    this.generation++;
    if (this.readyToShowHandler) {
      ctx.window.removeListener('ready-to-show', this.readyToShowHandler);
      this.readyToShowHandler = undefined;
    }

    if (this.playerApiLoadedHandler) {
      ctx.ipc.off('peard:player-api-loaded', this.playerApiLoadedHandler);
      this.playerApiLoadedHandler = undefined;
    }

    if (this.beforeQuitHandler) {
      app.off('before-quit', this.beforeQuitHandler);
      this.beforeQuitHandler = undefined;
    }

    if (this.songInfoCallback) {
      unregisterCallback(this.songInfoCallback);
      this.songInfoCallback = undefined;
    }

    discordService?.cleanup();
    discordService = null;
  },

  onConfigChange(newConfig) {
    discordService?.onConfigChange(newConfig);

    if (this.readyToShowHandler) return;

    if (newConfig.enabled && !(discordService?.isConnected() ?? false)) {
      this.startService();
    }
  },
});
