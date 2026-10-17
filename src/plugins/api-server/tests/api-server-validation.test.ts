/**
 * The default validation hook, so a request that fails its schema answers the
 * same `{ error }` body as a route whose operation failed.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { expect, test } from '@playwright/test';

import { body, readable, validationHook } from '../backend/route-helpers';

const createApp = () => {
  const app = new OpenAPIHono({ defaultHook: validationHook });
  app.openapi(
    createRoute({
      method: 'post',
      path: '/thing',
      request: { body: body(z.object({ count: z.number() })) },
      responses: { 204: { description: 'Success' } },
      tags: [],
    }),
    (ctx) => ctx.body(null, 204),
  );

  return app;
};

const post = (body: unknown) =>
  createApp().request('/thing', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('readable documents a 502 for a renderer that does not answer', () => {
  const route = readable({
    path: '/thing',
    summary: 'get a thing',
    description: 'Get a thing',
    schema: z.object({ ok: z.boolean() }),
    tags: [],
  });

  expect(route.responses).toHaveProperty('502');
});

test('a valid request reaches the handler', async () => {
  const response = await post({ count: 2 });

  expect(response.status).toBe(204);
});

test('a validation failure answers { error }, not the zValidator shape', async () => {
  const response = await post({ count: 'two' });
  const payload = (await response.json()) as Record<string, unknown>;

  expect(response.status).toBe(400);
  expect(Object.keys(payload)).toEqual(['error']);
  expect(payload.error).toContain('count');
});
