import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';

import { APPLICATION_NAME } from '@/i18n';

import { API_PREFIX } from './api-version';
import { registerAuthRoute, requireAuth } from './auth';
import { registerRoutes } from './routes';
import { registerWebsocket } from './websocket';

import type { APIServerConfig } from '../config';
import type { PlayerState } from './state';
import type { BackendContext } from '@/types/contexts';

/** Builds the Hono app: middleware, routes, and the OpenAPI/Swagger endpoints. */
export const buildApp = (
  ctx: BackendContext<APIServerConfig>,
  playerState: PlayerState,
) => {
  const app = new OpenAPIHono();

  app.use('*', cors());

  // For web remote control
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Private-Network', 'true');
    await next();
  });

  app.use(`${API_PREFIX}/*`, requireAuth(ctx.getConfig));

  registerRoutes(app, ctx, playerState);
  registerAuthRoute(app, ctx);
  const stopWebsocket = registerWebsocket(app, ctx, playerState);

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  app.doc('/doc', {
    openapi: '3.1.0',
    info: {
      version: '1.0.0',
      title: `${APPLICATION_NAME} API Server`,
      description:
        'Note: You need to get an access token using the `/auth/{id}` endpoint first to call any API endpoints under `/api`.',
    },
    security: [{ bearerAuth: [] }],
  });
  app.get('/swagger', swaggerUI({ url: '/doc' }));

  return { app, stopWebsocket };
};
