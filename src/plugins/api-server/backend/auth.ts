import { getConnInfo } from '@hono/node-server/conninfo';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { dialog } from 'electron';
import { sign, verify } from 'hono/jwt';

import { t } from '@/i18n';
import { LoggerPrefix } from '@/utils';

import {
  AccessTokenSchema,
  JWTPayloadSchema,
  type JWTPayload,
} from './schemas';
import { AUTH_TAG } from './tags';

import { AuthStrategy, type APIServerConfig } from '../config';

import type { BackendContext } from '@/types/contexts';
import type { MiddlewareHandler } from 'hono';

const JWT_ALG = 'HS256';

const bearerToken = (header: string | undefined) =>
  header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

/**
 * Verifies an API token against the server's secret and authorized clients.
 * Shared by the HTTP auth middleware and the WebSocket handshake; each caller
 * handles its own `authStrategy === NONE` bypass. `logFailure` is for callers
 * that cannot answer a normal 401, i.e. the WebSocket handshake.
 */
export const verifyApiToken = async (
  config: APIServerConfig,
  token: string | undefined,
  { logFailure = false }: { logFailure?: boolean } = {},
): Promise<boolean> => {
  if (!token) {
    return false;
  }

  let payload: unknown;
  try {
    payload = await verify(token, config.secret, JWT_ALG);
  } catch (err) {
    if (logFailure) {
      console.error(LoggerPrefix, 'WebSocket authentication failed:', err);
    }
    return false;
  }

  const parsed = JWTPayloadSchema.safeParse(payload);
  return parsed.success && config.authorizedClients.includes(parsed.data.id);
};

/**
 * Guards everything under an API version's prefix. `wsPath` — that version's
 * WebSocket endpoint — is exempt, because browsers can't set an Authorization
 * header on a WebSocket handshake; it verifies its `?token=` query param
 * instead. Endpoints outside a version (the MCP server) pass no `wsPath`.
 */
export const requireAuth =
  (
    getConfig: () => APIServerConfig | Promise<APIServerConfig>,
    wsPath?: string,
  ): MiddlewareHandler =>
  async (ctx, next) => {
    if (wsPath && ctx.req.path === wsPath) {
      return next();
    }

    const config = await getConfig();
    if (config.authStrategy === AuthStrategy.NONE) {
      return next();
    }

    const token = bearerToken(ctx.req.header('authorization'));
    if (!(await verifyApiToken(config, token))) {
      return ctx.text('Unauthorized', 401);
    }

    return next();
  };

const requestRoute = createRoute({
  method: 'post',
  path: '/auth/{id}',
  summary: 'request an access token',
  description:
    'Authorizes a client id and returns a bearer token for the API endpoints.',
  tags: [AUTH_TAG],
  security: [],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Success',
      content: {
        'application/json': { schema: AccessTokenSchema },
      },
    },
    403: {
      description: 'Forbidden',
    },
  },
});

/**
 * `POST /auth/{id}` — deliberately outside the API prefix and unauthenticated:
 * this is the endpoint that hands out the token everything else needs.
 */
export const registerAuthRoute = (
  app: OpenAPIHono,
  { getConfig, setConfig }: BackendContext<APIServerConfig>,
) => {
  app.openapi(requestRoute, async (ctx) => {
    const config = await getConfig();
    const { id } = ctx.req.valid('param');

    const alreadyAuthorized = config.authorizedClients.includes(id);
    const needsApproval =
      !alreadyAuthorized && config.authStrategy === AuthStrategy.AUTH_AT_FIRST;

    if (needsApproval) {
      const { response } = await dialog.showMessageBox({
        title: t('plugins.api-server.dialog.request.title'),
        message: t('plugins.api-server.dialog.request.message', {
          origin: getConnInfo(ctx).remote.address,
          ID: id,
        }),
        buttons: [
          t('plugins.api-server.dialog.request.buttons.allow'),
          t('plugins.api-server.dialog.request.buttons.deny'),
        ],
        defaultId: 1,
        cancelId: 1,
      });

      if (response === 1) {
        return ctx.body(null, 403);
      }
    }

    if (!alreadyAuthorized) {
      // The whole list: config writes replace array values rather than merging
      // them, so sending just the new id would drop the other clients.
      setConfig({ authorizedClients: [...config.authorizedClients, id] });
    }

    const token = await sign(
      { id, iat: ~~(Date.now() / 1000) } satisfies JWTPayload,
      config.secret,
      JWT_ALG,
    );

    return ctx.json({ accessToken: token }, 200);
  });
};
