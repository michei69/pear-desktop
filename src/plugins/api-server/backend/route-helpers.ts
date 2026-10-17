import { createRoute, z, type Hook } from '@hono/zod-openapi';

import { ErrorSchema } from './schemas-common';

import type { Context, Env } from 'hono';

/**
 * Validation failures answer the same `{ error }` body as the routes' own
 * failures, instead of zValidator's `{ success, error: { issues } }` shape.
 */
export const validationHook: Hook<
  unknown,
  Env,
  string,
  Response | undefined
> = (result, ctx) => {
  if (result.success) return undefined;

  return ctx.json(
    {
      error: result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    },
    400,
  );
};

export const SUCCESS = { 204: { description: 'Success' } };
export const JSON_CONTENT = 'application/json';

export const noContent = (ctx: Context) => ctx.body(null, 204);

export const body = <S extends z.ZodType>(schema: S) => ({
  required: true,
  content: { [JSON_CONTENT]: { schema } },
});

/** A route that performs a player action and reports 204. */
export const action = (
  method: 'post' | 'patch' | 'delete',
  path: string,
  summary: string,
  description: string,
  tags: string[],
) =>
  createRoute({
    method,
    path,
    summary,
    description,
    tags,
    responses: SUCCESS,
  });

/** A 204 route that also takes a JSON body. */
export const actionWithBody = <S extends z.ZodType>(
  method: 'post' | 'patch' | 'delete',
  path: string,
  summary: string,
  description: string,
  schema: S,
  tags: string[],
) =>
  createRoute({
    method,
    path,
    summary,
    description,
    tags,
    request: { body: body(schema) },
    responses: SUCCESS,
  });

type ReadableOptions<S extends z.ZodType, Q extends z.ZodObject> = {
  path: string;
  summary: string;
  description: string;
  schema: S;
  query?: Q;
  emptyDescription?: string;
  deprecated?: boolean;
  tags: string[];
};

/**
 * A GET route returning JSON, optionally 204 when there's nothing to report,
 * and 502 when the renderer doesn't answer. `query` adds validated query
 * parameters; `deprecated` marks the route so.
 */
export const readable = <
  S extends z.ZodType,
  Q extends z.ZodObject = z.ZodObject<Record<string, never>>,
>({
  path,
  summary,
  description,
  schema,
  query = z.object({}) as Q,
  emptyDescription,
  deprecated,
  tags,
}: ReadableOptions<S, Q>) =>
  createRoute({
    method: 'get',
    path,
    summary,
    description,
    deprecated,
    tags,
    request: { query },
    responses: {
      200: {
        description: 'Success',
        content: { [JSON_CONTENT]: { schema } },
      },
      ...(emptyDescription ? { 204: { description: emptyDescription } } : {}),
      502: {
        description: 'The player did not answer',
        content: { [JSON_CONTENT]: { schema: ErrorSchema } },
      },
    },
  });
