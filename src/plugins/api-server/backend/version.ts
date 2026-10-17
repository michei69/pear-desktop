import { OpenAPIHono } from '@hono/zod-openapi';

import { requireAuth } from './auth';

import type { APIServerConfig } from '../config';
import type { BackendContext } from '@/types/contexts';

/**
 * The WebSocket endpoint, relative to the version prefix. It authenticates with
 * a `?token=` query param instead of the `Authorization` header, because
 * browsers cannot set headers on a WebSocket handshake.
 */
const WS_PATH = '/ws';

/**
 * One API version as a self-contained router: its prefix, auth guard and
 * WebSocket endpoint stay in one place instead of being repeated per version.
 * `register` wires that version's routes and returns the socket teardown.
 */
export const createVersion = (
  path: string,
  { getConfig }: BackendContext<APIServerConfig>,
  register: (app: OpenAPIHono, wsPath: string) => () => void,
) => {
  const app = new OpenAPIHono().basePath(path);
  const wsPath = `${path}${WS_PATH}`;

  // `requireAuth` matches `ctx.req.path`, which is absolute even inside a
  // sub-app, while `createRoute` paths are relative to `basePath`.
  app.use('*', requireAuth(getConfig, wsPath));
  const stopWebsocket = register(app, wsPath);

  return { app, stopWebsocket };
};
