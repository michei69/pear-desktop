import { upgradeWebSocket, type WebSocketLike } from '@hono/node-server';
import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
  z,
} from '@hono/zod-openapi';
import { verify } from 'hono/jwt';

import { LoggerPrefix } from '@/utils';

import { JWTPayloadSchema } from './schemas';
import { createV1EventAdapter, v1PlayerInfo } from './websocket-v1-events';

import { AuthStrategy, type APIServerConfig } from '../config';

import type { PlayerState } from './state';
import type { BackendContext } from '@/types/contexts';
import type { WSContext } from 'hono/ws';

const JWT_ALG = 'HS256';

export const createWsRoute = (
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

    if (!token) {
      return false;
    }

    let payload: unknown;
    try {
      payload = await verify(token, config.secret, JWT_ALG);
    } catch (err) {
      console.error(LoggerPrefix, 'WebSocket authentication failed:', err);
      return false;
    }

    const parsed = JWTPayloadSchema.safeParse(payload);
    return parsed.success && config.authorizedClients.includes(parsed.data.id);
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
  const sockets = new Set<WSContext<WebSocketLike>>();

  const adaptEvent = createV1EventAdapter();
  const unsubscribe = playerState.subscribe((event) => {
    const v1Event = adaptEvent(event);
    if (!v1Event) return;

    const message = JSON.stringify(v1Event);
    for (const socket of sockets) {
      socket.send(message);
    }
  });

  const authenticate = createWsAuthenticator(getConfig);

  const handler = upgradeWebSocket((ctx) => ({
    async onOpen(_, ws) {
      if (!(await authenticate(ctx.req.query('token')))) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      sockets.add(ws);
      ws.send(JSON.stringify(v1PlayerInfo(playerState.snapshot())));
    },
    onClose(_, ws) {
      sockets.delete(ws);
    },
  }));

  // `upgradeWebSocket` may resolve to void, but zod-openapi's handler type only
  // accepts a Response.
  const wsRoute = createWsRoute(path, tags);
  app.openapi(wsRoute, handler as unknown as RouteHandler<typeof wsRoute>);

  return () => {
    unsubscribe();
    sockets.clear();
  };
};
