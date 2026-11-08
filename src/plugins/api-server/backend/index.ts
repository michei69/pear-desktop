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
 * current. Requested on every `player-api-loaded`, and once when the backend
 * starts, since a live enable happens after that signal has already fired.
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

  /**
   * Whether this backend owns a listener. `server === undefined` alone cannot
   * tell "never started" from "stopped", and a restart needs to know both.
   */
  phase: 'idle' | 'serving' | 'stopped';
  /** Serialises restarts and stops so two config writes cannot overlap. */
  lifecycle: Promise<void>;

  serialize: <T>(task: () => Promise<T> | T) => Promise<T>;
  run: (config: APIServerConfig) => void;
  closeServer: () => Promise<void>;
  end: () => Promise<void>;
};

export const backend = createBackend<BackendType, APIServerConfig>({
  phase: 'idle',
  lifecycle: Promise.resolve(),

  serialize<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.lifecycle.then(task, task);
    this.lifecycle = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  },

  async start(ctx) {
    const { app: electronApp } = await import('electron');

    this.playerState = createPlayerState();
    const { app, stopWebsocket } = buildApp(ctx, this.playerState);
    this.app = app;
    this.stopWebsocket = stopWebsocket;

    const requestPlayerState = () => {
      ctx.ipc.send(SONG_INFO_SETUP_CHANNEL, PLAYER_STATE_EVENTS);
    };

    const unsubscribePlayerApiLoaded = subscribeIpc(
      'peard:player-api-loaded',
      requestPlayerState,
    );

    // Notify WebSocket clients playback stopped before the app goes away.
    const onBeforeQuit = () => this.playerState?.notifyStopped();
    electronApp.on('before-quit', onBeforeQuit);

    this.detachRenderer = () => {
      unsubscribePlayerApiLoaded();
      electronApp.removeListener('before-quit', onBeforeQuit);
    };

    const config = await ctx.getConfig();
    await this.serialize(() => {
      this.run(config);
      // A config change that landed while the config was loading already owns
      // the newer snapshot; don't overwrite it with the stale one.
      this.oldConfig ??= config;
    });
    requestPlayerState();
  },

  async stop() {
    await this.serialize(async () => {
      await this.closeServer();
      // The WebSocket subscriptions outlive the HTTP server, so they are
      // released here, once, rather than in `closeServer()` — which also runs
      // when a config change restarts the server under the same app.
      this.stopWebsocket?.();
      this.stopWebsocket = undefined;
      this.detachRenderer?.();
      this.detachRenderer = undefined;
      this.playerState?.stop();
      this.playerState = undefined;
      this.phase = 'stopped';
    });
  },

  async onConfigChange(config) {
    const previous = this.oldConfig;
    this.oldConfig = config;

    if (previous && SERVER_KEYS.every((key) => previous[key] === config[key])) {
      return;
    }

    // A restart is a close followed by a listen. `closeServer` drops the handle
    // before it awaits, so without serialisation a second config write landing
    // in that window would start a second listener whose handle overwrites the
    // first one and can never be closed.
    await this.serialize(async () => {
      await this.closeServer();
      this.run(config);
    });
  },

  run(config) {
    // One listener at a time: the mode says whether one is already owned.
    if (!this.app || this.phase === 'serving') {
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
      server.on('error', (err: NodeJS.ErrnoException) => {
        console.error(LoggerPrefix, 'API server error:', err);
        // A failed bind leaves a dead handle behind: drop it so the mode is
        // honest and the next restart is not blocked by a phantom listener.
        if (this.server === server && err?.code === 'EADDRINUSE') {
          this.server = undefined;
          this.phase = 'stopped';
        }
      });

      this.server = server;
      this.phase = 'serving';
    } catch (err) {
      this.phase = 'stopped';
      console.error(LoggerPrefix, 'Failed to start API server:', err);
    }
  },

  async closeServer() {
    const server = this.server;
    this.server = undefined;
    if (this.phase !== 'idle') this.phase = 'stopped';

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

  async end() {
    await this.serialize(async () => {
      await this.closeServer();
    });
  },
});
