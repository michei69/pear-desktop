// An OpenAPI 3.1 document for the route table and the plugins' RPC methods.

import { jsonSchema } from "./body-schema.ts";
import { MCP_PATH } from "./mcp.ts";
import { API, rpcPath } from "./routes.ts";
import { API_V2 } from "./v2.ts";
import type { Route, RpcInfo } from "./types.ts";

type Operations = Record<string, unknown>;

const JSON_CONTENT = "application/json";

export function openApiDocument(routes: readonly Route[], title: string, rpc: readonly RpcInfo[] = []) {
  const paths: Record<string, Operations> = {};
  for (const route of routes) (paths[route.path] ??= {})[route.method.toLowerCase()] = routeOperation(route);
  for (const method of rpc) paths[rpcPath(method.plugin, method.name)] = { post: rpcOperation(method) };
  for (const path of [`${API}/ws`, `${API_V2}/ws`]) {
    paths[path] = {
      get: {
        summary: "WebSocket with real-time player updates (pass ?token= unless auth is off)",
        responses: { 101: { description: "Switching Protocols" } },
      },
    };
  }
  paths[MCP_PATH] = {
    post: {
      summary: "MCP Streamable HTTP endpoint (JSON responses, stateless); off unless the API server's mcpEnabled is on",
      responses: {
        200: { description: "A JSON-RPC response" },
        400: { description: "Invalid JSON-RPC request" },
        401: { description: "Missing or invalid token" },
        404: { description: "MCP disabled" },
        405: { description: "Only POST is supported" },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      version: "2.0.0",
      title,
      description: "Get an access token from `/auth/{id}` first to call the endpoints under `/api/v2` (v1 stays as it was).",
    },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

function routeOperation(route: Route) {
  const params = [...route.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: "path",
    required: true,
    schema: { type: name === "index" ? "integer" : "string" },
  }));
  const operation: Operations = {
    summary: route.summary,
    ...(route.public ? { security: [] } : {}),
    ...(params.length ? { parameters: params } : {}),
    responses: {
      200: { description: "Success" },
      204: { description: "No content" },
      400: { description: "Invalid request body", content: errorBody() },
      404: { description: "Not found", content: errorBody() },
      502: { description: "The page or the provider failed", content: errorBody() },
    },
  };
  if (route.body && route.body !== "json") operation.requestBody = jsonBody(jsonSchema(route.body));
  return operation;
}

function rpcOperation(method: RpcInfo) {
  return {
    summary: method.summary ?? `${method.plugin}: ${method.name}`,
    tags: [`plugin: ${method.plugin}`],
    ...(method.input ? { requestBody: jsonBody(method.input) } : {}),
    responses: {
      200: { description: "The method's result" },
      400: { description: "Invalid input", content: errorBody() },
      404: { description: "No such method" },
      503: { description: "Plugin disabled" },
    },
  };
}

const errorBody = () => ({ [JSON_CONTENT]: { schema: { type: "object", properties: { error: { type: "string" } } } } });

function jsonBody(schema: unknown) {
  return { required: true, content: { [JSON_CONTENT]: { schema } } };
}
