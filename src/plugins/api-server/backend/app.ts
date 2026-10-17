import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';

import { APPLICATION_NAME } from '@/i18n';

import { registerAuthRoute } from './auth';
import { apiTagOrder } from './tags';
import { createV1 } from './v1';
import { createV2 } from './v2';

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

  // One line per API version. Each module owns its prefix, its auth guard and
  // its WebSocket endpoint, so adding v2 doesn't touch v1.
  const v1 = createV1(ctx, playerState);
  app.route('/', v1.app);

  const v2 = createV2(ctx, playerState);
  app.route('/', v2.app);

  // Outside any version: this is the endpoint that hands out the token every
  // version's routes require.
  registerAuthRoute(app, ctx);

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  app.doc('/doc', {
    // 3.2 is where the QUERY method exists as a path item; a document carrying
    // one can't honestly claim 3.1. The bundled Swagger UI is unpinned and
    // loads 5.3x, which understands it.
    openapi: '3.2.0',
    info: {
      version: '2.1.0',
      title: `${APPLICATION_NAME} API Server`,
      description:
        'Note: You need to get an access token using the `/auth/{id}` endpoint first to call any API endpoints under `/api`.',
    },
    tags: apiTagOrder.map((name) => ({ name })),
    security: [{ bearerAuth: [] }],
  });
  app.get('/swagger', swaggerUI({ url: '/doc' }));

  return {
    app,
    stopWebsocket: () => {
      v1.stopWebsocket();
      v2.stopWebsocket();
    },
  };
};
