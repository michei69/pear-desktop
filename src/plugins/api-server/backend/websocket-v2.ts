import { upgradeWebSocket, type WebSocketLike } from '@hono/node-server';
import { type OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import { ipcMain, type BrowserWindow } from 'electron';

import { sendToRenderer } from './ipc';
import { createWsAuthenticator, createWsRoute } from './websocket';
import { runCommand, type WsCommandActions } from './ws-commands';

import {
  ApiActions,
  V2RendererEvents,
  type LyricsChangedPayload,
  type TranslationUpdatedPayload,
} from '../channels';

import type { APIServerConfig } from '../config';
import type { PlayerState } from './state';
import type { BackendContext } from '@/types/contexts';
import type { LikeType } from '@/types/datahost-get-state';
import type { WSContext } from 'hono/ws';

/** v2's connect payload: v1's snapshot plus speed and the current rating. */
const playerInfo = (playerState: PlayerState) => ({
  type: 'PLAYER_INFO',
  ...playerState.snapshot(),
  speed: playerState.speed ?? 1,
  rating: playerState.rating,
});

/** Wires the commands to the same renderer actions the HTTP routes use. */
const createCommandActions = (window: BrowserWindow): WsCommandActions => ({
  next: () => sendToRenderer(window, ApiActions.nextVideo),
  previous: () => sendToRenderer(window, ApiActions.previousVideo),
  play: () => sendToRenderer(window, ApiActions.play),
  pause: () => sendToRenderer(window, ApiActions.pause),
  setSpeed: (speed) =>
    sendToRenderer(window, ApiActions.setPlaybackSpeed, speed),
  seek: (position) => sendToRenderer(window, ApiActions.seekTo, position),
  setShuffle: (enabled) =>
    sendToRenderer(window, ApiActions.setShuffle, enabled),
  setRepeat: (mode) => sendToRenderer(window, ApiActions.setRepeat, mode),
  setVolume: (volume) => sendToRenderer(window, ApiActions.setVolume, volume),
  setMute: (muted) => sendToRenderer(window, ApiActions.setMute, muted),
  rate: (rating) => sendToRenderer(window, ApiActions.setLikeState, rating),
});

/**
 * v2's WebSocket: v1's player events, plus rating, lyrics and translation
 * pushes from the renderer, plus client→server commands. Commands are never
 * answered — every change comes back as a broadcast event.
 */
export const registerV2Websocket = (
  app: OpenAPIHono,
  { window, getConfig }: BackendContext<APIServerConfig>,
  playerState: PlayerState,
  path: string,
  tags: string[] = [],
) => {
  const sockets = new Set<WSContext<WebSocketLike>>();
  const broadcast = (payload: unknown) => {
    const message = JSON.stringify(payload);
    for (const socket of sockets) {
      socket.send(message);
    }
  };

  // The last pushed lyrics/translation, so a socket that joins later catches up
  // without waiting for the next change.
  let lastLyrics: LyricsChangedPayload | null = null;
  let lastTranslation: TranslationUpdatedPayload | null = null;

  const teardown: (() => void)[] = [
    playerState.subscribe((event) => {
      broadcast(event);
      // The app clears the displayed translation with the song.
      if (event.type === 'VIDEO_CHANGED') lastTranslation = null;
    }),
  ];

  // Exact-listener removal: `ctx.ipc.on` wraps handlers and can only remove all
  // listeners on the channel, which would drop other plugins' listeners too.
  const listen = <T>(channel: string, handler: (payload: T) => void) => {
    const listener = (_: unknown, payload: T) => handler(payload);
    ipcMain.on(channel, listener);
    teardown.push(() => ipcMain.removeListener(channel, listener));
  };

  let lastRating: LikeType | undefined;
  listen<LikeType>('peard:like-changed', (rating) => {
    if (rating === lastRating) return;
    lastRating = rating;
    broadcast({ type: 'RATING_CHANGED', rating });
  });
  listen<LyricsChangedPayload | null>(
    V2RendererEvents.lyricsChanged,
    (lyrics) => {
      lastLyrics = lyrics;
      if (lyrics) broadcast({ type: 'LYRICS_CHANGED', ...lyrics });
    },
  );
  listen<TranslationUpdatedPayload>(
    V2RendererEvents.translationUpdated,
    (translation) => {
      lastTranslation = translation;
      broadcast({ type: 'TRANSLATION_UPDATED', ...translation });
    },
  );

  const authenticate = createWsAuthenticator(getConfig);
  const actions = createCommandActions(window);

  const handler = upgradeWebSocket((ctx) => ({
    async onOpen(_, ws) {
      if (!(await authenticate(ctx.req.query('token')))) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      sockets.add(ws);
      ws.send(JSON.stringify(playerInfo(playerState)));

      // Catch the new socket up on what is already known, without waiting for
      // the next change. A payload for a known different song is stale; while no
      // song is known yet, the cache can only be the one that was playing.
      const currentVideoId = playerState.song?.videoId;
      const isCurrent = (videoId: string) =>
        currentVideoId === undefined || videoId === currentVideoId;
      if (lastLyrics?.providers.length && isCurrent(lastLyrics.videoId ?? '')) {
        ws.send(JSON.stringify({ type: 'LYRICS_CHANGED', ...lastLyrics }));
      }
      if (lastTranslation && isCurrent(lastTranslation.videoId)) {
        ws.send(
          JSON.stringify({ type: 'TRANSLATION_UPDATED', ...lastTranslation }),
        );
      }
    },
    onClose(_, ws) {
      sockets.delete(ws);
    },
    onMessage(event) {
      runCommand(event.data, actions);
    },
  }));

  // `upgradeWebSocket` may resolve to void, but zod-openapi's handler type only
  // accepts a Response.
  const wsRoute = createWsRoute(
    path,
    tags,
    'WebSocket endpoint. Pushes PLAYER_INFO, VIDEO_CHANGED, ' +
      'PLAYER_STATE_CHANGED, POSITION_CHANGED, VOLUME_CHANGED, REPEAT_CHANGED, ' +
      'SHUFFLE_CHANGED, RATING_CHANGED, LYRICS_CHANGED and TRANSLATION_UPDATED. ' +
      'Commands: NEXT_VIDEO/SKIP_VIDEO, PREV_VIDEO/PREVIOUS_VIDEO, ' +
      'PLAYBACK { status, speed, position, shuffle, repeat, volume, mute } and ' +
      'RATE { status }.',
  );
  app.openapi(wsRoute, handler as unknown as RouteHandler<typeof wsRoute>);

  return () => {
    for (const stop of teardown.splice(0)) {
      stop();
    }
    sockets.clear();
  };
};
