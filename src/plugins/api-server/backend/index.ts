import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import { serve, type ServerType } from '@hono/node-server';
import { WebSocketServer } from 'ws';

import {
  SONG_INFO_SETUP_CHANNEL,
  SongInfoEventFlag,
} from '@/types/song-info-events';
import { LoggerPrefix, createBackend } from '@/utils';

import { buildApp } from './app';
import { subscribeIpc } from './ipc';
import { createPlayerState, type PlayerState } from './state';

import type { APIServerConfig } from '../config';
import type { OpenAPIHono } from '@hono/zod-openapi';

/**
 * Renderer listeners the API server needs so the player state it reports stays
 * current. Requested again on every `player-api-loaded`, since the renderer
 * reloads independently of this plugin.
 */
const PLAYER_STATE_EVENTS =
  SongInfoEventFlag.Seeked |
  SongInfoEventFlag.TimeChanged |
  SongInfoEventFlag.RepeatChanged |
  SongInfoEventFlag.VolumeChanged |
  SongInfoEventFlag.ShuffleChanged |
  SongInfoEventFlag.LikeChanged |
  SongInfoEventFlag.PlaybackSpeedChanged;

/** Config changes that require rebuilding the HTTP server. */
const SERVER_KEYS = [
  'hostname',
  'port',
  'useHttps',
  'certPath',
  'keyPath',
] as const;

export type BackendType = {
  app?: OpenAPIHono;
  server?: ServerType;
  playerState?: PlayerState;
  oldConfig?: APIServerConfig;
  stopWebsocket?: () => void;
  detachRenderer?: () => void;

  run: (config: APIServerConfig) => void;
  end: () => Promise<void>;
};

export const backend = createBackend<BackendType, APIServerConfig>({
  async start(ctx) {
    const { app: electronApp } = await import('electron');

    this.playerState = createPlayerState();
    const { app, stopWebsocket } = buildApp(ctx, this.playerState);
    this.app = app;
    this.stopWebsocket = stopWebsocket;

    const unsubscribePlayerApiLoaded = subscribeIpc(
      'peard:player-api-loaded',
      () => {
        ctx.ipc.send(SONG_INFO_SETUP_CHANNEL, PLAYER_STATE_EVENTS);
      },
    );

    // Notify WebSocket clients playback stopped before the app goes away.
    const onBeforeQuit = () => this.playerState?.notifyStopped();
    electronApp.on('before-quit', onBeforeQuit);

    this.detachRenderer = () => {
      unsubscribePlayerApiLoaded();
      electronApp.removeListener('before-quit', onBeforeQuit);
    };

    this.run(await ctx.getConfig());
  },

  async stop() {
    await this.end();
    // The WebSocket subscriptions outlive the HTTP server, so they are released
    // here, once, rather than in `end()` — which also runs when a config change
    // restarts the server under the same app.
    this.stopWebsocket?.();
    this.stopWebsocket = undefined;
    this.detachRenderer?.();
    this.detachRenderer = undefined;
    this.playerState?.stop();
    this.playerState = undefined;
  },

  async onConfigChange(config) {
    const previous = this.oldConfig;
    this.oldConfig = config;

    if (previous && SERVER_KEYS.every((key) => previous[key] === config[key])) {
      return;
    }

    await this.end();
    this.run(config);
  },

  run(config) {
    if (!this.app) {
      return;
    }

    const useHttps = config.useHttps && !!config.certPath && !!config.keyPath;
    const common = {
      fetch: this.app.fetch.bind(this.app),
      port: config.port,
      hostname: config.hostname?.trim() || '127.0.0.1',
      websocket: { server: new WebSocketServer({ noServer: true }) },
    };

    try {
      const server = useHttps
        ? serve({
            ...common,
            createServer: createHttpsServer,
            serverOptions: {
              key: readFileSync(config.keyPath),
              cert: readFileSync(config.certPath),
            },
          })
        : serve({ ...common, createServer: createHttpServer });

      // A port already in use emits 'error' asynchronously; without a listener
      // that would take the whole app down.
      server.on('error', (err) => {
        console.error(LoggerPrefix, 'API server error:', err);
      });

      this.server = server;
    } catch (err) {
      console.error(LoggerPrefix, 'Failed to start API server:', err);
    }
  },

  async end() {
    const server = this.server;
    this.server = undefined;

    this.playerState?.notifyStopped();

    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => {
      // close() alone waits for open connections, which WebSocket clients never
      // give up on their own.
      if ('closeAllConnections' in server) {
        server.closeAllConnections();
      }
      server.close(() => resolve());
    });
  },
});
