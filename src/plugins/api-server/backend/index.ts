import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import { serve, type ServerType } from '@hono/node-server';
import { WebSocketServer } from 'ws';

import { LoggerPrefix, createBackend } from '@/utils';

import { buildApp } from './app';
import { createPlayerState, type PlayerState } from './state';

import type { APIServerConfig } from '../config';
import type { OpenAPIHono } from '@hono/zod-openapi';

/**
 * Renderer listeners the API server needs so the player state it reports stays
 * current. Requested again on every `player-api-loaded`, since the renderer
 * reloads independently of this plugin.
 */
const RENDERER_SETUP_CHANNELS = [
  'peard:setup-seeked-listener',
  'peard:setup-time-changed-listener',
  'peard:setup-repeat-changed-listener',
  'peard:setup-volume-changed-listener',
  'peard:setup-shuffle-changed-listener',
];

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
    const { app: electronApp, ipcMain } = await import('electron');

    this.playerState = createPlayerState();
    const { app, stopWebsocket } = buildApp(ctx, this.playerState);
    this.app = app;
    this.stopWebsocket = stopWebsocket;

    // Registered on ipcMain directly so stop() can remove exactly this
    // listener; ctx.ipc.on wraps handlers anonymously and only supports
    // removeAllListeners, which would drop other plugins' listeners too.
    const onPlayerApiLoaded = () => {
      for (const channel of RENDERER_SETUP_CHANNELS) {
        ctx.ipc.send(channel);
      }
    };
    ipcMain.on('peard:player-api-loaded', onPlayerApiLoaded);

    // Notify WebSocket clients playback stopped before the app goes away.
    const onBeforeQuit = () => this.playerState?.notifyStopped();
    electronApp.on('before-quit', onBeforeQuit);

    this.detachRenderer = () => {
      ipcMain.removeListener('peard:player-api-loaded', onPlayerApiLoaded);
      electronApp.removeListener('before-quit', onBeforeQuit);
    };

    this.run(await ctx.getConfig());
  },

  async stop() {
    await this.end();
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
      hostname: config.hostname,
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
    this.stopWebsocket?.();

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
