import { upgradeWebSocket, type WebSocketLike } from '@hono/node-server';
import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
  z,
} from '@hono/zod-openapi';

import { verifyApiToken } from './auth';
import { createV1EventAdapter, v1PlayerInfo } from './websocket-v1-events';

import { AuthStrategy, type APIServerConfig } from '../config';

import type { PlayerState } from './state';
import type { BackendContext } from '@/types/contexts';
import type { WSContext } from 'hono/ws';

const createWsRoute = (
  path: string,
  tags: string[] = [],
  description = 'WebSocket endpoint for real-time updates',
) =>
  createRoute({
    method: 'get',
    path,
    summary: 'websocket endpoint',
    description,
    tags,
    request: {
      query: z.object({
        token: z
          .string()
          .openapi({
            description:
              'Authentication token. Required when the API server authStrategy is not NONE; optional otherwise.',
          })
          .optional(),
      }),
    },
    responses: {
      101: {
        description: 'Switching Protocols',
      },
    },
  });

/**
 * Verifies a WebSocket handshake's `?token=` against the API server's clients.
 * The route itself is exempt from the HTTP auth middleware because browsers
 * cannot set an Authorization header on a WebSocket handshake.
 */
export const createWsAuthenticator =
  (getConfig: BackendContext<APIServerConfig>['getConfig']) =>
  async (token: string | undefined) => {
    const config = await getConfig();

    if (config.authStrategy === AuthStrategy.NONE) {
      return true;
    }

    return verifyApiToken(config, token, { logFailure: true });
  };

type PlayerSocketOptions = {
  path: string;
  tags?: string[];
  description?: string;
  authenticate: (token: string | undefined) => Promise<boolean>;
  /** Runs after the handshake was authenticated; the socket is already tracked. */
  onOpen?: (ws: WSContext<WebSocketLike>) => void;
  /** Runs for every client frame. */
  onMessage?: (data: unknown) => void;
};

/** Drop frames to a client that has this much still queued, in bytes. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

/**
 * A socket is worth a frame only while it is open and not already behind on
 * delivery; an unresponsive client would otherwise queue broadcasts without
 * bound. `WSContext` hides the buffer, but its raw `ws` socket reports it.
 */
const canReceive = (socket: WSContext<WebSocketLike>) =>
  socket.readyState === 1 &&
  ((socket.raw as { bufferedAmount?: number } | undefined)?.bufferedAmount ??
    0) <= MAX_BUFFERED_BYTES;

/**
 * The server skeleton shared by both versions: one socket set per endpoint,
 * the `?token=` auth guard (closing 1008 on failure), socket bookkeeping and
 * route registration. The connect payload, event pushes and message handling
 * are the caller's.
 */
export const upgradePlayerSocket = (
  app: OpenAPIHono,
  {
    path,
    tags = [],
    description,
    authenticate,
    onOpen,
    onMessage,
  }: PlayerSocketOptions,
) => {
  const sockets = new Set<WSContext<WebSocketLike>>();

  const broadcast = (payload: unknown) => {
    const message = JSON.stringify(payload);
    for (const socket of sockets) {
      if (canReceive(socket)) socket.send(message);
    }
  };

  const handler = upgradeWebSocket((ctx) => ({
    async onOpen(_, ws) {
      // Authenticate before tracking: a broadcast must never reach a socket
      // whose token has not been verified yet.
      if (!(await authenticate(ctx.req.query('token')))) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      // Closed while authenticating: `onClose` already ran, so don't track it.
      if (!canReceive(ws)) return;

      sockets.add(ws);
      onOpen?.(ws);
    },
    onClose(_, ws) {
      sockets.delete(ws);
    },
    onMessage(event) {
      onMessage?.(event.data);
    },
  }));

  // `upgradeWebSocket` may resolve to void, but zod-openapi's handler type only
  // accepts a Response.
  const wsRoute = createWsRoute(path, tags, description);
  app.openapi(wsRoute, handler as unknown as RouteHandler<typeof wsRoute>);

  return {
    broadcast,
    close: () => sockets.clear(),
  };
};

/**
 * Broadcasts every player event to the connected clients. Sockets are tracked
 * per server instance, so a restart can't leave clients wired to a dead app.
 */
export const registerWebsocket = (
  app: OpenAPIHono,
  { getConfig }: BackendContext<APIServerConfig>,
  playerState: PlayerState,
  path: string,
  tags: string[] = [],
) => {
  const { broadcast, close } = upgradePlayerSocket(app, {
    path,
    tags,
    authenticate: createWsAuthenticator(getConfig),
    onOpen(ws) {
      ws.send(JSON.stringify(v1PlayerInfo(playerState.snapshot())));
    },
  });

  const adaptEvent = createV1EventAdapter();
  const unsubscribe = playerState.subscribe((event) => {
    const v1Event = adaptEvent(event);
    if (!v1Event) return;

    broadcast(v1Event);
  });

  return () => {
    unsubscribe();
    close();
  };
};
